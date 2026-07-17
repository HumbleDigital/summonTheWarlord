import { test, expect } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDebugLog, redactDebugValue } from "../utils/debugLog.js";

test("disabled debug logging does not create a log", async () => {
  await expect(createDebugLog({ enabled: false })).resolves.toBeNull();
});

test("debug logs are private and redact sensitive fields", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "summon-debug-log-"));

  try {
    const debugLog = await createDebugLog({
      enabled: true,
      operation: "sell-ExampleMint",
      directory,
      now: new Date("2026-07-17T12:34:56.789Z"),
      pid: 123,
    });

    await debugLog.write("trade.failed", {
      safe: "visible",
      apiKey: "raptor-secret",
      headers: { "x-api-key": "header-secret", authorization: "Bearer bearer-secret" },
      privateKey: "wallet-secret",
      signedBase64: "signed-transaction-secret",
      transaction: "serialized-transaction-secret",
      details: "request failed with apiKey=message-secret",
      amountBaseUnits: 123n,
    });
    await debugLog.close();

    const contents = await fs.readFile(debugLog.path, "utf8");
    const fileStats = await fs.stat(debugLog.path);
    const directoryStats = await fs.stat(directory);

    expect(contents).toContain('"safe":"visible"');
    expect(contents).toContain("[REDACTED]");
    expect(contents).not.toContain("raptor-secret");
    expect(contents).not.toContain("header-secret");
    expect(contents).not.toContain("bearer-secret");
    expect(contents).not.toContain("wallet-secret");
    expect(contents).not.toContain("signed-transaction-secret");
    expect(contents).not.toContain("serialized-transaction-secret");
    expect(contents).not.toContain("message-secret");
    expect(contents).toContain('"amountBaseUnits":"123n"');
    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(directoryStats.mode & 0o777).toBe(0o700);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("errors are converted to redacted serializable data", () => {
  const error = new Error("request failed");
  error.details = { apiKey: "secret", body: "safe details" };

  expect(redactDebugValue(error)).toEqual({
    name: "Error",
    message: "request failed",
    status: undefined,
    details: { apiKey: "[REDACTED]", body: "safe details" },
  });
});

test("trade completion displays the debug-log path", async () => {
  const cli = await fs.readFile(new URL("../summon-cli.js", import.meta.url), "utf8");

  expect(cli).toContain("createDebugLog");
  expect(cli).toContain('["Debug log", debugLog.path]');
});
