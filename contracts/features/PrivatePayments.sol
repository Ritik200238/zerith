// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISettlementVault} from "../interfaces/ISettlementVault.sol";
import {IPlatformRegistry} from "../interfaces/IPlatformRegistry.sol";
import {FHEConstants} from "../libraries/FHEConstants.sol";

/// @title PrivatePayments — Encrypted multi-recipient splits with templates and recurring
/// @notice Creator funds a split with encrypted per-recipient amounts. Each recipient
///         claims privately. Supports reusable templates for recurring payroll.
contract PrivatePayments is ReentrancyGuard, FHEConstants {
    enum SplitStatus { FUNDED, COMPLETED, CANCELLED }

    struct Split {
        address creator;
        address token;
        uint256 totalDeposited;
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
    event SplitFunded(uint256 indexed splitId, uint256 totalDeposited);
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
        InEuint64[] calldata encAmountsInput,
        uint256 totalDeposit
    ) external whenNotPaused nonReentrant returns (uint256 splitId) {
        splitId = _createSplitInternal(token, _recipients, encAmountsInput, totalDeposit, 0);
    }

    /// @notice Create and fund a split from a saved template (recurring use)
    function createSplitFromTemplate(
        uint256 templateId,
        address token,
        InEuint64[] calldata encAmountsInput,
        uint256 totalDeposit
    ) external whenNotPaused nonReentrant returns (uint256 splitId) {
        Template storage tmpl = templates[templateId];
        if (tmpl.creator != msg.sender) revert Unauthorized();
        if (!tmpl.active) revert InvalidState();
        if (tmpl.recipients.length != encAmountsInput.length) revert InvalidInput();

        splitId = _createSplitInternal(token, tmpl.recipients, encAmountsInput, totalDeposit, templateId);
    }

    function _createSplitInternal(
        address token,
        address[] memory _recipients,
        InEuint64[] calldata encAmountsInput,
        uint256 totalDeposit,
        uint256 templateId
    ) internal returns (uint256 splitId) {
        if (_recipients.length == 0 || _recipients.length > MAX_RECIPIENTS) revert InvalidInput();
        if (_recipients.length != encAmountsInput.length) revert InvalidInput();
        if (totalDeposit == 0) revert InvalidInput();

        splitId = nextSplitId++;

        splits[splitId] = Split({
            creator: msg.sender,
            token: token,
            totalDeposited: totalDeposit,
            recipientCount: _recipients.length,
            claimedCount: 0,
            status: SplitStatus.FUNDED,
            createdAt: block.timestamp,
            templateId: templateId
        });

        for (uint256 i = 0; i < _recipients.length; i++) {
            address recipient = _recipients[i];
            if (recipient == address(0)) revert InvalidInput();

            euint64 amount = FHE.asEuint64(encAmountsInput[i]);
            splitRecipients[splitId].push(recipient);
            encAmounts[splitId][recipient] = amount;
            isRecipient[splitId][recipient] = true;

            FHE.allowThis(amount);
            FHE.allow(amount, recipient);

            recipientSplitHistory[recipient].push(splitId);
        }

        creatorSplitHistory[msg.sender].push(splitId);
        emit SplitCreated(splitId, msg.sender, token, _recipients.length);
        emit SplitFunded(splitId, totalDeposit);
    }

    // ─── Claims (single-step, no decryption) ─────────────

    /// @notice Claim payment — passes encrypted handle directly to vault. Amount NEVER decrypted.
    /// @dev No on-chain decryption = amount stays encrypted forever. True end-to-end privacy.
    ///      Recipient can unseal their amount off-chain via cofhejs.unseal() before or after claiming.
    function claim(uint256 splitId) external whenNotPaused nonReentrant {
        Split storage split = splits[splitId];
        if (split.status != SplitStatus.FUNDED) revert InvalidState();
        if (!isRecipient[splitId][msg.sender]) revert Unauthorized();
        if (hasClaimed[splitId][msg.sender]) revert InvalidState();

        hasClaimed[splitId][msg.sender] = true;
        split.claimedCount++;

        // Pass encrypted handle DIRECTLY to vault — no decryption needed
        euint64 amount = encAmounts[splitId][msg.sender];
        FHE.allowTransient(amount, address(vault));
        FHE.allow(amount, address(vault));
        vault.settleTrade(split.creator, msg.sender, split.token, amount);

        if (split.claimedCount == split.recipientCount) {
            split.status = SplitStatus.COMPLETED;
            emit SplitCompleted(splitId);
        }

        emit PaymentClaimed(splitId, msg.sender);
    }

    // ─── Management ────────────────────────────────────────

    /// @notice Cancel split if nobody has claimed
    function cancelSplit(uint256 splitId) external {
        Split storage split = splits[splitId];
        if (split.creator != msg.sender) revert Unauthorized();
        if (split.status != SplitStatus.FUNDED) revert InvalidState();
        if (split.claimedCount > 0) revert InvalidState();

        split.status = SplitStatus.CANCELLED;
        emit SplitCancelled(splitId);
    }

    // ─── Views ─────────────────────────────────────────────

    function getMyAmount(uint256 splitId) external view returns (euint64) {
        if (!isRecipient[splitId][msg.sender]) revert Unauthorized();
        return encAmounts[splitId][msg.sender];
    }

    function getSplit(uint256 splitId) external view returns (
        address creator, address token, uint256 totalDeposited,
        uint256 recipientCount, uint256 claimedCount, SplitStatus status, uint256 templateId
    ) {
        Split storage s = splits[splitId];
        return (s.creator, s.token, s.totalDeposited, s.recipientCount, s.claimedCount, s.status, s.templateId);
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
