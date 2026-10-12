import { expect } from "chai";
import hre from "hardhat";
import {
  ConfidentialToken,
  PlatformRegistry,
  SettlementVault,
  VaultEscrowHarness,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint64 } from "../helpers/cofhe";

describe("SettlementVault", function () {
  let token: ConfidentialToken;
  let registry: PlatformRegistry;
  let vault: SettlementVault;
  let admin: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let settler: HardhatEthersSigner;
  let feeCollector: HardhatEthersSigner;

  beforeEach(async function () {
    [admin, alice, bob, settler, feeCollector] = await hre.ethers.getSigners();

    // Deploy ConfidentialToken
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    token = await tokenFactory.deploy("Zerith Test Dollar", "CDEX");
    await token.waitForDeployment();

    // Deploy PlatformRegistry
    const registryFactory = await hre.ethers.getContractFactory("PlatformRegistry");
    registry = await registryFactory.deploy(admin.address, 100, feeCollector.address);
    await registry.waitForDeployment();

    // Deploy SettlementVault
    const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
    vault = await vaultFactory.deploy(
      await token.getAddress(),
      await registry.getAddress(),
      admin.address
    );
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("deploys successfully", async function () {
      const addr = await vault.getAddress();
      expect(addr).to.be.properAddress;
    });

    it("sets correct owner", async function () {
      expect(await vault.owner()).to.equal(admin.address);
    });

    it("whitelists the initial token", async function () {
      expect(await vault.supportedTokens(await token.getAddress())).to.equal(true);
    });

    it("sets the registry address", async function () {
      expect(await vault.registry()).to.equal(await registry.getAddress());
    });

    it("reverts if token address is zero", async function () {
      const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
      await expect(
        vaultFactory.deploy(
          hre.ethers.ZeroAddress,
          await registry.getAddress(),
          admin.address
        )
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("reverts if registry address is zero", async function () {
      const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
      await expect(
        vaultFactory.deploy(
          await token.getAddress(),
          hre.ethers.ZeroAddress,
          admin.address
        )
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("emits TokenWhitelisted on deploy", async function () {
      const vaultFactory = await hre.ethers.getContractFactory("SettlementVault");
      const newVault = await vaultFactory.deploy(
        await token.getAddress(),
        await registry.getAddress(),
        admin.address
      );
      const receipt = await newVault.deploymentTransaction()?.wait();
      const events = await newVault.queryFilter(
        newVault.filters.TokenWhitelisted(),
        receipt?.blockNumber,
        receipt?.blockNumber
      );
      expect(events.length).to.equal(1);
      expect(events[0].args.token).to.equal(await token.getAddress());
    });
  });

  describe("Token Management", function () {
    it("addSupportedToken() whitelists a new token", async function () {
      await vault.connect(admin).addSupportedToken(bob.address);
      expect(await vault.supportedTokens(bob.address)).to.equal(true);
    });

    it("addSupportedToken() emits TokenWhitelisted event", async function () {
      await expect(vault.connect(admin).addSupportedToken(bob.address))
        .to.emit(vault, "TokenWhitelisted")
        .withArgs(bob.address);
    });

    it("addSupportedToken() reverts for zero address", async function () {
      await expect(
        vault.connect(admin).addSupportedToken(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("addSupportedToken() reverts if already supported", async function () {
      await vault.connect(admin).addSupportedToken(bob.address);
      await expect(
        vault.connect(admin).addSupportedToken(bob.address)
      ).to.be.revertedWithCustomError(vault, "InvalidState");
    });

    it("addSupportedToken() reverts when called by non-owner", async function () {
      await expect(
        vault.connect(alice).addSupportedToken(bob.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("removeSupportedToken() delists a token", async function () {
      await vault.connect(admin).removeSupportedToken(await token.getAddress());
      expect(await vault.supportedTokens(await token.getAddress())).to.equal(false);
    });

    it("removeSupportedToken() emits TokenDelisted event", async function () {
      await expect(
        vault.connect(admin).removeSupportedToken(await token.getAddress())
      )
        .to.emit(vault, "TokenDelisted")
        .withArgs(await token.getAddress());
    });

    it("removeSupportedToken() reverts if not supported", async function () {
      await expect(
        vault.connect(admin).removeSupportedToken(bob.address)
      ).to.be.revertedWithCustomError(vault, "InvalidState");
    });

    it("removeSupportedToken() reverts when called by non-owner", async function () {
      await expect(
        vault.connect(alice).removeSupportedToken(await token.getAddress())
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Settler Management", function () {
    it("addAuthorizedSettler() authorizes a settler", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      expect(await vault.authorizedSettlers(settler.address)).to.equal(true);
    });

    it("addAuthorizedSettler() emits SettlerAuthorized event", async function () {
      await expect(vault.connect(admin).addAuthorizedSettler(settler.address))
        .to.emit(vault, "SettlerAuthorized")
        .withArgs(settler.address);
    });

    it("addAuthorizedSettler() reverts for zero address", async function () {
      await expect(
        vault.connect(admin).addAuthorizedSettler(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("addAuthorizedSettler() reverts if already authorized", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      await expect(
        vault.connect(admin).addAuthorizedSettler(settler.address)
      ).to.be.revertedWithCustomError(vault, "InvalidState");
    });

    it("addAuthorizedSettler() reverts when called by non-owner", async function () {
      await expect(
        vault.connect(alice).addAuthorizedSettler(settler.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("removeAuthorizedSettler() revokes a settler", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      await vault.connect(admin).removeAuthorizedSettler(settler.address);
      expect(await vault.authorizedSettlers(settler.address)).to.equal(false);
    });

    it("removeAuthorizedSettler() emits SettlerRevoked event", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      await expect(vault.connect(admin).removeAuthorizedSettler(settler.address))
        .to.emit(vault, "SettlerRevoked")
        .withArgs(settler.address);
    });

    it("removeAuthorizedSettler() reverts if not authorized", async function () {
      await expect(
        vault.connect(admin).removeAuthorizedSettler(settler.address)
      ).to.be.revertedWithCustomError(vault, "InvalidState");
    });

    it("removeAuthorizedSettler() reverts when called by non-owner", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      await expect(
        vault.connect(alice).removeAuthorizedSettler(settler.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("deposit()", function () {
    let tokenAddr: string;

    beforeEach(async function () {
      tokenAddr = await token.getAddress();
    });

    it("reverts for unsupported token", async function () {
      const encAmount = await encryptUint64(alice, 500n, vault);

      await expect(
        vault.connect(alice).deposit(bob.address, ...encAmount)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("reverts when platform is paused", async function () {
      await registry.connect(admin).pause();

      const encAmount = await encryptUint64(alice, 500n, vault);

      await expect(
        vault.connect(alice).deposit(tokenAddr, ...encAmount)
      ).to.be.revertedWithCustomError(vault, "Paused");
    });
  });

  describe("withdraw()", function () {
    let tokenAddr: string;

    beforeEach(async function () {
      tokenAddr = await token.getAddress();
    });

    it("reverts for unsupported token", async function () {
      const encAmount = await encryptUint64(alice, 100n, vault);

      await expect(
        vault.connect(alice).withdraw(bob.address, ...encAmount)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("reverts when platform is paused", async function () {
      await registry.connect(admin).pause();

      const encAmount = await encryptUint64(alice, 100n, vault);

      await expect(
        vault.connect(alice).withdraw(tokenAddr, ...encAmount)
      ).to.be.revertedWithCustomError(vault, "Paused");
    });
  });

  // ─── Real token flows (regression for the audit's C1 finding) ───────────

  describe("deposit/withdraw with real token movement", function () {
    const UNTIL = 2n ** 48n - 1n;
    const pt = async (h: string | bigint) => hre.cofhe.mocks.getPlaintext(BigInt(h));
    let tokenAddr: string;
    let vaultAddr: string;

    beforeEach(async function () {
      tokenAddr = await token.getAddress();
      vaultAddr = await vault.getAddress();
      for (const s of [alice, bob]) {
        await token.connect(s).setOperator(vaultAddr, UNTIL);
      }
    });

    it("credits exactly what arrived", async function () {
      await token.connect(alice).faucet(); // 1000e6
      await vault.connect(alice).deposit(tokenAddr, ...(await encryptUint64(alice, 400_000000n, vault)));
      expect(await pt(await vault.getEncBalance(alice.address, tokenAddr))).to.equal(400_000000n);
      expect(await pt(await token.confidentialBalanceOf(alice.address))).to.equal(600_000000n);
    });

    it("rejects a deposit from a wallet that never held the token", async function () {
      // ERC-7984 FHERC20 refuses to move from an account with no balance at all.
      await expect(
        vault.connect(alice).deposit(tokenAddr, ...(await encryptUint64(alice, 1000_000000n, vault))),
      ).to.be.revertedWithCustomError(token, "FHERC20ZeroBalance");
      expect(BigInt(await vault.getEncBalance(alice.address, tokenAddr))).to.equal(0n);
    });

    it("credits 0 when the depositor holds some tokens but not enough (no phantom balance)", async function () {
      await token.connect(alice).faucet(); // 1000e6
      await vault.connect(alice).deposit(tokenAddr, ...(await encryptUint64(alice, 5000_000000n, vault)));
      expect(await pt(await vault.getEncBalance(alice.address, tokenAddr))).to.equal(0n);
      expect(await pt(await token.confidentialBalanceOf(alice.address))).to.equal(1000_000000n);
    });

    it("an attacker who can't cover a deposit cannot withdraw another user's funds", async function () {
      await token.connect(bob).faucet();
      await vault.connect(bob).deposit(tokenAddr, ...(await encryptUint64(bob, 1000_000000n, vault)));

      // alice holds 1 token and "deposits" 1000: the token moves 0, the vault credits 0
      await token.connect(admin).adminMint(alice.address, 1_000000n);
      await vault.connect(alice).deposit(tokenAddr, ...(await encryptUint64(alice, 1000_000000n, vault)));
      await vault.connect(alice).withdraw(tokenAddr, ...(await encryptUint64(alice, 1000_000000n, vault)));

      expect(await pt(await token.confidentialBalanceOf(alice.address))).to.equal(1_000000n);
      expect(await pt(await vault.getEncBalance(bob.address, tokenAddr))).to.equal(1000_000000n);
    });

    it("withdraw returns tokens and debits the ledger", async function () {
      await token.connect(alice).faucet();
      await vault.connect(alice).deposit(tokenAddr, ...(await encryptUint64(alice, 500_000000n, vault)));
      await vault.connect(alice).withdraw(tokenAddr, ...(await encryptUint64(alice, 200_000000n, vault)));
      expect(await pt(await vault.getEncBalance(alice.address, tokenAddr))).to.equal(300_000000n);
      expect(await pt(await token.confidentialBalanceOf(alice.address))).to.equal(700_000000n);
    });

    it("withdrawing more than the balance moves nothing", async function () {
      await token.connect(alice).faucet();
      await vault.connect(alice).deposit(tokenAddr, ...(await encryptUint64(alice, 500_000000n, vault)));
      await vault.connect(alice).withdraw(tokenAddr, ...(await encryptUint64(alice, 501_000000n, vault)));
      expect(await pt(await vault.getEncBalance(alice.address, tokenAddr))).to.equal(500_000000n);
      expect(await pt(await token.confidentialBalanceOf(alice.address))).to.equal(500_000000n);
    });
  });

  // ─── Escrow ─────────────────────────────────────────────────────────────

  describe("escrow (lockFunds / releaseFunds)", function () {
    const UNTIL = 2n ** 48n - 1n;
    const pt = async (h: string | bigint) => hre.cofhe.mocks.getPlaintext(BigInt(h));
    let harness: VaultEscrowHarness;
    let tokenAddr: string;

    beforeEach(async function () {
      tokenAddr = await token.getAddress();
      const H = await hre.ethers.getContractFactory("VaultEscrowHarness");
      harness = await H.deploy(await vault.getAddress());
      await vault.connect(admin).addAuthorizedSettler(await harness.getAddress());
      await token.connect(alice).faucet();
      await token.connect(alice).setOperator(await vault.getAddress(), UNTIL);
      await vault.connect(alice).deposit(tokenAddr, ...(await encryptUint64(alice, 1000_000000n, vault)));
    });

    it("rejects callers that aren't authorized settlers", async function () {
      const dummy = hre.ethers.zeroPadValue("0x01", 32);
      await expect(
        vault.connect(alice).lockFunds(alice.address, tokenAddr, dummy)
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
      await expect(
        vault.connect(alice).releaseFunds(alice.address, tokenAddr, dummy)
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
    });

    it("rejects an encrypted handle the settler didn't share (no oracle over balances)", async function () {
      const balanceHandle = await vault.getEncBalance(alice.address, tokenAddr);
      await expect(harness.releaseUnshared(bob.address, tokenAddr, balanceHandle)).to.be.reverted;
      expect(await pt(await vault.getEncBalance(bob.address, tokenAddr))).to.equal(0n);
    });

    it("locks the full amount when the user can cover it", async function () {
      await harness.connect(alice).lock(alice.address, tokenAddr, ...(await encryptUint64(alice, 300_000000n, harness)));
      expect(await pt(await harness.lastLocked())).to.equal(300_000000n);
      expect(await pt(await vault.getEncBalance(alice.address, tokenAddr))).to.equal(700_000000n);
    });

    it("locks nothing when the user can't cover it", async function () {
      await harness.connect(alice).lock(alice.address, tokenAddr, ...(await encryptUint64(alice, 1001_000000n, harness)));
      expect(await pt(await harness.lastLocked())).to.equal(0n);
      expect(await pt(await vault.getEncBalance(alice.address, tokenAddr))).to.equal(1000_000000n);
    });

    it("releases locked funds to a recipient", async function () {
      await harness.connect(alice).lock(alice.address, tokenAddr, ...(await encryptUint64(alice, 300_000000n, harness)));
      await harness.release(bob.address, tokenAddr, 300_000000n);
      expect(await pt(await vault.getEncBalance(bob.address, tokenAddr))).to.equal(300_000000n);
    });

    it("can never release more than its own escrow pool", async function () {
      await harness.connect(alice).lock(alice.address, tokenAddr, ...(await encryptUint64(alice, 300_000000n, harness)));
      // Pool holds 300; asking for 301 pays nothing — users' balances are untouched.
      await harness.release(bob.address, tokenAddr, 301_000000n);
      expect(await pt(await vault.getEncBalance(bob.address, tokenAddr))).to.equal(0n);
      expect(await pt(await vault.getEncBalance(alice.address, tokenAddr))).to.equal(700_000000n);
    });

    it("balanceAtLeast compares on ciphertext", async function () {
      await harness.checkAtLeast(alice.address, tokenAddr, 1000_000000n);
      expect(await pt(await harness.lastMeets())).to.equal(1n);
      await harness.checkAtLeast(alice.address, tokenAddr, 1000_000001n);
      expect(await pt(await harness.lastMeets())).to.equal(0n);
    });
  });
});
