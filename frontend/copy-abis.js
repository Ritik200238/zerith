const fs = require('fs');
const path = require('path');

const frontendDir = __dirname;
const base = path.dirname(frontendDir); // parent = cipherdex/
const destDir = path.join(frontendDir, 'src', 'lib', 'abis');

const core = ['ConfidentialToken', 'SettlementVault', 'PlatformRegistry', 'AuctionClaim', 'TokenVesting', 'AllowlistGate', 'Referrals'];
const features = ['OrderBook', 'SealedAuction', 'Escrow', 'LimitOrderEngine', 'BatchAuction', 'PortfolioTracker', 'Reputation', 'OTCBoard', 'PrivatePayments', 'FreelanceBidding', 'VickreyAuction', 'DutchAuction', 'OverflowSale', 'Organization', 'EncryptedStreaming', 'ConfidentialMultisig', 'EncryptedRoyalty', 'ConfidentialWrapper', 'EncryptedRaffle', 'ProofOfReserves'];

const contracts = [
  ...core.map((n) => [n, path.join('artifacts', 'contracts', 'core', `${n}.sol`, `${n}.json`)]),
  ...features.map((n) => [n, path.join('artifacts', 'contracts', 'features', `${n}.sol`, `${n}.json`)]),
];

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

let ok = 0;
let skipped = 0;
for (const [name, srcPath] of contracts) {
  const fullSrc = path.join(base, srcPath);
  try {
    const json = JSON.parse(fs.readFileSync(fullSrc, 'utf8'));
    const abiOnly = JSON.stringify(json.abi, null, 2);
    fs.writeFileSync(path.join(destDir, name + '.json'), abiOnly);
    ok++;
  } catch (e) {
    console.log('SKIP:', name, '-', e.message.substring(0, 100));
    skipped++;
  }
}
console.log(`\n✓ ${ok} ABIs refreshed, ${skipped} skipped, dest: ${destDir}`);
