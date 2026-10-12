import { expect } from "chai";
import hre from "hardhat";
import { OTCBoard, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint128 } from "../helpers/cofhe";

describe("OTCBoard", function () {
  let otcBoard: OTCBoard;
  let tokenWant: ConfidentialToken;
  let tokenOffer: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let requester: HardhatEthersSigner;
  let quoter: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, requester, quoter, outsider] = await hre.ethers.getSigners();

    // Deploy tokens
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    tokenWant = await tokenFactory.deploy();
    await tokenWant.waitForDeployment();
    tokenOffer = await tokenFactory.deploy();
    await tokenOffer.waitForDeployment();

    // Deploy PlatformRegistry
    const registryFactory = await hre.ethers.getContractFactory("PlatformRegistry");
    registry = await registryFactory.deploy(deployer.address, 100, deployer.address);
    await registry.waitForDeployment();

    // Deploy SettlementVault
    const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
    vault = await vaultFactory.deploy(
      await tokenWant.getAddress(),
      await registry.getAddress(),
      deployer.address
    );
    await vault.waitForDeployment();
    await vault.addSupportedToken(await tokenOffer.getAddress());

    // Deploy OTCBoard
    const otcFactory = await hre.ethers.getContractFactory("OTCBoard");
    otcBoard = await otcFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress()
    );
    await otcBoard.waitForDeployment();

    // Authorize OTCBoard as settler
    await vault.addAuthorizedSettler(await otcBoard.getAddress());
  });

  describe("postRequest()", function () {
    it("stores encrypted amounts and emits event", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;

      await expect(
        otcBoard.connect(requester).postRequest(
          tokenWantAddr,
          tokenOfferAddr,
          encAmount,
          encMinPrice,
          encMaxPrice,
          deadline
        )
      )
        .to.emit(otcBoard, "RequestPosted")
        .withArgs(0, requester.address, tokenWantAddr, tokenOfferAddr, deadline);

      const req = await otcBoard.getRequest(0);
      expect(req.requester).to.equal(requester.address);
      expect(req.tokenWant).to.equal(tokenWantAddr);
      expect(req.tokenOffer).to.equal(tokenOfferAddr);
      expect(req.status).to.equal(0n); // ACTIVE
      expect(req.deadline).to.equal(BigInt(deadline));
      expect(req.quoteCount).to.equal(0n);
    });

    it("increments request count", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
      );
      expect(await otcBoard.getRequestCount()).to.equal(1n);

      const encAmount2 = await encryptUint128(requester, 20000n);
      const encMinPrice2 = await encryptUint128(requester, 600n);
      const encMaxPrice2 = await encryptUint128(requester, 1600n);
      const deadline2 = (await hre.ethers.provider.getBlock("latest")).timestamp + 7200;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount2, encMinPrice2, encMaxPrice2, deadline2
      );
      expect(await otcBoard.getRequestCount()).to.equal(2n);
    });

    it("reverts if same token", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;

      await expect(
        otcBoard.connect(requester).postRequest(
          tokenWantAddr, tokenWantAddr, encAmount, encMinPrice, encMaxPrice, deadline
        )
      ).to.be.revertedWithCustomError(otcBoard, "InvalidInput");
    });

    it("reverts if deadline passed", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp - 1;

      await expect(
        otcBoard.connect(requester).postRequest(
          tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
        )
      ).to.be.revertedWithCustomError(otcBoard, "Expired");
    });
  });

  describe("submitQuote()", function () {
    let deadline: number;

    beforeEach(async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
      );
    });

    it("stores quote and emits event", async function () {
      const encQuotePrice = await encryptUint128(quoter, 1000n);
      const encQuoteAmount = await encryptUint128(quoter, 5000n);

      await expect(
        otcBoard.connect(quoter).submitQuote(0, encQuotePrice, encQuoteAmount)
      )
        .to.emit(otcBoard, "QuoteSubmitted")
        .withArgs(0, 0, quoter.address);

      // Verify quote count increased
      const req = await otcBoard.getRequest(0);
      expect(req.quoteCount).to.equal(1n);

      // Verify quote details
      const quote = await otcBoard.getQuote(0, 0);
      expect(quote.quoter).to.equal(quoter.address);
      expect(quote.accepted).to.equal(false);
    });

    it("reverts if requester quotes own request", async function () {
      const encQuotePrice = await encryptUint128(requester, 1000n);
      const encQuoteAmount = await encryptUint128(requester, 5000n);

      await expect(
        otcBoard.connect(requester).submitQuote(0, encQuotePrice, encQuoteAmount)
      ).to.be.revertedWithCustomError(otcBoard, "InvalidInput");
    });

    it("reverts if request not active", async function () {
      // Cancel the request first
      await otcBoard.connect(requester).cancelRequest(0);

      const encQuotePrice = await encryptUint128(quoter, 1000n);
      const encQuoteAmount = await encryptUint128(quoter, 5000n);

      await expect(
        otcBoard.connect(quoter).submitQuote(0, encQuotePrice, encQuoteAmount)
      ).to.be.revertedWithCustomError(otcBoard, "InvalidState");
    });

    it("reverts if deadline expired", async function () {
      await hre.network.provider.send("evm_increaseTime", [3601]);
      await hre.network.provider.send("evm_mine");

      const encQuotePrice = await encryptUint128(quoter, 1000n);
      const encQuoteAmount = await encryptUint128(quoter, 5000n);

      await expect(
        otcBoard.connect(quoter).submitQuote(0, encQuotePrice, encQuoteAmount)
      ).to.be.revertedWithCustomError(otcBoard, "Expired");
    });

    it("allows multiple quotes from different quoters", async function () {
      const encQuotePrice1 = await encryptUint128(quoter, 1000n);
      const encQuoteAmount1 = await encryptUint128(quoter, 5000n);
      await otcBoard.connect(quoter).submitQuote(0, encQuotePrice1, encQuoteAmount1);

      const encQuotePrice2 = await encryptUint128(outsider, 1100n);
      const encQuoteAmount2 = await encryptUint128(outsider, 4000n);
      await otcBoard.connect(outsider).submitQuote(0, encQuotePrice2, encQuoteAmount2);

      const req = await otcBoard.getRequest(0);
      expect(req.quoteCount).to.equal(2n);
    });
  });

  describe("acceptQuote()", function () {
    beforeEach(async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
      );

      // Submit a quote with price in range
      const encQuotePrice = await encryptUint128(quoter, 1000n);
      const encQuoteAmount = await encryptUint128(quoter, 5000n);
      await otcBoard.connect(quoter).submitQuote(0, encQuotePrice, encQuoteAmount);
    });

    it("verifies price in range and settles", async function () {
      await expect(otcBoard.connect(requester).acceptQuote(0, 0))
        .to.emit(otcBoard, "QuoteAccepted")
        .withArgs(0, 0);

      const req = await otcBoard.getRequest(0);
      expect(req.status).to.equal(1n); // MATCHED

      const quote = await otcBoard.getQuote(0, 0);
      expect(quote.accepted).to.equal(true);
    });

    it("reverts if not requester", async function () {
      await expect(
        otcBoard.connect(quoter).acceptQuote(0, 0)
      ).to.be.revertedWithCustomError(otcBoard, "Unauthorized");
    });

    it("reverts if invalid quote index", async function () {
      await expect(
        otcBoard.connect(requester).acceptQuote(0, 99)
      ).to.be.revertedWithCustomError(otcBoard, "InvalidInput");
    });

    it("reverts if request not active", async function () {
      // Accept first quote (marks request as MATCHED)
      await otcBoard.connect(requester).acceptQuote(0, 0);

      // Try to accept again
      await expect(
        otcBoard.connect(requester).acceptQuote(0, 0)
      ).to.be.revertedWithCustomError(otcBoard, "InvalidState");
    });
  });

  describe("cancelRequest()", function () {
    it("cancels request for requester", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
      );

      await expect(otcBoard.connect(requester).cancelRequest(0))
        .to.emit(otcBoard, "RequestCancelled")
        .withArgs(0);

      const req = await otcBoard.getRequest(0);
      expect(req.status).to.equal(2n); // CANCELLED
    });

    it("reverts if not requester", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
      );

      await expect(
        otcBoard.connect(outsider).cancelRequest(0)
      ).to.be.revertedWithCustomError(otcBoard, "Unauthorized");
    });
  });

  describe("expireRequest()", function () {
    it("flips ACTIVE → EXPIRED after deadline (anyone can sweep)", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
      );

      // Advance past deadline
      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      // outsider (not requester, not quoter) can sweep
      await expect(otcBoard.connect(outsider).expireRequest(0))
        .to.emit(otcBoard, "RequestExpired")
        .withArgs(0);

      const req = await otcBoard.getRequest(0);
      expect(req.status).to.equal(3n); // EXPIRED
    });

    it("reverts if called before deadline", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
      );

      await expect(
        otcBoard.connect(outsider).expireRequest(0)
      ).to.be.revertedWithCustomError(otcBoard, "InvalidState");
    });

    it("reverts if already cancelled", async function () {
      const tokenWantAddr = await tokenWant.getAddress();
      const tokenOfferAddr = await tokenOffer.getAddress();
      const encAmount = await encryptUint128(requester, 10000n);
      const encMinPrice = await encryptUint128(requester, 500n);
      const encMaxPrice = await encryptUint128(requester, 1500n);
      const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600;

      await otcBoard.connect(requester).postRequest(
        tokenWantAddr, tokenOfferAddr, encAmount, encMinPrice, encMaxPrice, deadline
      );
      await otcBoard.connect(requester).cancelRequest(0);

      await hre.network.provider.send("evm_increaseTime", [601]);
      await hre.network.provider.send("evm_mine");

      await expect(
        otcBoard.connect(outsider).expireRequest(0)
      ).to.be.revertedWithCustomError(otcBoard, "InvalidState");
    });
  });
});
