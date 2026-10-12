// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, externalEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title PrivatePayments — Encrypted multi-recipient payroll splits, escrowed up front
/// @notice The creator funds a split with encrypted per-recipient amounts. The whole
///         split is locked from the creator's vault balance when it's created, so every
///         recipient can always claim their amount. Per-recipient amounts AND the total
///         stay encrypted; each recipient can unseal only their own.
/// @dev All-or-nothing: if the creator can't cover the (encrypted) total, or the
///      amounts overflow uint64 when summed, nothing is locked and every recipient's
///      amount becomes 0. Supports reusable templates for recurring payroll.
contract PrivatePayments is ReentrancyGuard, FHEConstants {
    enum SplitStatus { FUNDED, COMPLETED, CANCELLED }

    struct Split {
        address creator;
        address token;
        uint256 recipientCount;
        uint256 claimedCount;
        SplitStatus status;
        uint256 createdAt;
        uint256 templateId; // 0 = no template
    }

    struct Template {
        address creator;
        string name;
        address[] recipients;
        bool active;
    }

    ISettlementVault public vault;
    IPlatformRegistry public registry;

    mapping(uint256 => Split) public splits;
    mapping(uint256 => mapping(address => euint64)) private encAmounts;
    mapping(uint256 => mapping(address => bool)) public isRecipient;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;
    mapping(uint256 => address[]) private splitRecipients;
    uint256 public nextSplitId;

    mapping(uint256 => Template) public templates;
    mapping(address => uint256[]) public creatorTemplates;
    uint256 public nextTemplateId;

    mapping(address => uint256[]) public creatorSplitHistory;
    mapping(address => uint256[]) public recipientSplitHistory;

    uint256 public constant MAX_RECIPIENTS = 20;
    uint256 public constant PLATFORM_FEE_BPS = 30;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error Paused();

    event SplitCreated(uint256 indexed splitId, address indexed creator, address token, uint256 recipientCount);
    event SplitFunded(uint256 indexed splitId);
    event PaymentClaimed(uint256 indexed splitId, address indexed recipient);
    event SplitCancelled(uint256 indexed splitId);
    event SplitCompleted(uint256 indexed splitId);
    event TemplateCreated(uint256 indexed templateId, address indexed creator, string name);
    event TemplateDeactivated(uint256 indexed templateId);

    modifier whenNotPaused() {
        if (registry.paused()) revert Paused();
        _;
    }

    constructor(address _vault, address _registry) {
        if (_vault == address(0) || _registry == address(0)) revert InvalidInput();
        vault = ISettlementVault(_vault);
        registry = IPlatformRegistry(_registry);
        _initFHEConstants();
    }

    // ─── Templates ─────────────────────────────────────────

    /// @notice Save a reusable recipient list for recurring payments
    function createTemplate(
        string calldata name,
        address[] calldata _recipients
    ) external returns (uint256 templateId) {
        if (_recipients.length == 0 || _recipients.length > MAX_RECIPIENTS) revert InvalidInput();
        if (bytes(name).length == 0) revert InvalidInput();

        for (uint256 i = 0; i < _recipients.length; i++) {
            if (_recipients[i] == address(0)) revert InvalidInput();
        }

        templateId = nextTemplateId++;
        templates[templateId].creator = msg.sender;
        templates[templateId].name = name;
        templates[templateId].active = true;

        for (uint256 i = 0; i < _recipients.length; i++) {
            templates[templateId].recipients.push(_recipients[i]);
        }

        creatorTemplates[msg.sender].push(templateId);
        emit TemplateCreated(templateId, msg.sender, name);
    }

    /// @notice Deactivate a template
    function deactivateTemplate(uint256 templateId) external {
        if (templates[templateId].creator != msg.sender) revert Unauthorized();
        if (!templates[templateId].active) revert InvalidState();
        templates[templateId].active = false;
        emit TemplateDeactivated(templateId);
    }

    // ─── Splits ────────────────────────────────────────────

    /// @notice Create and fund a split with encrypted amounts
    function createSplit(
        address token,
        address[] calldata _recipients,
        externalEuint64[] calldata encAmounts_,
        bytes calldata signature
    ) external whenNotPaused nonReentrant returns (uint256 splitId) {
        splitId = _createSplitInternal(token, _recipients, encAmounts_, signature, 0);
    }

    /// @notice Create and fund a split from a saved template (recurring use)
    function createSplitFromTemplate(
        uint256 templateId,
        address token,
        externalEuint64[] calldata encAmounts_,
        bytes calldata signature
    ) external whenNotPaused nonReentrant returns (uint256 splitId) {
        Template storage tmpl = templates[templateId];
        if (tmpl.creator != msg.sender) revert Unauthorized();
        if (!tmpl.active) revert InvalidState();
        if (tmpl.recipients.length != encAmounts_.length) revert InvalidInput();

        splitId = _createSplitInternal(token, tmpl.recipients, encAmounts_, signature, templateId);
    }

    function _createSplitInternal(
        address token,
        address[] memory _recipients,
        externalEuint64[] calldata encAmounts_,
        bytes calldata signature,
        uint256 templateId
    ) internal returns (uint256 splitId) {
        if (_recipients.length == 0 || _recipients.length > MAX_RECIPIENTS) revert InvalidInput();
        if (_recipients.length != encAmounts_.length) revert InvalidInput();

        splitId = nextSplitId++;
        splits[splitId] = Split({
            creator: msg.sender,
            token: token,
            recipientCount: _recipients.length,
            claimedCount: 0,
            status: SplitStatus.FUNDED,
            createdAt: block.timestamp,
            templateId: templateId
        });

        // Sum the encrypted amounts, tracking uint64 overflow so a wrapped total can
        // never lock less than the recipients are later paid.
        // One batch signature covers every amount (CoFHE 1.0 input verification).
        euint64[] memory amounts = FHE.asEuint64s(encAmounts_, signature);
        euint64 total = ZERO_64;
        ebool noOverflow = FHE.asEbool(true);
        for (uint256 i = 0; i < _recipients.length; i++) {
            address recipient = _recipients[i];
            if (recipient == address(0)) revert InvalidInput();
            if (isRecipient[splitId][recipient]) revert InvalidInput(); // no duplicates
            isRecipient[splitId][recipient] = true;

            euint64 next = FHE.add(total, amounts[i]);
            noOverflow = FHE.and(noOverflow, FHE.gte(next, total));
            total = next;
        }

        // Lock the whole split from the creator: all of it, or nothing.
        euint64 toLock = FHE.select(noOverflow, total, ZERO_64);
        euint64 locked = FHE.receiveEuint64FromCall(
            vault.lockFunds(msg.sender, token, FHE.shareEuint64(toLock, address(vault))),
            address(vault)
        );
        ebool funded = FHE.and(noOverflow, FHE.eq(locked, total));

        for (uint256 i = 0; i < _recipients.length; i++) {
            address recipient = _recipients[i];
            euint64 amount = FHE.select(funded, amounts[i], ZERO_64);
            encAmounts[splitId][recipient] = amount;
            splitRecipients[splitId].push(recipient);

            FHE.allowThis(amount);
            FHE.allow(amount, recipient);
            FHE.allow(amount, msg.sender); // the creator can audit what they're paying

            recipientSplitHistory[recipient].push(splitId);
        }

        creatorSplitHistory[msg.sender].push(splitId);
        emit SplitCreated(splitId, msg.sender, token, _recipients.length);
        emit SplitFunded(splitId);
    }

    // ─── Claims (single-step, no decryption) ─────────────

    /// @notice Claim payment from escrow. The amount is never decrypted on-chain;
    ///         the recipient can unseal it off-chain with a permit before or after claiming.
    function claim(uint256 splitId) external whenNotPaused nonReentrant {
        Split storage split = splits[splitId];
        if (split.status != SplitStatus.FUNDED) revert InvalidState();
        if (!isRecipient[splitId][msg.sender]) revert Unauthorized();
        if (hasClaimed[splitId][msg.sender]) revert InvalidState();

        hasClaimed[splitId][msg.sender] = true;
        split.claimedCount++;

        _release(msg.sender, split.token, encAmounts[splitId][msg.sender]);

        if (split.claimedCount == split.recipientCount) {
            split.status = SplitStatus.COMPLETED;
            emit SplitCompleted(splitId);
        }

        emit PaymentClaimed(splitId, msg.sender);
    }

    // ─── Management ────────────────────────────────────────

    /// @notice Cancel a split and return every unclaimed amount to the creator.
    ///         Recipients who already claimed keep their payment.
    function cancelSplit(uint256 splitId) external nonReentrant {
        Split storage split = splits[splitId];
        if (split.creator != msg.sender) revert Unauthorized();
        if (split.status != SplitStatus.FUNDED) revert InvalidState();

        split.status = SplitStatus.CANCELLED;
        address[] storage rs = splitRecipients[splitId];
        for (uint256 i = 0; i < rs.length; i++) {
            if (!hasClaimed[splitId][rs[i]]) {
                hasClaimed[splitId][rs[i]] = true;
                _release(split.creator, split.token, encAmounts[splitId][rs[i]]);
            }
        }
        emit SplitCancelled(splitId);
    }

    function _release(address to, address token, euint64 amount) internal {
        vault.releaseFunds(to, token, FHE.shareEuint64(amount, address(vault)));
    }

    // ─── Views ─────────────────────────────────────────────

    function getMyAmount(uint256 splitId) external view returns (euint64) {
        if (!isRecipient[splitId][msg.sender]) revert Unauthorized();
        return encAmounts[splitId][msg.sender];
    }

    /// @notice Creator view of one recipient's encrypted amount (unseal with a permit)
    function getRecipientAmount(uint256 splitId, address recipient) external view returns (euint64) {
        if (splits[splitId].creator != msg.sender) revert Unauthorized();
        if (!isRecipient[splitId][recipient]) revert InvalidInput();
        return encAmounts[splitId][recipient];
    }

    function getSplit(uint256 splitId) external view returns (
        address creator, address token,
        uint256 recipientCount, uint256 claimedCount, SplitStatus status, uint256 templateId
    ) {
        Split storage s = splits[splitId];
        return (s.creator, s.token, s.recipientCount, s.claimedCount, s.status, s.templateId);
    }

    function getRecipients(uint256 splitId) external view returns (address[] memory) {
        return splitRecipients[splitId];
    }

    function getTemplateRecipients(uint256 templateId) external view returns (address[] memory) {
        return templates[templateId].recipients;
    }

    function getCreatorTemplates(address creator) external view returns (uint256[] memory) {
        return creatorTemplates[creator];
    }

    function getCreatorHistory(address creator) external view returns (uint256[] memory) {
        return creatorSplitHistory[creator];
    }

    function getRecipientHistory(address recipient) external view returns (uint256[] memory) {
        return recipientSplitHistory[recipient];
    }

    function getSplitCount() external view returns (uint256) {
        return nextSplitId;
    }

    function hasSplits() external view returns (bool) {
        return nextSplitId > 0;
    }
}
