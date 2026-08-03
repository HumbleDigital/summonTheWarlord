import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { AppError } from "./errors.js";

export class PrivateKeyFormatError extends AppError {}

const EMPTY_KEY_MSG =
  "No private key provided. Paste a Base58 string or JSON byte array.";

export function normalizePrivateKeyInput(secret) {
  return String(secret ?? "").trim();
}

function isValidByteArray(arr) {
  return Array.isArray(arr)
    && (arr.length === 32 || arr.length === 64)
    && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

/**
 * Expand a 32-byte seed or verify a 64-byte secret via Keypair, always
 * returning a 64-byte secretKey. Wraps crypto failures as PrivateKeyFormatError.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function secretKeyFromBytes(bytes) {
  try {
    if (bytes.length === 32) {
      return Keypair.fromSeed(bytes).secretKey;
    }
    // Verify pubkey half matches seed half
    const kp = Keypair.fromSecretKey(bytes);
    return kp.secretKey instanceof Uint8Array
      ? kp.secretKey
      : Uint8Array.from(kp.secretKey);
  } catch (err) {
    if (err instanceof PrivateKeyFormatError) throw err;
    throw new PrivateKeyFormatError("Invalid private key material.", { cause: err });
  }
}

/**
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePrivateKeyInput(secret) {
  const normalized = normalizePrivateKeyInput(secret);
  if (!normalized) {
    return { ok: false, error: EMPTY_KEY_MSG };
  }
  let parsed;
  try {
    parsed = parsePrivateKeyToSecretKey(normalized);
    return { ok: true };
  } catch (err) {
    if (err instanceof PrivateKeyFormatError && err.message === EMPTY_KEY_MSG) {
      return { ok: false, error: EMPTY_KEY_MSG };
    }
    return {
      ok: false,
      error: "Invalid private key format. Expected Base58 secret key or JSON array of 32 or 64 bytes.",
    };
  } finally {
    if (parsed) wipeBytes(parsed);
  }
}

/**
 * Returns a new Uint8Array secretKey suitable for Keypair.fromSecretKey.
 * Caller should zero the buffer after constructing the Keypair when possible.
 */
export function parsePrivateKeyToSecretKey(secret) {
  const normalized = normalizePrivateKeyInput(secret);
  if (!normalized) {
    throw new PrivateKeyFormatError(EMPTY_KEY_MSG);
  }

  if (normalized.startsWith("[")) {
    let arr;
    try {
      arr = JSON.parse(normalized);
    } catch (err) {
      throw new PrivateKeyFormatError("Invalid private key JSON array.", { cause: err });
    }
    if (!isValidByteArray(arr)) {
      throw new PrivateKeyFormatError("Invalid private key byte array length or values.");
    }
    return secretKeyFromBytes(Uint8Array.from(arr));
  }

  let decoded;
  try {
    decoded = bs58.decode(normalized);
  } catch (err) {
    throw new PrivateKeyFormatError("Invalid Base58 private key.", { cause: err });
  }
  if (decoded.length === 32 || decoded.length === 64) {
    const bytes = decoded instanceof Uint8Array ? decoded : Uint8Array.from(decoded);
    return secretKeyFromBytes(bytes);
  }
  throw new PrivateKeyFormatError("Invalid private key length after Base58 decode.");
}

/** Best-effort wipe of a Uint8Array holding key material. */
export function wipeBytes(bytes) {
  if (bytes && bytes.fill) {
    bytes.fill(0);
  }
}
