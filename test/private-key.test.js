import { describe, expect, test } from "@jest/globals";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  normalizePrivateKeyInput,
  parsePrivateKeyToSecretKey,
  validatePrivateKeyInput,
  wipeBytes,
  PrivateKeyFormatError,
} from "../lib/privateKey.js";

/** Build a 64-byte secret whose pubkey half does not match the seed half. */
function invalid64ByteKeypairBytes() {
  const a = Keypair.generate().secretKey;
  const b = Keypair.generate().secretKey;
  // seed from A, pubkey from B — fails Keypair.fromSecretKey validation
  const bad = new Uint8Array(64);
  bad.set(a.slice(0, 32), 0);
  bad.set(b.slice(32), 32);
  return bad;
}

describe("validatePrivateKeyInput", () => {
  test("accepts base58 secret key from Keypair.secretKey", () => {
    const kp = Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
    expect(validatePrivateKeyInput(encoded).ok).toBe(true);
  });

  test("accepts Base58 32-byte seed", () => {
    const seed = Keypair.generate().secretKey.slice(0, 32);
    const encoded = bs58.encode(seed);
    expect(validatePrivateKeyInput(encoded).ok).toBe(true);
  });

  test("accepts JSON array of 64 bytes", () => {
    const kp = Keypair.generate();
    const json = JSON.stringify(Array.from(kp.secretKey));
    expect(validatePrivateKeyInput(json).ok).toBe(true);
  });

  test("accepts JSON array of 32-byte seed", () => {
    const seed = Keypair.generate().secretKey.slice(0, 32);
    const json = JSON.stringify(Array.from(seed));
    expect(validatePrivateKeyInput(json).ok).toBe(true);
  });

  test("rejects empty / whitespace", () => {
    expect(validatePrivateKeyInput("").ok).toBe(false);
    expect(validatePrivateKeyInput("   ").ok).toBe(false);
  });

  test("rejects random strings and wrong-length arrays", () => {
    expect(validatePrivateKeyInput("not-a-key").ok).toBe(false);
    expect(validatePrivateKeyInput("[1,2,3]").ok).toBe(false);
  });

  test("rejects invalid 64-byte keypair (JSON and Base58)", () => {
    const bad = invalid64ByteKeypairBytes();
    const json = JSON.stringify(Array.from(bad));
    const encoded = bs58.encode(bad);
    expect(validatePrivateKeyInput(json).ok).toBe(false);
    expect(validatePrivateKeyInput(encoded).ok).toBe(false);
  });

  test("error messages never echo the secret material", () => {
    const secret = bs58.encode(Keypair.generate().secretKey);
    const bad = `${secret.slice(0, 10)}!!!`;
    const result = validatePrivateKeyInput(bad);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(bad);
    expect(result.error).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{40,}/);
  });
});

describe("parsePrivateKeyToSecretKey", () => {
  test("round-trips base58 64-byte secretKey", () => {
    const kp = Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
    const bytes = parsePrivateKeyToSecretKey(encoded);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(64);
    expect(Buffer.from(bytes).equals(Buffer.from(kp.secretKey))).toBe(true);
  });

  test("round-trips JSON 64-byte secretKey", () => {
    const kp = Keypair.generate();
    const json = JSON.stringify(Array.from(kp.secretKey));
    const bytes = parsePrivateKeyToSecretKey(json);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(64);
    expect(Buffer.from(bytes).equals(Buffer.from(kp.secretKey))).toBe(true);
  });

  test("accepts Base58 32-byte seed and expands to 64-byte secretKey", () => {
    const seed = Keypair.generate().secretKey.slice(0, 32);
    const encoded = bs58.encode(seed);
    const bytes = parsePrivateKeyToSecretKey(encoded);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(64);
    expect(Buffer.from(bytes.slice(0, 32)).equals(Buffer.from(seed))).toBe(true);
    // Must form a valid keypair
    const kp = Keypair.fromSecretKey(bytes);
    expect(kp.secretKey.length).toBe(64);
  });

  test("accepts JSON 32-byte seed and expands to 64-byte secretKey", () => {
    const seed = Keypair.generate().secretKey.slice(0, 32);
    const json = JSON.stringify(Array.from(seed));
    const bytes = parsePrivateKeyToSecretKey(json);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(64);
    expect(Buffer.from(bytes.slice(0, 32)).equals(Buffer.from(seed))).toBe(true);
  });

  test("rejects invalid 64-byte keypair for JSON encoding", () => {
    const bad = invalid64ByteKeypairBytes();
    const json = JSON.stringify(Array.from(bad));
    expect(() => parsePrivateKeyToSecretKey(json)).toThrow(PrivateKeyFormatError);
  });

  test("rejects invalid 64-byte keypair for Base58 encoding", () => {
    const bad = invalid64ByteKeypairBytes();
    const encoded = bs58.encode(bad);
    expect(() => parsePrivateKeyToSecretKey(encoded)).toThrow(PrivateKeyFormatError);
  });

  test("throws PrivateKeyFormatError for invalid input", () => {
    expect(() => parsePrivateKeyToSecretKey("nope")).toThrow(PrivateKeyFormatError);
  });

  test("throws PrivateKeyFormatError for empty input", () => {
    expect(() => parsePrivateKeyToSecretKey("")).toThrow(PrivateKeyFormatError);
    expect(() => parsePrivateKeyToSecretKey("   ")).toThrow(PrivateKeyFormatError);
  });
});

describe("wipeBytes", () => {
  test("zeros the buffer", () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]);
    wipeBytes(buf);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("Keypair.fromSecretKey buffer ownership", () => {
  test("shares buffer with input — wipeBytes would break signing", () => {
    const original = Keypair.generate();
    const secret = Uint8Array.from(original.secretKey);
    const kp = Keypair.fromSecretKey(secret);

    // Document web3.js behavior: same underlying buffer reference.
    expect(kp.secretKey === secret || Buffer.from(kp.secretKey).equals(Buffer.from(secret))).toBe(
      true
    );
    expect(Buffer.from(kp.secretKey).equals(Buffer.from(original.secretKey))).toBe(true);

    // Wiping the input zeros the live Keypair secret (the bug we must not reintroduce).
    wipeBytes(secret);
    expect(kp.secretKey.every((b) => b === 0)).toBe(true);
  });

  test("parse + fromSecretKey leaves secret non-zero and matches input (no wipe)", () => {
    const original = Keypair.generate();
    const encoded = bs58.encode(original.secretKey);
    const secretBytes = parsePrivateKeyToSecretKey(encoded);
    const kp = Keypair.fromSecretKey(secretBytes);

    expect(kp.secretKey.every((b) => b === 0)).toBe(false);
    expect(Buffer.from(kp.secretKey).equals(Buffer.from(original.secretKey))).toBe(true);
    expect(kp.publicKey.equals(original.publicKey)).toBe(true);
  });
});

describe("normalizePrivateKeyInput", () => {
  test("trims whitespace only", () => {
    expect(normalizePrivateKeyInput("  abc  ")).toBe("abc");
  });
});
