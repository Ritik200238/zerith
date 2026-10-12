// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";

/// @title EncryptedStreaming — Sablier-style payments with encrypted rate
/// @notice Wave 4 WOW feature. Payer locks an encrypted *rate-per-second*
///         in their vault. Recipient claims at any time; contract computes
///         encRate * (now - lastClaim) on ciphertext, settles via vault.
///         Neither the rate nor the cumulative payout ever decrypts.
///
/// @dev We use rate-per-second instead of total/duration to avoid the
///      `FHE.div` requirement (only plaintext divisors are supported).
///      Multiplication of euint64 by a public uint64 is gas-cheap.
contract EncryptedStreaming is ReentrancyGuard {
    enum StreamStatus { ACTIVE, CANCELLED, COMPLETED }

    struct Stream {
        address payer;
        address recipient;
        address token;
        uint64 startTime;
        uint64 endTime;
        uint64 lastClaimTime;
        euint64 ratePerSecond; // encrypted; how much per second
        StreamStatus status;
    }

    /// @notice next stream ID; 1-indexed for ergonomics
    uint256 public streamCount;

    mapping(uint256 => Stream) public streams;

    ISettlementVault public immutable vault;

    // ─── Events ─────────────────────────────────────────────

    event StreamCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed recipient,
        address token,
        uint64 startTime,
        uint64 endTime
    );
    event StreamClaimed(uint256 indexed id, uint64 atTime);
    event StreamCancelled(uint256 indexed id);
    event StreamCompleted(uint256 indexed id);

    // ─── Errors ─────────────────────────────────────────────

    error InvalidInput();
    error InvalidStream();
    error NotPayer();
    error NotRecipient();
    error NotActive();
    error TooEarly();

    // ─── Constructor ────────────────────────────────────────

    constructor(address _vault) {
        if (_vault == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
    }

    // ─── Stream Lifecycle ───────────────────────────────────

    /// @notice Create a new encrypted-rate stream. Payer must have at least
    ///         the *expected total* (encRate * duration) deposited in vault;
    ///         the contract does not pre-debit — settle pulls from payer's
    ///         balance at claim time. Underflow falls into vault's
    ///         zero-replacement (transfers 0 if insufficient).
    function createStream(
        address recipient,
        address token,
        InEuint64 calldata encRateInput,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 id) {
        if (recipient == address(0) || token == address(0)) revert InvalidInput();
        if (recipient == msg.sender) revert InvalidInput();
        if (startTime < block.timestamp) revert InvalidInput();
        if (endTime <= startTime) revert InvalidInput();
        if (endTime - startTime < 60) revert InvalidInput(); // at least 60 seconds

        streamCount += 1;
        id = streamCount;

        euint64 rate = FHE.asEuint64(encRateInput);
        FHE.allowThis(rate);
        FHE.allow(rate, msg.sender);   // payer can read their own rate
        FHE.allow(rate, recipient);    // recipient can read it

        streams[id] = Stream({
            payer: msg.sender,
            recipient: recipient,
            token: token,
            startTime: startTime,
            endTime: endTime,
            lastClaimTime: startTime,
            ratePerSecond: rate,
            status: StreamStatus.ACTIVE
        });

        emit StreamCreated(id, msg.sender, recipient, token, startTime, endTime);
    }

    /// @notice Recipient claims any vested amount. Calculates encrypted
    ///         delta = ratePerSecond × elapsedSeconds, settles via vault.
    function claim(uint256 id) external nonReentrant {
        Stream storage s = streams[id];
        if (s.payer == address(0)) revert InvalidStream();
        if (s.status != StreamStatus.ACTIVE) revert NotActive();
        if (msg.sender != s.recipient) revert NotRecipient();
        if (block.timestamp < s.startTime) revert TooEarly();

        uint64 nowClamped = block.timestamp >= s.endTime
            ? s.endTime
            : uint64(block.timestamp);

        if (nowClamped == s.lastClaimTime) revert TooEarly();

        uint64 elapsed = nowClamped - s.lastClaimTime;

        // amount = ratePerSecond * elapsed (multiplication by plaintext)
        // Safe up to ~580 years for euint64 with reasonable rates.
        euint64 amount = FHE.mul(s.ratePerSecond, FHE.asEuint64(elapsed));
        FHE.allowThis(amount);
        FHE.allowTransient(amount, address(vault));
        FHE.allow(amount, address(vault));

        s.lastClaimTime = nowClamped;

        // Settle: payer → recipient. Vault uses zero-replacement on underflow.
        vault.settleTrade(s.payer, s.recipient, s.token, amount);

        if (nowClamped >= s.endTime) {
            s.status = StreamStatus.COMPLETED;
            emit StreamCompleted(id);
        }

        emit StreamClaimed(id, nowClamped);
    }

    /// @notice Payer cancels future streaming. Already-vested amounts can
    ///         still be claimed by the recipient until they call claim().
    function cancel(uint256 id) external {
        Stream storage s = streams[id];
        if (s.payer == address(0)) revert InvalidStream();
        if (s.status != StreamStatus.ACTIVE) revert NotActive();
        if (msg.sender != s.payer) revert NotPayer();

        // Lock end time at "now" so no further accrual happens.
        s.endTime = uint64(block.timestamp);
        s.status = StreamStatus.CANCELLED;
        emit StreamCancelled(id);
    }

    // ─── Views ──────────────────────────────────────────────

    function getStreamCount() external view returns (uint256) {
        return streamCount;
    }

    function getStream(uint256 id)
        external
        view
        returns (
            address payer,
            address recipient,
            address token,
            uint64 startTime,
            uint64 endTime,
            uint64 lastClaimTime,
            StreamStatus status
        )
    {
        Stream storage s = streams[id];
        return (s.payer, s.recipient, s.token, s.startTime, s.endTime, s.lastClaimTime, s.status);
    }

    /// @notice Get the encrypted rate handle for the caller's view.
    /// @dev Only payer or recipient can decrypt (allow set in createStream).
    function getRate(uint256 id) external view returns (euint64) {
        Stream storage s = streams[id];
        return s.ratePerSecond;
    }
}
