import { expect } from "chai";
import hre from "hardhat";
import { PortfolioTracker, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("PortfolioTracker", function () {
  let tracker: PortfolioTracker;
  let tokenA: ConfidentialToken;
  let tokenB: ConfidentialToken;
  let tokenC: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, user, user2] = await hre.ethers.getSigners();

    // Deploy tokens
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    tokenA = await tokenFactory.deploy();
    await tokenA.waitForDeployment();
    tokenB = await tokenFactory.deploy();
    await tokenB.waitForDeployment();
    tokenC = await tokenFactory.deploy();
    await tokenC.waitForDeployment();

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
    await vault.addSupportedToken(await tokenC.getAddress());

    // Deploy PortfolioTracker
    const trackerFactory = await hre.ethers.getContractFactory("PortfolioTracker");
    tracker = await trackerFactory.deploy(await vault.getAddress());
    await tracker.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets vault correctly", async function () {
      expect(await tracker.vault()).to.equal(await vault.getAddress());
    });

    it("sets MAX_POSITIONS constant", async function () {
      expect(await tracker.MAX_POSITIONS()).to.equal(10n);
    });
  });

  describe("trackToken()", function () {
    it("adds position and emits event", async function () {
      const tokenAAddr = await tokenA.getAddress();

      await expect(tracker.connect(user).trackToken(tokenAAddr))
        .to.emit(tracker, "TokenTracked")
        .withArgs(user.address, tokenAAddr);

      expect(await tracker.positionCount(user.address)).to.equal(1n);
    });

    it("tracks multiple tokens", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const tokenCAddr = await tokenC.getAddress();

      await tracker.connect(user).trackToken(tokenAAddr);
      await tracker.connect(user).trackToken(tokenBAddr);
      await tracker.connect(user).trackToken(tokenCAddr);

      expect(await tracker.positionCount(user.address)).to.equal(3n);

      // Verify tracked tokens list
      const tracked = await tracker.getTrackedTokens(user.address);
      expect(tracked.length).to.equal(3);
      expect(tracked[0]).to.equal(tokenAAddr);
      expect(tracked[1]).to.equal(tokenBAddr);
      expect(tracked[2]).to.equal(tokenCAddr);
    });

    it("reverts if zero address", async function () {
      await expect(
        tracker.connect(user).trackToken(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(tracker, "InvalidInput");
    });

    it("reverts if already tracked", async function () {
      const tokenAAddr = await tokenA.getAddress();
      await tracker.connect(user).trackToken(tokenAAddr);

      await expect(
        tracker.connect(user).trackToken(tokenAAddr)
      ).to.be.revertedWithCustomError(tracker, "InvalidState");
    });

    it("reverts if max positions reached", async function () {
      // Track 10 tokens (deploy 10 different ones)
      const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
      for (let i = 0; i < 10; i++) {
        const t = await tokenFactory.deploy();
        await t.waitForDeployment();
        await tracker.connect(user).trackToken(await t.getAddress());
      }

      expect(await tracker.positionCount(user.address)).to.equal(10n);

      // 11th should fail
      const extraToken = await tokenFactory.deploy();
      await extraToken.waitForDeployment();
      await expect(
        tracker.connect(user).trackToken(await extraToken.getAddress())
      ).to.be.revertedWithCustomError(tracker, "InvalidState");
    });

    it("different users track independently", async function () {
      const tokenAAddr = await tokenA.getAddress();

      await tracker.connect(user).trackToken(tokenAAddr);
      await tracker.connect(user2).trackToken(tokenAAddr);

      expect(await tracker.positionCount(user.address)).to.equal(1n);
      expect(await tracker.positionCount(user2.address)).to.equal(1n);
    });
  });

  describe("untrackToken()", function () {
    it("removes tracked position", async function () {
      const tokenAAddr = await tokenA.getAddress();
      await tracker.connect(user).trackToken(tokenAAddr);

      await expect(tracker.connect(user).untrackToken(tokenAAddr))
        .to.emit(tracker, "TokenUntracked")
        .withArgs(user.address, tokenAAddr);

      expect(await tracker.positionCount(user.address)).to.equal(0n);
    });

    it("reverts if not tracked", async function () {
      const tokenAAddr = await tokenA.getAddress();

      await expect(
        tracker.connect(user).untrackToken(tokenAAddr)
      ).to.be.revertedWithCustomError(tracker, "InvalidState");
    });

    it("allows re-tracking after untrack", async function () {
      const tokenAAddr = await tokenA.getAddress();
      await tracker.connect(user).trackToken(tokenAAddr);
      await tracker.connect(user).untrackToken(tokenAAddr);

      // Should be able to track again
      await expect(
        tracker.connect(user).trackToken(tokenAAddr)
      ).to.not.be.reverted;

      expect(await tracker.positionCount(user.address)).to.equal(1n);
    });
  });

  describe("computePortfolioValue()", function () {
    it("reverts if no positions tracked", async function () {
      await expect(
        tracker.connect(user).computePortfolioValue([100])
      ).to.be.revertedWithCustomError(tracker, "InvalidState");
    });

    it("reverts if price count mismatch", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await tracker.connect(user).trackToken(tokenAAddr);
      await tracker.connect(user).trackToken(tokenBAddr);

      // Provide only 1 price for 2 positions
      await expect(
        tracker.connect(user).computePortfolioValue([100])
      ).to.be.revertedWithCustomError(tracker, "InvalidInput");
    });

    it("computes portfolio value across tracked tokens and emits event", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const trackerAddr = await tracker.getAddress();

      await tracker.connect(user).trackToken(tokenAAddr);
      await tracker.connect(user).trackToken(tokenBAddr);

      // Audit fix m-PT1: user must delegate balance-read access to the tracker.
      await vault.connect(user).delegateBalanceRead(trackerAddr, tokenAAddr);
      await vault.connect(user).delegateBalanceRead(trackerAddr, tokenBAddr);

      await expect(
        tracker.connect(user).computePortfolioValue([100, 200])
      )
        .to.emit(tracker, "PortfolioComputed")
        .withArgs(user.address, 2);
    });

    it("sums across multiple tokens", async function () {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const tokenCAddr = await tokenC.getAddress();
      const trackerAddr = await tracker.getAddress();

      await tracker.connect(user).trackToken(tokenAAddr);
      await tracker.connect(user).trackToken(tokenBAddr);
      await tracker.connect(user).trackToken(tokenCAddr);

      await vault.connect(user).delegateBalanceRead(trackerAddr, tokenAAddr);
      await vault.connect(user).delegateBalanceRead(trackerAddr, tokenBAddr);
      await vault.connect(user).delegateBalanceRead(trackerAddr, tokenCAddr);

      await expect(
        tracker.connect(user).computePortfolioValue([100, 200, 300])
      )
        .to.emit(tracker, "PortfolioComputed")
        .withArgs(user.address, 3);
    });
  });
});
