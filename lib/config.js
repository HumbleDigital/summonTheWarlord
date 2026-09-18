import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { ConfigError } from "./errors.js";
import { logger } from "../utils/logger.js";

// Application name for config directory
const APP_NAME = "summonTheWarlord";

export const PRIORITY_FEE_LEVELS = ["min", "low", "medium", "high", "veryHigh"];
export const TX_VERSIONS = ["v0", "legacy"];
export const EXECUTION_MODES = ["basic", "fast"];
const DEFAULT_JITO = { enabled: false, tip: 0.0001 };
const DEPRECATED_KEYS = new Set(["swapAPIKey", "walletSecretKey"]);

// Default configuration values
// Note: walletSecretKey has been moved to macOS Keychain storage
export const DEFAULT_CONFIG = {
  //  Welcome to summonTheWarlord, a CLI for simple fast trading on Solana.
  //  Its required that you use SolanaTracker.io as your RPC as they also provide required APIs.
  //  This is a free public endpoint and may have issues.
  //  You can get a free account at https://www.solanatracker.io/solana-rpc
  //  Replace the URL with the new one provided and keep '?advancedTx=true' after your API Key.
  rpcUrl: "https://rpc.solanatracker.io/public?advancedTx=true",
  slippage: 10,               // Maximum acceptable slippage percentage (e.g., 10) or "auto"
  priorityFee: "auto",        // Amount in SOL or "auto"
  priorityFeeLevel: "medium", // "min","low","medium","high","veryHigh"
  txVersion: "v0",            // "v0" or "legacy"
  executionMode: "fast",      // "basic" or "fast"
  showQuoteDetails: false,      //  Outputs the JSON swap response to the console
  DEBUG_MODE: false,          // Enable debug logging
  notificationsEnabled: true, // Enable macOS notifications
  jito: { ...DEFAULT_JITO },  // Jito bundle settings
  // walletSecretKey: "",       // Deprecated: now stored in macOS Keychain,
};

export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));

const BOOLEAN_KEYS = new Set(["showQuoteDetails", "DEBUG_MODE", "notificationsEnabled"]);
const STRING_KEYS = new Set(["rpcUrl"]);

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return null;
}

function coerceNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

export function parseConfigValue(raw) {
  const trimmed = String(raw ?? "").trim();
  const bool = coerceBoolean(trimmed);
  if (bool !== null) return bool;
  if (trimmed !== "") {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }
  return raw;
}

function evaluateConfigValue(key, value) {
  if (key === "slippage") {
    if (typeof value === "string" && value.trim().toLowerCase() === "auto") {
      return { normalized: "auto" };
    }
    const num = coerceNumber(value);
    if (num === null || num < 0) {
      return { error: "Invalid slippage. Use a non-negative number or \"auto\"." };
    }
    return { normalized: num };
  }
  if (key === "priorityFee") {
    if (typeof value === "string" && value.trim().toLowerCase() === "auto") {
      return { normalized: "auto" };
    }
    const num = coerceNumber(value);
    if (num === null || num < 0) {
      return { error: "Invalid priorityFee. Use a non-negative number or \"auto\"." };
    }
    return { normalized: num };
  }
  if (key === "priorityFeeLevel") {
    if (typeof value !== "string") {
      return { error: `Invalid priorityFeeLevel. Use one of ${PRIORITY_FEE_LEVELS.join(", ")}.` };
    }
    const normalizedLevel = value.trim();
    const match = PRIORITY_FEE_LEVELS.find((level) => level.toLowerCase() === normalizedLevel.toLowerCase());
    if (!match) {
      return { error: `Invalid priorityFeeLevel. Use one of ${PRIORITY_FEE_LEVELS.join(", ")}.` };
    }
    return { normalized: match };
  }
  if (key === "txVersion") {
    if (typeof value !== "string") {
      return { error: `Invalid txVersion. Use ${TX_VERSIONS.join(" or ")}.` };
    }
    const normalizedVersion = value.trim();
    const match = TX_VERSIONS.find((version) => version.toLowerCase() === normalizedVersion.toLowerCase());
    if (!match) {
      return { error: `Invalid txVersion. Use ${TX_VERSIONS.join(" or ")}.` };
    }
    return { normalized: match };
  }
  if (key === "executionMode") {
    if (typeof value !== "string") {
      return { error: `Invalid executionMode. Use one of ${EXECUTION_MODES.join(", ")}.` };
    }
    const normalizedMode = value.trim();
    const match = EXECUTION_MODES.find((mode) => mode.toLowerCase() === normalizedMode.toLowerCase());
    if (!match) {
      return { error: `Invalid executionMode. Use one of ${EXECUTION_MODES.join(", ")}.` };
    }
    return { normalized: match };
  }
  if (key === "jito") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Invalid jito config. Expected an object with enabled and tip." };
    }
    const enabledRaw = value.enabled === undefined ? DEFAULT_JITO.enabled : value.enabled;
    const enabled = coerceBoolean(enabledRaw);
    if (enabled === null) {
      return { error: "Invalid jito.enabled. Use true or false." };
    }
    const tipRaw = value.tip === undefined ? DEFAULT_JITO.tip : value.tip;
    const tip = coerceNumber(tipRaw);
    if (tip === null || tip < 0) {
      return { error: "Invalid jito.tip. Use a non-negative number." };
    }
    return { normalized: { enabled, tip } };
  }
  if (BOOLEAN_KEYS.has(key)) {
    const bool = coerceBoolean(value);
    if (bool === null) {
      return { error: `Invalid ${key}. Use true or false.` };
    }
    return { normalized: bool };
  }
  if (STRING_KEYS.has(key)) {
    if (typeof value !== "string") {
      return { error: `Invalid ${key}. Expected a string.` };
    }
    if (key === "rpcUrl" && value.trim() === "") {
      return { error: "Invalid rpcUrl. Expected a non-empty string." };
    }
    return { normalized: value };
  }
  return { normalized: value };
}

