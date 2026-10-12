# Legacy contracts (paused)

These contracts were built against `@fhenixprotocol/cofhe-contracts` 0.1.x and its
`InEuint*` encrypted-input structs. Fhenix's CoFHE testnets now verify inputs in the
1.0 format (`externalEuint*` handles plus a batch signature bound to the consuming
contract), so encrypted writes to the deployed copies of these contracts no longer
work. They are kept here, outside the Hardhat build, until each is ported.

The October 2026 audit also found settlement bugs in several of them (non-atomic,
zero-replaced legs; unchecked encrypted arithmetic). Any port should move them onto
the vault's escrow (`lockFunds` / `releaseFunds`) the way `SealedAuction` and
`PrivatePayments` now work.

The core product — `SettlementVault`, `SealedAuction`, `PrivatePayments`,
`ProofOfReserves` — lives in `contracts/`.

`tasks/` holds the May 2026 deploy, seed and end-to-end scripts. They target
the paused contracts or the pre-1.0 SDK (`InEuint*` inputs, `withoutPermit`),
so they no longer run against the current network. The scripts for the core
product are `tasks/deploy-core.ts` and `tasks/verify-escrow-auction-e2e.ts`.
