import { expect } from "chai";
import hre from "hardhat";
import { ConfidentialToken } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ConfidentialToken", function () {
  let token: ConfidentialToken;
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  const FAUCET_AMOUNT = 1000n * 10n ** 6n; // 1000 * 1e6
  const INITIAL_SUPPLY = 1_000_000n * 10n ** 6n; // 1_000_000 * 1e6
  const FAUCET_COOLDOWN = 3600n; // 1 hour in seconds

  beforeEach(async function () {
    [deployer, alice, bob] = await hre.ethers.getSigners();
    const factory = await hre.ethers.getContractFactory("ConfidentialToken");
    token = await factory.deploy("Zerith Test Dollar", "CDEX");
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("deploys successfully", async function () {
      const addr = await token.getAddress();
      expect(addr).to.be.properAddress;
    });

    it("has correct name", async function () {
      expect(await token.name()).to.equal("Zerith Test Dollar");
    });

    it("has correct symbol", async function () {
      expect(await token.symbol()).to.equal("CDEX");
    });

    it("has correct decimals", async function () {
      expect(await token.decimals()).to.equal(6n);
    });

    it("returns correct FAUCET_AMOUNT constant", async function () {
      expect(await token.FAUCET_AMOUNT()).to.equal(FAUCET_AMOUNT);
    });

    it("returns correct FAUCET_COOLDOWN constant", async function () {
      expect(await token.FAUCET_COOLDOWN()).to.equal(FAUCET_COOLDOWN);
    });

    it("returns correct INITIAL_SUPPLY constant", async function () {
      expect(await token.INITIAL_SUPPLY()).to.equal(INITIAL_SUPPLY);
    });

    it("behaves as an ERC-7984 token (ERC-165, holder is always its own operator)", async function () {
      expect(await token.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC-165
      expect(await token.isOperator(deployer.address, deployer.address)).to.equal(true);
    });
  });

  describe("Constructor mint", function () {
    it("mints INITIAL_SUPPLY to deployer (encrypted balance)", async function () {
      // The confidentialBalanceOf returns a ctHash (bytes32) handle.
      // In mock mode, we can look up the plaintext via mock utilities.
      const ctHash = await token.confidentialBalanceOf(deployer.address);
      // ctHash is a bytes32 — non-zero means a balance handle was created
      expect(ctHash).to.not.equal(
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );
      // Verify the plaintext value stored behind this handle
      await hre.cofhe.mocks.expectPlaintext(BigInt(ctHash), INITIAL_SUPPLY);
    });

    it("deployer indicated balance is non-zero after mint", async function () {
      const indicated = await token.balanceOf(deployer.address);
      // After first interaction (mint), indicated balance should be set to midpoint area
      expect(indicated).to.be.gt(0n);
    });
  });

  describe("faucet()", function () {
    it("mints FAUCET_AMOUNT to caller", async function () {
      const tx = await token.connect(alice).faucet();
      await tx.wait();

      const ctHash = await token.confidentialBalanceOf(alice.address);
      expect(ctHash).to.not.equal(
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );
      await hre.cofhe.mocks.expectPlaintext(BigInt(ctHash), FAUCET_AMOUNT);
    });

    it("emits FaucetClaimed event", async function () {
      await expect(token.connect(alice).faucet())
        .to.emit(token, "FaucetClaimed")
        .withArgs(alice.address, FAUCET_AMOUNT);
    });

    it("updates lastFaucetClaim timestamp", async function () {
      await token.connect(alice).faucet();
      const lastClaim = await token.lastFaucetClaim(alice.address);
      expect(lastClaim).to.be.gt(0n);
    });

    it("enforces 1-hour cooldown on second call", async function () {
      await token.connect(alice).faucet();
      await expect(
        token.connect(alice).faucet()
      ).to.be.revertedWithCustomError(token, "InvalidState");
    });

    it("allows faucet after cooldown expires", async function () {
      await token.connect(alice).faucet();

      // Advance time by 1 hour + 1 second
      await hre.network.provider.send("evm_increaseTime", [3601]);
      await hre.network.provider.send("evm_mine");

      // Should succeed
      await expect(token.connect(alice).faucet()).to.not.be.reverted;
    });

    it("different users can claim independently", async function () {
      await token.connect(alice).faucet();
      await expect(token.connect(bob).faucet()).to.not.be.reverted;
    });
  });

  describe("adminMint()", function () {
    it("mints arbitrary amount to any address", async function () {
      const amount = 5000n * 10n ** 6n;
      await token.adminMint(alice.address, amount);

      const ctHash = await token.confidentialBalanceOf(alice.address);
      expect(ctHash).to.not.equal(
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );
      await hre.cofhe.mocks.expectPlaintext(BigInt(ctHash), amount);
    });

    it("reverts when called by non-admin", async function () {
      const amount = 100n * 10n ** 6n;
      await expect(
        token.connect(alice).adminMint(bob.address, amount)
      ).to.be.revertedWithCustomError(token, "Unauthorized");
    });

    it("accumulates with existing balance", async function () {
      const firstAmount = 1000n * 10n ** 6n;
      const secondAmount = 2000n * 10n ** 6n;

      await token.adminMint(alice.address, firstAmount);
      await token.adminMint(alice.address, secondAmount);

      const ctHash = await token.confidentialBalanceOf(alice.address);
      await hre.cofhe.mocks.expectPlaintext(
        BigInt(ctHash),
        firstAmount + secondAmount
      );
    });
  });
});
