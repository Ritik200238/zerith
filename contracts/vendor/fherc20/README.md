# Vendored FHERC20

Source: `fhenix-confidential-contracts@0.4.0` (MIT, see LICENSE) — the ERC-7984
confidential token Fhenix's docs currently point to. Only the core token files are
included: `FHERC20/FHERC20.sol`, `FHERC20/FHERC20Core.sol`, their `utils/`, the
`IFHERC20` / `IERC7984` / `IERC7984Receiver` interfaces and `utils/FHESafeMath.sol`.
Wrappers and upgradeable variants are left out.

It is vendored rather than installed because the npm package pins
`@fhenixprotocol/cofhe-contracts@0.2.0`, while Zerith builds against `1.0.0`. The
files are unchanged and compile against 1.0.0, which provides the same
`externalEuint64` / `sharedEuint64` / `shareEuint64` / `receiveEuint64Param` API.

Token-to-contract calls use shared handles: transfers take a `sharedEuint64` the
caller shared with the token and return the amount actually moved as a
`sharedEuint64` shared back to the caller (receive it with
`FHE.receiveEuint64FromCall(result, address(token))`).
