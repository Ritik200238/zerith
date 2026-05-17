/**
 * Shared CoFHE encryption helpers for unit tests.
 *
 * Wraps @cofhe/hardhat-plugin's createClientWithBatteries + new builder API.
 * Replaces the legacy `hre.cofhe.initializeWithHardhatSigner` + `cofhejs.encrypt`
 * pattern that the older `cofhe-hardhat-plugin@0.3.1` exposed.
 */

import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export { Encryptable };

export async function encryptUint8(signer: HardhatEthersSigner, value: bigint) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [encrypted] = await client.encryptInputs([Encryptable.uint8(value)]).execute();
  return encrypted;
}

export async function encryptUint16(signer: HardhatEthersSigner, value: bigint) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [encrypted] = await client.encryptInputs([Encryptable.uint16(value)]).execute();
  return encrypted;
}

export async function encryptUint32(signer: HardhatEthersSigner, value: bigint) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [encrypted] = await client.encryptInputs([Encryptable.uint32(value)]).execute();
  return encrypted;
}

export async function encryptUint64(signer: HardhatEthersSigner, value: bigint) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [encrypted] = await client.encryptInputs([Encryptable.uint64(value)]).execute();
  return encrypted;
}

export async function encryptUint128(signer: HardhatEthersSigner, value: bigint) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [encrypted] = await client.encryptInputs([Encryptable.uint128(value)]).execute();
  return encrypted;
}

export async function encryptBool(signer: HardhatEthersSigner, value: boolean) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [encrypted] = await client.encryptInputs([Encryptable.bool(value)]).execute();
  return encrypted;
}

export async function encryptAddress(signer: HardhatEthersSigner, value: string) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [encrypted] = await client
    .encryptInputs([Encryptable.address(value as `0x${string}`)])
    .execute();
  return encrypted;
}
