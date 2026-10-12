import { expect } from "chai";
import hre from "hardhat";
import { AllowlistGate } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, solidityPacked } from "ethers";

describe("AllowlistGate", function () {
  let gate: AllowlistGate;
  let deployer: HardhatEthersSigner;
  let creator: HardhatEthersSigner;
  let allowed1: HardhatEthersSigner;
  let allowed2: HardhatEthersSigner;
  let notAllowed: HardhatEthersSigner;

  // Build a simple 2-leaf Merkle tree from two addresses
  function buildMerkleTree(addresses: string[]): { root: string; proofs: Map<string, string[]> } {
    const leaves = addresses.map(addr =>
      keccak256(solidityPacked(["address"], [addr]))
    );

    // Sort leaves for consistent tree
    const sortedLeaves = [...leaves].sort();

    // For a 2-leaf tree, root = hash(sortedLeaves[0] + sortedLeaves[1])
    let root: string;
    const proofs = new Map<string, string[]>();

    if (sortedLeaves.length === 1) {
      root = sortedLeaves[0];
      proofs.set(addresses[0], []);
    } else if (sortedLeaves.length === 2) {
      // Combine two leaves to get root
      const [left, right] = sortedLeaves[0] < sortedLeaves[1]
        ? [sortedLeaves[0], sortedLeaves[1]]
        : [sortedLeaves[1], sortedLeaves[0]];
      root = keccak256(solidityPacked(["bytes32", "bytes32"], [left, right]));

      // Each leaf's proof is the other leaf
      for (let i = 0; i < addresses.length; i++) {
        const leaf = keccak256(solidityPacked(["address"], [addresses[i]]));
        const sibling = leaves.find(l => l !== leaf) || leaves[0];
        proofs.set(addresses[i], [sibling]);
      }
    } else {
      throw new Error("Only 1-2 leaf trees supported in test helper");
    }

    return { root, proofs };
  }

  beforeEach(async function () {
    [deployer, creator, allowed1, allowed2, notAllowed] = await hre.ethers.getSigners();

    const gateFactory = await hre.ethers.getContractFactory("AllowlistGate");
    gate = await gateFactory.deploy();
    await gate.waitForDeployment();
  });

  describe("createAllowlist()", function () {
    it("creates allowlist with Merkle root", async function () {
      const { root } = buildMerkleTree([allowed1.address, allowed2.address]);

      await expect(
        gate.connect(creator).createAllowlist(root, "KYC Verified")
      )
        .to.emit(gate, "AllowlistCreated");

      const al = await gate.getAllowlist(0);
      expect(al.merkleRoot).to.equal(root);
      expect(al.creator).to.equal(creator.address);
      expect(al.active).to.equal(true);
      expect(al.description).to.equal("KYC Verified");
    });

    it("reverts with zero root", async function () {
      await expect(
        gate.connect(creator).createAllowlist(hre.ethers.ZeroHash, "Test")
      ).to.be.revertedWithCustomError(gate, "InvalidInput");
    });

    it("increments allowlist ID", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "First");
      await gate.connect(creator).createAllowlist(root, "Second");

      expect(await gate.nextAllowlistId()).to.equal(2n);
    });
  });

  describe("isAllowed() — verify valid proof", function () {
    it("returns true for valid proof", async function () {
      const { root, proofs } = buildMerkleTree([allowed1.address, allowed2.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");

      const proof = proofs.get(allowed1.address) || [];
      const result = await gate.isAllowed(0, allowed1.address, proof);
      expect(result).to.equal(true);
    });

    it("returns true for second allowed address", async function () {
      const { root, proofs } = buildMerkleTree([allowed1.address, allowed2.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");

      const proof = proofs.get(allowed2.address) || [];
      const result = await gate.isAllowed(0, allowed2.address, proof);
      expect(result).to.equal(true);
    });
  });

  describe("isAllowed() — reject invalid proof", function () {
    it("returns false for address not in tree", async function () {
      const { root, proofs } = buildMerkleTree([allowed1.address, allowed2.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");

      // Use allowed1's proof but check notAllowed address
      const proof = proofs.get(allowed1.address) || [];
      const result = await gate.isAllowed(0, notAllowed.address, proof);
      expect(result).to.equal(false);
    });

    it("returns false with empty proof for non-single-leaf tree", async function () {
      const { root } = buildMerkleTree([allowed1.address, allowed2.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");

      const result = await gate.isAllowed(0, allowed1.address, []);
      expect(result).to.equal(false);
    });
  });

  describe("deactivate() — open to all", function () {
    it("deactivates allowlist", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");

      await expect(gate.connect(creator).deactivate(0))
        .to.emit(gate, "AllowlistDeactivated")
        .withArgs(0);

      const al = await gate.getAllowlist(0);
      expect(al.active).to.equal(false);
    });

    it("returns true for anyone after deactivation", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");
      await gate.connect(creator).deactivate(0);

      // notAllowed should now be allowed (inactive = open to all)
      const result = await gate.isAllowed(0, notAllowed.address, []);
      expect(result).to.equal(true);
    });

    it("reverts if not creator", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");

      await expect(
        gate.connect(notAllowed).deactivate(0)
      ).to.be.revertedWithCustomError(gate, "Unauthorized");
    });
  });

  describe("updateRoot()", function () {
    it("updates Merkle root", async function () {
      const { root: root1 } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root1, "VIP");

      const { root: root2 } = buildMerkleTree([allowed2.address]);

      await expect(gate.connect(creator).updateRoot(0, root2))
        .to.emit(gate, "AllowlistUpdated")
        .withArgs(0, root2);

      const al = await gate.getAllowlist(0);
      expect(al.merkleRoot).to.equal(root2);
    });

    it("reverts if not creator", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");

      const newRoot = keccak256(solidityPacked(["string"], ["new"]));
      await expect(
        gate.connect(notAllowed).updateRoot(0, newRoot)
      ).to.be.revertedWithCustomError(gate, "Unauthorized");
    });

    it("reverts with zero root", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");

      await expect(
        gate.connect(creator).updateRoot(0, hre.ethers.ZeroHash)
      ).to.be.revertedWithCustomError(gate, "InvalidInput");
    });

    it("reverts if deactivated", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "VIP");
      await gate.connect(creator).deactivate(0);

      const newRoot = keccak256(solidityPacked(["string"], ["new"]));
      await expect(
        gate.connect(creator).updateRoot(0, newRoot)
      ).to.be.revertedWithCustomError(gate, "InvalidState");
    });
  });

  describe("verifyAndMark() — one-time use", function () {
    it("marks address as claimed on valid proof", async function () {
      const { root, proofs } = buildMerkleTree([allowed1.address, allowed2.address]);
      await gate.connect(creator).createAllowlist(root, "One-Time Sale");

      const proof = proofs.get(allowed1.address) || [];
      const result = await gate.connect(creator).verifyAndMark(0, allowed1.address, proof);
      await result.wait();

      expect(await gate.hasClaimed(0, allowed1.address)).to.equal(true);
    });

    it("reverts on second use (double-claim)", async function () {
      const { root, proofs } = buildMerkleTree([allowed1.address, allowed2.address]);
      await gate.connect(creator).createAllowlist(root, "One-Time Sale");

      const proof = proofs.get(allowed1.address) || [];
      await gate.connect(creator).verifyAndMark(0, allowed1.address, proof);

      await expect(
        gate.connect(creator).verifyAndMark(0, allowed1.address, proof)
      ).to.be.revertedWithCustomError(gate, "InvalidState");
    });

    it("reverts for non-allowlisted address", async function () {
      const { root, proofs } = buildMerkleTree([allowed1.address, allowed2.address]);
      await gate.connect(creator).createAllowlist(root, "One-Time Sale");

      const proof = proofs.get(allowed1.address) || [];
      await expect(
        gate.connect(creator).verifyAndMark(0, notAllowed.address, proof)
      ).to.be.revertedWithCustomError(gate, "NotAllowlisted");
    });

    it("passes for anyone when allowlist is deactivated", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "Open Sale");
      await gate.connect(creator).deactivate(0);

      // notAllowed can verifyAndMark because inactive = open
      await gate.connect(creator).verifyAndMark(0, notAllowed.address, []);
      expect(await gate.hasClaimed(0, notAllowed.address)).to.equal(true);
    });
  });

  describe("hasAllowlists()", function () {
    it("returns false before any creation", async function () {
      const newGate = await (await hre.ethers.getContractFactory("AllowlistGate")).deploy();
      await newGate.waitForDeployment();
      expect(await newGate.hasAllowlists()).to.equal(false);
    });

    it("returns true after creation", async function () {
      const { root } = buildMerkleTree([allowed1.address]);
      await gate.connect(creator).createAllowlist(root, "Test");
      expect(await gate.hasAllowlists()).to.equal(true);
    });
  });
});
