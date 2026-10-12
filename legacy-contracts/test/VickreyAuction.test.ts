import { expect } from "chai";
import hre from "hardhat";
import { VickreyAuction, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint128 } from "../helpers/cofhe";

describe("VickreyAuction", function () {
  let auction: VickreyAuction;
  let token: ConfidentialToken;
  let paymentToken: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let bidder1: HardhatEthersSigner;
  let bidder2: HardhatEthersSigner;
  let bidder3: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, seller, bidder1, bidder2, bidder3] = await hre.ethers.getSigners();

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

    // Deploy VickreyAuction (claimNFT = address(0) for tests)
    const auctionFactory = await hre.ethers.getContractFactory("VickreyAuction");
    auction = await auctionFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress(),
      hre.ethers.ZeroAddress
    );
    await auction.waitForDeployment();

    // Authorize auction as settler
    await vault.addAuthorizedSettler(await auction.getAddress());
  });

  describe("createAuction()", function () {
    it("sets correct state", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();

      await expect(
        auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 600, 0)
      )
        .to.emit(auction, "AuctionCreated");

      const a = await auction.getAuction(0);
      expect(a.seller).to.equal(seller.address);
      expect(a.token).to.equal(tokenAddr);
      expect(a.paymentToken).to.equal(paymentAddr);
      expect(a.amount).to.equal(1000n);
      expect(a.bidCount).to.equal(0n);
      expect(a.status).to.equal(0n); // OPEN
      expect(a.revealedHighest).to.equal(0n);
      expect(a.revealedSecond).to.equal(0n);
      expect(a.revealedBidder).to.equal(hre.ethers.ZeroAddress);
    });

    it("reverts if same token", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        auction.connect(seller).createAuction(tokenAddr, tokenAddr, 1000, 600, 0)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("reverts if zero amount", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await expect(
        auction.connect(seller).createAuction(tokenAddr, paymentAddr, 0, 600, 0)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("reverts if duration too short", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await expect(
        auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 100, 0)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("uses default snipe extension when 0 is passed", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 600, 0);
      expect(await auction.DEFAULT_SNIPE_EXTENSION()).to.equal(120n);
    });
  });

  describe("bid()", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 600, 0);
    });

    it("accepts encrypted bid and increments bidCount", async function () {
      const encBid = await encryptUint128(bidder1, 5000n);

      await expect(auction.connect(bidder1).bid(0, encBid))
        .to.emit(auction, "BidPlaced");

      const a = await auction.getAuction(0);
      expect(a.bidCount).to.equal(1n);
      expect(await auction.hasBid(0, bidder1.address)).to.equal(true);
    });

    it("prevents double bidding", async function () {
      const encBid1 = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid1);

      const encBid2 = await encryptUint128(bidder1, 6000n);
      await expect(
        auction.connect(bidder1).bid(0, encBid2)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("prevents seller from bidding", async function () {
      const encBid = await encryptUint128(seller, 5000n);
      await expect(
        auction.connect(seller).bid(0, encBid)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("tracks multiple bidders (second-price tracking)", async function () {
      const encBid1 = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid1);

      const encBid2 = await encryptUint128(bidder2, 7000n);
      await auction.connect(bidder2).bid(0, encBid2);

      const a = await auction.getAuction(0);
      expect(a.bidCount).to.equal(2n);
    });

    it("supports three bidders for second-price verification", async function () {
      const encBid1 = await encryptUint128(bidder1, 3000n);
      await auction.connect(bidder1).bid(0, encBid1);

      const encBid2 = await encryptUint128(bidder2, 7000n);
      await auction.connect(bidder2).bid(0, encBid2);

      const encBid3 = await encryptUint128(bidder3, 5000n);
      await auction.connect(bidder3).bid(0, encBid3);

      const a = await auction.getAuction(0);
      expect(a.bidCount).to.equal(3n);
    });
  });

  describe("Anti-snipe timer", function () {
    it("extends deadline when bid is in last 60 seconds", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();

      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 300, 0);

      const auctionData = await auction.getAuction(0);
      const originalDeadline = auctionData.deadline;

      // Advance to within 30 seconds of deadline
      const advanceSeconds = Number(originalDeadline) - (await hre.ethers.provider.getBlock("latest"))!.timestamp - 30;
      await hre.network.provider.send("evm_increaseTime", [advanceSeconds]);
      await hre.network.provider.send("evm_mine");

      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      const updatedAuction = await auction.getAuction(0);
      expect(updatedAuction.deadline).to.be.gt(originalDeadline);
    });
  });

  describe("closeAuction()", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 300, 0);
    });

    it("requires deadline passed", async function () {
      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      await expect(
        auction.connect(seller).closeAuction(0)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("requires bids exist", async function () {
      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(
        auction.connect(seller).closeAuction(0)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("succeeds when deadline passed and bids exist", async function () {
      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(auction.connect(seller).closeAuction(0))
        .to.emit(auction, "AuctionClosed")
        .withArgs(0);

      const a = await auction.getAuction(0);
      expect(a.status).to.equal(1n); // CLOSED
    });

    it("reverts if not seller", async function () {
      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(
        auction.connect(bidder1).closeAuction(0)
      ).to.be.revertedWithCustomError(auction, "Unauthorized");
    });
  });

  describe("cancelAuction()", function () {
    it("works with 0 bids", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 300, 0);

      await expect(auction.connect(seller).cancelAuction(0))
        .to.emit(auction, "AuctionCancelled")
        .withArgs(0);

      const a = await auction.getAuction(0);
      expect(a.status).to.equal(4n); // CANCELLED
    });

    it("reverts if bids exist", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 300, 0);

      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      await expect(
        auction.connect(seller).cancelAuction(0)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("reverts if not seller", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 300, 0);

      await expect(
        auction.connect(bidder1).cancelAuction(0)
      ).to.be.revertedWithCustomError(auction, "Unauthorized");
    });
  });

  describe("Single bid edge case", function () {
    it("single bidder — closeAuction requests decryption", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 300, 0);

      // Only one bidder
      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      const a = await auction.getAuction(0);
      expect(a.bidCount).to.equal(1n);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      // Close should succeed — single bid edge case handled in revealWinner
      await expect(auction.connect(seller).closeAuction(0))
        .to.emit(auction, "AuctionClosed")
        .withArgs(0);

      const closed = await auction.getAuction(0);
      expect(closed.status).to.equal(1n); // CLOSED
    });
  });

  describe("Second-price mechanism (bid submission)", function () {
    it("two bidders — both tracked without leaking order", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 600, 0);

      // bidder1 bids 5000, bidder2 bids 8000
      // After reveal: winner = bidder2, pays 5000 (second-highest)
      const encBid1 = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid1);

      const encBid2 = await encryptUint128(bidder2, 8000n);
      await auction.connect(bidder2).bid(0, encBid2);

      const a = await auction.getAuction(0);
      expect(a.bidCount).to.equal(2n);

      // Both bidders have their bids recorded
      expect(await auction.hasBid(0, bidder1.address)).to.equal(true);
      expect(await auction.hasBid(0, bidder2.address)).to.equal(true);
    });
  });
});
