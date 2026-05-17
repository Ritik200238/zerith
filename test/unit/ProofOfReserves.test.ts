import { expect } from "chai";
import hre from "hardhat";
import {
  ProofOfReserves,
  ConfidentialToken,
  SettlementVault,
  PlatformRegistry,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ProofOfReserves", function () {
  let por: ProofOfReserves;
  let token: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let prover: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, prover, other] = await hre.ethers.getSigners();

    // Token
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    token = await tokenFactory.deploy();
    await token.waitForDeployment();

    // Registry
    const registryFactory = await hre.ethers.getContractFactory("PlatformRegistry");
    registry = await registryFactory.deploy(deployer.address, 100, deployer.address);
    await registry.waitForDeployment();

    // Vault
    const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
    vault = await vaultFactory.deploy(
      await token.getAddress(),
      await registry.getAddress(),
      deployer.address
    );
    await vault.waitForDeployment();

    // ProofOfReserves
    const porFactory = await hre.ethers.getContractFactory("ProofOfReserves");
    por = await porFactory.deploy(await vault.getAddress(), await registry.getAddress());
    await por.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets vault correctly", async function () {
      expect(await por.vault()).to.equal(await vault.getAddress());
    });

    it("sets registry correctly", async function () {
      expect(await por.registry()).to.equal(await registry.getAddress());
    });

    it("starts with zero claims", async function () {
      expect(await por.nextClaimId()).to.equal(0n);
      expect(await por.getClaimCount()).to.equal(0n);
    });

    it("reverts with zero vault", async function () {
      const porFactory = await hre.ethers.getContractFactory("ProofOfReserves");
      await expect(
        porFactory.deploy(hre.ethers.ZeroAddress, await registry.getAddress())
      ).to.be.revertedWithCustomError(por, "InvalidInput");
    });

    it("reverts with zero registry", async function () {
      const porFactory = await hre.ethers.getContractFactory("ProofOfReserves");
      await expect(
        porFactory.deploy(await vault.getAddress(), hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(por, "InvalidInput");
    });
  });

  describe("requestProof()", function () {
    beforeEach(async function () {
      // Prover delegates balance read to PoR before requesting
      await vault.connect(prover).delegateBalanceRead(
        await por.getAddress(),
        await token.getAddress()
      );
    });

    it("creates pending claim and emits event", async function () {
      const tokenAddr = await token.getAddress();
      const threshold = 1000n;

      await expect(por.connect(prover).requestProof(tokenAddr, threshold))
        .to.emit(por, "ProofRequested")
        .withArgs(0, prover.address, tokenAddr, threshold);

      expect(await por.nextClaimId()).to.equal(1n);
      expect(await por.getClaimCount()).to.equal(1n);
    });

    it("stores claim with PENDING status", async function () {
      const tokenAddr = await token.getAddress();
      await por.connect(prover).requestProof(tokenAddr, 5000n);

      const claim = await por.getClaim(0);
      expect(claim[0]).to.equal(prover.address);     // prover
      expect(claim[1]).to.equal(tokenAddr);          // token
      expect(claim[2]).to.equal(5000n);              // threshold
      expect(claim[3]).to.be.gt(0n);                 // requestedAt
      expect(claim[4]).to.equal(0n);                 // revealedAt
      expect(claim[5]).to.equal(0n);                 // status = PENDING
    });

    it("tracks claims per prover", async function () {
      const tokenAddr = await token.getAddress();
      await por.connect(prover).requestProof(tokenAddr, 100n);
      await por.connect(prover).requestProof(tokenAddr, 200n);
      await por.connect(prover).requestProof(tokenAddr, 300n);

      const claims = await por.getProverClaims(prover.address);
      expect(claims.length).to.equal(3);
      expect(claims[0]).to.equal(0n);
      expect(claims[1]).to.equal(1n);
      expect(claims[2]).to.equal(2n);

      expect(await por.getProverClaimCount(prover.address)).to.equal(3n);
    });

    it("isolates claims between provers", async function () {
      const tokenAddr = await token.getAddress();
      await vault.connect(other).delegateBalanceRead(await por.getAddress(), tokenAddr);

      await por.connect(prover).requestProof(tokenAddr, 100n);
      await por.connect(other).requestProof(tokenAddr, 500n);

      expect(await por.getProverClaimCount(prover.address)).to.equal(1n);
      expect(await por.getProverClaimCount(other.address)).to.equal(1n);

      const proverIds = await por.getProverClaims(prover.address);
      const otherIds = await por.getProverClaims(other.address);
      expect(proverIds[0]).to.equal(0n);
      expect(otherIds[0]).to.equal(1n);
    });

    it("reverts on zero token", async function () {
      await expect(
        por.connect(prover).requestProof(hre.ethers.ZeroAddress, 100n)
      ).to.be.revertedWithCustomError(por, "InvalidInput");
    });

    it("reverts on zero threshold", async function () {
      await expect(
        por.connect(prover).requestProof(await token.getAddress(), 0n)
      ).to.be.revertedWithCustomError(por, "InvalidInput");
    });

    it("reverts on threshold > uint64 max", async function () {
      const tooBig = 2n ** 64n;
      await expect(
        por.connect(prover).requestProof(await token.getAddress(), tooBig)
      ).to.be.revertedWithCustomError(por, "InvalidInput");
    });

    it("accepts threshold == uint64 max", async function () {
      const max64 = 2n ** 64n - 1n;
      await expect(
        por.connect(prover).requestProof(await token.getAddress(), max64)
      ).to.emit(por, "ProofRequested");
    });

    it("reverts when registry paused", async function () {
      await registry.connect(deployer).pause();
      await expect(
        por.connect(prover).requestProof(await token.getAddress(), 100n)
      ).to.be.revertedWithCustomError(por, "Paused");
    });
  });

  describe("getHighestVerifiedThreshold()", function () {
    it("returns 0 when no claims exist", async function () {
      expect(
        await por.getHighestVerifiedThreshold(prover.address, await token.getAddress())
      ).to.equal(0n);
    });

    it("returns 0 when only pending claims exist", async function () {
      const tokenAddr = await token.getAddress();
      await vault.connect(prover).delegateBalanceRead(await por.getAddress(), tokenAddr);
      await por.connect(prover).requestProof(tokenAddr, 1000n);
      await por.connect(prover).requestProof(tokenAddr, 5000n);

      // No revealProof calls — all still PENDING
      expect(
        await por.getHighestVerifiedThreshold(prover.address, tokenAddr)
      ).to.equal(0n);
    });
  });

  describe("Views", function () {
    it("getClaim reverts gracefully on non-existent id (returns zero struct)", async function () {
      // Solidity returns zeroed struct for unset mapping reads
      const claim = await por.getClaim(999);
      expect(claim[0]).to.equal(hre.ethers.ZeroAddress);
      expect(claim[5]).to.equal(0n); // PENDING (default enum value)
    });

    it("getProverClaims returns empty array for unknown prover", async function () {
      const claims = await por.getProverClaims(other.address);
      expect(claims.length).to.equal(0);
    });
  });
});
