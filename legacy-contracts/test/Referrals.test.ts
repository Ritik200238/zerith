import { expect } from "chai";
import hre from "hardhat";
import { Referrals, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, solidityPacked } from "ethers";

describe("Referrals", function () {
  let referrals: Referrals;
  let token: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let referrer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, referrer, user1, user2, outsider] = await hre.ethers.getSigners();

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

    // Deploy Referrals
    const referralsFactory = await hre.ethers.getContractFactory("Referrals");
    referrals = await referralsFactory.deploy(await vault.getAddress());
    await referrals.waitForDeployment();

    // Authorize referrals as settler
    await vault.addAuthorizedSettler(await referrals.getAddress());
  });

  describe("Deployment", function () {
    it("sets vault correctly", async function () {
      expect(await referrals.vault()).to.equal(await vault.getAddress());
    });

    it("reverts with zero vault", async function () {
      const referralsFactory = await hre.ethers.getContractFactory("Referrals");
      await expect(
        referralsFactory.deploy(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(referrals, "InvalidInput");
    });

    it("sets constants correctly", async function () {
      expect(await referrals.DEFAULT_REWARD_BPS()).to.equal(1000n);
      expect(await referrals.MAX_REWARD_BPS()).to.equal(5000n);
    });
  });

  describe("createLink()", function () {
    it("creates referral link with custom reward", async function () {
      const codeHash = keccak256(solidityPacked(["string"], ["ALPHA100"]));

      await expect(
        referrals.connect(referrer).createLink("ALPHA100", 2000)
      )
        .to.emit(referrals, "ReferralLinkCreated")
        .withArgs(codeHash, referrer.address);

      const stats = await referrals.getLinkStats(codeHash);
      expect(stats.referrer).to.equal(referrer.address);
      expect(stats.rewardBps).to.equal(2000n);
      expect(stats.referralCount).to.equal(0n);
      expect(stats.active).to.equal(true);
    });

    it("uses default reward when 0 is passed", async function () {
      await referrals.connect(referrer).createLink("BETA200", 0);

      const codeHash = keccak256(solidityPacked(["string"], ["BETA200"]));
      const stats = await referrals.getLinkStats(codeHash);
      expect(stats.rewardBps).to.equal(1000n); // DEFAULT_REWARD_BPS
    });

    it("reverts with empty code", async function () {
      await expect(
        referrals.connect(referrer).createLink("", 1000)
      ).to.be.revertedWithCustomError(referrals, "InvalidInput");
    });

    it("reverts if reward exceeds max", async function () {
      await expect(
        referrals.connect(referrer).createLink("TOOMUCH", 6000)
      ).to.be.revertedWithCustomError(referrals, "InvalidInput");
    });

    it("reverts if code already taken", async function () {
      await referrals.connect(referrer).createLink("TAKEN", 1000);

      await expect(
        referrals.connect(user1).createLink("TAKEN", 1000)
      ).to.be.revertedWithCustomError(referrals, "InvalidState");
    });

    it("reverts if referrer already has a code", async function () {
      await referrals.connect(referrer).createLink("FIRST", 1000);

      await expect(
        referrals.connect(referrer).createLink("SECOND", 1000)
      ).to.be.revertedWithCustomError(referrals, "InvalidState");
    });

    it("stores referrer-to-code mapping", async function () {
      await referrals.connect(referrer).createLink("MYCODE", 1500);

      const codeHash = keccak256(solidityPacked(["string"], ["MYCODE"]));
      expect(await referrals.referrerToCode(referrer.address)).to.equal(codeHash);
    });
  });

  describe("useReferralCode()", function () {
    beforeEach(async function () {
      await referrals.connect(referrer).createLink("ALPHA", 1000);
    });

    it("registers referral and increments count", async function () {
      const codeHash = keccak256(solidityPacked(["string"], ["ALPHA"]));

      await expect(
        referrals.connect(user1).useReferralCode("ALPHA")
      )
        .to.emit(referrals, "ReferralUsed")
        .withArgs(codeHash, user1.address);

      const stats = await referrals.getLinkStats(codeHash);
      expect(stats.referralCount).to.equal(1n);
      expect(await referrals.isReferred(user1.address)).to.equal(true);
    });

    it("allows multiple users to use same code", async function () {
      await referrals.connect(user1).useReferralCode("ALPHA");
      await referrals.connect(user2).useReferralCode("ALPHA");

      const codeHash = keccak256(solidityPacked(["string"], ["ALPHA"]));
      const stats = await referrals.getLinkStats(codeHash);
      expect(stats.referralCount).to.equal(2n);
    });

    it("rejects self-referral", async function () {
      await expect(
        referrals.connect(referrer).useReferralCode("ALPHA")
      ).to.be.revertedWithCustomError(referrals, "InvalidInput");
    });

    it("rejects non-existent code", async function () {
      await expect(
        referrals.connect(user1).useReferralCode("DOESNOTEXIST")
      ).to.be.revertedWithCustomError(referrals, "InvalidInput");
    });

    it("rejects double referral (user already referred)", async function () {
      await referrals.connect(user1).useReferralCode("ALPHA");

      // Create second referrer's code
      await referrals.connect(user2).createLink("BETA", 1000);

      await expect(
        referrals.connect(user1).useReferralCode("BETA")
      ).to.be.revertedWithCustomError(referrals, "InvalidState");
    });

    it("rejects use of deactivated link", async function () {
      await referrals.connect(referrer).deactivateLink();

      await expect(
        referrals.connect(user1).useReferralCode("ALPHA")
      ).to.be.revertedWithCustomError(referrals, "InvalidState");
    });
  });

  describe("payReferralReward()", function () {
    beforeEach(async function () {
      await referrals.connect(referrer).createLink("ALPHA", 1000);
      await referrals.connect(user1).useReferralCode("ALPHA");
    });

    it("pays reward via vault settlement", async function () {
      const tokenAddr = await token.getAddress();
      const codeHash = keccak256(solidityPacked(["string"], ["ALPHA"]));

      await expect(
        referrals.connect(deployer).payReferralReward(user1.address, tokenAddr, 10000)
      )
        .to.emit(referrals, "ReferralRewardPaid")
        .withArgs(codeHash);
    });

    it("silently skips if user has no referrer", async function () {
      const tokenAddr = await token.getAddress();

      // outsider has no referrer — should not revert, just skip
      await expect(
        referrals.connect(deployer).payReferralReward(outsider.address, tokenAddr, 10000)
      ).to.not.be.reverted;
    });

    it("silently skips if zero reward (very small fee)", async function () {
      const tokenAddr = await token.getAddress();

      // rewardBps = 1000 (10%), fee = 1 → reward = 0 (rounds down)
      // Should not revert
      await expect(
        referrals.connect(deployer).payReferralReward(user1.address, tokenAddr, 1)
      ).to.not.be.reverted;
    });
  });

  describe("deactivateLink()", function () {
    it("deactivates referrer's link", async function () {
      await referrals.connect(referrer).createLink("ALPHA", 1000);

      const codeHash = keccak256(solidityPacked(["string"], ["ALPHA"]));

      await expect(referrals.connect(referrer).deactivateLink())
        .to.emit(referrals, "ReferralDeactivated")
        .withArgs(codeHash);

      const stats = await referrals.getLinkStats(codeHash);
      expect(stats.active).to.equal(false);
    });

    it("reverts if no link exists", async function () {
      await expect(
        referrals.connect(outsider).deactivateLink()
      ).to.be.revertedWithCustomError(referrals, "InvalidState");
    });
  });

  describe("View functions", function () {
    it("isReferred returns false for un-referred user", async function () {
      expect(await referrals.isReferred(outsider.address)).to.equal(false);
    });

    it("getReferralRewardBps returns 0 for un-referred user", async function () {
      expect(await referrals.getReferralRewardBps(outsider.address)).to.equal(0n);
    });

    it("getReferralRewardBps returns correct BPS for referred user", async function () {
      await referrals.connect(referrer).createLink("CODE", 2500);
      await referrals.connect(user1).useReferralCode("CODE");

      expect(await referrals.getReferralRewardBps(user1.address)).to.equal(2500n);
    });

    it("getMyEarnings reverts if no link", async function () {
      await expect(
        referrals.connect(outsider).getMyEarnings()
      ).to.be.revertedWithCustomError(referrals, "InvalidState");
    });
  });
});
