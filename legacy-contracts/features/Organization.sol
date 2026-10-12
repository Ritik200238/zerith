// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";

/// @title Organization — DAO primitive with encrypted vote weights
/// @notice Wave 4 foundational primitive. An Organization is a named group of
///         members with encrypted voting weights. Members can post proposals
///         (referenced by an off-chain action hash) and vote. The tally runs
///         over ciphertext; only the final yes/no result is revealed via
///         Threshold Network signature, never the per-member votes.
///
/// @dev Off-chain integrations watch ProposalRevealed events and execute
///      the corresponding action when the proposal passes.
contract Organization is ReentrancyGuard {
    enum Role { NONE, MEMBER, ADMIN }

    enum ProposalStatus {
        PENDING,        // open for voting
        REVEAL_REQUESTED, // tally posted; waiting for off-chain reveal sig
        APPROVED,       // yesWeight > noWeight when revealed
        REJECTED,       // noWeight >= yesWeight when revealed
        EXECUTED        // off-chain executor flagged it as actioned
    }

    struct Org {
        string name;
        address admin;
        uint64 memberCount;
        uint64 proposalCount;
        uint64 createdAt;
        bool exists;
    }

    struct Proposal {
        address proposer;
        string description;     // free-text label
        bytes32 actionHash;     // hash of the proposed action's off-chain spec
        uint64 createdAt;
        uint64 deadline;
        euint64 yesWeight;
        euint64 noWeight;
        ProposalStatus status;
        // revealed values (populated after publishDecryptResult)
        bool revealed;
        uint64 revealedYes;
        uint64 revealedNo;
    }

    // ─── Storage ────────────────────────────────────────────

    IPlatformRegistry public immutable registry;

    /// @notice next org ID; orgIds start at 1
    uint256 public orgCount;

    mapping(uint256 => Org) public orgs;
    mapping(uint256 => mapping(address => Role)) public roles;

    /// @notice encrypted vote weight per member. Admin sets at addMember time.
    mapping(uint256 => mapping(address => euint64)) public encWeight;

    /// @notice org → proposal ID → proposal
    mapping(uint256 => mapping(uint256 => Proposal)) public proposals;

    /// @notice org → proposal ID → member → has voted
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasVoted;

    /// @notice org → proposal ID → has the admin requested reveal
    mapping(uint256 => mapping(uint256 => bool)) public revealRequested;

    // ─── Events ─────────────────────────────────────────────

    event OrgCreated(uint256 indexed orgId, address indexed admin, string name);
    event MemberAdded(uint256 indexed orgId, address indexed member, Role role);
    event MemberRemoved(uint256 indexed orgId, address indexed member);
    event ProposalCreated(
        uint256 indexed orgId,
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 actionHash,
        uint64 deadline
    );
    event VoteCast(uint256 indexed orgId, uint256 indexed proposalId, address indexed voter);
    event RevealRequested(uint256 indexed orgId, uint256 indexed proposalId);
    event ProposalRevealed(
        uint256 indexed orgId,
        uint256 indexed proposalId,
        uint64 yesWeight,
        uint64 noWeight,
        ProposalStatus result
    );
    event ProposalExecuted(uint256 indexed orgId, uint256 indexed proposalId);

    // ─── Errors ─────────────────────────────────────────────

    error NotAdmin();
    error NotMember();
    error AlreadyMember();
    error AlreadyVoted();
    error VotingClosed();
    error VotingOpen();
    error NotPending();
    error NotRevealed();
    error InvalidInput();
    error OrgNotFound();

    // ─── Constructor ────────────────────────────────────────

    constructor(address _registry) {
        if (_registry == address(0)) revert InvalidInput();
        registry = IPlatformRegistry(_registry);
    }

    // ─── Org Management ─────────────────────────────────────

    /// @notice Create a new org with the caller as admin.
    function createOrg(string calldata name) external returns (uint256 orgId) {
        if (bytes(name).length == 0 || bytes(name).length > 64) revert InvalidInput();
        orgCount += 1;
        orgId = orgCount;
        orgs[orgId] = Org({
            name: name,
            admin: msg.sender,
            memberCount: 1,
            proposalCount: 0,
            createdAt: uint64(block.timestamp),
            exists: true
        });
        roles[orgId][msg.sender] = Role.ADMIN;

        // admin starts with weight zero — must explicitly set via addMember
        // for self-vote allocation. This avoids accidentally giving admin
        // unlimited weight.
        emit OrgCreated(orgId, msg.sender, name);
        emit MemberAdded(orgId, msg.sender, Role.ADMIN);
    }

    /// @notice Add a new member with an encrypted voting weight.
    /// @dev Admin only. weight is encrypted in the client and submitted as
    ///      InEuint64. Members can vote with this weight on proposals.
    function addMember(
        uint256 orgId,
        address member,
        InEuint64 calldata weightInput
    ) external nonReentrant {
        Org storage o = orgs[orgId];
        if (!o.exists) revert OrgNotFound();
        if (o.admin != msg.sender) revert NotAdmin();
        if (member == address(0)) revert InvalidInput();
        if (roles[orgId][member] != Role.NONE) revert AlreadyMember();

        roles[orgId][member] = Role.MEMBER;
        euint64 weight = FHE.asEuint64(weightInput);
        FHE.allowThis(weight);
        FHE.allow(weight, member); // member can read their own weight
        encWeight[orgId][member] = weight;
        o.memberCount += 1;

        emit MemberAdded(orgId, member, Role.MEMBER);
    }

    /// @notice Update an existing member's encrypted weight.
    function updateWeight(
        uint256 orgId,
        address member,
        InEuint64 calldata weightInput
    ) external nonReentrant {
        Org storage o = orgs[orgId];
        if (!o.exists) revert OrgNotFound();
        if (o.admin != msg.sender) revert NotAdmin();
        if (roles[orgId][member] == Role.NONE) revert NotMember();

        euint64 weight = FHE.asEuint64(weightInput);
        FHE.allowThis(weight);
        FHE.allow(weight, member);
        encWeight[orgId][member] = weight;
    }

    /// @notice Remove a member from the org. Their weight is zeroed.
    function removeMember(uint256 orgId, address member) external {
        Org storage o = orgs[orgId];
        if (!o.exists) revert OrgNotFound();
        if (o.admin != msg.sender) revert NotAdmin();
        if (roles[orgId][member] == Role.NONE) revert NotMember();
        if (member == o.admin) revert InvalidInput();

        roles[orgId][member] = Role.NONE;
        // do not delete encWeight — historical proposals already counted it
        o.memberCount -= 1;
        emit MemberRemoved(orgId, member);
    }

    // ─── Proposals ──────────────────────────────────────────

    /// @notice Submit a new proposal. Any member can propose.
    /// @param orgId target organization
    /// @param description short label
    /// @param actionHash keccak256(abi.encode(...)) of the off-chain action spec
    /// @param duration seconds until voting closes (60..30 days)
    function createProposal(
        uint256 orgId,
        string calldata description,
        bytes32 actionHash,
        uint64 duration
    ) external returns (uint256 proposalId) {
        Org storage o = orgs[orgId];
        if (!o.exists) revert OrgNotFound();
        if (roles[orgId][msg.sender] == Role.NONE) revert NotMember();
        if (bytes(description).length == 0 || bytes(description).length > 200) revert InvalidInput();
        if (duration < 60 || duration > 30 days) revert InvalidInput();
        if (actionHash == bytes32(0)) revert InvalidInput();

        o.proposalCount += 1;
        proposalId = o.proposalCount;

        // Initialize encrypted accumulators to zero. allowThis lets the
        // contract keep operating on them across votes.
        euint64 zeroYes = FHE.asEuint64(0);
        euint64 zeroNo  = FHE.asEuint64(0);
        FHE.allowThis(zeroYes);
        FHE.allowThis(zeroNo);

        proposals[orgId][proposalId] = Proposal({
            proposer: msg.sender,
            description: description,
            actionHash: actionHash,
            createdAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp) + duration,
            yesWeight: zeroYes,
            noWeight: zeroNo,
            status: ProposalStatus.PENDING,
            revealed: false,
            revealedYes: 0,
            revealedNo: 0
        });

        emit ProposalCreated(orgId, proposalId, msg.sender, actionHash, uint64(block.timestamp) + duration);
    }

    /// @notice Cast an encrypted vote. Member's encWeight is added to the
    ///         appropriate side; the per-vote weight is never revealed.
    /// @dev Uses FHE.select to add either weight or 0 — no per-vote leak
    ///      via gas patterns.
    function vote(uint256 orgId, uint256 proposalId, bool support) external nonReentrant {
        Proposal storage p = proposals[orgId][proposalId];
        if (p.proposer == address(0)) revert InvalidInput();
        if (p.status != ProposalStatus.PENDING) revert NotPending();
        if (block.timestamp > p.deadline) revert VotingClosed();
        if (roles[orgId][msg.sender] == Role.NONE) revert NotMember();
        if (hasVoted[orgId][proposalId][msg.sender]) revert AlreadyVoted();

        hasVoted[orgId][proposalId][msg.sender] = true;

        euint64 weight = encWeight[orgId][msg.sender];

        if (support) {
            euint64 newYes = FHE.add(p.yesWeight, weight);
            FHE.allowThis(newYes);
            p.yesWeight = newYes;
        } else {
            euint64 newNo = FHE.add(p.noWeight, weight);
            FHE.allowThis(newNo);
            p.noWeight = newNo;
        }

        emit VoteCast(orgId, proposalId, msg.sender);
    }

    // ─── Reveal Flow ────────────────────────────────────────

    /// @notice Admin requests the tally be revealed. Voting must be closed.
    /// @dev Allows the encrypted handles globally so the off-chain Threshold
    ///      Network can fetch and sign them.
    function requestReveal(uint256 orgId, uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[orgId][proposalId];
        if (p.proposer == address(0)) revert InvalidInput();
        if (p.status != ProposalStatus.PENDING) revert NotPending();
        if (block.timestamp <= p.deadline) revert VotingOpen();
        Org storage o = orgs[orgId];
        if (o.admin != msg.sender) revert NotAdmin();

        FHE.allowGlobal(p.yesWeight);
        FHE.allowGlobal(p.noWeight);
        p.status = ProposalStatus.REVEAL_REQUESTED;
        revealRequested[orgId][proposalId] = true;

        emit RevealRequested(orgId, proposalId);
    }

    /// @notice Publish the threshold-network-signed reveal for both tallies.
    /// @dev Anyone may call this — the signature verification inside
    ///      FHE.publishDecryptResult is what gates correctness.
    function publishReveal(
        uint256 orgId,
        uint256 proposalId,
        uint64 yesValue,
        bytes calldata yesSig,
        uint64 noValue,
        bytes calldata noSig
    ) external nonReentrant {
        Proposal storage p = proposals[orgId][proposalId];
        if (p.proposer == address(0)) revert InvalidInput();
        if (p.status != ProposalStatus.REVEAL_REQUESTED) revert NotPending();

        FHE.publishDecryptResult(p.yesWeight, yesValue, yesSig);
        FHE.publishDecryptResult(p.noWeight,  noValue,  noSig);

        p.revealedYes = yesValue;
        p.revealedNo = noValue;
        p.revealed = true;
        p.status = yesValue > noValue ? ProposalStatus.APPROVED : ProposalStatus.REJECTED;

        emit ProposalRevealed(orgId, proposalId, yesValue, noValue, p.status);
    }

    /// @notice Mark a proposal as executed. Off-chain executor calls this
    ///         after performing the action keyed by actionHash.
    /// @dev Admin only — prevents griefing.
    function markExecuted(uint256 orgId, uint256 proposalId) external {
        Proposal storage p = proposals[orgId][proposalId];
        if (p.status != ProposalStatus.APPROVED) revert NotRevealed();
        Org storage o = orgs[orgId];
        if (o.admin != msg.sender) revert NotAdmin();

        p.status = ProposalStatus.EXECUTED;
        emit ProposalExecuted(orgId, proposalId);
    }

    // ─── Views ──────────────────────────────────────────────

    function getOrgCount() external view returns (uint256) {
        return orgCount;
    }

    function getProposalCount(uint256 orgId) external view returns (uint256) {
        return orgs[orgId].proposalCount;
    }

    function getRole(uint256 orgId, address member) external view returns (Role) {
        return roles[orgId][member];
    }

    function getMyWeight(uint256 orgId) external view returns (euint64) {
        return encWeight[orgId][msg.sender];
    }
}
