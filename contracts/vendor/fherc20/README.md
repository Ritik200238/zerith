# Vendored FHERC20

Source: `fhenix-confidential-contracts@0.2.0` (MIT, see LICENSE) — the exact version
the deployed Zerith test tokens (CDEX and MOCK on Sepolia) were built from.

Local change: the `InEuint64` encrypted-input overloads are ported to the CoFHE 1.0
input format (`externalEuint64` handle + `bytes` proof) so the library compiles
against `@fhenixprotocol/cofhe-contracts@1.0.0`. Token logic, ACL handling and the
zero-replacement transfer semantics are unchanged, so tests behave like the live
tokens. The handle-based `confidentialTransfer(From)(…, euint64)` functions the vault
uses are untouched.

Newer upstream releases (0.4.x) restructure the library around ERC-7984; moving to
them is a separate change that would also mean redeploying the tokens.
