/**
 * Shared CoFHE encryption helpers for unit tests (CoFHE 1.0 / @cofhe/sdk 0.8).
 *
 * Encrypted inputs are bound to the contract that consumes them, and a batch of
 * inputs shares one signature. `encrypt` returns the contract-call shape
 * `[...handles, signature]`; the single-value helpers return `[handle, signature]`
 * so they can be spread into a call: `vault.deposit(token, ...await encryptUint64(...))`.
 */

import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Addressable } from "ethers";

export { Encryptable };

type Target = string | Addressable;
type Item = ReturnType<(typeof Encryptable)["uint64"]> | ReturnType<(typeof Encryptable)["bool"]>;

async function addressOf(t: Target): Promise<string> {
  return typeof t === "string" ? t : t.getAddress();
}

// One SDK client per test wallet (as the Fhenix testing docs do in `before`),
// instead of building a new one for every encrypt/decrypt call.
const clients = new Map<string, ReturnType<typeof hre.cofhe.createClientWithBatteries>>();
function clientFor(signer: HardhatEthersSigner) {
  let c = clients.get(signer.address);
  if (!c) {
    c = hre.cofhe.createClientWithBatteries(signer);
    clients.set(signer.address, c);
  }
  return c;
}

/** Encrypt a batch for `consumer`; returns `[...handles, signature]`. */
export async function encrypt(signer: HardhatEthersSigner, consumer: Target, items: unknown[]) {
  const client = await clientFor(signer);
  return client
    .encryptInputs(items as Item[])
    .setConsumingContract((await addressOf(consumer)) as `0x${string}`)
    .execute() as Promise<string[]>;
}

export async function encryptUint64(signer: HardhatEthersSigner, value: bigint, consumer: Target) {
  const [handle, signature] = await encrypt(signer, consumer, [Encryptable.uint64(value)]);
  return [handle, signature] as [string, string];
}

/** Several uint64 values under one signature: `[handles[], signature]` for array params. */
export async function encryptUint64s(signer: HardhatEthersSigner, values: bigint[], consumer: Target) {
  const out = await encrypt(signer, consumer, values.map((v) => Encryptable.uint64(v)));
  return [out.slice(0, -1), out[out.length - 1]] as [string[], string];
}

/** Plaintext behind a handle, read from the mock coprocessor. */
export async function plaintext(handle: string | bigint) {
  return hre.cofhe.mocks.getPlaintext(BigInt(handle));
}

/** Threshold-Network-style public decrypt with signature, as used by reveal flows. */
export async function publicDecrypt(signer: HardhatEthersSigner, handle: string | bigint) {
  const client = await clientFor(signer);
  return client.decryptForTx(BigInt(handle)).withoutACP().execute();
}
