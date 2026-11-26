import { hashRawSync, type Algorithm } from '@node-rs/argon2';

/** Argon2id via a prebuilt N-API library. Electron's Node (BoringSSL) has no crypto.argon2, so node:crypto cannot be used
 *  in the desktop app (found by the app smoke test, 2026-11-20). */
const ARGON2ID = 2 as unknown as Algorithm; // const enum values cannot be imported by bundlers

export function argon2idRaw(a: { password: Buffer; salt: Buffer; memoryKiB: number; passes: number; parallelism: number; tagLength: number }): Buffer {
  return hashRawSync(a.password, { algorithm: ARGON2ID, memoryCost: a.memoryKiB, timeCost: a.passes, parallelism: a.parallelism, outputLen: a.tagLength, salt: a.salt });
}
