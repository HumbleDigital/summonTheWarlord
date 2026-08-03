import keytar from "keytar";
import { KeychainError } from "../lib/errors.js";
import {
  normalizePrivateKeyInput,
  validatePrivateKeyInput,
} from "../lib/privateKey.js";
import { logger } from "./logger.js";

const SERVICE = "summonTheWarlord";
const ACCOUNT = "wallet-private-key";

/**
 * Stores the Solana private key in the macOS Keychain.
 * Accepts Base58 or a JSON array string; validates before write and stores normalized form.
 * @param {string} secret - The private key string.
 */
export async function storePrivateKey(secret) {
  const normalized = normalizePrivateKeyInput(secret);
  const validation = validatePrivateKeyInput(normalized);
  if (!validation.ok) {
    throw new KeychainError(validation.error);
  }
  try {
    await keytar.setPassword(SERVICE, ACCOUNT, normalized);
    console.log("🔐 Private key securely stored in macOS Keychain.");
  } catch (err) {
    // Do not log err.message — keytar or other layers may embed the secret.
    logger.error("Failed to store private key.");
    throw new KeychainError("Failed to store private key in Keychain.", { cause: err });
  }
}

/**
 * Retrieves the private key from the macOS Keychain.
 * Throws if not found.
 * @returns {Promise<string>}
 */
export async function getPrivateKey() {
  try {
    const key = await keytar.getPassword(SERVICE, ACCOUNT);
    if (!key) {
      throw new KeychainError("Private key not found. Run `summon keychain store` to save it.");
    }
    return key.trim();
  } catch (err) {
    if (err instanceof KeychainError) throw err;
    logger.error("Failed to read private key from Keychain.", { error: err?.message });
    throw new KeychainError("Failed to read private key from Keychain.", { cause: err });
  }
}

/**
 * Returns true if a private key exists in the Keychain.
 * @returns {Promise<boolean>}
 */
export async function hasPrivateKey() {
  try {
    const key = await keytar.getPassword(SERVICE, ACCOUNT);
    return typeof key === "string" && key.length > 0;
  } catch (err) {
    logger.error("Failed to check Keychain for private key.", { error: err?.message });
    return false;
  }
}

/**
 * Deletes the private key from Keychain.
 * @returns {Promise<boolean>} true if an entry was deleted, false if nothing existed
 */
export async function deletePrivateKey() {
  try {
    const deleted = await keytar.deletePassword(SERVICE, ACCOUNT);
    if (deleted) {
      console.log("💥 Private key removed from macOS Keychain.");
    } else {
      console.log("ℹ️ No private key found in macOS Keychain.");
    }
    return deleted;
  } catch (err) {
    logger.error("Failed to delete private key from Keychain.", { error: err?.message });
    throw new KeychainError("Failed to delete private key from Keychain.", { cause: err });
  }
}
