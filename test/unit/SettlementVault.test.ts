import { expect } from "chai";
import hre from "hardhat";
import { ConfidentialToken, PlatformRegistry, SettlementVault } from "../../typechain-types";
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
    token = await tokenFactory.deploy();
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
      const encAmount = await encryptUint64(alice, 500n);

      await expect(
        vault.connect(alice).deposit(bob.address, encAmount)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("reverts when platform is paused", async function () {
      await registry.connect(admin).pause();

      const encAmount = await encryptUint64(alice, 500n);

      await expect(
        vault.connect(alice).deposit(tokenAddr, encAmount)
      ).to.be.revertedWithCustomError(vault, "Paused");
    });
  });

  describe("withdraw()", function () {
    let tokenAddr: string;

    beforeEach(async function () {
      tokenAddr = await token.getAddress();
    });

    it("reverts for unsupported token", async function () {
      const encAmount = await encryptUint64(alice, 100n);

      await expect(
        vault.connect(alice).withdraw(bob.address, encAmount)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("reverts when platform is paused", async function () {
      await registry.connect(admin).pause();

      const encAmount = await encryptUint64(alice, 100n);

      await expect(
        vault.connect(alice).withdraw(tokenAddr, encAmount)
      ).to.be.revertedWithCustomError(vault, "Paused");
    });
  });

  describe("settleTrade()", function () {
    let tokenAddr: string;

    beforeEach(async function () {
      tokenAddr = await token.getAddress();
    });

    it("requires authorized settler", async function () {
      const dummyHash = hre.ethers.zeroPadValue("0x01", 32);
      await expect(
        vault.connect(alice).settleTrade(alice.address, bob.address, tokenAddr, dummyHash)
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
    });

    it("prevents self-settlement", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      const dummyHash = hre.ethers.zeroPadValue("0x01", 32);
      await expect(
        vault.connect(settler).settleTrade(alice.address, alice.address, tokenAddr, dummyHash)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("reverts for unsupported token", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      const dummyHash = hre.ethers.zeroPadValue("0x01", 32);
      await expect(
        vault.connect(settler).settleTrade(alice.address, bob.address, feeCollector.address, dummyHash)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("reverts for zero address (from)", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      const dummyHash = hre.ethers.zeroPadValue("0x01", 32);
      await expect(
        vault.connect(settler).settleTrade(hre.ethers.ZeroAddress, bob.address, tokenAddr, dummyHash)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });

    it("reverts for zero address (to)", async function () {
      await vault.connect(admin).addAuthorizedSettler(settler.address);
      const dummyHash = hre.ethers.zeroPadValue("0x01", 32);
      await expect(
        vault.connect(settler).settleTrade(alice.address, hre.ethers.ZeroAddress, tokenAddr, dummyHash)
      ).to.be.revertedWithCustomError(vault, "InvalidInput");
    });
  });
});
