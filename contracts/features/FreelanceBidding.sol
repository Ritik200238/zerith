// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, euint128, InEuint128, eaddress, ebool, euint8, InEuint8} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

interface IAuctionClaimFL {
    function mint(address winner, address sourceContract, uint256 sourceId, string calldata claimType) external returns (uint256);
}

/// @title FreelanceBidding — Blind bidding with milestone-based release and encrypted dispute resolution
/// @notice Client posts job with milestones and escrowed budget. Freelancers bid encrypted prices.
///         Lowest bid wins. Escrow releases per milestone. Disputes resolved by 3 encrypted votes.
contract FreelanceBidding is Ownable, ReentrancyGuard, FHEConstants {
    enum JobStatus { OPEN, SETTLING, ASSIGNED, COMPLETED, CANCELLED }
    enum MilestoneStatus { PENDING, DELIVERED, APPROVED, DISPUTED, RESOLVED }

    struct Milestone {
        string description;
        uint8 percentageBps;  // basis points of total (e.g., 3000 = 30%)
        MilestoneStatus status;
        uint8 voteCount;
        euint8 voteSum;       // encrypted sum of votes (1=approve, 0=reject)
        uint256 deliveredAt;  // timestamp when freelancer marked delivered (for auto-release)
        mapping(address => bool) hasVoted;
    }

    struct Job {
        address client;
        address token;
        uint256 escrowAmount;
        uint256 deadline;
        uint256 bidCount;
        euint128 lowestBid;
        eaddress lowestBidder;
        uint128 revealedBid;
        address revealedBidder;
        JobStatus status;
        uint256 settleTimestamp;
        string title;
        uint8 milestoneCount;
        uint8 milestonesApproved;
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;
    IAuctionClaimFL public claimNFT;

    mapping(uint256 => Job) public jobs;
    mapping(uint256 => mapping(uint8 => Milestone)) public milestones;
    mapping(uint256 => mapping(address => euint128)) private bids;
    mapping(uint256 => mapping(address => bool)) public hasBid;

    mapping(address => bool) public isVoter;
    address[] public voters;

    uint256 public nextJobId;

    uint256 public constant MAX_BIDS = 10;
    uint256 public constant MAX_MILESTONES = 5;
    uint256 public constant REQUIRED_VOTES = 3;
    uint256 public constant MIN_DURATION = 300;
    uint256 public constant EMERGENCY_TIMEOUT = 7 days;
    uint256 public constant AUTO_RELEASE_TIMEOUT = 14 days;
    uint256 public constant PLATFORM_FEE_BPS = 300;
    uint256 public constant VOTER_REWARD_BPS = 50; // 0.5% to each voter

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Expired();
    error Paused();

    event JobPosted(uint256 indexed jobId, address indexed client, uint256 escrowAmount, uint256 deadline, uint8 milestoneCount);
    event BidSubmitted(uint256 indexed jobId, address indexed freelancer);
    event SettlementRequested(uint256 indexed jobId);
    event JobAssigned(uint256 indexed jobId, address indexed freelancer, uint128 agreedPrice);
    event MilestoneDelivered(uint256 indexed jobId, uint8 indexed milestoneIndex);
    event MilestoneApproved(uint256 indexed jobId, uint8 indexed milestoneIndex, uint256 paymentReleased);
    event MilestoneDisputed(uint256 indexed jobId, uint8 indexed milestoneIndex);
    event DisputeVoteSubmitted(uint256 indexed jobId, uint8 indexed milestoneIndex, address indexed voter);
    event DisputeResolved(uint256 indexed jobId, uint8 indexed milestoneIndex, bool freelancerWins);
    event JobCompleted(uint256 indexed jobId);
    event JobCancelled(uint256 indexed jobId);
    event JobFailed(uint256 indexed jobId);
    event VoterAdded(address indexed voter);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry, address _admin, address _claimNFT) Ownable(_admin) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        if (_claimNFT != address(0)) claimNFT = IAuctionClaimFL(_claimNFT);
        _initFHEConstants();
    }

    // ─── Voter Management ──────────────────────────────────

    /// @notice Admin adds a dispute voter
    function addVoter(address voter) external onlyOwner {
        if (voter == address(0)) revert InvalidInput();
        if (isVoter[voter]) revert InvalidState();
        isVoter[voter] = true;
        voters.push(voter);
        emit VoterAdded(voter);
    }

    // ─── Job Posting ───────────────────────────────────────

    /// @notice Client posts a job with milestones and escrowed budget
    /// @param milestoneDescriptions Description per milestone
    /// @param milestonePercentages Basis points per milestone (must sum to 10000)
    function postJob(
        address token,
        uint256 escrowAmount,
        uint256 duration,
        string calldata title,
        string[] calldata milestoneDescriptions,
        uint8[] calldata milestonePercentages
    ) external whenNotPaused returns (uint256 jobId) {
        if (escrowAmount == 0) revert InvalidInput();
        if (duration < MIN_DURATION) revert InvalidInput();
        if (bytes(title).length == 0) revert InvalidInput();
        if (milestoneDescriptions.length == 0 || milestoneDescriptions.length > MAX_MILESTONES) revert InvalidInput();
        if (milestoneDescriptions.length != milestonePercentages.length) revert InvalidInput();

        uint256 totalPct;
        for (uint256 i = 0; i < milestonePercentages.length; i++) {
            if (milestonePercentages[i] == 0) revert InvalidInput();
            totalPct += milestonePercentages[i];
        }
        if (totalPct != 100) revert InvalidInput();

        jobId = nextJobId++;
        uint256 deadline = block.timestamp + duration;

        euint128 initBid = FHE.asEuint128(type(uint128).max);
        eaddress initBidder = FHE.asEaddress(address(0));
        FHE.allowThis(initBid);
        FHE.allowThis(initBidder);

        Job storage job = jobs[jobId];
        job.client = msg.sender;
        job.token = token;
        job.escrowAmount = escrowAmount;
        job.deadline = deadline;
        job.bidCount = 0;
        job.lowestBid = initBid;
        job.lowestBidder = initBidder;
        job.status = JobStatus.OPEN;
        job.title = title;
        job.milestoneCount = uint8(milestoneDescriptions.length);
        job.milestonesApproved = 0;

        for (uint8 i = 0; i < milestoneDescriptions.length; i++) {
            Milestone storage ms = milestones[jobId][i];
            ms.description = milestoneDescriptions[i];
            ms.percentageBps = milestonePercentages[i];
            ms.status = MilestoneStatus.PENDING;
            ms.voteCount = 0;
        }

        emit JobPosted(jobId, msg.sender, escrowAmount, deadline, uint8(milestoneDescriptions.length));
    }

    // ─── Bidding ───────────────────────────────────────────

    /// @notice Freelancer submits encrypted bid price
    function submitBid(uint256 jobId, InEuint128 calldata encBidPrice) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.OPEN) revert InvalidState();
        if (block.timestamp >= job.deadline) revert Expired();
        if (job.client == msg.sender) revert InvalidInput();
        if (hasBid[jobId][msg.sender]) revert InvalidState();
        if (job.bidCount >= MAX_BIDS) revert InvalidState();

        euint128 newBid = FHE.asEuint128(encBidPrice);
        ebool isLower = FHE.lt(newBid, job.lowestBid);
        job.lowestBid = FHE.select(isLower, newBid, job.lowestBid);
        job.lowestBidder = FHE.select(isLower, FHE.asEaddress(msg.sender), job.lowestBidder);

        FHE.allowThis(job.lowestBid);
        FHE.allowThis(job.lowestBidder);

        bids[jobId][msg.sender] = newBid;
        FHE.allowThis(newBid);
        FHE.allowSender(newBid);

        hasBid[jobId][msg.sender] = true;
        job.bidCount++;

        emit BidSubmitted(jobId, msg.sender);
    }

    // ─── Settlement ────────────────────────────────────────

    /// @notice Trigger settlement after deadline
    function settle(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.OPEN) revert InvalidState();
        if (block.timestamp < job.deadline) revert InvalidState();

        if (job.bidCount == 0) {
            job.status = JobStatus.CANCELLED;
            emit JobFailed(jobId);
            return;
        }

        FHE.allowGlobal(job.lowestBid);
        FHE.allowGlobal(job.lowestBidder);
        job.status = JobStatus.SETTLING;
        job.settleTimestamp = block.timestamp;

        emit SettlementRequested(jobId);
    }

    /// @notice Finalize with verified Threshold Network signatures of the winning bid + bidder.
    /// @dev Caller fetches (value, signature) tuples via client.decryptForTx().withoutPermit().
    function finalizeSettlement(
        uint256 jobId,
        uint128 bidValue,
        bytes calldata bidSignature,
        address bidderValue,
        bytes calldata bidderSignature
    ) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.SETTLING) revert InvalidState();

        FHE.publishDecryptResult(job.lowestBid, bidValue, bidSignature);
        FHE.publishDecryptResult(job.lowestBidder, bidderValue, bidderSignature);

        if (bidderValue == address(0) || bidValue >= type(uint128).max) {
            job.status = JobStatus.CANCELLED;
            emit JobFailed(jobId);
            return;
        }

        job.revealedBid = bidValue;
        job.revealedBidder = bidderValue;
        job.status = JobStatus.ASSIGNED;

        // Mint Claim NFT to winning freelancer (proof-of-work credential)
        if (address(claimNFT) != address(0)) {
            claimNFT.mint(bidderValue, address(this), jobId, "FREELANCE");
        }

        emit JobAssigned(jobId, bidderValue, bidValue);
    }

    // ─── Milestone Delivery + Approval ─────────────────────

    /// @notice Freelancer marks a milestone as delivered
    function deliverMilestone(uint256 jobId, uint8 milestoneIndex) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.ASSIGNED) revert InvalidState();
        if (job.revealedBidder != msg.sender) revert Unauthorized();
        if (milestoneIndex >= job.milestoneCount) revert InvalidInput();

        Milestone storage ms = milestones[jobId][milestoneIndex];
        if (ms.status != MilestoneStatus.PENDING) revert InvalidState();

        ms.status = MilestoneStatus.DELIVERED;
        ms.deliveredAt = block.timestamp;
        emit MilestoneDelivered(jobId, milestoneIndex);
    }

    /// @notice Client approves a milestone → releases proportional escrow
    function approveMilestone(uint256 jobId, uint8 milestoneIndex) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.ASSIGNED) revert InvalidState();
        if (job.client != msg.sender) revert Unauthorized();
        if (milestoneIndex >= job.milestoneCount) revert InvalidInput();

        Milestone storage ms = milestones[jobId][milestoneIndex];
        if (ms.status != MilestoneStatus.DELIVERED) revert InvalidState();

        ms.status = MilestoneStatus.APPROVED;
        job.milestonesApproved++;

        uint256 payment = (uint256(job.revealedBid) * ms.percentageBps) / 100;
        uint256 fee = (payment * PLATFORM_FEE_BPS) / 10000;
        _transferPayment(job, payment - fee);

        emit MilestoneApproved(jobId, milestoneIndex, payment);

        if (job.milestonesApproved == job.milestoneCount) {
            // No-op: excess escrow stays in client's vault (audit fix C-FB2)
            job.status = JobStatus.COMPLETED;
            emit JobCompleted(jobId);
        }
    }

    // ─── Dispute Resolution (3-voter encrypted votes) ──────

    /// @notice Either party disputes a delivered milestone
    function disputeMilestone(uint256 jobId, uint8 milestoneIndex) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.ASSIGNED) revert InvalidState();
        if (msg.sender != job.client && msg.sender != job.revealedBidder) revert Unauthorized();
        if (milestoneIndex >= job.milestoneCount) revert InvalidInput();

        Milestone storage ms = milestones[jobId][milestoneIndex];
        if (ms.status != MilestoneStatus.DELIVERED) revert InvalidState();

        ms.status = MilestoneStatus.DISPUTED;

        euint8 initSum = FHE.asEuint8(0);
        FHE.allowThis(initSum);
        ms.voteSum = initSum;

        emit MilestoneDisputed(jobId, milestoneIndex);
    }

    /// @notice Voter submits encrypted vote (1 = approve/freelancer wins, 0 = reject/client wins)
    /// @dev FHE ops: asEuint8(1), add(1), allowThis(1) = 3 ops per vote
    function submitVote(uint256 jobId, uint8 milestoneIndex, InEuint8 calldata encVote) external {
        if (!isVoter[msg.sender]) revert Unauthorized();

        Job storage job = jobs[jobId];
        if (job.status != JobStatus.ASSIGNED) revert InvalidState();

        Milestone storage ms = milestones[jobId][milestoneIndex];
        if (ms.status != MilestoneStatus.DISPUTED) revert InvalidState();
        if (ms.hasVoted[msg.sender]) revert InvalidState();
        if (ms.voteCount >= REQUIRED_VOTES) revert InvalidState();

        euint8 vote = FHE.asEuint8(encVote);
        ms.voteSum = FHE.add(ms.voteSum, vote);
        FHE.allowThis(ms.voteSum);

        ms.hasVoted[msg.sender] = true;
        ms.voteCount++;

        emit DisputeVoteSubmitted(jobId, milestoneIndex, msg.sender);

        if (ms.voteCount == REQUIRED_VOTES) {
            FHE.allowGlobal(ms.voteSum);
        }
    }

    /// @notice Resolve dispute with verified majority-vote decryption.
    /// @dev voteSum >= 2 means freelancer approved. Caller obtains (totalVotes, signature)
    ///      via client.decryptForTx().withoutPermit() once all 3 votes are submitted.
    function resolveDispute(
        uint256 jobId,
        uint8 milestoneIndex,
        uint8 totalVotes,
        bytes calldata signature
    ) external nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage ms = milestones[jobId][milestoneIndex];
        if (ms.status != MilestoneStatus.DISPUTED) revert InvalidState();
        if (ms.voteCount < REQUIRED_VOTES) revert InvalidState();

        FHE.publishDecryptResult(ms.voteSum, totalVotes, signature);

        bool freelancerWins = totalVotes >= 2;
        ms.status = MilestoneStatus.RESOLVED;

        uint256 payment = (uint256(job.revealedBid) * ms.percentageBps) / 100;

        if (freelancerWins) {
            uint256 fee = (payment * PLATFORM_FEE_BPS) / 10000;
            _transferPayment(job, payment - fee);
            job.milestonesApproved++;

            if (job.milestonesApproved == job.milestoneCount) {
                // Excess escrow stays in client's vault (audit fix C-FB2)
                job.status = JobStatus.COMPLETED;
                emit JobCompleted(jobId);
            }
        } else {
            // Client wins — milestone's share stays in client's vault.
            // No on-chain transfer needed (audit fix C-FB1); escrow was never
            // moved out of the client's vault to begin with.
        }

        emit DisputeResolved(jobId, milestoneIndex, freelancerWins);
    }

    // ─── Internal Helpers ──────────────────────────────────

    function _transferPayment(Job storage job, uint256 amount) internal {
        euint64 encAmount = FHE.asEuint64(uint64(amount));
        FHE.allowThis(encAmount);
        FHE.allowTransient(encAmount, address(vault));
        FHE.allow(encAmount, address(vault));
        vault.settleTrade(job.client, job.revealedBidder, job.token, encAmount);
    }

    /// @dev Audit fix C-FB1/C-FB2: previously these functions called
    ///      vault.settleTrade(client, client, ...) which reverts on from==to.
    ///      The intent was always a no-op — escrow funds remain in the client's
    ///      vault throughout. _transferPayment moves money TO the freelancer when
    ///      the freelancer wins; if the client wins, no on-chain transfer happens
    ///      because the funds never left the client's vault. The "refund" was
    ///      always implicit. Functions removed entirely.

    // ─── Auto-Release (Upwork-style 14-day timeout) ──────

    /// @notice Auto-release milestone payment if client doesn't respond within 14 days
    /// @dev After freelancer delivers, client has 14 days to approve or dispute.
    ///      If they do nothing, anyone can trigger auto-release → freelancer gets paid.
    function autoReleaseMilestone(uint256 jobId, uint8 milestoneIndex) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.ASSIGNED) revert InvalidState();
        if (milestoneIndex >= job.milestoneCount) revert InvalidInput();

        Milestone storage ms = milestones[jobId][milestoneIndex];
        if (ms.status != MilestoneStatus.DELIVERED) revert InvalidState();
        if (ms.deliveredAt == 0) revert InvalidState();
        if (block.timestamp < ms.deliveredAt + AUTO_RELEASE_TIMEOUT) revert InvalidState();

        // 14 days passed with no approval or dispute → auto-approve
        ms.status = MilestoneStatus.APPROVED;
        job.milestonesApproved++;

        uint256 payment = (uint256(job.revealedBid) * ms.percentageBps) / 100;
        uint256 fee = (payment * PLATFORM_FEE_BPS) / 10000;
        _transferPayment(job, payment - fee);

        emit MilestoneApproved(jobId, milestoneIndex, payment);

        if (job.milestonesApproved == job.milestoneCount) {
            // No-op: excess escrow stays in client's vault (audit fix C-FB2)
            job.status = JobStatus.COMPLETED;
            emit JobCompleted(jobId);
        }
    }

    // ─── Cancel + Emergency ────────────────────────────────

    function cancelJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.client != msg.sender) revert Unauthorized();
        if (job.status != JobStatus.OPEN) revert InvalidState();
        if (job.bidCount != 0) revert InvalidState();

        job.status = JobStatus.CANCELLED;
        emit JobCancelled(jobId);
    }

    function emergencyRefund(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.SETTLING) revert InvalidState();
        if (block.timestamp < job.settleTimestamp + EMERGENCY_TIMEOUT) revert InvalidState();

        job.status = JobStatus.CANCELLED;
        emit JobFailed(jobId);
    }

    // ─── Views ─────────────────────────────────────────────

    function getMyBid(uint256 jobId) external view returns (euint128) {
        if (!hasBid[jobId][msg.sender]) revert InvalidState();
        return bids[jobId][msg.sender];
    }

    function getJob(uint256 jobId) external view returns (
        address client, address token, uint256 escrowAmount, uint256 deadline,
        uint256 bidCount, JobStatus status, uint128 revealedBid,
        address revealedBidder, string memory title,
        uint8 milestoneCount, uint8 milestonesApproved
    ) {
        Job storage j = jobs[jobId];
        return (j.client, j.token, j.escrowAmount, j.deadline,
                j.bidCount, j.status, j.revealedBid, j.revealedBidder,
                j.title, j.milestoneCount, j.milestonesApproved);
    }

    function getMilestone(uint256 jobId, uint8 index) external view returns (
        string memory description, uint8 percentageBps, MilestoneStatus status, uint8 voteCount
    ) {
        Milestone storage ms = milestones[jobId][index];
        return (ms.description, ms.percentageBps, ms.status, ms.voteCount);
    }

    function getJobCount() external view returns (uint256) {
        return nextJobId;
    }

    function hasJobs() external view returns (bool) {
        return nextJobId > 0;
    }

    function getVoters() external view returns (address[] memory) {
        return voters;
    }
}
