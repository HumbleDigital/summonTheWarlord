import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { AppError } from "./errors.js";

export class PrivateKeyFormatError extends AppError {}

export function normalizePrivateKeyInput(secret) {
  return String(secret ?? "").trim();
}

function isValidByteArray(arr) {
  return Array.isArray(arr)
    && (arr.length === 32 || arr.length === 64)
    && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

/**
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePrivateKeyInput(secret) {
  const normalized = normalizePrivateKeyInput(secret);
  if (!normalized) {
    return { ok: false, error: "No private key provided. Paste a Base58 string or JSON byte array." };
  }
  try {
    parsePrivateKeyToSecretKey(normalized);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Invalid private key format. Expected Base58 secret key or JSON array of 32 or 64 bytes.",
    };
  }
}

/**
 * Returns a new Uint8Array secretKey suitable for Keypair.fromSecretKey.
 * Caller should zero the buffer after constructing the Keypair when possible.
 */
export function parsePrivateKeyToSecretKey(secret) {
  const normalized = normalizePrivateKeyInput(secret);
  if (!normalized) {
    throw new PrivateKeyFormatError("No private key provided.");
  }

  if (normalized.startsWith("[")) {
    let arr;
    try {
      arr = JSON.parse(normalized);
    } catch {
      throw new PrivateKeyFormatError("Invalid private key JSON array.");
    }
    if (!isValidByteArray(arr)) {
      throw new PrivateKeyFormatError("Invalid private key byte array length or values.");
    }
    if (arr.length === 32) {
      return Keypair.fromSeed(Uint8Array.from(arr)).secretKey;
    }
    return Uint8Array.from(arr);
  }

  let decoded;
  try {
    decoded = bs58.decode(normalized);
  } catch {
    throw new PrivateKeyFormatError("Invalid Base58 private key.");
  }
  if (decoded.length === 32) {
    return Keypair.fromSeed(decoded).secretKey;
  }
  if (decoded.length === 64) {
    // Verify it forms a valid keypair
    Keypair.fromSecretKey(decoded);
    return decoded instanceof Uint8Array ? decoded : Uint8Array.from(decoded);
  }
  throw new PrivateKeyFormatError("Invalid private key length after Base58 decode.");
}

/** Best-effort wipe of a Uint8Array holding key material. */
export function wipeBytes(bytes) {
  if (bytes && bytes.fill) {
    bytes.fill(0);
  }
}
