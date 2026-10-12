import { expect } from "chai";
import hre from "hardhat";
import { PrivatePayments, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint64, encryptUint64s } from "../helpers/cofhe";

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
    token = await tokenFactory.deploy("Zerith Test Dollar", "CDEX");
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

  // ─── Splits (escrowed) ─────────────────────────────────

  const UNTIL = 2n ** 48n - 1n;
  const pt = async (h: string | bigint) => hre.cofhe.mocks.getPlaintext(BigInt(h));
  const vaultBal = async (who: HardhatEthersSigner) =>
    pt(await vault.getEncBalance(who.address, await token.getAddress()));

  async function fundCreator(amount: bigint) {
    await token.connect(deployer).adminMint(creator.address, amount);
    await token.connect(creator).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(creator).deposit(await token.getAddress(), ...(await encryptUint64(creator, amount, vault)));
  }

  async function createSplit(amounts: bigint[], recipients = [recipient1, recipient2]) {
    const [handles, signature] = amounts.length
      ? await encryptUint64s(creator, amounts, payments)
      : [[], "0x"];
    return payments.connect(creator).createSplit(
      await token.getAddress(),
      recipients.map((r) => r.address),
      handles,
      signature,
    );
  }

  describe("createSplitFromTemplate()", function () {
    beforeEach(async function () {
      await payments.connect(creator).createTemplate("Payroll", [recipient1.address, recipient2.address]);
    });

    it("creates and escrows a split from an active template", async function () {
      await fundCreator(1_000n);
      const tokenAddr = await token.getAddress();
      await expect(
        payments.connect(creator).createSplitFromTemplate(0, tokenAddr, ...(await encryptUint64s(creator, [300n, 500n], payments))),
      )
        .to.emit(payments, "SplitCreated")
        .to.emit(payments, "SplitFunded");
      const s = await payments.getSplit(0);
      expect(s.recipientCount).to.equal(2n);
      expect(s.templateId).to.equal(0n);
      expect(await vaultBal(creator)).to.equal(200n);
    });

    it("reverts if not template creator", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        payments.connect(outsider).createSplitFromTemplate(0, tokenAddr, ...(await encryptUint64s(outsider, [1n, 1n], payments))),
      ).to.be.revertedWithCustomError(payments, "Unauthorized");
    });

    it("reverts if template deactivated", async function () {
      await payments.connect(creator).deactivateTemplate(0);
      const tokenAddr = await token.getAddress();
      await expect(
        payments.connect(creator).createSplitFromTemplate(0, tokenAddr, ...(await encryptUint64s(creator, [1n, 1n], payments))),
      ).to.be.revertedWithCustomError(payments, "InvalidState");
    });

    it("reverts if amount count mismatch", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        payments.connect(creator).createSplitFromTemplate(0, tokenAddr, ...(await encryptUint64s(creator, [1n], payments))),
      ).to.be.revertedWithCustomError(payments, "InvalidInput");
    });
  });

  describe("createSplit()", function () {
    it("locks the whole split from the creator up front", async function () {
      await fundCreator(1_000n);
      await createSplit([300n, 500n]);
      expect(await vaultBal(creator)).to.equal(200n);
      expect(await pt(await payments.connect(recipient1).getMyAmount(0))).to.equal(300n);
      expect(await pt(await payments.connect(recipient2).getMyAmount(0))).to.equal(500n);
    });

    it("locks nothing and zeroes every amount when the creator can't cover the total", async function () {
      await fundCreator(700n);
      await createSplit([300n, 500n]);
      expect(await vaultBal(creator)).to.equal(700n);
      expect(await pt(await payments.connect(recipient1).getMyAmount(0))).to.equal(0n);
      expect(await pt(await payments.connect(recipient2).getMyAmount(0))).to.equal(0n);
    });

    it("rejects amounts that overflow uint64 when summed (no wrapped total)", async function () {
      await fundCreator(1_000n);
      await createSplit([2n ** 64n - 1n, 1_001n]); // sum wraps to 1000
      expect(await vaultBal(creator)).to.equal(1_000n);
      expect(await pt(await payments.connect(recipient1).getMyAmount(0))).to.equal(0n);
      expect(await pt(await payments.connect(recipient2).getMyAmount(0))).to.equal(0n);
    });

    it("rejects duplicate recipients, mismatched arrays and empty lists", async function () {
      await expect(createSplit([1n, 1n], [recipient1, recipient1]))
        .to.be.revertedWithCustomError(payments, "InvalidInput");
      await expect(createSplit([1n], [recipient1, recipient2]))
        .to.be.revertedWithCustomError(payments, "InvalidInput");
      await expect(createSplit([], []))
        .to.be.revertedWithCustomError(payments, "InvalidInput");
    });

    it("lets the creator read each recipient's amount, and nobody else", async function () {
      await fundCreator(1_000n);
      await createSplit([300n, 500n]);
      expect(await pt(await payments.connect(creator).getRecipientAmount(0, recipient2.address))).to.equal(500n);
      await expect(payments.connect(outsider).getRecipientAmount(0, recipient2.address))
        .to.be.revertedWithCustomError(payments, "Unauthorized");
      await expect(payments.connect(outsider).getMyAmount(0))
        .to.be.revertedWithCustomError(payments, "Unauthorized");
    });
  });

  describe("claim()", function () {
    beforeEach(async function () {
      await fundCreator(1_000n);
      await createSplit([300n, 500n]);
    });

    it("pays the recipient from escrow", async function () {
      await expect(payments.connect(recipient1).claim(0)).to.emit(payments, "PaymentClaimed");
      expect(await vaultBal(recipient1)).to.equal(300n);
      expect((await payments.getSplit(0)).claimedCount).to.equal(1n);
    });

    it("still pays even if the creator empties their vault afterwards", async function () {
      await vault.connect(creator).withdraw(await token.getAddress(), ...(await encryptUint64(creator, 200n, vault)));
      await payments.connect(recipient2).claim(0);
      expect(await vaultBal(recipient2)).to.equal(500n);
    });

    it("completes the split when everyone has claimed", async function () {
      await payments.connect(recipient1).claim(0);
      await expect(payments.connect(recipient2).claim(0)).to.emit(payments, "SplitCompleted");
      expect((await payments.getSplit(0)).status).to.equal(1n);
    });

    it("rejects double claims and outsiders", async function () {
      await payments.connect(recipient1).claim(0);
      await expect(payments.connect(recipient1).claim(0)).to.be.revertedWithCustomError(payments, "InvalidState");
      await expect(payments.connect(outsider).claim(0)).to.be.revertedWithCustomError(payments, "Unauthorized");
    });
  });

  describe("cancelSplit()", function () {
    beforeEach(async function () {
      await fundCreator(1_000n);
      await createSplit([300n, 500n]);
    });

    it("returns unclaimed amounts to the creator", async function () {
      await payments.connect(recipient1).claim(0);
      await expect(payments.connect(creator).cancelSplit(0)).to.emit(payments, "SplitCancelled");
      expect(await vaultBal(creator)).to.equal(700n); // 200 left + 500 unclaimed
      expect(await vaultBal(recipient1)).to.equal(300n);
      expect((await payments.getSplit(0)).status).to.equal(2n);
      await expect(payments.connect(recipient2).claim(0)).to.be.revertedWithCustomError(payments, "InvalidState");
    });

    it("reverts if not creator, or already cancelled", async function () {
      await expect(payments.connect(outsider).cancelSplit(0)).to.be.revertedWithCustomError(payments, "Unauthorized");
      await payments.connect(creator).cancelSplit(0);
      await expect(payments.connect(creator).cancelSplit(0)).to.be.revertedWithCustomError(payments, "InvalidState");
    });
  });
});
