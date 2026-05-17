import { expect } from "chai";
import hre from "hardhat";
import { LimitOrderEngine, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint128 } from "../helpers/cofhe";

describe("LimitOrderEngine", function () {
  let engine: LimitOrderEngine;
  let tokenBuy: ConfidentialToken;
  let tokenSell: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, oracle, user, user2] = await hre.ethers.getSigners();

    // Deploy tokens
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    tokenBuy = await tokenFactory.deploy();
    await tokenBuy.waitForDeployment();
    tokenSell = await tokenFactory.deploy();
    await tokenSell.waitForDeployment();

    // Deploy PlatformRegistry
    const registryFactory = await hre.ethers.getContractFactory("PlatformRegistry");
    registry = await registryFactory.deploy(deployer.address, 100, deployer.address);
    await registry.waitForDeployment();

    // Deploy SettlementVault
    const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
    vault = await vaultFactory.deploy(
      await tokenBuy.getAddress(),
      await registry.getAddress(),
      deployer.address
    );
    await vault.waitForDeployment();
    await vault.addSupportedToken(await tokenSell.getAddress());

    // Deploy LimitOrderEngine
    const engineFactory = await hre.ethers.getContractFactory("LimitOrderEngine");
    engine = await engineFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress(),
      oracle.address
    );
    await engine.waitForDeployment();

    // Authorize engine as settler
    await vault.addAuthorizedSettler(await engine.getAddress());
  });

  describe("Deployment", function () {
    it("sets oracle correctly", async function () {
      expect(await engine.oracle()).to.equal(oracle.address);
    });

    it("reverts with zero oracle address", async function () {
      const engineFactory = await hre.ethers.getContractFactory("LimitOrderEngine");
      await expect(
        engineFactory.deploy(
          await vault.getAddress(),
          await registry.getAddress(),
          hre.ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(engine, "InvalidInput");
    });
  });

  describe("createLimitOrder()", function () {
    it("stores trigger price and order details", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();
      const encTrigger = await encryptUint128(user, 5000n);

      await expect(
        engine.connect(user).createLimitOrder(
          tokenBuyAddr,
          tokenSellAddr,
          1000,
          encTrigger,
          0 // BUY_BELOW
        )
      )
        .to.emit(engine, "LimitOrderCreated")
        .withArgs(0, user.address, 0);

      // Verify order data via public mapping
      const order = await engine.limitOrders(0);
      expect(order.owner).to.equal(user.address);
      expect(order.tokenBuy).to.equal(tokenBuyAddr);
      expect(order.tokenSell).to.equal(tokenSellAddr);
      expect(order.amount).to.equal(1000n);
      expect(order.direction).to.equal(0n); // BUY_BELOW
      expect(order.status).to.equal(0n); // ACTIVE
    });

    it("adds to active orders list", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();
      const encTrigger = await encryptUint128(user, 5000n);

      await engine.connect(user).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 1000, encTrigger, 0
      );

      expect(await engine.getActiveOrderCount()).to.equal(1n);
      expect(await engine.activeOrderIds(0)).to.equal(0n);
    });

    it("reverts if same token", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const encTrigger = await encryptUint128(user, 5000n);

      await expect(
        engine.connect(user).createLimitOrder(
          tokenBuyAddr, tokenBuyAddr, 1000, encTrigger, 0
        )
      ).to.be.revertedWithCustomError(engine, "InvalidInput");
    });

    it("reverts if zero amount", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();
      const encTrigger = await encryptUint128(user, 5000n);

      await expect(
        engine.connect(user).createLimitOrder(
          tokenBuyAddr, tokenSellAddr, 0, encTrigger, 0
        )
      ).to.be.revertedWithCustomError(engine, "InvalidInput");
    });

    it("increments nextOrderId", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();

      const encTrigger1 = await encryptUint128(user, 5000n);
      await engine.connect(user).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 1000, encTrigger1, 0
      );

      const encTrigger2 = await encryptUint128(user, 6000n);
      await engine.connect(user).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 2000, encTrigger2, 1 // SELL_ABOVE
      );

      expect(await engine.nextOrderId()).to.equal(2n);
    });
  });

  describe("checkPrice()", function () {
    it("triggers orders when condition met (oracle only)", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();

      // Create BUY_BELOW order with trigger at 5000
      const encTrigger = await encryptUint128(user, 5000n);
      await engine.connect(user).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 1000, encTrigger, 0
      );

      // Oracle pushes price of 4000 (below trigger of 5000 -> should trigger BUY_BELOW)
      await expect(engine.connect(oracle).checkPrice(4000))
        .to.emit(engine, "PriceChecked")
        .withArgs(4000, 1);

      // Verify lastOraclePrice updated
      expect(await engine.lastOraclePrice()).to.equal(4000n);
    });

    it("reverts if not oracle", async function () {
      await expect(
        engine.connect(user).checkPrice(5000)
      ).to.be.revertedWithCustomError(engine, "Unauthorized");
    });

    it("processes multiple active orders", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();

      const encTrigger1 = await encryptUint128(user, 5000n);
      await engine.connect(user).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 1000, encTrigger1, 0
      );

      const encTrigger2 = await encryptUint128(user2, 8000n);
      await engine.connect(user2).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 2000, encTrigger2, 1 // SELL_ABOVE
      );

      // Push price that should trigger both:
      // BUY_BELOW at trigger 5000, oracle=4000 -> 4000 <= 5000 -> triggered
      // SELL_ABOVE at trigger 8000, oracle=4000 -> 4000 >= 8000 -> NOT triggered
      await expect(engine.connect(oracle).checkPrice(4000))
        .to.emit(engine, "PriceChecked")
        .withArgs(4000, 2);
    });
  });

  describe("cancelLimitOrder()", function () {
    it("cancels order for owner", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();
      const encTrigger = await encryptUint128(user, 5000n);

      await engine.connect(user).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 1000, encTrigger, 0
      );

      await expect(engine.connect(user).cancelLimitOrder(0))
        .to.emit(engine, "OrderCancelled")
        .withArgs(0);

      const order = await engine.limitOrders(0);
      expect(order.status).to.equal(3n); // CANCELLED

      expect(await engine.getActiveOrderCount()).to.equal(0n);
    });

    it("reverts if not owner", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();
      const encTrigger = await encryptUint128(user, 5000n);

      await engine.connect(user).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 1000, encTrigger, 0
      );

      await expect(
        engine.connect(user2).cancelLimitOrder(0)
      ).to.be.revertedWithCustomError(engine, "Unauthorized");
    });

    it("reverts if already cancelled", async function () {
      const tokenBuyAddr = await tokenBuy.getAddress();
      const tokenSellAddr = await tokenSell.getAddress();
      const encTrigger = await encryptUint128(user, 5000n);

      await engine.connect(user).createLimitOrder(
        tokenBuyAddr, tokenSellAddr, 1000, encTrigger, 0
      );
      await engine.connect(user).cancelLimitOrder(0);

      await expect(
        engine.connect(user).cancelLimitOrder(0)
      ).to.be.revertedWithCustomError(engine, "InvalidState");
    });
  });

  describe("setOracle()", function () {
    it("allows oracle to update oracle address", async function () {
      await expect(engine.connect(oracle).setOracle(user.address))
        .to.emit(engine, "OracleUpdated")
        .withArgs(user.address);

      expect(await engine.oracle()).to.equal(user.address);
    });

    it("reverts if not current oracle", async function () {
      await expect(
        engine.connect(user).setOracle(user2.address)
      ).to.be.revertedWithCustomError(engine, "Unauthorized");
    });

    it("reverts for zero address", async function () {
      await expect(
        engine.connect(oracle).setOracle(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(engine, "InvalidInput");
    });
  });
});
