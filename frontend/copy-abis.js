const fs = require('fs');
const path = require('path');

const frontendDir = __dirname;
const base = path.dirname(frontendDir); // parent = cipherdex/
const destDir = path.join(frontendDir, 'src', 'lib', 'abis');

// Contracts built in this repo. ConfidentialToken is the ERC-7984 test token
// (CDEX and MOCK are both deployments of it). Paused features (legacy-contracts/)
// keep the ABIs already in src/lib/abis.
const core = ['ConfidentialToken', 'SettlementVault', 'PlatformRegistry', 'AuctionClaim'];
const features = ['SealedAuction', 'PrivatePayments', 'ProofOfReserves'];

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

// ─── FHE operations per contract, read from the Solidity source ───────────
// The /audit page shows these, so they come from the code, never from a
// hand-maintained list.
const opSources = {
  ConfidentialToken: ['contracts/core/ConfidentialToken.sol', 'contracts/vendor/fherc20/FHERC20/FHERC20Core.sol', 'contracts/vendor/fherc20/FHERC20/utils/FHERC20Utils.sol', 'contracts/vendor/fherc20/utils/FHESafeMath.sol'],
  SettlementVault: ['contracts/core/SettlementVault.sol', 'contracts/libraries/FHEConstants.sol'],
  SealedAuction: ['contracts/features/SealedAuction.sol', 'contracts/libraries/FHEConstants.sol'],
  PrivatePayments: ['contracts/features/PrivatePayments.sol', 'contracts/libraries/FHEConstants.sol'],
  ProofOfReserves: ['contracts/features/ProofOfReserves.sol', 'contracts/libraries/FHEConstants.sol'],
  PlatformRegistry: ['contracts/core/PlatformRegistry.sol'],
  AuctionClaim: ['contracts/core/AuctionClaim.sol'],
};
const fheOps = {};
for (const [name, files] of Object.entries(opSources)) {
  const ops = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(base, f), 'utf8').replace(/\/\/.*$/gm, '');
    for (const m of src.matchAll(/\bFHE\.(\w+)\s*\(/g)) ops.add(m[1]);
  }
  fheOps[name] = [...ops].sort();
}
fs.writeFileSync(path.join(frontendDir, 'src', 'lib', 'fhe-ops.json'), JSON.stringify(fheOps, null, 2) + '\n');
console.log(`✓ FHE ops extracted for ${Object.keys(fheOps).length} contracts → src/lib/fhe-ops.json`);
