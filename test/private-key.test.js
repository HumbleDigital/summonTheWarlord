import { describe, expect, test } from "@jest/globals";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  normalizePrivateKeyInput,
  parsePrivateKeyToSecretKey,
  validatePrivateKeyInput,
  PrivateKeyFormatError,
} from "../lib/privateKey.js";

describe("validatePrivateKeyInput", () => {
  test("accepts base58 secret key from Keypair.secretKey", () => {
    const kp = Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
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
  test("round-trips base58 and JSON to 64-byte secretKey", () => {
    const kp = Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
    const bytes = parsePrivateKeyToSecretKey(encoded);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(64);
    expect(Buffer.from(bytes).equals(Buffer.from(kp.secretKey))).toBe(true);
  });

  test("throws PrivateKeyFormatError for invalid input", () => {
    expect(() => parsePrivateKeyToSecretKey("nope")).toThrow(PrivateKeyFormatError);
  });
});

describe("normalizePrivateKeyInput", () => {
  test("trims whitespace only", () => {
    expect(normalizePrivateKeyInput("  abc  ")).toBe("abc");
  });
});
