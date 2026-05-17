// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EncryptedRaffle — public entry, encrypted winner selection
/// @notice F6 from the Wave 4 plan. Anyone buys a ticket (publicly).
///         When the deadline hits, the contract draws a random winner
///         using FHE.randomEuint64() — the winning *index* is encrypted
///         until a Threshold-Network signature reveals it.
///
/// @dev Why this is interesting: a normal on-chain raffle leaks the
///      winner the moment the random number lands on-chain. A commit-reveal
///      scheme requires honest off-chain coordinators. With FHE.random()
///      we get a verifiably-fair winner that nobody — not even the raffle
///      creator — can predict or front-run, and the winner-index stays
///      encrypted on-chain until everyone is ready to see it.
///
/// Privacy posture:
///   - Tickets bought publicly (entry list public on-chain)
///   - Random winner index encrypted via FHE.randomEuint64() % ticketCount
///   - Reveal happens via Threshold Network signature
///   - Prize claim is public (winner takes the pot)
contract EncryptedRaffle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum RaffleStatus { OPEN, CLOSED, REVEAL_REQUESTED, REVEALED, CLAIMED, CANCELLED }

    struct Raffle {
        address creator;
        address token;
        uint256 ticketPrice;
        uint64 maxTickets;
        uint64 ticketCount;
        uint64 deadline;
        address winner;
        uint64 winnerIndex;
        RaffleStatus status;
    }

    /// @notice raffles[id] — 1-indexed
    uint256 public raffleCount;
    mapping(uint256 => Raffle) public raffles;

    /// @notice raffles[id].participants — public ticket-holder list
    mapping(uint256 => address[]) private participants;

    /// @notice raffles[id].encWinnerIndex — pending encrypted index after drawWinner
    mapping(uint256 => euint64) private encWinnerIndex;

    /// @notice Cap to keep gas bounded. Each draw is O(1) FHE.
    uint64 public constant MAX_TICKETS = 1000;

    // ─── Events ─────────────────────────────────────────────

    event RaffleCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed token,
        uint256 ticketPrice,
        uint64 maxTickets,
        uint64 deadline
    );
    event TicketBought(uint256 indexed id, address indexed buyer, uint64 ticketNumber);
    event WinnerDrawn(uint256 indexed id);
    event WinnerRevealed(uint256 indexed id, address indexed winner, uint64 index);
    event PrizeClaimed(uint256 indexed id, address indexed winner, uint256 prize);
    event RaffleCancelled(uint256 indexed id);

    // ─── Errors ─────────────────────────────────────────────

    error InvalidInput();
    error NotCreator();
    error NotOpen();
    error NotClosed();
    error NotRevealed();
    error NotWinner();
    error AlreadyClaimed();
    error TicketLimit();
    error TooEarly();
    error NotFound();
    error IndexOutOfBounds();

    // ─── Lifecycle ──────────────────────────────────────────

    /// @notice Create a new raffle. Anyone can be the creator.
    function createRaffle(
        address token,
        uint256 ticketPrice,
        uint64 maxTickets,
        uint64 duration
    ) external returns (uint256 id) {
        if (token == address(0) || ticketPrice == 0) revert InvalidInput();
        if (maxTickets < 2 || maxTickets > MAX_TICKETS) revert InvalidInput();
        if (duration < 60 || duration > 30 days) revert InvalidInput();

        raffleCount += 1;
        id = raffleCount;
        uint64 deadline = uint64(block.timestamp) + duration;

        raffles[id] = Raffle({
            creator: msg.sender,
            token: token,
            ticketPrice: ticketPrice,
            maxTickets: maxTickets,
            ticketCount: 0,
            deadline: deadline,
            winner: address(0),
            winnerIndex: 0,
            status: RaffleStatus.OPEN
        });

        emit RaffleCreated(id, msg.sender, token, ticketPrice, maxTickets, deadline);
    }

    /// @notice Buy one ticket at the listed price.
    function buyTicket(uint256 id) external nonReentrant {
        Raffle storage r = raffles[id];
        if (r.creator == address(0)) revert NotFound();
        if (r.status != RaffleStatus.OPEN) revert NotOpen();
        if (block.timestamp > r.deadline) revert NotOpen();
        if (r.ticketCount >= r.maxTickets) revert TicketLimit();

        IERC20(r.token).safeTransferFrom(msg.sender, address(this), r.ticketPrice);
        participants[id].push(msg.sender);
        uint64 ticketNumber = r.ticketCount;
        r.ticketCount += 1;

        emit TicketBought(id, msg.sender, ticketNumber);
    }

    /// @notice After the deadline, anyone can trigger the encrypted draw.
    /// @dev Generates a random euint64 and reduces it modulo ticketCount.
    ///      The result is the encrypted winning index.
    function drawWinner(uint256 id) external nonReentrant {
        Raffle storage r = raffles[id];
        if (r.creator == address(0)) revert NotFound();
        if (r.status != RaffleStatus.OPEN) revert NotOpen();
        if (block.timestamp <= r.deadline) revert TooEarly();
        if (r.ticketCount == 0) revert InvalidInput();

        euint64 random = FHE.randomEuint64();
        FHE.allowThis(random);
        euint64 mod = FHE.asEuint64(r.ticketCount);
        FHE.allowThis(mod);
        euint64 idx = FHE.rem(random, mod);
        FHE.allowThis(idx);
        FHE.allowGlobal(idx);

        encWinnerIndex[id] = idx;
        r.status = RaffleStatus.REVEAL_REQUESTED;

        emit WinnerDrawn(id);
    }

    /// @notice Publish the TN-signed reveal of the winning index.
    /// @dev Anyone can call. The signature inside FHE.publishDecryptResult
    ///      is what gates correctness. Winner is then computable from the
    ///      public participant list.
    function revealWinner(
        uint256 id,
        uint64 winnerIndex,
        bytes calldata sig
    ) external nonReentrant {
        Raffle storage r = raffles[id];
        if (r.creator == address(0)) revert NotFound();
        if (r.status != RaffleStatus.REVEAL_REQUESTED) revert NotClosed();
        if (winnerIndex >= r.ticketCount) revert IndexOutOfBounds();

        FHE.publishDecryptResult(encWinnerIndex[id], winnerIndex, sig);

        r.winnerIndex = winnerIndex;
        r.winner = participants[id][winnerIndex];
        r.status = RaffleStatus.REVEALED;

        emit WinnerRevealed(id, r.winner, winnerIndex);
    }

    /// @notice Winner pulls the prize (sum of all ticket payments).
    function claimPrize(uint256 id) external nonReentrant {
        Raffle storage r = raffles[id];
        if (r.creator == address(0)) revert NotFound();
        if (r.status != RaffleStatus.REVEALED) revert NotRevealed();
        if (msg.sender != r.winner) revert NotWinner();

        r.status = RaffleStatus.CLAIMED;
        uint256 prize = r.ticketPrice * uint256(r.ticketCount);
        IERC20(r.token).safeTransfer(r.winner, prize);

        emit PrizeClaimed(id, r.winner, prize);
    }

    /// @notice Creator cancels a raffle that has 0 tickets sold.
    /// @dev Once anyone has bought a ticket, refunding becomes complex,
    ///      so we simply lock cancellation to empty raffles. Use case:
    ///      created by mistake.
    function cancelEmpty(uint256 id) external nonReentrant {
        Raffle storage r = raffles[id];
        if (r.creator == address(0)) revert NotFound();
        if (msg.sender != r.creator) revert NotCreator();
        if (r.status != RaffleStatus.OPEN) revert NotOpen();
        if (r.ticketCount > 0) revert InvalidInput();

        r.status = RaffleStatus.CANCELLED;
        emit RaffleCancelled(id);
    }

    // ─── Views ──────────────────────────────────────────────

    function getRaffleCount() external view returns (uint256) {
        return raffleCount;
    }

    function getParticipants(uint256 id) external view returns (address[] memory) {
        return participants[id];
    }

    /// @notice Encrypted winner-index handle for off-chain decryptForView.
    function getEncWinnerIndex(uint256 id) external view returns (euint64) {
        return encWinnerIndex[id];
    }
}
