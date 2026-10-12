// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, ebool, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";

/// @title ConfidentialMultisig — encrypted-threshold multisig vault
/// @notice W5+ primitive. A multisig where:
///   - Each member holds an *encrypted* voting share
///   - The threshold itself is encrypted
///   - Settlement happens automatically when encrypted yes-share sum
///     crosses the encrypted threshold — no per-vote reveal needed
///
/// @dev The killer property: an outside observer sees only "this multisig
///      exists and approved transaction X." They cannot tell:
///        - how many shares anyone holds
///        - what the threshold actually is
///        - which votes contributed to approval
///
///      All of that is enforced on ciphertext via `FHE.gte` + `FHE.select`.
contract ConfidentialMultisig is ReentrancyGuard {
    enum ProposalStatus { PENDING, EXECUTED, EXPIRED }

    struct Multisig {
        address creator;
        address token;
        euint64 threshold;       // encrypted threshold for approval
        uint64 memberCount;
        uint64 proposalCount;
        bool exists;
    }

    struct Member {
        bool registered;
        euint64 share;           // encrypted vote weight
    }

    struct Proposal {
        address recipient;
        uint64 createdAt;
        uint64 deadline;
        euint64 amount;          // encrypted payout amount
        euint64 yesShares;       // encrypted running sum of yes-share weights
        ProposalStatus status;
    }

    /// @notice multisigs[id]
    uint256 public multisigCount;
    mapping(uint256 => Multisig) public multisigs;

    /// @notice multisigs[id].members[address]
    mapping(uint256 => mapping(address => Member)) public members;

    /// @notice multisigs[id].proposals[proposalId]
    mapping(uint256 => mapping(uint256 => Proposal)) public proposals;

    /// @notice voted[multisigId][proposalId][member] = true after voting
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public voted;

    ISettlementVault public immutable vault;

    // ─── Events ─────────────────────────────────────────────

    event MultisigCreated(uint256 indexed id, address indexed creator, address token);
    event MemberAdded(uint256 indexed id, address indexed member);
    event ProposalCreated(
        uint256 indexed multisigId,
        uint256 indexed proposalId,
        address indexed recipient,
        uint64 deadline
    );
    event Voted(uint256 indexed multisigId, uint256 indexed proposalId, address indexed member);
    event ProposalExecuted(uint256 indexed multisigId, uint256 indexed proposalId);

    // ─── Errors ─────────────────────────────────────────────

    error InvalidInput();
    error NotCreator();
    error NotMember();
    error AlreadyMember();
    error AlreadyVoted();
    error NotPending();
    error VotingClosed();
    error MultisigNotFound();
    error ProposalNotFound();

    // ─── Constructor ────────────────────────────────────────

    constructor(address _vault) {
        if (_vault == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
    }

    // ─── Multisig Lifecycle ─────────────────────────────────

    /// @notice Create a multisig with an encrypted threshold.
    /// @dev Creator's vault balance for `token` becomes the multisig's
    ///      treasury — the multisig itself doesn't pull funds; it settles
    ///      directly from the creator's vault account on execute. Creator
    ///      must remain the funded account.
    function createMultisig(
        address token,
        InEuint64 calldata thresholdInput
    ) external returns (uint256 id) {
        if (token == address(0)) revert InvalidInput();
        multisigCount += 1;
        id = multisigCount;

        euint64 threshold = FHE.asEuint64(thresholdInput);
        FHE.allowThis(threshold);
        FHE.allow(threshold, msg.sender);

        multisigs[id] = Multisig({
            creator: msg.sender,
            token: token,
            threshold: threshold,
            memberCount: 0,
            proposalCount: 0,
            exists: true
        });

        emit MultisigCreated(id, msg.sender, token);
    }

    /// @notice Add a member with an encrypted share.
    function addMember(
        uint256 id,
        address member,
        InEuint64 calldata shareInput
    ) external nonReentrant {
        Multisig storage m = multisigs[id];
        if (!m.exists) revert MultisigNotFound();
        if (m.creator != msg.sender) revert NotCreator();
        if (member == address(0)) revert InvalidInput();
        if (members[id][member].registered) revert AlreadyMember();

        euint64 share = FHE.asEuint64(shareInput);
        FHE.allowThis(share);
        FHE.allow(share, member);

        members[id][member] = Member({ registered: true, share: share });
        m.memberCount += 1;
        emit MemberAdded(id, member);
    }

    // ─── Proposal Flow ──────────────────────────────────────

    /// @notice Submit a proposal to send `amount` of `token` to `recipient`.
    /// @dev Only members can propose. Amount is encrypted.
    function createProposal(
        uint256 id,
        address recipient,
        InEuint64 calldata amountInput,
        uint64 duration
    ) external returns (uint256 proposalId) {
        Multisig storage m = multisigs[id];
        if (!m.exists) revert MultisigNotFound();
        if (!members[id][msg.sender].registered) revert NotMember();
        if (recipient == address(0)) revert InvalidInput();
        if (duration < 60 || duration > 30 days) revert InvalidInput();

        m.proposalCount += 1;
        proposalId = m.proposalCount;

        euint64 amt = FHE.asEuint64(amountInput);
        FHE.allowThis(amt);
        FHE.allow(amt, recipient); // recipient can verify amount post-execution

        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);

        proposals[id][proposalId] = Proposal({
            recipient: recipient,
            createdAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp) + duration,
            amount: amt,
            yesShares: zero,
            status: ProposalStatus.PENDING
        });

        emit ProposalCreated(id, proposalId, recipient, uint64(block.timestamp) + duration);
    }

    /// @notice Cast an encrypted yes-vote. Member's share is added to the
    ///         running yes-share sum; no-vote is implicit (don't call vote).
    /// @dev We never tally noShares — only yes matters for "did we cross threshold".
    function vote(uint256 id, uint256 proposalId) external nonReentrant {
        Multisig storage m = multisigs[id];
        if (!m.exists) revert MultisigNotFound();
        if (!members[id][msg.sender].registered) revert NotMember();
        Proposal storage p = proposals[id][proposalId];
        if (p.recipient == address(0)) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert NotPending();
        if (block.timestamp > p.deadline) revert VotingClosed();
        if (voted[id][proposalId][msg.sender]) revert AlreadyVoted();

        voted[id][proposalId][msg.sender] = true;
        euint64 newSum = FHE.add(p.yesShares, members[id][msg.sender].share);
        FHE.allowThis(newSum);
        p.yesShares = newSum;
        emit Voted(id, proposalId, msg.sender);
    }

    /// @notice Execute the proposal. Settles the encrypted amount IF the
    ///         encrypted yesShares ≥ encrypted threshold. Otherwise settles 0.
    /// @dev No reveal needed — `FHE.select` runs on ciphertext, `FHE.gte`
    ///      returns an encrypted bool, vault accepts the (possibly-zero)
    ///      euint64 amount via zero-replacement on insufficient balance.
    ///      Outside observers see "execute called" but not whether it
    ///      actually paid out or by how much.
    function execute(uint256 id, uint256 proposalId) external nonReentrant {
        Multisig storage m = multisigs[id];
        if (!m.exists) revert MultisigNotFound();
        Proposal storage p = proposals[id][proposalId];
        if (p.recipient == address(0)) revert ProposalNotFound();
        if (p.status != ProposalStatus.PENDING) revert NotPending();
        // Anyone may call execute after deadline OR before, if they are
        // confident the threshold is reached. The contract checks both:
        // condition is enforced via FHE.select on the actual amount.

        ebool passed = FHE.gte(p.yesShares, m.threshold);
        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);
        // amount or zero based on passed
        euint64 actual = FHE.select(passed, p.amount, zero);
        FHE.allowThis(actual);
        FHE.allowTransient(actual, address(vault));
        FHE.allow(actual, address(vault));

        p.status = ProposalStatus.EXECUTED;

        // Settle from creator's vault account → recipient.
        // Vault's zero-replacement handles insufficient-balance case.
        vault.settleTrade(m.creator, p.recipient, m.token, actual);

        emit ProposalExecuted(id, proposalId);
    }

    // ─── Views ──────────────────────────────────────────────

    function getMultisigCount() external view returns (uint256) {
        return multisigCount;
    }

    function getProposalCount(uint256 id) external view returns (uint256) {
        return multisigs[id].proposalCount;
    }

    function isMember(uint256 id, address who) external view returns (bool) {
        return members[id][who].registered;
    }

    function getProposalRecipient(uint256 id, uint256 proposalId)
        external
        view
        returns (address)
    {
        return proposals[id][proposalId].recipient;
    }
}
