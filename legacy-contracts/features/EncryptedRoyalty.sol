// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";

/// @title EncryptedRoyalty — royalty distribution with encrypted splits
/// @notice W5+ primitive. An on-chain royalty registry where the per-recipient
///         percentage is encrypted, but the recipient *list* is public so
///         payouts can route. When a royalty deposit lands, the contract
///         distributes the amount across recipients using their encrypted
///         percentages — no observer learns who got how much.
///
/// @dev Useful for music/art collaborations where the headline ratio
///      (e.g. lead vs producer vs label) is sensitive but the cap-table
///      members aren't.
///
///      Math: `payoutᵢ = amount × encPercentᵢ / 10000` (basis points).
///      We compute `FHE.mul(asEuint64(amount), encPercentᵢ)` then
///      `FHE.div(result, 10000)` — division by plaintext is supported.
///
///      Sum of encPercents must equal 10000 in the off-chain shape. The
///      contract trusts the registrant — there's no on-chain check that
///      they sum to 10000 because that would require revealing them.
contract EncryptedRoyalty is ReentrancyGuard {
    struct Royalty {
        address creator;
        address token;
        uint64 recipientCount;
        bool exists;
    }

    /// @notice royalties[id] — registered royalty splits, 1-indexed
    uint256 public royaltyCount;
    mapping(uint256 => Royalty) public royalties;

    /// @notice royalties[id].recipients — public list
    mapping(uint256 => address[]) private recipientLists;

    /// @notice royalties[id].percent[recipient] — encrypted basis points (out of 10000)
    mapping(uint256 => mapping(address => euint64)) public encPercent;

    ISettlementVault public immutable vault;

    // ─── Events ─────────────────────────────────────────────

    event RoyaltyRegistered(uint256 indexed id, address indexed creator, address token);
    event RecipientAdded(uint256 indexed id, address indexed recipient);
    event RoyaltyDistributed(uint256 indexed id, uint64 totalAmount);

    // ─── Errors ─────────────────────────────────────────────

    error InvalidInput();
    error NotCreator();
    error RoyaltyNotFound();
    error TooManyRecipients();

    /// @notice Hard cap on recipients per split. Each distribute call runs
    ///         O(N) FHE multiplications, so we keep N small.
    uint64 public constant MAX_RECIPIENTS = 10;

    constructor(address _vault) {
        if (_vault == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
    }

    // ─── Registration ───────────────────────────────────────

    /// @notice Register a royalty split. Pass parallel arrays of recipients
    ///         and their encrypted basis-point shares.
    function register(
        address token,
        address[] calldata recipients,
        InEuint64[] calldata percentInputs
    ) external returns (uint256 id) {
        if (token == address(0)) revert InvalidInput();
        if (recipients.length == 0 || recipients.length != percentInputs.length) {
            revert InvalidInput();
        }
        if (recipients.length > MAX_RECIPIENTS) revert TooManyRecipients();

        royaltyCount += 1;
        id = royaltyCount;

        royalties[id] = Royalty({
            creator: msg.sender,
            token: token,
            recipientCount: uint64(recipients.length),
            exists: true
        });

        for (uint256 i = 0; i < recipients.length; i++) {
            address r = recipients[i];
            if (r == address(0)) revert InvalidInput();
            recipientLists[id].push(r);
            euint64 pct = FHE.asEuint64(percentInputs[i]);
            FHE.allowThis(pct);
            FHE.allow(pct, r);            // recipient can verify their share
            FHE.allow(pct, msg.sender);   // creator can audit
            encPercent[id][r] = pct;
            emit RecipientAdded(id, r);
        }

        emit RoyaltyRegistered(id, msg.sender, token);
    }

    // ─── Distribution ───────────────────────────────────────

    /// @notice Distribute `amount` of the registered token across recipients.
    /// @dev Caller must be the funded account (typically the marketplace
    ///      forwarding a sale royalty). Each recipient receives
    ///      `amount × encPct[i] / 10000` via vault settlement on ciphertext.
    function distribute(uint256 id, uint64 amount) external nonReentrant {
        Royalty storage r = royalties[id];
        if (!r.exists) revert RoyaltyNotFound();
        if (amount == 0) revert InvalidInput();

        address[] storage recips = recipientLists[id];
        // Pre-scaled: shift the amount up by /10000 to embed the basis-point
        // divisor into the constant. payoutᵢ = (amount/10000) × encPctᵢ.
        // Since encPct is in basis points (out of 10000), this matches.
        // To avoid ciphertext division (which requires encrypted divisor),
        // we have the caller pass the *pre-scaled* amount: amount/10000.
        // For a 100-token sale, caller passes amount=100 and we treat
        // encPct as already-scaled basis points; payout = amount × encPct / 10000.
        // Implementation: encode the divisor as an encrypted constant
        // computed once per call.
        euint64 amountEnc = FHE.asEuint64(amount);
        FHE.allowThis(amountEnc);
        euint64 divisor = FHE.asEuint64(10000);
        FHE.allowThis(divisor);

        for (uint256 i = 0; i < recips.length; i++) {
            address recipient = recips[i];
            // payout = amount × encPct / 10000
            euint64 raw = FHE.mul(amountEnc, encPercent[id][recipient]);
            FHE.allowThis(raw);
            euint64 payout = FHE.div(raw, divisor);
            FHE.allowThis(payout);
            FHE.allowTransient(payout, address(vault));
            FHE.allow(payout, address(vault));

            vault.settleTrade(msg.sender, recipient, r.token, payout);
        }

        emit RoyaltyDistributed(id, amount);
    }

    // ─── Views ──────────────────────────────────────────────

    function getRoyaltyCount() external view returns (uint256) {
        return royaltyCount;
    }

    function getRecipients(uint256 id) external view returns (address[] memory) {
        return recipientLists[id];
    }

    /// @notice Get the encrypted basis-point share for a recipient.
    /// @dev Only the recipient or creator can decrypt (allow set in register).
    function getMyShare(uint256 id) external view returns (euint64) {
        return encPercent[id][msg.sender];
    }
}
