import { expect } from "chai";
import hre from "hardhat";
import { Escrow, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint128 } from "../helpers/cofhe";

describe("Escrow", function () {
  let escrow: Escrow;
  let tokenA: ConfidentialToken;
  let tokenB: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let partyA: HardhatEthersSigner;
  let partyB: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, partyA, partyB, outsider] = await hre.ethers.getSigners();

    // Deploy tokens
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    tokenA = await tokenFactory.deploy();
    await tokenA.waitForDeployment();
    tokenB = await tokenFactory.deploy();
    await tokenB.waitForDeployment();

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

    // Deploy Escrow
    const escrowFactory = await hre.ethers.getContractFactory("Escrow");
    escrow = await escrowFactory.deploy(
      await vault.getAddress(),
      await registry.getAddress()
    );
    await escrow.waitForDeployment();

    // Authorize escrow as settler
    await vault.addAuthorizedSettler(await escrow.getAddress());
  });

  describe("createDeal()", function () {
    it("stores encrypted terms and emits event", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await expect(
        escrow.connect(partyA).createDeal(
          partyB.address,
          tokenAAddr,
          tokenBAddr,
          encTermsA,
          encTermsB,
          futureDeadline,
          dealHash
        )
      )
        .to.emit(escrow, "DealCreated")
        .withArgs(0, partyA.address, partyB.address, futureDeadline);

      const deal = await escrow.getDeal(0);
      expect(deal.partyA).to.equal(partyA.address);
      expect(deal.partyB).to.equal(partyB.address);
      expect(deal.tokenA).to.equal(tokenAAddr);
      expect(deal.tokenB).to.equal(tokenBAddr);
      expect(deal.status).to.equal(0n); // CREATED
      expect(deal.deadline).to.equal(BigInt(futureDeadline));
      expect(deal.dealHash).to.equal(dealHash);
    });

    it("reverts if partyB is zero address", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await expect(
        escrow.connect(partyA).createDeal(
          hre.ethers.ZeroAddress,
          tokenAAddr,
          tokenBAddr,
          encTermsA,
          encTermsB,
          futureDeadline,
          dealHash
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidInput");
    });

    it("reverts if partyB is self", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await expect(
        escrow.connect(partyA).createDeal(
          partyA.address,
          tokenAAddr,
          tokenBAddr,
          encTermsA,
          encTermsB,
          futureDeadline,
          dealHash
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidInput");
    });

    it("reverts if same token", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await expect(
        escrow.connect(partyA).createDeal(
          partyB.address,
          tokenAAddr,
          tokenAAddr,
          encTermsA,
          encTermsB,
          futureDeadline,
          dealHash
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidInput");
    });

    it("reverts if deadline already passed", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const pastDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp - 1;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await expect(
        escrow.connect(partyA).createDeal(
          partyB.address,
          tokenAAddr,
          tokenBAddr,
          encTermsA,
          encTermsB,
          pastDeadline,
          dealHash
        )
      ).to.be.revertedWithCustomError(escrow, "Expired");
    });
  });

  describe("fundDeal()", function () {
    let futureDeadline: number;

    beforeEach(async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await escrow.connect(partyA).createDeal(
        partyB.address,
        tokenAAddr,
        tokenBAddr,
        encTermsA,
        encTermsB,
        futureDeadline,
        dealHash
      );
    });

    it("partyA funds first, status becomes FUNDED_A", async function () {
      const encAmount = await encryptUint128(partyA, 1000n);

      await expect(escrow.connect(partyA).fundDeal(0, encAmount))
        .to.emit(escrow, "DealFunded")
        .withArgs(0, partyA.address);

      const deal = await escrow.getDeal(0);
      expect(deal.status).to.equal(1n); // FUNDED_A
    });

    it("partyB funds after partyA, status becomes FUNDED_BOTH", async function () {
      const encAmountA = await encryptUint128(partyA, 1000n);
      await escrow.connect(partyA).fundDeal(0, encAmountA);

      const encAmountB = await encryptUint128(partyB, 2000n);
      await expect(escrow.connect(partyB).fundDeal(0, encAmountB))
        .to.emit(escrow, "DealFunded")
        .withArgs(0, partyB.address);

      const deal = await escrow.getDeal(0);
      expect(deal.status).to.equal(2n); // FUNDED_BOTH
    });

    it("partyB cannot fund before partyA", async function () {
      const encAmountB = await encryptUint128(partyB, 2000n);
      await expect(
        escrow.connect(partyB).fundDeal(0, encAmountB)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("outsider cannot fund", async function () {
      const encAmount = await encryptUint128(outsider, 1000n);
      await expect(
        escrow.connect(outsider).fundDeal(0, encAmount)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });
  });

  describe("releaseDeal()", function () {
    it("executes when both deposits match terms", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await escrow.connect(partyA).createDeal(
        partyB.address, tokenAAddr, tokenBAddr,
        encTermsA, encTermsB, futureDeadline, dealHash
      );

      // Fund with matching amounts
      const encAmountA = await encryptUint128(partyA, 1000n);
      await escrow.connect(partyA).fundDeal(0, encAmountA);

      const encAmountB = await encryptUint128(partyB, 2000n);
      await escrow.connect(partyB).fundDeal(0, encAmountB);

      // Release
      await expect(escrow.connect(partyA).releaseDeal(0))
        .to.emit(escrow, "DealReleased")
        .withArgs(0);

      const deal = await escrow.getDeal(0);
      expect(deal.status).to.equal(3n); // RELEASED
    });

    it("reverts if not fully funded", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await escrow.connect(partyA).createDeal(
        partyB.address, tokenAAddr, tokenBAddr,
        encTermsA, encTermsB, futureDeadline, dealHash
      );

      // Only fund partyA
      const encAmountA = await encryptUint128(partyA, 1000n);
      await escrow.connect(partyA).fundDeal(0, encAmountA);

      await expect(
        escrow.connect(partyA).releaseDeal(0)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  describe("cancelDeal()", function () {
    it("works when deadline passed for FUNDED_BOTH deal", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 300;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await escrow.connect(partyA).createDeal(
        partyB.address, tokenAAddr, tokenBAddr,
        encTermsA, encTermsB, futureDeadline, dealHash
      );

      const encAmountA = await encryptUint128(partyA, 1000n);
      await escrow.connect(partyA).fundDeal(0, encAmountA);
      const encAmountB = await encryptUint128(partyB, 2000n);
      await escrow.connect(partyB).fundDeal(0, encAmountB);

      // Fast-forward past deadline
      await hre.network.provider.send("evm_increaseTime", [301]);
      await hre.network.provider.send("evm_mine");

      await expect(escrow.connect(partyA).cancelDeal(0))
        .to.emit(escrow, "DealCancelled")
        .withArgs(0);

      const deal = await escrow.getDeal(0);
      expect(deal.status).to.equal(4n); // CANCELLED
    });

    it("works for CREATED or FUNDED_A deals without waiting for deadline", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await escrow.connect(partyA).createDeal(
        partyB.address, tokenAAddr, tokenBAddr,
        encTermsA, encTermsB, futureDeadline, dealHash
      );

      // Cancel in CREATED state (no deadline requirement for non-FUNDED_BOTH)
      await expect(escrow.connect(partyA).cancelDeal(0))
        .to.emit(escrow, "DealCancelled");
    });

    it("reverts for FUNDED_BOTH if deadline not passed", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await escrow.connect(partyA).createDeal(
        partyB.address, tokenAAddr, tokenBAddr,
        encTermsA, encTermsB, futureDeadline, dealHash
      );

      const encAmountA = await encryptUint128(partyA, 1000n);
      await escrow.connect(partyA).fundDeal(0, encAmountA);
      const encAmountB = await encryptUint128(partyB, 2000n);
      await escrow.connect(partyB).fundDeal(0, encAmountB);

      await expect(
        escrow.connect(partyA).cancelDeal(0)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("reverts if not a party", async function () {
      const encTermsA = await encryptUint128(partyA, 1000n);
      const encTermsB = await encryptUint128(partyA, 2000n);
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const futureDeadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
      const dealHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal-1"));

      await escrow.connect(partyA).createDeal(
        partyB.address, tokenAAddr, tokenBAddr,
        encTermsA, encTermsB, futureDeadline, dealHash
      );

      await expect(
        escrow.connect(outsider).cancelDeal(0)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });
  });
});
