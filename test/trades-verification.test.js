import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const BASE_CFG = {
  slippage: 1,
  priorityFee: "auto",
  priorityFeeLevel: "medium",
  txVersion: "v0",
  DEBUG_MODE: false,
  notificationsEnabled: false,
  wrapUnwrapSol: true,
  tip: { enabled: false, sol: 0.0001, account: "", lamports: null },
  jito: { enabled: false, tip: 0.0001 },
};

const MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";
const WSOL = "So11111111111111111111111111111111111111112";

function makeClient(getTransactionStatus) {
  return {
    publicKey: "wallet11111111111111111111111111111111111111",
    signer: {
      address: "wallet11111111111111111111111111111111111111",
      keyPair: {},
    },
    rpc: {},
    raptor: {
      getQuote: jest.fn().mockResolvedValue({
        amountOut: "12500000",
        feeAmount: "1000",
        priceImpact: 0.001,
        inputMint: WSOL,
        outputMint: MINT,
      }),
      buildSwap: jest.fn().mockResolvedValue({
        swapTransaction: "AQID",
        lastValidBlockHeight: 1,
      }),
      sendTransaction: jest.fn().mockResolvedValue({ signature: "tx-123", success: true }),
      getTransactionStatus,
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

async function loadBuyWithMocks({ client, signImpl }) {
  const loadConfigMock = jest.fn().mockResolvedValue(BASE_CFG);
  const getSwapClientMock = jest.fn().mockResolvedValue(client);
  const notifyMock = jest.fn();
  const resolveAmountMock = jest.fn().mockResolvedValue("200000000");
  const getMintDecimalsMock = jest.fn().mockResolvedValue(6);
  const signMock = jest.fn().mockImplementation(signImpl || (async () => ({
    signedBase64: "signed",
    signature: "tx-123",
  })));

  jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
  jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
  jest.unstable_mockModule("../utils/notify.js", () => ({ notify: notifyMock }));
  jest.unstable_mockModule("../lib/amounts.js", () => ({
    resolveInputAmountBaseUnits: resolveAmountMock,
    getMintDecimals: getMintDecimalsMock,
    baseUnitsToHuman: (v, d) => {
      const n = Number(v) / 10 ** d;
      return String(n);
    },
    toSlippageBps: () => "100",
    solToLamportsNumber: (n) => Math.round(Number(n) * 1e9),
  }));
  jest.unstable_mockModule("../lib/txSign.js", () => ({
    signSwapTransaction: signMock,
  }));

  const { buyToken } = await import("../lib/trades.js");
  return { buyToken, client, signMock };
}

describe("trade verification behavior", () => {
  test("marks verification confirmed when status confirms immediately", async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ status: "confirmed" }));
    const { buyToken } = await loadBuyWithMocks({ client });
    const result = await buyToken(MINT, 0.2);

    expect(result.verificationStatus).toBe("confirmed");
    expect(client.raptor.getTransactionStatus).toHaveBeenCalledTimes(1);
    expect(client.raptor.getQuote).toHaveBeenCalled();
    expect(client.raptor.buildSwap).toHaveBeenCalled();
    expect(client.raptor.sendTransaction).toHaveBeenCalled();
  });

  test("does not report success when status never confirms within timeout schedule", async () => {
    jest.useFakeTimers();
    const client = makeClient(jest.fn().mockResolvedValue({ status: "pending" }));
    const { buyToken } = await loadBuyWithMocks({ client });

    const pendingResultPromise = buyToken(MINT, 0.2);
    const rejection = expect(pendingResultPromise).rejects.toThrow(/not confirmed/i);
    await jest.runAllTimersAsync();
    await rejection;

    expect(client.raptor.getTransactionStatus).toHaveBeenCalledTimes(7);
  });

  test("throws when transaction status is failed", async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ status: "failed", error: "boom" }));
    const { buyToken } = await loadBuyWithMocks({ client });
    await expect(buyToken(MINT, 0.2)).rejects.toThrow(/Swap failed/i);
  });

  test("decodes Raptor instruction errors from transaction status", async () => {
    const client = makeClient(jest.fn().mockResolvedValue({
      status: "failed",
      error: "[8, 0, 0, 0, 2, 25, 0, 0, 0, 114, 23, 0, 0]",
    }));
    const { buyToken } = await loadBuyWithMocks({ client });

    await expect(buyToken(MINT, 0.2)).rejects.toThrow(/Insufficient funds for transaction.*6002/i);
  });

  test("does not fall back to the local signature when Raptor rejects the send", async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ status: "confirmed" }));
    client.raptor.sendTransaction.mockResolvedValue({ success: false, error: "insufficient funds" });
    const { buyToken } = await loadBuyWithMocks({ client });

    await expect(buyToken(MINT, 0.2)).rejects.toThrow(/insufficient funds/i);
    expect(client.raptor.getTransactionStatus).not.toHaveBeenCalled();
  });

  test("requires Raptor to explicitly accept the send response", async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ status: "confirmed" }));
    client.raptor.sendTransaction.mockResolvedValue({ signature: "tx-123" });
    const { buyToken } = await loadBuyWithMocks({ client });

    await expect(buyToken(MINT, 0.2)).rejects.toThrow(/accept|success/i);
    expect(client.raptor.getTransactionStatus).not.toHaveBeenCalled();
  });

  test("rejects a Raptor signature that does not match the signed payload", async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ status: "confirmed" }));
    client.raptor.sendTransaction.mockResolvedValue({ signature: "different-signature", success: true });
    const { buyToken } = await loadBuyWithMocks({ client });

    await expect(buyToken(MINT, 0.2)).rejects.toThrow(/different signature/i);
    expect(client.raptor.getTransactionStatus).not.toHaveBeenCalled();
  });
});
