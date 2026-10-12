import { expect } from "chai";
import hre from "hardhat";
import { DutchAuction, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint64 } from "../helpers/cofhe";

describe("DutchAuction", function () {
  let auction: DutchAuction;
  let token: ConfidentialToken;
  let paymentToken: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let buyer1: HardhatEthersSigner;
  let buyer2: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, seller, buyer1, buyer2] = await hre.ethers.getSigners();

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

    // Deploy DutchAuction (claimNFT = address(0) for tests)
    const auctionFactory = await hre.ethers.getContractFactory("DutchAuction");
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
        auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 600)
      )
        .to.emit(auction, "DutchAuctionCreated");

      const a = await auction.getAuction(0);
      expect(a.seller).to.equal(seller.address);
      expect(a.token).to.equal(tokenAddr);
      expect(a.paymentToken).to.equal(paymentAddr);
      expect(a.totalSupply).to.equal(500n);
      expect(a.startPrice).to.equal(10000n);
      expect(a.endPrice).to.equal(1000n);
      expect(a.filledAmount).to.equal(0n);
      expect(a.status).to.equal(0n); // OPEN
    });

    it("reverts if same token", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        auction.connect(seller).createAuction(tokenAddr, tokenAddr, 500, 10000, 1000, 600)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("reverts if zero supply", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await expect(
        auction.connect(seller).createAuction(tokenAddr, paymentAddr, 0, 10000, 1000, 600)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("reverts if endPrice >= startPrice", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await expect(
        auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 1000, 1000, 600)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("reverts if duration too short", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await expect(
        auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 100)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });
  });

  describe("Price decay over time", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      // startPrice=10000, endPrice=2000, duration=800s
      // price drops 8000 over 800s = 10 per second
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 2000, 800);
    });

    it("starts at startPrice", async function () {
      const a = await auction.getAuction(0);
      expect(a.currentPrice).to.equal(10000n);
    });

    it("decays linearly over time", async function () {
      // Advance 400s — halfway → price should be ~6000
      await hre.network.provider.send("evm_increaseTime", [400]);
      await hre.network.provider.send("evm_mine");

      const a = await auction.getAuction(0);
      // (10000 - 2000) * 400 / 800 = 4000 drop → 10000 - 4000 = 6000
      expect(a.currentPrice).to.equal(6000n);
    });

    it("settles at endPrice after end time", async function () {
      await hre.network.provider.send("evm_increaseTime", [801]);
      await hre.network.provider.send("evm_mine");

      const a = await auction.getAuction(0);
      expect(a.currentPrice).to.equal(2000n);
    });
  });

  describe("buy()", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 600);
    });

    it("records purchase at current price", async function () {
      const encAmount = await encryptUint64(buyer1, 100n);

      await expect(auction.connect(buyer1).buy(0, encAmount))
        .to.emit(auction, "DutchPurchase");

      expect(await auction.getPurchaseCount(0)).to.equal(1n);
    });

    it("prevents seller from buying", async function () {
      const encAmount = await encryptUint64(seller, 100n);
      await expect(
        auction.connect(seller).buy(0, encAmount)
      ).to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("reverts after auction ends", async function () {
      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      const encAmount = await encryptUint64(buyer1, 100n);
      await expect(
        auction.connect(buyer1).buy(0, encAmount)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("accepts multiple purchases from different buyers", async function () {
      const encAmount1 = await encryptUint64(buyer1, 100n);
      await auction.connect(buyer1).buy(0, encAmount1);

      const encAmount2 = await encryptUint64(buyer2, 200n);
      await auction.connect(buyer2).buy(0, encAmount2);

      expect(await auction.getPurchaseCount(0)).to.equal(2n);
    });
  });

  describe("cancelAuction()", function () {
    it("works with no purchases", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 600);

      await expect(auction.connect(seller).cancelAuction(0))
        .to.emit(auction, "DutchAuctionCancelled")
        .withArgs(0);

      const a = await auction.getAuction(0);
      expect(a.status).to.equal(2n); // CANCELLED
    });

    it("reverts if purchases exist", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 600);

      const encAmount = await encryptUint64(buyer1, 100n);
      await auction.connect(buyer1).buy(0, encAmount);

      await expect(
        auction.connect(seller).cancelAuction(0)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("reverts if not seller", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 600);

      await expect(
        auction.connect(buyer1).cancelAuction(0)
      ).to.be.revertedWithCustomError(auction, "Unauthorized");
    });
  });

  describe("settleAuction()", function () {
    it("settles after end time with no purchases", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 600);

      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      await expect(auction.connect(seller).settleAuction(0))
        .to.emit(auction, "DutchAuctionSettled")
        .withArgs(0, 0);

      const a = await auction.getAuction(0);
      expect(a.status).to.equal(1n); // SETTLED
    });

    it("reverts before end time with unfilled supply", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 600);

      await expect(
        auction.connect(seller).settleAuction(0)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("reverts if already settled", async function () {
      const tokenAddr = await token.getAddress();
      const paymentAddr = await paymentToken.getAddress();
      await auction.connect(seller).createAuction(tokenAddr, paymentAddr, 500, 10000, 1000, 600);

      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      await auction.connect(seller).settleAuction(0);

      await expect(
        auction.connect(seller).settleAuction(0)
      ).to.be.revertedWithCustomError(auction, "InvalidState");
    });
  });
});
