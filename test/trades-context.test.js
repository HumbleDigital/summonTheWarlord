import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const BASE_CFG = {
  slippage: 1,
  priorityFee: "auto",
  priorityFeeLevel: "medium",
  txVersion: "v0",
  DEBUG_MODE: false,
  notificationsEnabled: false,
  executionMode: "fast",
  jito: { enabled: false, tip: 0.0001 },
};

const MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";

function makeTracker() {
  return {
    keypair: { publicKey: { toBase58: () => "wallet11111111111111111111111111111111111111" } },
    getSwapInstructions: jest.fn().mockResolvedValue({
      quote: {
        amountOut: "12.5",
        outAmount: "2.25",
        fee: "0.01",
        platformFeeUI: "0.02",
        priceImpact: "0.5",
      },
    }),
    performSwap: jest.fn().mockResolvedValue({ signature: "tx-123" }),
    getTransactionDetails: jest.fn().mockResolvedValue({ meta: {} }),
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("trades config reuse", () => {
  test("buyToken uses context.cfg and skips loadConfig", async () => {
    const tracker = makeTracker();
    const loadConfigMock = jest.fn().mockRejectedValue(new Error("loadConfig should not be called"));
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { buyToken } = await import("../lib/trades.js");
    const contextCfg = { ...BASE_CFG, slippage: 3 };
    await buyToken(MINT, 0.1, { cfg: contextCfg });

    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(getSwapClientMock).toHaveBeenCalledWith({ cfg: contextCfg });
  });

  test("sellToken uses context.cfg and skips loadConfig", async () => {
    const tracker = makeTracker();
    const loadConfigMock = jest.fn().mockRejectedValue(new Error("loadConfig should not be called"));
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { sellToken } = await import("../lib/trades.js");
    const contextCfg = { ...BASE_CFG, slippage: 4 };
    await sellToken(MINT, "10%", { cfg: contextCfg });

    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(getSwapClientMock).toHaveBeenCalledWith({ cfg: contextCfg });
  });

  test("buyToken loads config when context cfg is not provided", async () => {
    const tracker = makeTracker();
    const loadConfigMock = jest.fn().mockResolvedValue({ ...BASE_CFG, slippage: 9 });
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { buyToken } = await import("../lib/trades.js");
    await buyToken(MINT, 0.25);

    expect(loadConfigMock).toHaveBeenCalledTimes(1);
    expect(getSwapClientMock).toHaveBeenCalledWith({ cfg: { ...BASE_CFG, slippage: 9 } });
  });

  test("buyToken with executionMode basic passes skipPreflight false to performSwap", async () => {
    const tracker = makeTracker();
    const loadConfigMock = jest.fn().mockRejectedValue(new Error("loadConfig should not be called"));
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { buyToken } = await import("../lib/trades.js");
    await buyToken(MINT, 0.1, { cfg: { ...BASE_CFG, executionMode: "basic" } });

    expect(tracker.performSwap).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sendOptions: { skipPreflight: false },
      })
    );
  });

  test("buyToken with fast (or default) passes skipPreflight true to performSwap", async () => {
    const tracker = makeTracker();
    const loadConfigMock = jest.fn().mockRejectedValue(new Error("loadConfig should not be called"));
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { buyToken } = await import("../lib/trades.js");
    await buyToken(MINT, 0.1, { cfg: { ...BASE_CFG, executionMode: "fast" } });

    expect(tracker.performSwap).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sendOptions: { skipPreflight: true },
      })
    );

    tracker.performSwap.mockClear();
    const cfgWithoutMode = { ...BASE_CFG };
    delete cfgWithoutMode.executionMode;
    await buyToken(MINT, 0.1, { cfg: cfgWithoutMode });

    expect(tracker.performSwap).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sendOptions: { skipPreflight: true },
      })
    );
  });
});
