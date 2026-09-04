import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_CONFIG, normalizeConfig } from "../lib/config.js";
import { buildPerformSwapOptions } from "../lib/executionMode.js";
import { validatePrivateKeyInput } from "../lib/privateKey.js";

const packageJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json"
);

describe("security regression", () => {
  test("DEFAULT_CONFIG has no walletSecretKey field", () => {
    expect(Object.hasOwn(DEFAULT_CONFIG, "walletSecretKey")).toBe(false);
    expect(DEFAULT_CONFIG.walletSecretKey).toBeUndefined();
  });

  test("normalizeConfig strips walletSecretKey and swapAPIKey", () => {
    const { config, changed } = normalizeConfig({
      rpcUrl: DEFAULT_CONFIG.rpcUrl,
      walletSecretKey: "legacy-wallet-secret",
      swapAPIKey: "legacy-swap-api-key",
    });

    expect(changed).toBe(true);
    expect(config.walletSecretKey).toBeUndefined();
    expect(config.swapAPIKey).toBeUndefined();
    expect(Object.hasOwn(config, "walletSecretKey")).toBe(false);
    expect(Object.hasOwn(config, "swapAPIKey")).toBe(false);
  });

  test("buildPerformSwapOptions basic vs fast differ on skipPreflight", () => {
    const basic = buildPerformSwapOptions({ executionMode: "basic" });
    const fast = buildPerformSwapOptions({ executionMode: "fast" });

    expect(basic.sendOptions.skipPreflight).toBe(false);
    expect(fast.sendOptions.skipPreflight).toBe(true);
    expect(basic.sendOptions.skipPreflight).not.toBe(fast.sendOptions.skipPreflight);
  });

  test("validatePrivateKeyInput rejects empty", () => {
    expect(validatePrivateKeyInput("").ok).toBe(false);
    expect(validatePrivateKeyInput("   ").ok).toBe(false);
    expect(validatePrivateKeyInput(null).ok).toBe(false);
    expect(validatePrivateKeyInput(undefined).ok).toBe(false);
  });

  test("package.json description does not claim private keys never enter JS memory", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    expect(typeof pkg.description).toBe("string");
    expect(pkg.description).not.toMatch(/never.*javascript memory/i);
    expect(pkg.description).not.toMatch(/never enter.*memory/i);
  });
});
