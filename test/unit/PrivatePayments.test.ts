import { expect } from "chai";
import hre from "hardhat";
import { PrivatePayments, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint64 } from "../helpers/cofhe";

describe("PrivatePayments", function () {
  let payments: PrivatePayments;
  let token: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let creator: HardhatEthersSigner;
  let recipient1: HardhatEthersSigner;
  let recipient2: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, creator, recipient1, recipient2, outsider] = await hre.ethers.getSigners();

    // Deploy token
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    token = await tokenFactory.deploy();
    await token.waitForDeployment();

    // Deploy PlatformRegistry
    const registryFactory = await hre.ethers.getContractFactory("PlatformRegistry");
    registry = await registryFactory.deploy(deployer.address, 100, deployer.address);
    await registry.waitForDeployment();

    // Deploy SettlementVault
    const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
    vault = await vaultFactory.deploy(
      await token.getAddress(),
      await registry.getAddress(),
      deployer.address
    );
    await vault.waitForDeployment();

    // Deploy PrivatePayments
    const paymentsFactory = await hre.ethers.getContractFactory("PrivatePayments");
    payments = await paymentsFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress()
    );
    await payments.waitForDeployment();

    // Authorize payments as settler
    await vault.addAuthorizedSettler(await payments.getAddress());
  });

  describe("createTemplate()", function () {
    it("creates template with recipients", async function () {
      await expect(
        payments.connect(creator).createTemplate(
          "Monthly Payroll",
          [recipient1.address, recipient2.address]
        )
      )
        .to.emit(payments, "TemplateCreated");

      const recipients = await payments.getTemplateRecipients(0);
      expect(recipients.length).to.equal(2);
      expect(recipients[0]).to.equal(recipient1.address);
      expect(recipients[1]).to.equal(recipient2.address);
    });

    it("reverts with empty name", async function () {
      await expect(
        payments.connect(creator).createTemplate("", [recipient1.address])
      ).to.be.revertedWithCustomError(payments, "InvalidInput");
    });

    it("reverts with zero recipients", async function () {
      await expect(
        payments.connect(creator).createTemplate("Test", [])
      ).to.be.revertedWithCustomError(payments, "InvalidInput");
    });

    it("reverts with zero address recipient", async function () {
      await expect(
        payments.connect(creator).createTemplate("Test", [hre.ethers.ZeroAddress])
      ).to.be.revertedWithCustomError(payments, "InvalidInput");
    });

    it("stores creator templates list", async function () {
      await payments.connect(creator).createTemplate("First", [recipient1.address]);
      await payments.connect(creator).createTemplate("Second", [recipient2.address]);

      const templateIds = await payments.getCreatorTemplates(creator.address);
      expect(templateIds.length).to.equal(2);
    });

    it("deactivates template", async function () {
      await payments.connect(creator).createTemplate("Test", [recipient1.address]);

      await expect(payments.connect(creator).deactivateTemplate(0))
        .to.emit(payments, "TemplateDeactivated")
        .withArgs(0);
    });

    it("reverts deactivate if not creator", async function () {
      await payments.connect(creator).createTemplate("Test", [recipient1.address]);

      await expect(
        payments.connect(outsider).deactivateTemplate(0)
      ).to.be.revertedWithCustomError(payments, "Unauthorized");
    });
  });

  describe("createSplitFromTemplate()", function () {
    beforeEach(async function () {
      await payments.connect(creator).createTemplate(
        "Payroll",
        [recipient1.address, recipient2.address]
      );
    });

    it("creates split from active template", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);
      const enc2 = await encryptUint64(creator, 300n);

      await expect(
        payments.connect(creator).createSplitFromTemplate(0, tokenAddr, [enc1, enc2], 800)
      )
        .to.emit(payments, "SplitCreated")
        .to.emit(payments, "SplitFunded");

      const s = await payments.getSplit(0);
      expect(s.creator).to.equal(creator.address);
      expect(s.token).to.equal(tokenAddr);
      expect(s.totalDeposited).to.equal(800n);
      expect(s.recipientCount).to.equal(2n);
      expect(s.claimedCount).to.equal(0n);
      expect(s.status).to.equal(0n); // FUNDED
      expect(s.templateId).to.equal(0n);
    });

    it("reverts if not template creator", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(outsider, 500n);
      const enc2 = await encryptUint64(outsider, 300n);

      await expect(
        payments.connect(outsider).createSplitFromTemplate(0, tokenAddr, [enc1, enc2], 800)
      ).to.be.revertedWithCustomError(payments, "Unauthorized");
    });

    it("reverts if template deactivated", async function () {
      await payments.connect(creator).deactivateTemplate(0);

      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);
      const enc2 = await encryptUint64(creator, 300n);

      await expect(
        payments.connect(creator).createSplitFromTemplate(0, tokenAddr, [enc1, enc2], 800)
      ).to.be.revertedWithCustomError(payments, "InvalidState");
    });

    it("reverts if amount count mismatch", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);

      await expect(
        payments.connect(creator).createSplitFromTemplate(0, tokenAddr, [enc1], 500)
      ).to.be.revertedWithCustomError(payments, "InvalidInput");
    });
  });

  describe("createSplit() (direct)", function () {
    it("creates split with recipients and amounts", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);
      const enc2 = await encryptUint64(creator, 300n);

      await expect(
        payments.connect(creator).createSplit(
          tokenAddr,
          [recipient1.address, recipient2.address],
          [enc1, enc2],
          800
        )
      )
        .to.emit(payments, "SplitCreated");

      const s = await payments.getSplit(0);
      expect(s.creator).to.equal(creator.address);
      expect(s.recipientCount).to.equal(2n);
      expect(s.templateId).to.equal(0n); // no template
    });

    it("reverts with zero deposit", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);

      await expect(
        payments.connect(creator).createSplit(
          tokenAddr, [recipient1.address], [enc1], 0
        )
      ).to.be.revertedWithCustomError(payments, "InvalidInput");
    });

    it("reverts with mismatched arrays", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);

      await expect(
        payments.connect(creator).createSplit(
          tokenAddr,
          [recipient1.address, recipient2.address],
          [enc1],
          500
        )
      ).to.be.revertedWithCustomError(payments, "InvalidInput");
    });
  });

  describe("claim() — single step, no decrypt", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);
      const enc2 = await encryptUint64(creator, 300n);

      await payments.connect(creator).createSplit(
        tokenAddr,
        [recipient1.address, recipient2.address],
        [enc1, enc2],
        800
      );
    });

    it("recipient claims successfully", async function () {
      await expect(payments.connect(recipient1).claim(0))
        .to.emit(payments, "PaymentClaimed")
        .withArgs(0, recipient1.address);

      expect(await payments.hasClaimed(0, recipient1.address)).to.equal(true);

      const s = await payments.getSplit(0);
      expect(s.claimedCount).to.equal(1n);
    });

    it("completes split when all recipients claim", async function () {
      await payments.connect(recipient1).claim(0);
      await expect(payments.connect(recipient2).claim(0))
        .to.emit(payments, "SplitCompleted")
        .withArgs(0);

      const s = await payments.getSplit(0);
      expect(s.status).to.equal(1n); // COMPLETED
      expect(s.claimedCount).to.equal(2n);
    });

    it("rejects double claim", async function () {
      await payments.connect(recipient1).claim(0);

      await expect(
        payments.connect(recipient1).claim(0)
      ).to.be.revertedWithCustomError(payments, "InvalidState");
    });

    it("rejects non-recipient", async function () {
      await expect(
        payments.connect(outsider).claim(0)
      ).to.be.revertedWithCustomError(payments, "Unauthorized");
    });
  });

  describe("cancelSplit()", function () {
    it("cancels split with no claims", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);

      await payments.connect(creator).createSplit(
        tokenAddr, [recipient1.address], [enc1], 500
      );

      await expect(payments.connect(creator).cancelSplit(0))
        .to.emit(payments, "SplitCancelled")
        .withArgs(0);

      const s = await payments.getSplit(0);
      expect(s.status).to.equal(2n); // CANCELLED
    });

    it("reverts if claims exist", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);
      const enc2 = await encryptUint64(creator, 300n);

      await payments.connect(creator).createSplit(
        tokenAddr,
        [recipient1.address, recipient2.address],
        [enc1, enc2],
        800
      );

      await payments.connect(recipient1).claim(0);

      await expect(
        payments.connect(creator).cancelSplit(0)
      ).to.be.revertedWithCustomError(payments, "InvalidState");
    });

    it("reverts if not creator", async function () {
      const tokenAddr = await token.getAddress();
      const enc1 = await encryptUint64(creator, 500n);

      await payments.connect(creator).createSplit(
        tokenAddr, [recipient1.address], [enc1], 500
      );

      await expect(
        payments.connect(outsider).cancelSplit(0)
      ).to.be.revertedWithCustomError(payments, "Unauthorized");
    });
  });
});
