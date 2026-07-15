import keytar from "keytar";
import { KeychainError } from "../lib/errors.js";
import { logger } from "./logger.js";

const SERVICE = "summonTheWarlord";
const ACCOUNT_WALLET = "wallet-private-key";
const ACCOUNT_RAPTOR_API_KEY = "raptor-api-key";

/**
 * Normalize a pasted secret by coercing to string and trimming whitespace/newlines.
 * @param {any} secret
 * @returns {string}
 */
function normalizeSecret(secret) {
  return String(secret ?? "").trim();
}

async function storeSecret(account, secret, emptyMessage, successMessage, failMessage) {
  const normalized = normalizeSecret(secret);
  if (!normalized) {
    throw new KeychainError(emptyMessage);
  }
  try {
    await keytar.setPassword(SERVICE, account, normalized);
    console.log(successMessage);
  } catch (err) {
    logger.error(failMessage, { error: err?.message });
    throw new KeychainError(failMessage, { cause: err });
  }
}

async function getSecret(account, missingMessage, failMessage) {
  try {
    const value = await keytar.getPassword(SERVICE, account);
    if (!value) {
      throw new KeychainError(missingMessage);
    }
    return value.trim();
  } catch (err) {
    if (err instanceof KeychainError) throw err;
    logger.error(failMessage, { error: err?.message });
    throw new KeychainError(failMessage, { cause: err });
  }
}

async function hasSecret(account) {
  try {
    const value = await keytar.getPassword(SERVICE, account);
    return typeof value === "string" && value.length > 0;
  } catch (err) {
    logger.error("Failed to check Keychain.", { error: err?.message, account });
    return false;
  }
}

async function deleteSecret(account, deletedMessage, missingMessage, failMessage) {
  try {
    const deleted = await keytar.deletePassword(SERVICE, account);
    if (deleted) {
      console.log(deletedMessage);
    } else {
      console.log(missingMessage);
    }
    return deleted;
  } catch (err) {
    logger.error(failMessage, { error: err?.message });
    throw new KeychainError(failMessage, { cause: err });
  }
}

/**
 * Stores the Solana private key in the macOS Keychain.
 * Accepts Base58 or a JSON array string; we store it as-is.
 * @param {string} secret - The private key string.
 */
export async function storePrivateKey(secret) {
  return storeSecret(
    ACCOUNT_WALLET,
    secret,
    "No private key provided. Paste your Base58 string or JSON array.",
    "🔐 Private key securely stored in macOS Keychain.",
    "Failed to store private key in Keychain."
  );
}

/**
 * Retrieves the private key from the macOS Keychain.
 * @returns {Promise<string>}
 */
export async function getPrivateKey() {
  return getSecret(
    ACCOUNT_WALLET,
    "Private key not found. Run `summon keychain store` to save it.",
    "Failed to read private key from Keychain."
  );
}

/**
 * @returns {Promise<boolean>}
 */
export async function hasPrivateKey() {
  return hasSecret(ACCOUNT_WALLET);
}

/**
 * @returns {Promise<boolean>}
 */
export async function deletePrivateKey() {
  return deleteSecret(
    ACCOUNT_WALLET,
    "💥 Private key removed from macOS Keychain.",
    "ℹ️ No private key found in macOS Keychain.",
    "Failed to delete private key from Keychain."
  );
}

/**
 * Store Raptor API key (sent as x-api-key).
 * @param {string} secret
 */
export async function storeRaptorApiKey(secret) {
  return storeSecret(
    ACCOUNT_RAPTOR_API_KEY,
    secret,
    "No Raptor API key provided.",
    "🔐 Raptor API key securely stored in macOS Keychain.",
    "Failed to store Raptor API key in Keychain."
  );
}

/**
 * @returns {Promise<string>}
 */
export async function getRaptorApiKey() {
  return getSecret(
    ACCOUNT_RAPTOR_API_KEY,
    "Raptor API key not found. Run `summon keychain store-api-key` to save it.",
    "Failed to read Raptor API key from Keychain."
  );
}

/**
 * @returns {Promise<boolean>}
 */
export async function hasRaptorApiKey() {
  return hasSecret(ACCOUNT_RAPTOR_API_KEY);
}

/**
 * @returns {Promise<boolean>}
 */
export async function deleteRaptorApiKey() {
  return deleteSecret(
    ACCOUNT_RAPTOR_API_KEY,
    "💥 Raptor API key removed from macOS Keychain.",
    "ℹ️ No Raptor API key found in macOS Keychain.",
    "Failed to delete Raptor API key from Keychain."
  );
}

export const KEYCHAIN_ACCOUNTS = Object.freeze({
  wallet: ACCOUNT_WALLET,
  raptorApiKey: ACCOUNT_RAPTOR_API_KEY,
  service: SERVICE,
});
