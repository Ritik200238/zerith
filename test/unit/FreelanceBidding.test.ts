import { expect } from "chai";
import hre from "hardhat";
import { FreelanceBidding, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint8, encryptUint128 } from "../helpers/cofhe";

describe("FreelanceBidding", function () {
  let freelance: FreelanceBidding;
  let token: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let client: HardhatEthersSigner;
  let freelancer1: HardhatEthersSigner;
  let freelancer2: HardhatEthersSigner;
  let voter1: HardhatEthersSigner;
  let voter2: HardhatEthersSigner;
  let voter3: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, admin, client, freelancer1, freelancer2, voter1, voter2, voter3, outsider] = await hre.ethers.getSigners();

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

    // Deploy FreelanceBidding (claimNFT = address(0))
    const freelanceFactory = await hre.ethers.getContractFactory("FreelanceBidding");
    freelance = await freelanceFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress(),
      admin.address,
      hre.ethers.ZeroAddress
    );
    await freelance.waitForDeployment();

    // Authorize freelance as settler
    await vault.addAuthorizedSettler(await freelance.getAddress());

    // Add voters
    await freelance.connect(admin).addVoter(voter1.address);
    await freelance.connect(admin).addVoter(voter2.address);
    await freelance.connect(admin).addVoter(voter3.address);
  });

  describe("postJob()", function () {
    it("creates job with milestones", async function () {
      const tokenAddr = await token.getAddress();

      await expect(
        freelance.connect(client).postJob(
          tokenAddr,
          10000,
          600,
          "Build DEX Frontend",
          ["Design", "Implementation", "Testing"],
          [30, 50, 20]
        )
      )
        .to.emit(freelance, "JobPosted");

      const j = await freelance.getJob(0);
      expect(j.client).to.equal(client.address);
      expect(j.token).to.equal(tokenAddr);
      expect(j.escrowAmount).to.equal(10000n);
      expect(j.bidCount).to.equal(0n);
      expect(j.status).to.equal(0n); // OPEN
      expect(j.milestoneCount).to.equal(3);
      expect(j.milestonesApproved).to.equal(0);
    });

    it("reverts if escrow is zero", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        freelance.connect(client).postJob(tokenAddr, 0, 600, "Job", ["M1"], [100])
      ).to.be.revertedWithCustomError(freelance, "InvalidInput");
    });

    it("reverts if duration too short", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        freelance.connect(client).postJob(tokenAddr, 10000, 100, "Job", ["M1"], [100])
      ).to.be.revertedWithCustomError(freelance, "InvalidInput");
    });

    it("reverts if milestone percentages do not sum to 100", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        freelance.connect(client).postJob(tokenAddr, 10000, 600, "Job", ["M1", "M2"], [30, 50])
      ).to.be.revertedWithCustomError(freelance, "InvalidInput");
    });

    it("reverts if empty title", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        freelance.connect(client).postJob(tokenAddr, 10000, 600, "", ["M1"], [100])
      ).to.be.revertedWithCustomError(freelance, "InvalidInput");
    });

    it("reverts if mismatched milestone arrays", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        freelance.connect(client).postJob(tokenAddr, 10000, 600, "Job", ["M1", "M2"], [100])
      ).to.be.revertedWithCustomError(freelance, "InvalidInput");
    });
  });

  describe("submitBid()", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 600, "Build DEX", ["Design", "Code"], [40, 60]
      );
    });

    it("accepts encrypted bid", async function () {
      const encBid = await encryptUint128(freelancer1, 8000n);

      await expect(freelance.connect(freelancer1).submitBid(0, encBid))
        .to.emit(freelance, "BidSubmitted")
        .withArgs(0, freelancer1.address);

      const j = await freelance.getJob(0);
      expect(j.bidCount).to.equal(1n);
      expect(await freelance.hasBid(0, freelancer1.address)).to.equal(true);
    });

    it("prevents client from bidding", async function () {
      const encBid = await encryptUint128(client, 8000n);
      await expect(
        freelance.connect(client).submitBid(0, encBid)
      ).to.be.revertedWithCustomError(freelance, "InvalidInput");
    });

    it("prevents double bidding", async function () {
      const encBid1 = await encryptUint128(freelancer1, 8000n);
      await freelance.connect(freelancer1).submitBid(0, encBid1);

      const encBid2 = await encryptUint128(freelancer1, 7000n);
      await expect(
        freelance.connect(freelancer1).submitBid(0, encBid2)
      ).to.be.revertedWithCustomError(freelance, "InvalidState");
    });

    it("tracks multiple bidders (lowest bid)", async function () {
      const encBid1 = await encryptUint128(freelancer1, 8000n);
      await freelance.connect(freelancer1).submitBid(0, encBid1);

      const encBid2 = await encryptUint128(freelancer2, 6000n);
      await freelance.connect(freelancer2).submitBid(0, encBid2);

      const j = await freelance.getJob(0);
      expect(j.bidCount).to.equal(2n);
    });

    it("reverts after deadline", async function () {
      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      const encBid = await encryptUint128(freelancer1, 8000n);
      await expect(
        freelance.connect(freelancer1).submitBid(0, encBid)
      ).to.be.revertedWithCustomError(freelance, "Expired");
    });
  });

  describe("settle() — lowest bid wins", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 300, "Build DEX", ["Design", "Code"], [40, 60]
      );
    });

    it("cancels with 0 bids", async function () {
      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(freelance.connect(client).settle(0))
        .to.emit(freelance, "JobFailed")
        .withArgs(0);

      const j = await freelance.getJob(0);
      expect(j.status).to.equal(4n); // CANCELLED
    });

    it("transitions to SETTLING with bids", async function () {
      const encBid = await encryptUint128(freelancer1, 8000n);
      await freelance.connect(freelancer1).submitBid(0, encBid);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(freelance.connect(client).settle(0))
        .to.emit(freelance, "SettlementRequested")
        .withArgs(0);

      const j = await freelance.getJob(0);
      expect(j.status).to.equal(1n); // SETTLING
    });

    it("reverts before deadline", async function () {
      await expect(
        freelance.connect(client).settle(0)
      ).to.be.revertedWithCustomError(freelance, "InvalidState");
    });
  });

  describe("deliverMilestone()", function () {
    it("reverts if job not assigned", async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 300, "Job", ["M1"], [100]
      );

      await expect(
        freelance.connect(freelancer1).deliverMilestone(0, 0)
      ).to.be.revertedWithCustomError(freelance, "InvalidState");
    });
  });

  describe("approveMilestone()", function () {
    it("reverts if job not assigned", async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 300, "Job", ["M1"], [100]
      );

      await expect(
        freelance.connect(client).approveMilestone(0, 0)
      ).to.be.revertedWithCustomError(freelance, "InvalidState");
    });
  });

  describe("autoReleaseMilestone()", function () {
    it("reverts if job not assigned", async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 300, "Job", ["M1"], [100]
      );

      await expect(
        freelance.connect(freelancer1).autoReleaseMilestone(0, 0)
      ).to.be.revertedWithCustomError(freelance, "InvalidState");
    });
  });

  describe("cancelJob()", function () {
    it("cancels with 0 bids", async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 600, "Job", ["M1"], [100]
      );

      await expect(freelance.connect(client).cancelJob(0))
        .to.emit(freelance, "JobCancelled")
        .withArgs(0);

      const j = await freelance.getJob(0);
      expect(j.status).to.equal(4n); // CANCELLED
    });

    it("reverts if bids exist", async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 600, "Job", ["M1"], [100]
      );

      const encBid = await encryptUint128(freelancer1, 8000n);
      await freelance.connect(freelancer1).submitBid(0, encBid);

      await expect(
        freelance.connect(client).cancelJob(0)
      ).to.be.revertedWithCustomError(freelance, "InvalidState");
    });

    it("reverts if not client", async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 600, "Job", ["M1"], [100]
      );

      await expect(
        freelance.connect(freelancer1).cancelJob(0)
      ).to.be.revertedWithCustomError(freelance, "Unauthorized");
    });
  });

  describe("Voter management", function () {
    it("adds voters correctly", async function () {
      const voterList = await freelance.getVoters();
      expect(voterList.length).to.equal(3);
      expect(await freelance.isVoter(voter1.address)).to.equal(true);
      expect(await freelance.isVoter(voter2.address)).to.equal(true);
      expect(await freelance.isVoter(voter3.address)).to.equal(true);
    });

    it("reverts if non-admin adds voter", async function () {
      await expect(
        freelance.connect(client).addVoter(deployer.address)
      ).to.be.revertedWithCustomError(freelance, "OwnableUnauthorizedAccount");
    });

    it("reverts if voter already added", async function () {
      await expect(
        freelance.connect(admin).addVoter(voter1.address)
      ).to.be.revertedWithCustomError(freelance, "InvalidState");
    });

    it("reverts adding zero address voter", async function () {
      await expect(
        freelance.connect(admin).addVoter(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(freelance, "InvalidInput");
    });
  });

  describe("Dispute vote submission (pre-assignment)", function () {
    it("rejects vote from non-voter", async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 600, "Job", ["M1"], [100]
      );

      const encVote = await encryptUint8(outsider, 1n);
      await expect(
        freelance.connect(outsider).submitVote(0, 0, encVote)
      ).to.be.revertedWithCustomError(freelance, "Unauthorized");
    });
  });

  describe("Milestone view", function () {
    it("returns milestone details", async function () {
      const tokenAddr = await token.getAddress();
      await freelance.connect(client).postJob(
        tokenAddr, 10000, 600, "Build DEX",
        ["Design", "Implementation"],
        [40, 60]
      );

      const ms0 = await freelance.getMilestone(0, 0);
      expect(ms0.description).to.equal("Design");
      expect(ms0.percentageBps).to.equal(40);
      expect(ms0.status).to.equal(0n); // PENDING
      expect(ms0.voteCount).to.equal(0);

      const ms1 = await freelance.getMilestone(0, 1);
      expect(ms1.description).to.equal("Implementation");
      expect(ms1.percentageBps).to.equal(60);
    });
  });
});
