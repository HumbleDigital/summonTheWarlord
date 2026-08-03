import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

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

function makeTracker(getTransactionDetails) {
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
    getTransactionDetails,
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("trade verification behavior", () => {
  test("marks verification confirmed when details confirm immediately", async () => {
    const tracker = makeTracker(jest.fn().mockResolvedValue({ meta: { err: null } }));
    const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { buyToken } = await import("../lib/trades.js");
    const result = await buyToken(MINT, 0.2);

    expect(result.verificationStatus).toBe("confirmed");
    expect(tracker.getTransactionDetails).toHaveBeenCalledTimes(1);
  });

  test("keeps verification pending when status never confirms within timeout schedule", async () => {
    jest.useFakeTimers();

    const tracker = makeTracker(jest.fn().mockResolvedValue({}));
    const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { buyToken } = await import("../lib/trades.js");

    const pendingResultPromise = buyToken(MINT, 0.2);
    await jest.runAllTimersAsync();
    const result = await pendingResultPromise;

    expect(result.verificationStatus).toBe("pending");
    expect(tracker.getTransactionDetails).toHaveBeenCalledTimes(7);
  });

  test("throws SwapError when on-chain metadata reports a transaction error", async () => {
    const tracker = makeTracker(
      jest.fn().mockResolvedValue({ meta: { err: { InstructionError: [1, "Custom"] } } })
    );
    const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { buyToken } = await import("../lib/trades.js");

    await expect(buyToken(MINT, 0.2)).rejects.toThrow("Swap failed: Transaction failed");
    expect(tracker.getTransactionDetails).toHaveBeenCalledTimes(1);
  });

  test("retries transient transaction detail fetch errors and confirms later", async () => {
    jest.useFakeTimers();

    const getTransactionDetails = jest.fn()
      .mockRejectedValueOnce({ status: 503, message: "temporarily unavailable" })
      .mockResolvedValueOnce({ meta: { err: null } });
    const tracker = makeTracker(getTransactionDetails);
    const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
    const getSwapClientMock = jest.fn().mockResolvedValue(tracker);
    const notifyMock = jest.fn();

    jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
    jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));

    const { buyToken } = await import("../lib/trades.js");

    const resultPromise = buyToken(MINT, 0.2);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.verificationStatus).toBe("confirmed");
    expect(getTransactionDetails).toHaveBeenCalledTimes(2);
  });
});
