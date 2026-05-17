import { expect } from "chai";
import hre from "hardhat";
import { BatchAuction, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint128 } from "../helpers/cofhe";

describe("BatchAuction", function () {
  let batchAuction: BatchAuction;
  let tokenA: ConfidentialToken;
  let tokenB: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let buyer1: HardhatEthersSigner;
  let buyer2: HardhatEthersSigner;
  let seller1: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, admin, buyer1, buyer2, seller1] = await hre.ethers.getSigners();

    // Deploy tokens
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    tokenA = await tokenFactory.deploy();
    await tokenA.waitForDeployment();
    tokenB = await tokenFactory.deploy();
    await tokenB.waitForDeployment();

    // Deploy PlatformRegistry
    const registryFactory = await hre.ethers.getContractFactory("PlatformRegistry");
    registry = await registryFactory.deploy(deployer.address, 100, deployer.address);
    await registry.waitForDeployment();

    // Deploy SettlementVault
    const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
    vault = await vaultFactory.deploy(
      await tokenA.getAddress(),
      await registry.getAddress(),
      deployer.address
    );
    await vault.waitForDeployment();
    await vault.addSupportedToken(await tokenB.getAddress());

    // Deploy BatchAuction
    const batchFactory = await hre.ethers.getContractFactory("BatchAuction");
    batchAuction = await batchFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress(),
      admin.address
    );
    await batchAuction.waitForDeployment();

    // Authorize BatchAuction as settler
    await vault.addAuthorizedSettler(await batchAuction.getAddress());
  });

  describe("Deployment", function () {
    it("sets admin correctly", async function () {
      expect(await batchAuction.admin()).to.equal(admin.address);
    });

    it("sets correct constants", async function () {
      expect(await batchAuction.MAX_ORDERS_PER_ROUND()).to.equal(5n);
      expect(await batchAuction.PRICE_LADDER_STEPS()).to.equal(3n);
      expect(await batchAuction.DEFAULT_ROUND_DURATION()).to.equal(300n);
    });
  });

  describe("createRound()", function () {
    it("creates round with price ladder", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await expect(
        batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 600)
      )
        .to.emit(batchAuction, "RoundCreated");

      const round = await batchAuction.getRound(0);
      expect(round.tokenA).to.equal(tokenAAddr);
      expect(round.tokenB).to.equal(tokenBAddr);
      expect(round.status).to.equal(0n); // COLLECTING
      expect(round.clearingPrice).to.equal(0n);
      expect(round.buyCount).to.equal(0n);
      expect(round.sellCount).to.equal(0n);
    });

    it("uses default duration when 0 is passed", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 0);

      const round = await batchAuction.getRound(0);
      // endTime should be startTime + DEFAULT_ROUND_DURATION (300)
      expect(round.endTime - round.startTime).to.equal(300n);
    });

    it("increments round count", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 600);
      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 600);

      expect(await batchAuction.getRoundCount()).to.equal(2n);
    });

    it("reverts if same token", async function () {
      const tokenAAddr = await tokenA.getAddress();

      await expect(
        batchAuction.connect(admin).createRound(tokenAAddr, tokenAAddr, 600)
      ).to.be.revertedWithCustomError(batchAuction, "InvalidInput");
    });

    it("reverts if not admin", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await expect(
        batchAuction.connect(buyer1).createRound(tokenAAddr, tokenBAddr, 600)
      ).to.be.revertedWithCustomError(batchAuction, "Unauthorized");
    });
  });

  describe("submitBuyOrder()", function () {
    beforeEach(async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 600);
    });

    it("stores buy order with encrypted max price", async function () {
      const encMaxPrice = await encryptUint128(buyer1, 1500n);

      await expect(
        batchAuction.connect(buyer1).submitBuyOrder(0, encMaxPrice, 100)
      )
        .to.emit(batchAuction, "BuyOrderSubmitted")
        .withArgs(0, buyer1.address, 100);

      const round = await batchAuction.getRound(0);
      expect(round.buyCount).to.equal(1n);
    });

    it("accumulates total buy volume", async function () {
      const encMaxPrice1 = await encryptUint128(buyer1, 1500n);
      await batchAuction.connect(buyer1).submitBuyOrder(0, encMaxPrice1, 100);

      const encMaxPrice2 = await encryptUint128(buyer2, 1600n);
      await batchAuction.connect(buyer2).submitBuyOrder(0, encMaxPrice2, 200);

      const round = await batchAuction.getRound(0);
      expect(round.buyCount).to.equal(2n);
    });

    it("reverts if round not collecting", async function () {
      // Fast-forward past round end
      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      const encMaxPrice = await encryptUint128(buyer1, 1500n);
      await expect(
        batchAuction.connect(buyer1).submitBuyOrder(0, encMaxPrice, 100)
      ).to.be.revertedWithCustomError(batchAuction, "Expired");
    });

    it("reverts if zero amount", async function () {
      const encMaxPrice = await encryptUint128(buyer1, 1500n);
      await expect(
        batchAuction.connect(buyer1).submitBuyOrder(0, encMaxPrice, 0)
      ).to.be.revertedWithCustomError(batchAuction, "InvalidInput");
    });

    it("reverts if round is full (5 orders max)", async function () {
      // Submit 5 orders (mix of buy/sell to reach MAX_ORDERS_PER_ROUND)
      for (let i = 0; i < 5; i++) {
        const signers = await hre.ethers.getSigners();
        const encMaxPrice = await encryptUint128(signers[i + 1], BigInt(1000 + i * 100));
        await batchAuction.connect(signers[i + 1]).submitBuyOrder(0, encMaxPrice, 100);
      }

      const encMaxPrice = await encryptUint128(buyer1, 2000n);
      await expect(
        batchAuction.connect(buyer1).submitBuyOrder(0, encMaxPrice, 100)
      ).to.be.revertedWithCustomError(batchAuction, "InvalidState");
    });
  });

  describe("submitSellOrder()", function () {
    beforeEach(async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 600);
    });

    it("stores sell order with encrypted min price", async function () {
      const encMinPrice = await encryptUint128(seller1, 800n);

      await expect(
        batchAuction.connect(seller1).submitSellOrder(0, encMinPrice, 150)
      )
        .to.emit(batchAuction, "SellOrderSubmitted")
        .withArgs(0, seller1.address, 150);

      const round = await batchAuction.getRound(0);
      expect(round.sellCount).to.equal(1n);
    });

    it("reverts if zero amount", async function () {
      const encMinPrice = await encryptUint128(seller1, 800n);
      await expect(
        batchAuction.connect(seller1).submitSellOrder(0, encMinPrice, 0)
      ).to.be.revertedWithCustomError(batchAuction, "InvalidInput");
    });

    it("reverts if round ended", async function () {
      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      const encMinPrice = await encryptUint128(seller1, 800n);
      await expect(
        batchAuction.connect(seller1).submitSellOrder(0, encMinPrice, 150)
      ).to.be.revertedWithCustomError(batchAuction, "Expired");
    });
  });

  describe("closeAndCompute()", function () {
    it("reverts if round not ended", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 600);

      const encBuyPrice = await encryptUint128(buyer1, 1500n);
      await batchAuction.connect(buyer1).submitBuyOrder(0, encBuyPrice, 100);

      const encSellPrice = await encryptUint128(seller1, 800n);
      await batchAuction.connect(seller1).submitSellOrder(0, encSellPrice, 100);

      await expect(
        batchAuction.connect(admin).closeAndCompute(0, [800, 1000, 1200])
      ).to.be.revertedWithCustomError(batchAuction, "InvalidState");
    });

    it("reverts if wrong ladder size", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 600);

      const encBuyPrice = await encryptUint128(buyer1, 1500n);
      await batchAuction.connect(buyer1).submitBuyOrder(0, encBuyPrice, 100);

      const encSellPrice = await encryptUint128(seller1, 800n);
      await batchAuction.connect(seller1).submitSellOrder(0, encSellPrice, 100);

      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      await expect(
        batchAuction.connect(admin).closeAndCompute(0, [800, 1000])
      ).to.be.revertedWithCustomError(batchAuction, "InvalidInput");
    });

    it("reverts if no orders on either side", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 600);

      // Only buy orders, no sell
      const encBuyPrice = await encryptUint128(buyer1, 1500n);
      await batchAuction.connect(buyer1).submitBuyOrder(0, encBuyPrice, 100);

      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      await expect(
        batchAuction.connect(admin).closeAndCompute(0, [800, 1000, 1200])
      ).to.be.revertedWithCustomError(batchAuction, "InvalidState");
    });

    it("computes clearing price and transitions to CLEARING", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 300);

      const encBuyPrice = await encryptUint128(buyer1, 1500n);
      await batchAuction.connect(buyer1).submitBuyOrder(0, encBuyPrice, 100);

      const encSellPrice = await encryptUint128(seller1, 800n);
      await batchAuction.connect(seller1).submitSellOrder(0, encSellPrice, 100);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(
        batchAuction.connect(admin).closeAndCompute(0, [800, 1000, 1200])
      )
        .to.emit(batchAuction, "RoundClosed")
        .withArgs(0);

      const round = await batchAuction.getRound(0);
      expect(round.status).to.equal(2n); // CLEARING
    });

    it("reverts if not admin", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await batchAuction.connect(admin).createRound(tokenAAddr, tokenBAddr, 300);

      const encBuyPrice = await encryptUint128(buyer1, 1500n);
      await batchAuction.connect(buyer1).submitBuyOrder(0, encBuyPrice, 100);

      const encSellPrice = await encryptUint128(seller1, 800n);
      await batchAuction.connect(seller1).submitSellOrder(0, encSellPrice, 100);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(
        batchAuction.connect(buyer1).closeAndCompute(0, [800, 1000, 1200])
      ).to.be.revertedWithCustomError(batchAuction, "Unauthorized");
    });
  });
});
