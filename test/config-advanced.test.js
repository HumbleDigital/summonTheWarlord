import { test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

import {
  DEFAULT_CONFIG,
  getConfigPath,
  loadConfig,
  normalizeConfig,
  normalizeConfigValue,
  saveConfig,
} from "../lib/config.js";

let originalConfigHome;
let originalConfigPath;
let tempConfigHome;

beforeEach(async () => {
  originalConfigHome = process.env.SUMMON_CONFIG_HOME;
  originalConfigPath = process.env.SUMMON_CONFIG_PATH;
  tempConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "summon-config-"));
  process.env.SUMMON_CONFIG_HOME = tempConfigHome;
  delete process.env.SUMMON_CONFIG_PATH;
});

afterEach(async () => {
  if (originalConfigHome === undefined) {
    delete process.env.SUMMON_CONFIG_HOME;
  } else {
    process.env.SUMMON_CONFIG_HOME = originalConfigHome;
  }
  if (originalConfigPath === undefined) {
    delete process.env.SUMMON_CONFIG_PATH;
  } else {
    process.env.SUMMON_CONFIG_PATH = originalConfigPath;
  }

  if (tempConfigHome) {
    await fs.remove(tempConfigHome);
    tempConfigHome = undefined;
  }
});

test("getConfigPath respects SUMMON_CONFIG_PATH", () => {
  const customPath = path.join(os.tmpdir(), "custom-config.json");
  process.env.SUMMON_CONFIG_PATH = customPath;
  expect(getConfigPath()).toBe(customPath);
});

test("getConfigPath uses macOS Application Support by default", () => {
  delete process.env.SUMMON_CONFIG_HOME;
  delete process.env.SUMMON_CONFIG_PATH;
  const configPath = getConfigPath();
  if (process.platform === "darwin") {
    expect(configPath).toContain(path.join("Library", "Application Support", "summonTheWarlord"));
  }
});

test("normalizeConfigValue falls back to defaults when not strict", () => {
  expect(normalizeConfigValue("slippage", "bad", { strict: false })).toBe(DEFAULT_CONFIG.slippage);
  expect(normalizeConfigValue("priorityFee", "", { strict: false })).toBe(DEFAULT_CONFIG.priorityFee);
  expect(normalizeConfigValue("rpcUrl", "", { strict: false })).toBe(DEFAULT_CONFIG.rpcUrl);
});

test("normalizeConfigValue handles case-insensitive enums", () => {
  expect(normalizeConfigValue("priorityFeeLevel", "MeDiUm", { strict: true })).toBe("medium");
  expect(normalizeConfigValue("txVersion", "LeGaCy", { strict: true })).toBe("legacy");
});

test("normalizeConfigValue rejects invalid enums", () => {
  expect(() => normalizeConfigValue("priorityFeeLevel", 123, { strict: true })).toThrow();
  expect(() => normalizeConfigValue("txVersion", 99, { strict: true })).toThrow();
  expect(() => normalizeConfigValue("txVersion", "nope", { strict: true })).toThrow();
});

test("normalizeConfigValue leaves unknown keys alone", () => {
  expect(normalizeConfigValue("customKey", "custom", { strict: true })).toBe("custom");
});

test("normalizeConfigValue rejects invalid booleans and strings", () => {
  expect(() => normalizeConfigValue("DEBUG_MODE", "maybe", { strict: true })).toThrow();
  expect(() => normalizeConfigValue("rpcUrl", 123, { strict: true })).toThrow();
});

test("normalizeConfigValue rejects invalid jito tips", () => {
  expect(() => normalizeConfigValue("jito", { enabled: true, tip: -1 }, { strict: true })).toThrow();
});

