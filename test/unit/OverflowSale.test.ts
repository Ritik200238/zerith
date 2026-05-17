import { expect } from "chai";
import hre from "hardhat";
import { OverflowSale, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint64 } from "../helpers/cofhe";

describe("OverflowSale", function () {
  let sale: OverflowSale;
  let token: ConfidentialToken;
  let paymentToken: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let depositor1: HardhatEthersSigner;
  let depositor2: HardhatEthersSigner;
  let depositor3: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, seller, depositor1, depositor2, depositor3] = await hre.ethers.getSigners();

    // Deploy tokens
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    token = await tokenFactory.deploy();
    await token.waitForDeployment();
    paymentToken = await tokenFactory.deploy();
    await paymentToken.waitForDeployment();

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
    await vault.addSupportedToken(await paymentToken.getAddress());

    // Deploy OverflowSale
    const saleFactory = await hre.ethers.getContractFactory("OverflowSale");
    sale = await saleFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress()
    );
    await sale.waitForDeployment();

    // Authorize sale as settler
    await vault.addAuthorizedSettler(await sale.getAddress());
  });

  describe("createSale()", function () {
    it("sets correct state", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();

      await expect(
        sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 50, 600)
      )
        .to.emit(sale, "SaleCreated");

      const s = await sale.getSale(0);
      expect(s.seller).to.equal(seller.address);
      expect(s.token).to.equal(tokenAddr);
      expect(s.paymentToken).to.equal(paymentAddr);
      expect(s.tokensForSale).to.equal(1000n);
      expect(s.pricePerToken).to.equal(50n);
      expect(s.depositCount).to.equal(0n);
      expect(s.status).to.equal(0n); // OPEN
      expect(s.revealedTotal).to.equal(0n);
    });

    it("reverts if same token", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        sale.connect(seller).createSale(tokenAddr, tokenAddr, 1000, 50, 600)
      ).to.be.revertedWithCustomError(sale, "InvalidInput");
    });

    it("reverts if zero supply", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await expect(
        sale.connect(seller).createSale(tokenAddr, paymentAddr, 0, 50, 600)
      ).to.be.revertedWithCustomError(sale, "InvalidInput");
    });

    it("reverts if zero price", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await expect(
        sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 0, 600)
      ).to.be.revertedWithCustomError(sale, "InvalidInput");
    });

    it("reverts if duration too short", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await expect(
        sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 50, 100)
      ).to.be.revertedWithCustomError(sale, "InvalidInput");
    });
  });

  describe("deposit()", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 50, 600);
    });

    it("accepts encrypted deposit and increments count", async function () {
      const encAmount = await encryptUint64(depositor1, 500n);

      await expect(sale.connect(depositor1).deposit(0, encAmount))
        .to.emit(sale, "DepositPlaced")
        .withArgs(0, depositor1.address);

      const s = await sale.getSale(0);
      expect(s.depositCount).to.equal(1n);
      expect(await sale.hasDeposited(0, depositor1.address)).to.equal(true);
    });

    it("prevents double deposit", async function () {
      const encAmount1 = await encryptUint64(depositor1, 500n);
      await sale.connect(depositor1).deposit(0, encAmount1);

      const encAmount2 = await encryptUint64(depositor1, 300n);
      await expect(
        sale.connect(depositor1).deposit(0, encAmount2)
      ).to.be.revertedWithCustomError(sale, "InvalidState");
    });

    it("prevents seller from depositing", async function () {
      const encAmount = await encryptUint64(seller, 500n);
      await expect(
        sale.connect(seller).deposit(0, encAmount)
      ).to.be.revertedWithCustomError(sale, "InvalidInput");
    });

    it("reverts after deadline", async function () {
      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      const encAmount = await encryptUint64(depositor1, 500n);
      await expect(
        sale.connect(depositor1).deposit(0, encAmount)
      ).to.be.revertedWithCustomError(sale, "InvalidState");
    });

    it("accepts multiple depositors", async function () {
      const encAmount1 = await encryptUint64(depositor1, 500n);
      await sale.connect(depositor1).deposit(0, encAmount1);

      const encAmount2 = await encryptUint64(depositor2, 800n);
      await sale.connect(depositor2).deposit(0, encAmount2);

      const encAmount3 = await encryptUint64(depositor3, 200n);
      await sale.connect(depositor3).deposit(0, encAmount3);

      const s = await sale.getSale(0);
      expect(s.depositCount).to.equal(3n);
    });
  });

  describe("settle()", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 50, 600);
    });

    it("cancels with 0 deposits", async function () {
      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      await expect(sale.connect(seller).settle(0))
        .to.emit(sale, "SaleCancelled")
        .withArgs(0);

      const s = await sale.getSale(0);
      expect(s.status).to.equal(3n); // CANCELLED
    });

    it("transitions to COMPUTING with deposits", async function () {
      const encAmount = await encryptUint64(depositor1, 500n);
      await sale.connect(depositor1).deposit(0, encAmount);

      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      await expect(sale.connect(seller).settle(0))
        .to.emit(sale, "SaleComputing")
        .withArgs(0);

      const s = await sale.getSale(0);
      expect(s.status).to.equal(1n); // COMPUTING
    });

    it("reverts before deadline", async function () {
      await expect(
        sale.connect(seller).settle(0)
      ).to.be.revertedWithCustomError(sale, "InvalidState");
    });

    it("reverts if already settled", async function () {
      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      await sale.connect(seller).settle(0); // cancels (0 deposits)

      await expect(
        sale.connect(seller).settle(0)
      ).to.be.revertedWithCustomError(sale, "InvalidState");
    });
  });

  describe("cancelSale()", function () {
    it("works with no deposits", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 50, 600);

      await expect(sale.connect(seller).cancelSale(0))
        .to.emit(sale, "SaleCancelled")
        .withArgs(0);

      const s = await sale.getSale(0);
      expect(s.status).to.equal(3n); // CANCELLED
    });

    it("reverts if deposits exist", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 50, 600);

      const encAmount = await encryptUint64(depositor1, 500n);
      await sale.connect(depositor1).deposit(0, encAmount);

      await expect(
        sale.connect(seller).cancelSale(0)
      ).to.be.revertedWithCustomError(sale, "InvalidState");
    });

    it("reverts if not seller", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 50, 600);

      await expect(
        sale.connect(depositor1).cancelSale(0)
      ).to.be.revertedWithCustomError(sale, "Unauthorized");
    });
  });

  describe("Oversubscription scenario (deposit tracking)", function () {
    it("accumulates encrypted total from multiple depositors", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      // Sale: 1000 tokens available
      await sale.connect(seller).createSale(tokenAddr, paymentAddr, 1000, 50, 600);

      // Depositors want 500 + 800 + 200 = 1500 total (oversubscribed by 50%)
      const enc1 = await encryptUint64(depositor1, 500n);
      await sale.connect(depositor1).deposit(0, enc1);

      const enc2 = await encryptUint64(depositor2, 800n);
      await sale.connect(depositor2).deposit(0, enc2);

      const enc3 = await encryptUint64(depositor3, 200n);
      await sale.connect(depositor3).deposit(0, enc3);

      const s = await sale.getSale(0);
      expect(s.depositCount).to.equal(3n);

      // Total is encrypted — cannot verify until decrypt
      // Pro-rata allocation happens in finalizeClaimAllocation after reveal
    });
  });
});
