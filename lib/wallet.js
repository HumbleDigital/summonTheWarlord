import {
  address,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
} from "@solana/kit";
import bs58 from "bs58";
import { getPrivateKey } from "../utils/keychain.js";
import { KeychainError, SwapError } from "./errors.js";
import { ensureAdvancedTx } from "./rpcUrl.js";

/**
 * Parse a stored secret (base58 or JSON byte array) into a Kit keypair signer.
 * @param {string} raw
 */
export async function createSignerFromSecret(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new KeychainError("No private key provided.");
  }

  let secretBytes;
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error("JSON secret must be a non-empty byte array.");
      }
      secretBytes = Uint8Array.from(arr);
    } catch (err) {
      throw new KeychainError("Invalid JSON private key array.", { cause: err });
    }
  } else {
    try {
      secretBytes = bs58.decode(text);
    } catch (err) {
      throw new KeychainError("Invalid base58 private key.", { cause: err });
    }
  }

  try {
    if (secretBytes.length === 64) {
      return await createKeyPairSignerFromBytes(secretBytes);
    }
    if (secretBytes.length === 32) {
      return await createKeyPairSignerFromPrivateKeyBytes(secretBytes);
    }
    throw new KeychainError(
      `Unsupported private key length ${secretBytes.length}. Expected 32 or 64 bytes.`
    );
  } catch (err) {
    if (err instanceof KeychainError) throw err;
    throw new KeychainError("Unable to construct wallet signer from private key.", { cause: err });
  }
}

/**
 * Load wallet signer from macOS Keychain.
 */
export async function loadWalletSigner() {
  const raw = await getPrivateKey();
  return createSignerFromSecret(raw);
}

/**
 * Create a Solana RPC client for the configured URL.
 * @param {string} rpcUrl
 */
export function createRpc(rpcUrl) {
  if (!rpcUrl || typeof rpcUrl !== "string") {
    throw new SwapError("RPC URL is missing or invalid.");
  }
  return createSolanaRpc(ensureAdvancedTx(rpcUrl));
}

/**
 * @param {string} value
 */
export function asAddress(value) {
  return address(value);
}
