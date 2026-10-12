import { expect } from "chai";
import hre from "hardhat";
import { TokenVesting, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("TokenVesting", function () {
  let vesting: TokenVesting;
  let token: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let beneficiary: HardhatEthersSigner;
  let granter: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  beforeEach(async function () {
    [deployer, admin, beneficiary, granter, outsider] = await hre.ethers.getSigners();

    // Deploy token
    const tokenFactory = await hre.ethers.getContractFactory("ConfidentialToken");
    token = await tokenFactory.deploy();
    await token.waitForDeployment();

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

    // Deploy TokenVesting
    const vestingFactory = await hre.ethers.getContractFactory("TokenVesting");
    vesting = await vestingFactory.deploy(
      await vault.getAddress(),
      admin.address
    );
    await vesting.waitForDeployment();

    // Authorize vesting as settler
    await vault.addAuthorizedSettler(await vesting.getAddress());

    // Authorize granter as creator
    await vesting.connect(admin).authorizeCreator(granter.address);
  });

  describe("Deployment", function () {
    it("sets admin correctly", async function () {
      expect(await vesting.admin()).to.equal(admin.address);
    });

    it("sets vault correctly", async function () {
      expect(await vesting.vault()).to.equal(await vault.getAddress());
    });

    it("reverts with zero vault address", async function () {
      const vestingFactory = await hre.ethers.getContractFactory("TokenVesting");
      await expect(
        vestingFactory.deploy(hre.ethers.ZeroAddress, admin.address)
      ).to.be.revertedWithCustomError(vesting, "InvalidInput");
    });

    it("reverts with zero admin address", async function () {
      const vestingFactory = await hre.ethers.getContractFactory("TokenVesting");
      await expect(
        vestingFactory.deploy(await vault.getAddress(), hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vesting, "InvalidInput");
    });
  });

  describe("authorizeCreator()", function () {
    it("authorizes a new creator", async function () {
      await expect(vesting.connect(admin).authorizeCreator(outsider.address))
        .to.emit(vesting, "CreatorAuthorized")
        .withArgs(outsider.address);

      expect(await vesting.authorizedCreators(outsider.address)).to.equal(true);
    });

    it("reverts if not admin", async function () {
      await expect(
        vesting.connect(outsider).authorizeCreator(outsider.address)
      ).to.be.revertedWithCustomError(vesting, "Unauthorized");
    });

    it("reverts with zero address", async function () {
      await expect(
        vesting.connect(admin).authorizeCreator(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vesting, "InvalidInput");
    });

    it("confirms granter is authorized", async function () {
      expect(await vesting.authorizedCreators(granter.address)).to.equal(true);
    });
  });

  describe("claimVested()", function () {
    it("reverts if caller is not beneficiary (no schedule)", async function () {
      await expect(
        vesting.connect(outsider).claimVested(0)
      ).to.be.revertedWithCustomError(vesting, "Unauthorized");
    });

    it("reverts if caller is not beneficiary (wrong address)", async function () {
      await expect(
        vesting.connect(beneficiary).claimVested(999)
      ).to.be.revertedWithCustomError(vesting, "Unauthorized");
    });
  });

  describe("revokeSchedule()", function () {
    it("reverts if caller is not granter or admin", async function () {
      await expect(
        vesting.connect(outsider).revokeSchedule(0)
      ).to.be.revertedWithCustomError(vesting, "Unauthorized");
    });
  });

  describe("getBeneficiarySchedules()", function () {
    it("returns empty array for address with no schedules", async function () {
      const schedules = await vesting.getBeneficiarySchedules(outsider.address);
      expect(schedules.length).to.equal(0);
    });

    it("returns empty array for beneficiary before any schedule", async function () {
      const schedules = await vesting.getBeneficiarySchedules(beneficiary.address);
      expect(schedules.length).to.equal(0);
    });
  });

  describe("getVestedPercentage()", function () {
    it("returns 100 for non-existent schedule (default zero timestamps)", async function () {
      // Default schedule has cliffEnd=0, vestingEnd=0
      // block.timestamp >= vestingEnd(0) → returns 100
      const pct = await vesting.getVestedPercentage(0);
      expect(pct).to.equal(100n);
    });
  });

  describe("getSchedule()", function () {
    it("returns zero values for non-existent schedule", async function () {
      const s = await vesting.getSchedule(0);
      expect(s.beneficiary).to.equal(hre.ethers.ZeroAddress);
      expect(s.token).to.equal(hre.ethers.ZeroAddress);
      expect(s.granter).to.equal(hre.ethers.ZeroAddress);
      expect(s.revoked).to.equal(false);
    });
  });

  // Note: createSchedule() takes euint64 (on-chain encrypted handle) as parameter,
  // making it callable only from other contracts (not EOAs). Full integration tests
  // for create → cliff → claim → revoke flow require a helper contract that creates
  // the encrypted handle on-chain and passes it to createSchedule.
  // The access control, view functions, and error paths are covered above.
});
