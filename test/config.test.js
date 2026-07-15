import { afterEach, beforeEach, test, expect } from "@jest/globals";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

import { getConfigPath, loadConfig, saveConfig } from "../lib/config.js";

let originalConfigHome;
let tempConfigHome;

beforeEach(async () => {
  originalConfigHome = process.env.SUMMON_CONFIG_HOME;
  tempConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "summon-config-"));
  process.env.SUMMON_CONFIG_HOME = tempConfigHome;
});

afterEach(async () => {
  if (originalConfigHome === undefined) {
    delete process.env.SUMMON_CONFIG_HOME;
  } else {
    process.env.SUMMON_CONFIG_HOME = originalConfigHome;
  }
  originalConfigHome = undefined;

  if (tempConfigHome) {
    await fs.remove(tempConfigHome);
    tempConfigHome = undefined;
  }
});

test("getConfigPath respects SUMMON_CONFIG_HOME", () => {
  const expected = path.join(tempConfigHome, "summonTheWarlord", "config.json");
  expect(getConfigPath()).toBe(expected);
});

test("loadConfig writes defaults when missing", async () => {
  const configPath = getConfigPath();
  const cfg = await loadConfig();

  await expect(fs.pathExists(configPath)).resolves.toBe(true);
  const fileContents = await fs.readJson(configPath);
  expect(cfg).toEqual(fileContents);

  expect(cfg.rpcUrl).toBe("https://rpc.solanatracker.io/public?advancedTx=true");
  expect(cfg.priorityFee).toBe("auto");
  expect(cfg.priorityFeeLevel).toBe("medium");
  expect(cfg.jito).toEqual({ enabled: false, tip: 0.0001 });
  expect(cfg.notificationsEnabled).toBe(true);

  const fileStat = await fs.stat(configPath);
  expect(fileStat.mode & 0o777).toBe(0o600);

  const dirStat = await fs.stat(path.dirname(configPath));
  expect(dirStat.mode & 0o777).toBe(0o700);
});

test("loadConfig merges missing defaults", async () => {
  const configPath = getConfigPath();
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJson(configPath, { rpcUrl: "https://example", slippage: 5 });

  const cfg = await loadConfig();

  expect(cfg.rpcUrl).toBe("https://example");
  expect(cfg.slippage).toBe(5);
  expect(cfg.priorityFeeLevel).toBe("medium");
  expect(cfg.txVersion).toBe("v0");
});

test("loadConfig recovers from invalid JSON", async () => {
  const configPath = getConfigPath();
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, "{ invalid json");

  const cfg = await loadConfig();

  const stored = await fs.readJson(configPath);
  expect(cfg).toEqual(stored);

  const dirEntries = await fs.readdir(path.dirname(configPath));
  const backups = dirEntries.filter((name) => name.startsWith("config.json.invalid-"));
  expect(backups.length).toBeGreaterThanOrEqual(1);
});

test("saveConfig persists updates with secure permissions", async () => {
  const configPath = getConfigPath();
  const newConfig = {
    rpcUrl: "https://custom?advancedTx=true",
    slippage: 2,
    priorityFee: 0.001,
    priorityFeeLevel: "medium",
    txVersion: "legacy",
    showQuoteDetails: true,
    DEBUG_MODE: true,
    notificationsEnabled: false,
    jito: { enabled: true, tip: 0.0002 },
  };

  await saveConfig(newConfig);

  const stored = await fs.readJson(configPath);
  expect(stored).toMatchObject({
    ...newConfig,
    // jito.enabled migrates into tip when tip was default-off
    tip: expect.objectContaining({ enabled: true, sol: 0.0002 }),
    raptorBaseUrl: expect.any(String),
    wrapUnwrapSol: true,
  });

  const fileStat = await fs.stat(configPath);
  expect(fileStat.mode & 0o777).toBe(0o600);
});
