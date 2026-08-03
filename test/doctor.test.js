import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const BASE_CFG = {
  rpcUrl: "https://rpc.example",
  slippage: 1,
  priorityFee: "auto",
  priorityFeeLevel: "medium",
  txVersion: "v0",
  notificationsEnabled: false,
};

const RPC_HINT = "Update `rpcUrl` via `summon config wizard`.";
const KEYCHAIN_HINT = "Run `summon keychain store`.";
const SWAP_HINT = "Rerun `summon doctor -v` and verify SolanaTracker account/RPC.";

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
    const getPrivateKeyMock = jest
      .fn()
      .mockRejectedValue(new Error("Private key not found. Run `summon keychain store` to save it."));
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
      getPrivateKey: getPrivateKeyMock,
    }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({
      ensureAdvancedTx: ensureAdvancedTxMock,
      getSwapClient: getSwapClientMock,
    }));

    const { runDoctor } = await import("../lib/doctor.js");
    const results = await runDoctor();

    const keychainResult = results.find((item) => item.name === "keychain");
    const rpcResult = results.find((item) => item.name === "rpc");
    expect(getPrivateKeyMock).toHaveBeenCalledTimes(1);
    expect(keychainResult).toMatchObject({
      status: "fail",
      message: "No private key stored.",
      hint: KEYCHAIN_HINT,
    });
    expect(rpcResult).toMatchObject({ status: "fail", hint: RPC_HINT });
    expect(getSwapClientMock).not.toHaveBeenCalled();
  });

  test("returns deterministic swap hint when swap api check fails", async () => {
    const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
    const getPrivateKeyMock = jest.fn().mockResolvedValue("private-key");
    const getSwapClientMock = jest.fn().mockResolvedValue({
      keypair: { publicKey: { toBase58: () => "wallet11111111111111111111111111111111111111" } },
      getSwapInstructions: jest.fn().mockRejectedValue(new Error("upstream down")),
    });
    const ensureAdvancedTxMock = jest.fn((url) => url);
    const notifyMock = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: "ok" }),
    });

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../utils/keychain.js", () => ({
      getPrivateKey: getPrivateKeyMock,
    }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({
      ensureAdvancedTx: ensureAdvancedTxMock,
      getSwapClient: getSwapClientMock,
    }));

    const { runDoctor } = await import("../lib/doctor.js");
    const results = await runDoctor({ verbose: true });

    expect(getPrivateKeyMock).toHaveBeenCalledTimes(1);
    const swapResult = results.find((item) => item.name === "swap");
    expect(swapResult).toMatchObject({ status: "fail", hint: SWAP_HINT });
    expect(swapResult.details).toBe("upstream down");
  });

  test("reports unable to read private key for non-missing keychain errors", async () => {
    const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
    const getPrivateKeyMock = jest
      .fn()
      .mockRejectedValue(new Error("Failed to read private key from Keychain."));
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
      getPrivateKey: getPrivateKeyMock,
    }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({
      ensureAdvancedTx: ensureAdvancedTxMock,
      getSwapClient: getSwapClientMock,
    }));

    const { runDoctor } = await import("../lib/doctor.js");
    const results = await runDoctor({ verbose: true });

    expect(getPrivateKeyMock).toHaveBeenCalledTimes(1);
    const keychainResult = results.find((item) => item.name === "keychain");
    expect(keychainResult).toMatchObject({
      status: "fail",
      message: "Unable to read private key.",
      details: "Failed to read private key from Keychain.",
      hint: KEYCHAIN_HINT,
    });
    expect(getSwapClientMock).not.toHaveBeenCalled();
  });
});
