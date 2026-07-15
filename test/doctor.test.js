import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const BASE_CFG = {
  rpcUrl: "https://rpc.example",
  raptorBaseUrl: "https://raptor.example",
  slippage: 1,
  priorityFee: "auto",
  priorityFeeLevel: "medium",
  txVersion: "v0",
  notificationsEnabled: false,
};

const RPC_HINT = "Update `rpcUrl` via `summon config wizard`.";
const KEYCHAIN_HINT = "Run `summon keychain store`.";

let originalFetch;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("runDoctor failure hints", () => {
  test("returns deterministic hints for keychain and rpc failures", async () => {
    const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
    const hasPrivateKeyMock = jest.fn().mockResolvedValue(false);
    const getPrivateKeyMock = jest.fn();
    const hasRaptorApiKeyMock = jest.fn().mockResolvedValue(false);
    const getRaptorApiKeyMock = jest.fn();
    const getSwapClientMock = jest.fn();
    const ensureAdvancedTxMock = jest.fn((url) => url);
    const notifyMock = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ result: "bad" }),
    });

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../utils/keychain.js", () => ({
      hasPrivateKey: hasPrivateKeyMock,
      getPrivateKey: getPrivateKeyMock,
      hasRaptorApiKey: hasRaptorApiKeyMock,
      getRaptorApiKey: getRaptorApiKeyMock,
    }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({
      ensureAdvancedTx: ensureAdvancedTxMock,
      getSwapClient: getSwapClientMock,
    }));

    const { runDoctor } = await import("../lib/doctor.js");
    const results = await runDoctor();

    const keychainResult = results.find((item) => item.name === "keychain");
    const raptorKeyResult = results.find((item) => item.name === "raptorKey");
    const rpcResult = results.find((item) => item.name === "rpc");
    expect(keychainResult).toMatchObject({ status: "fail", hint: KEYCHAIN_HINT });
    expect(raptorKeyResult).toMatchObject({ status: "fail" });
    expect(rpcResult).toMatchObject({ status: "fail", hint: RPC_HINT });
    expect(getSwapClientMock).not.toHaveBeenCalled();
  });

  test("returns swap failure when raptor quote fails", async () => {
    const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
    const hasPrivateKeyMock = jest.fn().mockResolvedValue(true);
    const getPrivateKeyMock = jest.fn().mockResolvedValue("private-key");
    const hasRaptorApiKeyMock = jest.fn().mockResolvedValue(true);
    const getRaptorApiKeyMock = jest.fn().mockResolvedValue("api-key");
    const getSwapClientMock = jest.fn();
    const ensureAdvancedTxMock = jest.fn((url) => url);
    const notifyMock = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: "ok" }),
    });

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../utils/keychain.js", () => ({
      hasPrivateKey: hasPrivateKeyMock,
      getPrivateKey: getPrivateKeyMock,
      hasRaptorApiKey: hasRaptorApiKeyMock,
      getRaptorApiKey: getRaptorApiKeyMock,
    }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({
      ensureAdvancedTx: ensureAdvancedTxMock,
      getSwapClient: getSwapClientMock,
    }));
    jest.unstable_mockModule("../lib/raptorClient.js", () => ({
      RaptorClient: class {
        health() {
          return Promise.resolve("OK");
        }
        getQuote() {
          return Promise.reject(new Error("upstream down"));
        }
      },
    }));

    const { runDoctor } = await import("../lib/doctor.js");
    const results = await runDoctor();
    const swapResult = results.find((item) => item.name === "swap");
    expect(swapResult.status).toBe("fail");
    expect(String(swapResult.details || "")).toMatch(/upstream down/i);
  });
});
