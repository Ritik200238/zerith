import { expect } from "chai";
import hre from "hardhat";
import { OrderBook, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint128 } from "../helpers/cofhe";

describe("OrderBook", function () {
  let orderBook: OrderBook;
  let token: ConfidentialToken;
  let tokenB: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let maker: HardhatEthersSigner;
  let taker: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, maker, taker] = await hre.ethers.getSigners();

    // Deploy ConfidentialToken (sell token)
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    token = await tokenFactory.deploy();
    await token.waitForDeployment();

    // Deploy second ConfidentialToken (buy token)
    tokenB = await tokenFactory.deploy();
    await tokenB.waitForDeployment();

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

    // Whitelist tokenB in vault
    await vault.addSupportedToken(await tokenB.getAddress());

    // Deploy OrderBook
    const orderBookFactory = await hre.ethers.getContractFactory("OrderBook");
    orderBook = await orderBookFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress()
    );
    await orderBook.waitForDeployment();

    // Authorize OrderBook as settler in vault
    await vault.addAuthorizedSettler(await orderBook.getAddress());
  });

  describe("createOrder()", function () {
    it("stores order correctly and emits event", async function () {
      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await expect(
        orderBook.connect(maker).createOrder(
          tokenAddr,
          tokenBAddr,
          500,
          encPrice,
          0 // BUY
        )
      )
        .to.emit(orderBook, "OrderCreated")
        .withArgs(0, maker.address, tokenAddr, tokenBAddr, 500, 0);

      // Verify order data stored
      const order = await orderBook.getOrder(0);
      expect(order.maker).to.equal(maker.address);
      expect(order.tokenSell).to.equal(tokenAddr);
      expect(order.tokenBuy).to.equal(tokenBAddr);
      expect(order.amountSell).to.equal(500n);
      expect(order.side).to.equal(0n); // BUY
      expect(order.status).to.equal(0n); // ACTIVE
    });

    it("increments nextOrderId", async function () {
      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 100, encPrice, 0);
      expect(await orderBook.getOrderCount()).to.equal(1n);

      const encPrice2 = await encryptUint128(maker, 2000n);
      await orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 200, encPrice2, 1);
      expect(await orderBook.getOrderCount()).to.equal(2n);
    });

    it("reverts if same token for sell and buy", async function () {
      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();

      await expect(
        orderBook.connect(maker).createOrder(tokenAddr, tokenAddr, 500, encPrice, 0)
      ).to.be.revertedWithCustomError(orderBook, "InvalidInput");
    });

    it("reverts if amount is zero", async function () {
      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await expect(
        orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 0, encPrice, 0)
      ).to.be.revertedWithCustomError(orderBook, "InvalidInput");
    });
  });

  describe("fillOrder()", function () {
    let tokenAddr: string;
    let tokenBAddr: string;

    beforeEach(async function () {
      tokenAddr = await token.getAddress();
      tokenBAddr = await tokenB.getAddress();

      // Create an order: maker sells token at price 1000
      const encPrice = await encryptUint128(maker, 1000n);
      await orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 500, encPrice, 1); // SELL
    });

    it("fills order when takerPrice >= makerPrice (via FHE.gte)", async function () {
      // Taker offers 1500 (>= 1000) - should match
      const encTakerPrice = await encryptUint128(taker, 1500n);

      await expect(orderBook.connect(taker).fillOrder(0, encTakerPrice))
        .to.emit(orderBook, "OrderFilled")
        .withArgs(0, taker.address);

      // Verify order is now FILLED
      const order = await orderBook.getOrder(0);
      expect(order.status).to.equal(1n); // FILLED
    });

    it("reverts if order not active", async function () {
      // Fill the order first
      const encTakerPrice = await encryptUint128(taker, 1500n);
      await orderBook.connect(taker).fillOrder(0, encTakerPrice);

      // Try to fill again
      const encTakerPrice2 = await encryptUint128(taker, 2000n);
      await expect(
        orderBook.connect(taker).fillOrder(0, encTakerPrice2)
      ).to.be.revertedWithCustomError(orderBook, "InvalidState");
    });

    it("prevents self-filling", async function () {
      const encTakerPrice = await encryptUint128(maker, 1500n);
      await expect(
        orderBook.connect(maker).fillOrder(0, encTakerPrice)
      ).to.be.revertedWithCustomError(orderBook, "InvalidInput");
    });
  });

  describe("cancelOrder()", function () {
    it("works for maker only", async function () {
      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 500, encPrice, 0);

      await expect(orderBook.connect(maker).cancelOrder(0))
        .to.emit(orderBook, "OrderCancelled")
        .withArgs(0);

      const order = await orderBook.getOrder(0);
      expect(order.status).to.equal(2n); // CANCELLED
    });

    it("reverts if not maker", async function () {
      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 500, encPrice, 0);

      await expect(
        orderBook.connect(taker).cancelOrder(0)
      ).to.be.revertedWithCustomError(orderBook, "Unauthorized");
    });

    it("reverts if order already cancelled", async function () {
      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 500, encPrice, 0);
      await orderBook.connect(maker).cancelOrder(0);

      await expect(
        orderBook.connect(maker).cancelOrder(0)
      ).to.be.revertedWithCustomError(orderBook, "InvalidState");
    });
  });

  describe("hasActiveOrders()", function () {
    it("returns false when empty, true after order", async function () {
      expect(await orderBook.hasActiveOrders()).to.equal(false);

      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 100, encPrice, 0);
      expect(await orderBook.hasActiveOrders()).to.equal(true);

      // Cancel — back to empty
      await orderBook.connect(maker).cancelOrder(0);
      expect(await orderBook.hasActiveOrders()).to.equal(false);
    });

    it("returns false after fill", async function () {
      const encPrice = await encryptUint128(maker, 1000n);
      const tokenAddr = await token.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      await orderBook.connect(maker).createOrder(tokenAddr, tokenBAddr, 100, encPrice, 0);
      expect(await orderBook.hasActiveOrders()).to.equal(true);

      const encTakerPrice = await encryptUint128(taker, 1500n);
      await orderBook.connect(taker).fillOrder(0, encTakerPrice);
      expect(await orderBook.hasActiveOrders()).to.equal(false);
    });
  });
});
