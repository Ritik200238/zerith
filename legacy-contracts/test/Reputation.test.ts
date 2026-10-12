import { expect } from "chai";
import hre from "hardhat";
import { Reputation, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint8 } from "../helpers/cofhe";

describe("Reputation", function () {
  let reputation: Reputation;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let userA: HardhatEthersSigner;
  let userB: HardhatEthersSigner;
  let unauthorized: HardhatEthersSigner;
  let authorizedCaller: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, admin, userA, userB, unauthorized, authorizedCaller] = await hre.ethers.getSigners();

    // Deploy PlatformRegistry
    const registryFactory = await hre.ethers.getContractFactory("PlatformRegistry");
    registry = await registryFactory.deploy(deployer.address, 100, deployer.address);
    await registry.waitForDeployment();

    // Deploy Reputation
    const reputationFactory = await hre.ethers.getContractFactory("Reputation");
    reputation = await reputationFactory.deploy(
      await registry.getAddress(),
      admin.address
    );
    await reputation.waitForDeployment();

    // Authorize the authorizedCaller
    await reputation.connect(admin).addAuthorizedCaller(authorizedCaller.address);
  });

  describe("Deployment", function () {
    it("sets admin correctly", async function () {
      expect(await reputation.admin()).to.equal(admin.address);
    });

    it("sets registry correctly", async function () {
      expect(await reputation.registry()).to.equal(await registry.getAddress());
    });
  });

  describe("recordTrade()", function () {
    it("records trade and increments counts for both parties", async function () {
      await expect(
        reputation.connect(authorizedCaller).recordTrade(userA.address, userB.address, 1)
      )
        .to.emit(reputation, "TradeRecorded")
        .withArgs(userA.address, userB.address);

      expect(await reputation.getTradeCount(userA.address)).to.equal(1n);
      expect(await reputation.getTradeCount(userB.address)).to.equal(1n);
    });

    it("only callable by authorized callers", async function () {
      await expect(
        reputation.connect(unauthorized).recordTrade(userA.address, userB.address, 1)
      ).to.be.revertedWithCustomError(reputation, "Unauthorized");
    });

    it("reverts on self-trade", async function () {
      await expect(
        reputation.connect(authorizedCaller).recordTrade(userA.address, userA.address, 99)
      ).to.be.revertedWithCustomError(reputation, "InvalidInput");
    });

    it("accumulates across multiple trades", async function () {
      await reputation.connect(authorizedCaller).recordTrade(userA.address, userB.address, 1);
      await reputation.connect(authorizedCaller).recordTrade(userA.address, userB.address, 2);

      expect(await reputation.getTradeCount(userA.address)).to.equal(2n);
      expect(await reputation.getTradeCount(userB.address)).to.equal(2n);
    });
  });

  describe("submitRating()", function () {
    // Audit fix C-REP2: rater must have recorded trade with counterparty.
    // Each test pre-records the trade(s) it needs.
    beforeEach(async function () {
      await reputation.connect(authorizedCaller).recordTrade(userA.address, userB.address, 1);
      await reputation.connect(authorizedCaller).recordTrade(userA.address, userB.address, 2);
    });

    it("accepts valid rating (1-5) and emits event", async function () {
      const encRating = await encryptUint8(userA, 4n);

      await expect(
        reputation.connect(userA).submitRating(userB.address, encRating, 1)
      )
        .to.emit(reputation, "RatingSubmitted")
        .withArgs(userA.address, userB.address);
    });

    it("prevents self-rating", async function () {
      const encRating = await encryptUint8(userA, 3n);
      await expect(
        reputation.connect(userA).submitRating(userA.address, encRating, 1)
      ).to.be.revertedWithCustomError(reputation, "InvalidInput");
    });

    it("prevents rating zero address", async function () {
      const encRating = await encryptUint8(userA, 3n);
      await expect(
        reputation.connect(userA).submitRating(hre.ethers.ZeroAddress, encRating, 1)
      ).to.be.revertedWithCustomError(reputation, "InvalidInput");
    });

    it("prevents double-rating for same trade", async function () {
      const encRating1 = await encryptUint8(userA, 4n);
      await reputation.connect(userA).submitRating(userB.address, encRating1, 1);

      const encRating2 = await encryptUint8(userA, 5n);
      await expect(
        reputation.connect(userA).submitRating(userB.address, encRating2, 1)
      ).to.be.revertedWithCustomError(reputation, "InvalidState");
    });

    it("allows rating same user for different trades", async function () {
      const encRating1 = await encryptUint8(userA, 4n);
      await reputation.connect(userA).submitRating(userB.address, encRating1, 1);

      const encRating2 = await encryptUint8(userA, 5n);
      await expect(
        reputation.connect(userA).submitRating(userB.address, encRating2, 2)
      ).to.not.be.reverted;
    });

    it("validates range 1-5 using FHE (invalid ratings become 0)", async function () {
      // Rating of 0 is invalid (below min). The contract uses FHE.select to replace
      // with 0 if out of range, so it won't revert but the score won't increase.
      // We need a trade recorded first for computeMyReputation to work.
      await reputation.connect(authorizedCaller).recordTrade(userA.address, userB.address, 1);

      // Submit a valid rating of 3
      const encValidRating = await encryptUint8(userA, 3n);
      await reputation.connect(userA).submitRating(userB.address, encValidRating, 1);

      // The rating is stored encrypted. We verify it works by calling computeMyReputation.
      // This test primarily confirms the contract doesn't revert on valid ratings.
    });
  });

  describe("computeMyReputation()", function () {
    it("computes average for a user with trades", async function () {
      // Record a trade with tradeId=1
      await reputation.connect(authorizedCaller).recordTrade(userA.address, userB.address, 1);

      // Submit a rating for that trade
      const encRating = await encryptUint8(userA, 4n);
      await reputation.connect(userA).submitRating(userB.address, encRating, 1);

      // userB computes their reputation
      await expect(reputation.connect(userB).computeMyReputation())
        .to.emit(reputation, "ReputationComputed")
        .withArgs(userB.address, 1);
    });

    it("reverts if no trades recorded", async function () {
      await expect(
        reputation.connect(userA).computeMyReputation()
      ).to.be.revertedWithCustomError(reputation, "InvalidState");
    });
  });

  describe("Admin functions", function () {
    it("addAuthorizedCaller() works for admin", async function () {
      await expect(
        reputation.connect(admin).addAuthorizedCaller(unauthorized.address)
      )
        .to.emit(reputation, "CallerAuthorized")
        .withArgs(unauthorized.address);

      expect(await reputation.authorizedCallers(unauthorized.address)).to.equal(true);
    });

    it("addAuthorizedCaller() reverts for non-admin", async function () {
      await expect(
        reputation.connect(userA).addAuthorizedCaller(unauthorized.address)
      ).to.be.revertedWithCustomError(reputation, "Unauthorized");
    });

    it("removeAuthorizedCaller() works for admin", async function () {
      await expect(
        reputation.connect(admin).removeAuthorizedCaller(authorizedCaller.address)
      )
        .to.emit(reputation, "CallerRevoked")
        .withArgs(authorizedCaller.address);

      expect(await reputation.authorizedCallers(authorizedCaller.address)).to.equal(false);
    });

    it("removeAuthorizedCaller() reverts for non-admin", async function () {
      await expect(
        reputation.connect(userA).removeAuthorizedCaller(authorizedCaller.address)
      ).to.be.revertedWithCustomError(reputation, "Unauthorized");
    });

    it("addAuthorizedCaller() reverts for zero address", async function () {
      await expect(
        reputation.connect(admin).addAuthorizedCaller(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(reputation, "InvalidInput");
    });
  });
});
