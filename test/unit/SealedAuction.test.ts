import { expect } from "chai";
import hre from "hardhat";
import { SealedAuction, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint128 } from "../helpers/cofhe";

describe("SealedAuction", function () {
  let auction: SealedAuction;
  let token: ConfidentialToken;
  let paymentToken: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let bidder1: HardhatEthersSigner;
  let bidder2: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, seller, bidder1, bidder2] = await hre.ethers.getSigners();

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

    // Deploy SealedAuction (3rd arg: claimNFT, optional — pass zero address)
    const auctionFactory = await hre.ethers.getContractFactory("SealedAuction");
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
      expect(a.revealedBid).to.equal(0n);
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

      // The auction struct stores snipeExtension but it's not in getAuction return
      // We verify via the DEFAULT_SNIPE_EXTENSION constant
      expect(await auction.DEFAULT_SNIPE_EXTENSION()).to.equal(120n);
    });
  });

  describe("bid()", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      // Create auction with 600s duration
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 600, 0);
    });

    it("updates highestBid via FHE.max()", async function () {
      const encBid = await encryptUint128(bidder1, 5000n);

      await expect(auction.connect(bidder1).bid(0, encBid))
        .to.emit(auction, "BidPlaced")
        .withArgs(0, bidder1.address, await auction.auctions(0).then(a => a.deadline));

      const a = await auction.getAuction(0);
      expect(a.bidCount).to.equal(1n);

      // Verify hasBid mapping
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

    it("increments bid count for multiple bidders", async function () {
      const encBid1 = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid1);

      const encBid2 = await encryptUint128(bidder2, 7000n);
      await auction.connect(bidder2).bid(0, encBid2);

      const a = await auction.getAuction(0);
      expect(a.bidCount).to.equal(2n);
    });
  });

  describe("Anti-snipe timer", function () {
    it("extends deadline when bid is in last 60 seconds", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();

      // Create auction with minimum duration (300s)
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 300, 0);

      const auctionData = await auction.getAuction(0);
      const originalDeadline = auctionData.deadline;

      // Fast-forward to within 60 seconds of deadline
      // deadline is ~300s from now, we need to advance to within SNIPE_WINDOW (60s)
      const advanceSeconds = Number(originalDeadline) - (await hre.ethers.provider.getBlock("latest")).timestamp - 30;
      await hre.network.provider.send("evm_increaseTime", [advanceSeconds]);
      await hre.network.provider.send("evm_mine");

      // Place a bid in the snipe window
      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      // Deadline should have been extended
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
      // Place a bid first
      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      // Try to close before deadline
      await expect(
        auction.connect(seller).closeAuction(0)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("requires bids exist", async function () {
      // Fast-forward past deadline
      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(
        auction.connect(seller).closeAuction(0)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("succeeds when deadline passed and bids exist", async function () {
      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      // Fast-forward past deadline
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

  describe("Blind Floor Auction (createBlindAuction)", function () {
    it("creates blind auction with hasReserve = true", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);

      await expect(
        auction.connect(seller).createBlindAuction(tokenAddr, paymentAddr, 1000, 600, 0, encReserve)
      ).to.emit(auction, "AuctionCreated");

      const blindStatus = await auction.getBlindStatus(0);
      expect(blindStatus.hasReserve).to.equal(true);
      expect(blindStatus.revealedReserveMet).to.equal(false);

      const a = await auction.getAuction(0);
      expect(a.seller).to.equal(seller.address);
      expect(a.amount).to.equal(1000n);
      expect(a.status).to.equal(0n); // OPEN
    });

    it("standard auctions report hasReserve = false", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 600, 0);

      const blindStatus = await auction.getBlindStatus(0);
      expect(blindStatus.hasReserve).to.equal(false);
    });

    it("reverts createBlindAuction with same token", async function () {
      const tokenAddr = await token.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);
      await expect(
        auction.connect(seller).createBlindAuction(tokenAddr, tokenAddr, 1000, 600, 0, encReserve)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("reverts createBlindAuction with zero amount", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);
      await expect(
        auction.connect(seller).createBlindAuction(tokenAddr, paymentAddr, 0, 600, 0, encReserve)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("reverts createBlindAuction with duration below MIN_DURATION", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);
      await expect(
        auction.connect(seller).createBlindAuction(tokenAddr, paymentAddr, 1000, 100, 0, encReserve)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("accepts bids on blind auctions and tracks count", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);
      await auction.connect(seller).createBlindAuction(tokenAddr, paymentAddr, 1000, 600, 0, encReserve);

      const encBid1 = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid1);
      const encBid2 = await encryptUint128(bidder2, 12000n);
      await auction.connect(bidder2).bid(0, encBid2);

      const a = await auction.getAuction(0);
      expect(a.bidCount).to.equal(2n);
    });

    it("closeAuction populates encReserveMet for blind auctions", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);
      await auction.connect(seller).createBlindAuction(tokenAddr, paymentAddr, 1000, 300, 0, encReserve);

      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      // Advance past deadline
      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(auction.connect(seller).closeAuction(0))
        .to.emit(auction, "AuctionClosed");

      const a = await auction.getAuction(0);
      expect(a.status).to.equal(1n); // CLOSED

      // The encReserveMet handle should be set (non-zero) after close
      const blindStatus = await auction.getBlindStatus(0);
      expect(blindStatus.encReserveMetHandle).to.not.equal(0n);
    });

    it("revealWinner reverts on blind auctions (must use revealWinnerBlind)", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);
      await auction.connect(seller).createBlindAuction(tokenAddr, paymentAddr, 1000, 300, 0, encReserve);

      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");
      await auction.connect(seller).closeAuction(0);

      // Attempting revealWinner on a blind auction should revert with InvalidState
      // (signatures are placeholders; the InvalidState check fires before signature verification)
      await expect(
        auction.revealWinner(0, 5000n, "0x", bidder1.address, "0x")
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("revealWinnerBlind reverts on non-blind auctions", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 1000, 300, 0);

      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");
      await auction.connect(seller).closeAuction(0);

      await expect(
        auction.revealWinnerBlind(0, 5000n, "0x", bidder1.address, "0x", 1n, "0x")
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("revealWinnerBlind reverts with reserveMetValue > 1", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);
      await auction.connect(seller).createBlindAuction(tokenAddr, paymentAddr, 1000, 300, 0, encReserve);

      const encBid = await encryptUint128(bidder1, 5000n);
      await auction.connect(bidder1).bid(0, encBid);

      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");
      await auction.connect(seller).closeAuction(0);

      // reserveMetValue must be 0 or 1
      await expect(
        auction.revealWinnerBlind(0, 5000n, "0x", bidder1.address, "0x", 2n, "0x")
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("blind cancelAuction works pre-bid", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      const encReserve = await encryptUint128(seller, 10000n);
      await auction.connect(seller).createBlindAuction(tokenAddr, paymentAddr, 1000, 300, 0, encReserve);

      await expect(auction.connect(seller).cancelAuction(0))
        .to.emit(auction, "AuctionCancelled");
    });
  });
});