test("normalizeConfig removes deprecated keys and records warnings", () => {
  const { config, changed, warnings } = normalizeConfig({
    rpcUrl: "https://example",
    slippage: -1,
    priorityFee: -0.01,
    priorityFeeLevel: "HIGH",
    txVersion: "LEGACY",
    showQuoteDetails: "true",
    notificationsEnabled: "false",
    DEBUG_MODE: "false",
    jito: { enabled: "true", tip: "0.002" },
    swapAPIKey: "secret",
    walletSecretKey: "legacy-secret",
  });

  expect(config.swapAPIKey).toBeUndefined();
  expect(config.walletSecretKey).toBeUndefined();
  expect(config.slippage).toBe(DEFAULT_CONFIG.slippage);
  expect(config.priorityFee).toBe(DEFAULT_CONFIG.priorityFee);
  expect(config.priorityFeeLevel).toBe("high");
  expect(config.txVersion).toBe("legacy");
  expect(config.showQuoteDetails).toBe(true);
  expect(config.notificationsEnabled).toBe(false);
  expect(config.DEBUG_MODE).toBe(false);
  expect(config.jito).toEqual({ enabled: true, tip: 0.002 });
  expect(config.executionMode).toBe("fast");
  expect(changed).toBe(true);
  expect(warnings.length).toBeGreaterThanOrEqual(2);
});

test("normalizeConfig strips walletSecretKey and swapAPIKey", () => {
  const { config, changed } = normalizeConfig({
    rpcUrl: "https://example",
    swapAPIKey: "api-secret",
    walletSecretKey: "wallet-secret",
  });

  expect(config.swapAPIKey).toBeUndefined();
  expect(config.walletSecretKey).toBeUndefined();
  expect(changed).toBe(true);
});

test("loadConfig migrates walletSecretKey off disk and defaults executionMode to fast", async () => {
  const configPath = getConfigPath();
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJson(configPath, {
    rpcUrl: "https://example",
    walletSecretKey: "legacy-on-disk-secret",
    swapAPIKey: "legacy-api-key",
  });

  const cfg = await loadConfig();

  expect(cfg.walletSecretKey).toBeUndefined();
  expect(cfg.swapAPIKey).toBeUndefined();
  expect(cfg.executionMode).toBe("fast");

  const stored = await fs.readJson(configPath);
  expect(stored.walletSecretKey).toBeUndefined();
  expect(stored.swapAPIKey).toBeUndefined();
  expect(stored.executionMode).toBe("fast");
});

test("normalizeConfig warns on invalid jito settings", () => {
  const { config, warnings } = normalizeConfig({
    rpcUrl: "https://example",
    jito: [],
  });
  expect(config.jito).toEqual(DEFAULT_CONFIG.jito);
  expect(warnings.some((warning) => warning.key === "jito")).toBe(true);
});

test("normalizeConfig throws when strict and invalid", () => {
  expect(() => normalizeConfig({ rpcUrl: "https://example", slippage: -1 }, { strict: true })).toThrow();
});

test("loadConfig handles invalid JSON even if backup fails", async () => {
  const configPath = getConfigPath();
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, "{ invalid json");
  const moveSpy = jest.spyOn(fs, "move").mockRejectedValueOnce(new Error("boom"));
  const pathExistsSpy = jest
    .spyOn(fs, "pathExists")
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);

  const cfg = await loadConfig();

  expect(cfg).toEqual(DEFAULT_CONFIG);
  moveSpy.mockRestore();
  pathExistsSpy.mockRestore();
});

test("loadConfig logs warnings for invalid values", async () => {
  const configPath = getConfigPath();
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJson(configPath, {
    rpcUrl: "https://example",
    slippage: -2,
    priorityFeeLevel: "nope",
  });

  const cfg = await loadConfig();

  expect(cfg.slippage).toBe(DEFAULT_CONFIG.slippage);
  expect(cfg.priorityFeeLevel).toBe(DEFAULT_CONFIG.priorityFeeLevel);
});

test("saveConfig writes normalized config and warns", async () => {
  const configPath = getConfigPath();
  await saveConfig({
    rpcUrl: "https://example",
    slippage: -10,
    priorityFee: "auto",
    priorityFeeLevel: "medium",
    txVersion: "v0",
    showQuoteDetails: true,
    DEBUG_MODE: false,
    notificationsEnabled: true,
    jito: { enabled: false, tip: 0.0001 },
  });
  const stored = await fs.readJson(configPath);
  expect(stored.slippage).toBe(DEFAULT_CONFIG.slippage);
});
