import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { ConfigError } from "./errors.js";
import { logger } from "../utils/logger.js";
import { DEFAULT_RAPTOR_BASE_URL } from "./constants.js";

const APP_NAME = "summonTheWarlord";

export const PRIORITY_FEE_LEVELS = [
  "min",
  "low",
  "medium",
  "high",
  "veryHigh",
  "turbo",
  "unsafeMax",
];
export const TX_VERSIONS = ["v0", "legacy"];

const DEFAULT_TIP = { enabled: false, sol: 0.0001, account: "", lamports: null };
const DEFAULT_JITO = { enabled: false, tip: 0.0001 };

/** Keys removed from disk configs during normalization. */
const DEPRECATED_KEYS = new Set(["swapAPIKey"]);

export const DEFAULT_CONFIG = {
  rpcUrl: "https://rpc.solanatracker.io/public?advancedTx=true",
  raptorBaseUrl: DEFAULT_RAPTOR_BASE_URL,
  slippage: 10,
  priorityFee: "auto",
  priorityFeeLevel: "medium",
  maxPriorityFee: null,
  computeUnitPriceMicroLamports: null,
  computeUnitLimit: null,
  txVersion: "v0",
  wrapUnwrapSol: true,
  dexes: "",
  pools: "",
  maxHops: null,
  onlyDirectRoutes: false,
  destinationTokenAccount: "",
  chargeBps: null,
  tip: { ...DEFAULT_TIP },
  // Legacy jito block kept for migration; prefer tip.*
  jito: { ...DEFAULT_JITO },
  showQuoteDetails: false,
  DEBUG_MODE: false,
  notificationsEnabled: true,
};

export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));

const BOOLEAN_KEYS = new Set([
  "showQuoteDetails",
  "DEBUG_MODE",
  "notificationsEnabled",
  "wrapUnwrapSol",
  "onlyDirectRoutes",
]);
const STRING_KEYS = new Set([
  "rpcUrl",
  "raptorBaseUrl",
  "dexes",
  "pools",
  "destinationTokenAccount",
]);
const OPTIONAL_NUMBER_KEYS = new Set([
  "maxPriorityFee",
  "computeUnitPriceMicroLamports",
  "computeUnitLimit",
  "maxHops",
  "chargeBps",
]);

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

function coerceOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return coerceNumber(value);
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
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (lowered === "auto") return { normalized: "auto" };
      const level = PRIORITY_FEE_LEVELS.find((l) => l.toLowerCase() === lowered);
      if (level) return { normalized: level };
    }
    const num = coerceNumber(value);
    if (num === null || num < 0) {
      return { error: "Invalid priorityFee. Use \"auto\", a level name, or microlamports." };
    }
    return { normalized: num };
  }
  if (key === "priorityFeeLevel") {
    if (typeof value !== "string") {
      return { error: `Invalid priorityFeeLevel. Use one of ${PRIORITY_FEE_LEVELS.join(", ")}.` };
    }
    const match = PRIORITY_FEE_LEVELS.find((level) => level.toLowerCase() === value.trim().toLowerCase());
    if (!match) {
      return { error: `Invalid priorityFeeLevel. Use one of ${PRIORITY_FEE_LEVELS.join(", ")}.` };
    }
    return { normalized: match };
  }
  if (key === "txVersion") {
    if (typeof value !== "string") {
      return { error: `Invalid txVersion. Use ${TX_VERSIONS.join(" or ")}.` };
    }
    const match = TX_VERSIONS.find((version) => version.toLowerCase() === value.trim().toLowerCase());
    if (!match) {
      return { error: `Invalid txVersion. Use ${TX_VERSIONS.join(" or ")}.` };
    }
    return { normalized: match };
  }
  if (OPTIONAL_NUMBER_KEYS.has(key)) {
    const num = coerceOptionalNumber(value);
    if (value !== null && value !== undefined && value !== "" && num === null) {
      return { error: `Invalid ${key}. Expected a number or empty.` };
    }
    if (num !== null && num < 0) {
      return { error: `Invalid ${key}. Expected a non-negative number.` };
    }
    return { normalized: num };
  }
  if (key === "tip") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Invalid tip config. Expected an object." };
    }
    const enabledRaw = value.enabled === undefined ? DEFAULT_TIP.enabled : value.enabled;
    const enabled = coerceBoolean(enabledRaw);
    if (enabled === null) {
      return { error: "Invalid tip.enabled. Use true or false." };
    }
    const solRaw = value.sol === undefined ? DEFAULT_TIP.sol : value.sol;
    const sol = coerceNumber(solRaw);
    if (sol === null || sol < 0) {
      return { error: "Invalid tip.sol. Use a non-negative number." };
    }
    const account = value.account == null ? "" : String(value.account);
    const lamports = coerceOptionalNumber(value.lamports);
    if (value.lamports != null && value.lamports !== "" && lamports === null) {
      return { error: "Invalid tip.lamports. Use a non-negative integer or empty." };
    }
    return { normalized: { enabled, sol, account, lamports } };
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
    if ((key === "rpcUrl" || key === "raptorBaseUrl") && value.trim() === "") {
      return { error: `Invalid ${key}. Expected a non-empty string.` };
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

/**
 * Migrate legacy jito settings into tip when tip is still default-off.
 * @param {object} cfg
 */
function migrateJitoToTip(cfg) {
  const next = { ...cfg };
  let changed = false;
  if (!next.tip || typeof next.tip !== "object") {
    next.tip = { ...DEFAULT_TIP };
    changed = true;
  }
  if (next.jito?.enabled && !next.tip.enabled) {
    next.tip = {
      ...next.tip,
      enabled: true,
      sol: next.jito.tip ?? next.tip.sol,
    };
    changed = true;
  }
  return { config: next, changed };
}

export function normalizeConfig(cfg, { strict = false } = {}) {
  let normalized = { ...cfg };
  const warnings = [];
  let changed = false;

  for (const key of DEPRECATED_KEYS) {
    if (key in normalized) {
      delete normalized[key];
      changed = true;
    }
  }

  const migrated = migrateJitoToTip(normalized);
  normalized = migrated.config;
  if (migrated.changed) changed = true;

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
      // deep compare tip/jito objects loosely
      if (typeof nextValue === "object" && nextValue !== null) {
        if (JSON.stringify(originalValue) !== JSON.stringify(nextValue)) {
          normalized[key] = nextValue;
          changed = true;
        }
      } else {
        normalized[key] = nextValue;
        changed = true;
      }
    }
  }

  return { config: normalized, changed, warnings };
}

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

export async function loadConfig() {
  const configPath = getConfigPath();

  if (!await fs.pathExists(configPath)) {
    await fs.ensureDir(path.dirname(configPath), { mode: 0o700 });
    await fs.writeJson(configPath, DEFAULT_CONFIG, { spaces: 2 });
    await fs.chmod(configPath, 0o600);
    return { ...DEFAULT_CONFIG, tip: { ...DEFAULT_TIP }, jito: { ...DEFAULT_JITO } };
  }

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
    return { ...DEFAULT_CONFIG, tip: { ...DEFAULT_TIP }, jito: { ...DEFAULT_JITO } };
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

export async function saveConfig(cfg) {
  const configPath = getConfigPath();
  const { config: normalized, warnings } = normalizeConfig(cfg);
  warnings.forEach((warning) => {
    logger.warn(warning.message, { key: warning.key });
  });
  await fs.ensureDir(path.dirname(configPath), { mode: 0o700 });
  await fs.writeJson(configPath, normalized, { spaces: 2 });
  await fs.chmod(configPath, 0o600);
}

export async function editConfig() {
  const configPath = getConfigPath();
  await loadConfig();
  const editor = process.env.EDITOR || "vim";
  spawnSync(editor, [configPath], { stdio: "inherit" });
}
