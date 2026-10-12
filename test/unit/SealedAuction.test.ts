import { expect } from "chai";
import hre from "hardhat";
import { SealedAuction, ConfidentialToken, SettlementVault, PlatformRegistry } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encryptUint64 } from "../helpers/cofhe";

const UNTIL = 2n ** 48n - 1n;
const E6 = 1_000_000n;
const LOT = 5_000n * E6;
const DURATION = 3600;

const pt = async (h: string | bigint) => hre.cofhe.mocks.getPlaintext(BigInt(h));
const toBool = (v: unknown) => (typeof v === "boolean" ? v : BigInt(v as bigint) === 1n);
const toAddr = (v: unknown) =>
  hre.ethers.getAddress("0x" + BigInt(v as bigint).toString(16).padStart(40, "0"));

async function publicDecrypt(signer: HardhatEthersSigner, handle: string | bigint) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  return client.decryptForTx(BigInt(handle)).withoutACP().execute();
}

async function increaseTime(seconds: number) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

describe("SealedAuction (escrowed)", function () {
  this.timeout(600_000);

  let auction: SealedAuction;
  let lotToken: ConfidentialToken;
  let payToken: ConfidentialToken;
  let vault: SettlementVault;
  let registry: PlatformRegistry;
  let deployer: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let b1: HardhatEthersSigner;
  let b2: HardhatEthersSigner;
  let b3: HardhatEthersSigner;
  let feeCollector: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;
  let LOT_ADDR: string;
  let PAY_ADDR: string;

  /** Mint `amount` of `token` to `signer` and deposit it into the vault. */
  async function fund(signer: HardhatEthersSigner, token: ConfidentialToken, amount: bigint) {
    await token.connect(deployer).adminMint(signer.address, amount);
    await token.connect(signer).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(signer).deposit(await token.getAddress(), ...(await encryptUint64(signer, amount, vault)));
  }

  const vaultBal = async (who: HardhatEthersSigner, token: string) =>
    pt(await vault.getEncBalance(who.address, token));

  async function createConfirmed(opts: { blindReserve?: bigint } = {}) {
    const id = await auction.getAuctionCount();
    if (opts.blindReserve !== undefined) {
      await auction
        .connect(seller)
        .createBlindAuction(LOT_ADDR, PAY_ADDR, LOT, DURATION, 0, ...(await encryptUint64(seller, opts.blindReserve, auction)));
    } else {
      await auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, LOT, DURATION, 0);
    }
    const r = await publicDecrypt(outsider, await auction.getLotFundedHandle(id));
    await auction.connect(outsider).confirmLot(id, toBool(r.decryptedValue), r.signature);
    return id;
  }

  async function bid(signer: HardhatEthersSigner, id: bigint, amount: bigint) {
    await auction.connect(signer).bid(id, ...(await encryptUint64(signer, amount, auction)));
  }

  async function closeAndReveal(id: bigint) {
    await increaseTime(DURATION + 1);
    await auction.connect(outsider).closeAuction(id);
    const [okH, bidH, winH] = await auction.getRevealHandles(id);
    const ok = await publicDecrypt(outsider, okH);
    const bv = await publicDecrypt(outsider, bidH);
    const wv = await publicDecrypt(outsider, winH);
    await auction
      .connect(outsider)
      .reveal(id, toBool(ok.decryptedValue), ok.signature, bv.decryptedValue, bv.signature, toAddr(wv.decryptedValue), wv.signature);
  }

  beforeEach(async function () {
    [deployer, seller, b1, b2, b3, feeCollector, outsider] = await hre.ethers.getSigners();

    const T = await hre.ethers.getContractFactory("ConfidentialToken");
    lotToken = await T.deploy();
    payToken = await T.deploy();
    LOT_ADDR = await lotToken.getAddress();
    PAY_ADDR = await payToken.getAddress();

    const R = await hre.ethers.getContractFactory("PlatformRegistry");
    registry = await R.deploy(deployer.address, 100, feeCollector.address);

    const V = await hre.ethers.getContractFactory("SettlementVault");
    vault = await V.deploy(LOT_ADDR, await registry.getAddress(), deployer.address);
    await vault.addSupportedToken(PAY_ADDR);

    const A = await hre.ethers.getContractFactory("SealedAuction");
    auction = await A.deploy(await vault.getAddress(), await registry.getAddress(), hre.ethers.ZeroAddress);
    await vault.addAuthorizedSettler(await auction.getAddress());
  });

  describe("create + lot confirmation", function () {
    it("rejects bad parameters", async function () {
      await expect(auction.connect(seller).createAuction(LOT_ADDR, LOT_ADDR, LOT, DURATION, 0))
        .to.be.revertedWithCustomError(auction, "InvalidInput");
      await expect(auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, 0, DURATION, 0))
        .to.be.revertedWithCustomError(auction, "InvalidInput");
      await expect(auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, 2n ** 64n, DURATION, 0))
        .to.be.revertedWithCustomError(auction, "InvalidInput");
      await expect(auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, LOT, 299, 0))
        .to.be.revertedWithCustomError(auction, "InvalidInput");
      await expect(auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, LOT, 91 * 86400, 0))
        .to.be.revertedWithCustomError(auction, "InvalidInput");
      await expect(auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, LOT, DURATION, 3601))
        .to.be.revertedWithCustomError(auction, "InvalidInput");
    });

    it("locks the lot and opens bidding once the lot is confirmed", async function () {
      await fund(seller, lotToken, LOT);
      await auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, LOT, DURATION, 0);
      expect((await auction.getAuction(0)).status).to.equal(6n); // PENDING_LOT
      expect(await vaultBal(seller, LOT_ADDR)).to.equal(0n); // lot moved into escrow

      await expect(bid(b1, 0n, 100n * E6)).to.be.revertedWithCustomError(auction, "InvalidState");

      const r = await publicDecrypt(outsider, await auction.getLotFundedHandle(0));
      await expect(auction.connect(outsider).confirmLot(0, toBool(r.decryptedValue), r.signature))
        .to.emit(auction, "LotConfirmed");
      const a = await auction.getAuction(0);
      expect(a.status).to.equal(0n); // OPEN
      expect(a.deadline).to.be.greaterThan(0n);
    });

    it("cancels an auction whose seller doesn't hold the lot", async function () {
      await auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, LOT, DURATION, 0);
      const r = await publicDecrypt(outsider, await auction.getLotFundedHandle(0));
      expect(toBool(r.decryptedValue)).to.equal(false);
      await auction.connect(outsider).confirmLot(0, false, r.signature);
      expect((await auction.getAuction(0)).status).to.equal(4n); // CANCELLED
      await expect(bid(b1, 0n, 100n * E6)).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("rejects a forged lot confirmation", async function () {
      await auction.connect(seller).createAuction(LOT_ADDR, PAY_ADDR, LOT, DURATION, 0);
      const r = await publicDecrypt(outsider, await auction.getLotFundedHandle(0));
      await expect(auction.connect(outsider).confirmLot(0, true, r.signature)).to.be.reverted;
    });
  });

  describe("bidding", function () {
    beforeEach(async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed();
    });

    it("locks the bid from the bidder's vault balance", async function () {
      await fund(b1, payToken, 1_000n * E6);
      await bid(b1, 0n, 600n * E6);
      expect(await vaultBal(b1, PAY_ADDR)).to.equal(400n * E6);
      expect(await pt(await auction.connect(b1).getMyBid(0))).to.equal(600n * E6);
    });

    it("locks nothing when the bidder can't cover the bid", async function () {
      await fund(b1, payToken, 100n * E6);
      await bid(b1, 0n, 600n * E6);
      expect(await vaultBal(b1, PAY_ADDR)).to.equal(100n * E6);
      expect(await pt(await auction.connect(b1).getMyBid(0))).to.equal(0n);
    });

    it("blocks double bids, seller bids, and late bids", async function () {
      await fund(b1, payToken, 1_000n * E6);
      await bid(b1, 0n, 100n * E6);
      await expect(bid(b1, 0n, 100n * E6)).to.be.revertedWithCustomError(auction, "InvalidState");
      await expect(bid(seller, 0n, 100n * E6)).to.be.revertedWithCustomError(auction, "InvalidInput");
      await increaseTime(DURATION + 1);
      await fund(b2, payToken, 1_000n * E6);
      await expect(bid(b2, 0n, 100n * E6)).to.be.revertedWithCustomError(auction, "Expired");
    });

    it("extends the deadline on a late bid", async function () {
      const before = (await auction.getAuction(0)).deadline;
      await increaseTime(DURATION - 30);
      await fund(b1, payToken, 1_000n * E6);
      await bid(b1, 0n, 100n * E6);
      expect((await auction.getAuction(0)).deadline).to.be.greaterThan(before);
    });
  });

  describe("full sale", function () {
    it("settles atomically from escrow and refunds losers as ciphertext", async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed();
      for (const [s, amt] of [[b1, 500n], [b2, 800n], [b3, 1_200n]] as const) {
        await fund(s, payToken, 2_000n * E6);
        await bid(s, 0n, amt * E6);
      }

      await closeAndReveal(0n);
      const a = await auction.getAuction(0);
      expect(a.status).to.equal(2n); // REVEALED
      expect(a.revealedBid).to.equal(1_200n * E6);
      expect(a.revealedBidder).to.equal(b3.address);

      await auction.connect(outsider).settleAuction(0);
      const fee = (1_200n * E6 * 200n) / 10_000n;
      expect(await vaultBal(b3, LOT_ADDR)).to.equal(LOT);
      expect(await vaultBal(b3, PAY_ADDR)).to.equal(800n * E6);
      expect(await vaultBal(seller, PAY_ADDR)).to.equal(1_200n * E6 - fee);
      expect(await vaultBal(feeCollector, PAY_ADDR)).to.equal(fee);

      await auction.connect(b1).claimRefund(0);
      await auction.connect(b2).claimRefund(0);
      expect(await vaultBal(b1, PAY_ADDR)).to.equal(2_000n * E6);
      expect(await vaultBal(b2, PAY_ADDR)).to.equal(2_000n * E6);

      await expect(auction.connect(b1).claimRefund(0)).to.be.revertedWithCustomError(auction, "InvalidState");
      await expect(auction.connect(b3).claimRefund(0)).to.be.revertedWithCustomError(auction, "InvalidState");
      await expect(auction.connect(outsider).claimRefund(0)).to.be.revertedWithCustomError(auction, "Unauthorized");
      await expect(auction.connect(outsider).settleAuction(0)).to.be.revertedWithCustomError(auction, "InvalidState");
    });

    it("an empty-vault bidder can't win the lot for free (audit C2 regression)", async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed();
      await bid(b1, 0n, 10_000n * E6); // attacker: nothing in the vault
      await fund(b2, payToken, 1_000n * E6);
      await bid(b2, 0n, 500n * E6); // honest bidder

      await closeAndReveal(0n);
      expect((await auction.getAuction(0)).revealedBidder).to.equal(b2.address);
      await auction.settleAuction(0);
      expect(await vaultBal(b1, LOT_ADDR)).to.equal(0n);
      expect(await vaultBal(b2, LOT_ADDR)).to.equal(LOT);
      expect(await vaultBal(seller, PAY_ADDR)).to.equal(490n * E6);
    });

    it("anyone can close after the deadline; with no bids the lot goes back", async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed();
      await expect(auction.connect(outsider).closeAuction(0)).to.be.revertedWithCustomError(auction, "InvalidState");
      await increaseTime(DURATION + 1);
      await expect(auction.connect(outsider).closeAuction(0)).to.emit(auction, "AuctionCancelled");
      expect(await vaultBal(seller, LOT_ADDR)).to.equal(LOT);
    });

    it("rejects a forged reveal", async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed();
      await fund(b1, payToken, 1_000n * E6);
      await bid(b1, 0n, 500n * E6);
      await increaseTime(DURATION + 1);
      await auction.closeAuction(0);
      const [okH, bidH, winH] = await auction.getRevealHandles(0);
      const ok = await publicDecrypt(outsider, okH);
      const bv = await publicDecrypt(outsider, bidH);
      const wv = await publicDecrypt(outsider, winH);
      await expect(
        auction.reveal(0, true, ok.signature, 1n, bv.signature, toAddr(wv.decryptedValue), wv.signature),
      ).to.be.reverted;
    });
  });

  describe("Blind Floor", function () {
    it("sells when the encrypted reserve is met", async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed({ blindReserve: 700n * E6 });
      expect((await auction.getBlindStatus(0)).hasReserve).to.equal(true);
      await fund(b1, payToken, 1_000n * E6);
      await bid(b1, 0n, 900n * E6);
      await closeAndReveal(0n);
      expect((await auction.getAuction(0)).status).to.equal(2n);
      expect((await auction.getBlindStatus(0)).revealedReserveMet).to.equal(true);
      await auction.settleAuction(0);
      expect(await vaultBal(b1, LOT_ADDR)).to.equal(LOT);
    });

    it("reveals nothing about bids when the reserve isn't met, and refunds everyone", async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed({ blindReserve: 1_000n * E6 });
      await fund(b1, payToken, 1_000n * E6);
      await fund(b2, payToken, 1_000n * E6);
      await bid(b1, 0n, 900n * E6);
      await bid(b2, 0n, 400n * E6);
      await closeAndReveal(0n);

      const a = await auction.getAuction(0);
      expect(a.status).to.equal(5n); // NO_SALE
      expect(a.revealedBid).to.equal(0n);
      expect(a.revealedBidder).to.equal(hre.ethers.ZeroAddress);
      expect(await vaultBal(seller, LOT_ADDR)).to.equal(LOT);

      await auction.connect(b1).claimRefund(0);
      await auction.connect(b2).claimRefund(0);
      expect(await vaultBal(b1, PAY_ADDR)).to.equal(1_000n * E6);
      expect(await vaultBal(b2, PAY_ADDR)).to.equal(1_000n * E6);
      await expect(auction.settleAuction(0)).to.be.revertedWithCustomError(auction, "InvalidState");
    });
  });

  describe("cancelAuction()", function () {
    it("returns the lot when the seller cancels before any bid", async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed();
      await expect(auction.connect(outsider).cancelAuction(0)).to.be.revertedWithCustomError(auction, "Unauthorized");
      await auction.connect(seller).cancelAuction(0);
      expect((await auction.getAuction(0)).status).to.equal(4n);
      expect(await vaultBal(seller, LOT_ADDR)).to.equal(LOT);
    });

    it("can't cancel once someone has bid", async function () {
      await fund(seller, lotToken, LOT);
      await createConfirmed();
      await fund(b1, payToken, 1_000n * E6);
      await bid(b1, 0n, 100n * E6);
      await expect(auction.connect(seller).cancelAuction(0)).to.be.revertedWithCustomError(auction, "InvalidState");
    });
  });
});