export function normalizeConfigValue(key, value, { strict = false } = {}) {
  const { normalized, error } = evaluateConfigValue(key, value);
  if (error) {
    if (strict) {
      throw new ConfigError(error, { details: { key, value } });
    }
    return DEFAULT_CONFIG[key];
  }
  return normalized;
}

export function normalizeConfig(cfg, { strict = false } = {}) {
  const normalized = { ...cfg };
  const warnings = [];
  let changed = false;

  for (const key of DEPRECATED_KEYS) {
    if (key in normalized) {
      delete normalized[key];
      changed = true;
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (!(key in normalized)) {
      normalized[key] = value;
      changed = true;
    }
  }

  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const originalValue = normalized[key];
    const { normalized: nextValue, error } = evaluateConfigValue(key, originalValue);
    if (error) {
      if (strict) {
        throw new ConfigError(error, { details: { key, value: originalValue } });
      }
      normalized[key] = DEFAULT_CONFIG[key];
      warnings.push({ key, message: error });
      changed = true;
      continue;
    }
    if (!Object.is(originalValue, nextValue)) {
      normalized[key] = nextValue;
      changed = true;
    }
  }

  return { config: normalized, changed, warnings };
}

/**
 * Compute the path to the config file.
 * - On macOS: ~/Library/Application Support/summonTheWarlord/config.json
 * - Else:      $XDG_CONFIG_HOME/summonTheWarlord/config.json (or ~/.config/…)
 */
export function getConfigPath() {
  const home = os.homedir();
  if (process.env.SUMMON_CONFIG_PATH) {
    return process.env.SUMMON_CONFIG_PATH;
  }
  if (process.env.SUMMON_CONFIG_HOME) {
    return path.join(process.env.SUMMON_CONFIG_HOME, APP_NAME, "config.json");
  }
  if (process.platform === "darwin") {
    const appSupport = path.join(home, "Library", "Application Support", APP_NAME);
    return path.join(appSupport, "config.json");
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdgConfig, APP_NAME, "config.json");
}

/**
 * Load the config, writing defaults if the file didn't exist.
 * Also merges in any new keys from DEFAULT_CONFIG.
 */
export async function loadConfig() {
  const configPath = getConfigPath();

  // If missing, write out defaults
  if (!await fs.pathExists(configPath)) {
    await fs.ensureDir(path.dirname(configPath), { mode: 0o700 });
    await fs.writeJson(configPath, DEFAULT_CONFIG, { spaces: 2 });
    await fs.chmod(configPath, 0o600);
    return { ...DEFAULT_CONFIG };
  }

  // Read existing, merge missing defaults
  let cfg;
  try {
    cfg = await fs.readJson(configPath);
  } catch {
    let backupPath;
    try {
      if (await fs.pathExists(configPath)) {
        backupPath = `${configPath}.invalid-${Date.now()}`;
        await fs.move(configPath, backupPath, { overwrite: true });
      }
    } catch (moveErr) {
      console.warn(`⚠️ Unable to back up invalid config: ${moveErr.message}`);
    }

    await fs.ensureDir(path.dirname(configPath), { mode: 0o700 });
    await fs.writeJson(configPath, DEFAULT_CONFIG, { spaces: 2 });
    await fs.chmod(configPath, 0o600);

    if (backupPath) {
      logger.warn("Config was invalid and has been reset.", { backupPath });
    } else {
      logger.warn("Config was invalid and has been reset.");
    }
    return { ...DEFAULT_CONFIG };
  }
  let updated = false;
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (!(key in cfg)) {
      cfg[key] = value;
      updated = true;
    }
  }
  const { config: normalized, changed, warnings } = normalizeConfig(cfg);
  warnings.forEach((warning) => {
    logger.warn(warning.message, { key: warning.key });
  });
  if (updated || changed) {
    await fs.writeJson(configPath, normalized, { spaces: 2 });
    await fs.chmod(configPath, 0o600);
  }
  return normalized;
}

/**
 * Save the given config object back to disk (with secure perms).
 */
export async function saveConfig(cfg) {
  const configPath = getConfigPath();
  const { config: normalized, warnings } = normalizeConfig(cfg);
  warnings.forEach((warning) => {
    logger.warn(warning.message, { key: warning.key });
  });
  await fs.ensureDir(path.dirname(configPath), { mode: 0o700 });
  // Note: walletSecretKey is now stored securely in the macOS Keychain, not in this file
  await fs.writeJson(configPath, normalized, { spaces: 2 });
  await fs.chmod(configPath, 0o600);
}

/**
 * Open the config file in the user's $EDITOR.
 */
export async function editConfig() {
  const configPath = getConfigPath();
  await loadConfig();
  const editor = process.env.EDITOR || "vim";
  spawnSync(editor, [configPath], { stdio: "inherit" });
}
