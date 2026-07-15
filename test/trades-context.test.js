import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

function makeClient() {
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
      getTransactionStatus: jest.fn().mockResolvedValue({ status: "confirmed" }),
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

async function mockTradeModules({ loadConfigMock, getSwapClientMock }) {
  jest.unstable_mockModule("../lib/config.js", () => ({ loadConfig: loadConfigMock }));
  jest.unstable_mockModule("../lib/swapClient.js", () => ({ getSwapClient: getSwapClientMock }));
  jest.unstable_mockModule("../utils/notify.js", () => ({ notify: jest.fn() }));
  jest.unstable_mockModule("../lib/amounts.js", () => ({
    resolveInputAmountBaseUnits: jest.fn().mockResolvedValue("100000000"),
    getMintDecimals: jest.fn().mockResolvedValue(6),
    baseUnitsToHuman: () => "12.5",
    toSlippageBps: () => "100",
    solToLamportsNumber: (n) => Math.round(Number(n) * 1e9),
  }));
  jest.unstable_mockModule("../lib/txSign.js", () => ({
    signSwapTransaction: jest.fn().mockResolvedValue({ signedBase64: "signed", signature: "tx-123" }),
  }));
}

describe("trades config reuse", () => {
  test("buyToken uses context.cfg and skips loadConfig", async () => {
    const client = makeClient();
    const loadConfigMock = jest.fn().mockRejectedValue(new Error("loadConfig should not be called"));
    const getSwapClientMock = jest.fn().mockResolvedValue(client);
    await mockTradeModules({ loadConfigMock, getSwapClientMock });

    const { buyToken } = await import("../lib/trades.js");
    const contextCfg = { ...BASE_CFG, slippage: 3 };
    await buyToken(MINT, 0.1, { cfg: contextCfg });

    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(getSwapClientMock).toHaveBeenCalledWith({ cfg: contextCfg });
  });

  test("sellToken uses context.cfg and skips loadConfig", async () => {
    const client = makeClient();
    const loadConfigMock = jest.fn().mockRejectedValue(new Error("loadConfig should not be called"));
    const getSwapClientMock = jest.fn().mockResolvedValue(client);
    await mockTradeModules({ loadConfigMock, getSwapClientMock });

    const { sellToken } = await import("../lib/trades.js");
    const contextCfg = { ...BASE_CFG, slippage: 4 };
    await sellToken(MINT, "10%", { cfg: contextCfg });

    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(getSwapClientMock).toHaveBeenCalledWith({ cfg: contextCfg });
  });

  test("buyToken loads config when context cfg is not provided", async () => {
    const client = makeClient();
    const loadConfigMock = jest.fn().mockResolvedValue({ ...BASE_CFG, slippage: 9 });
    const getSwapClientMock = jest.fn().mockResolvedValue(client);
    await mockTradeModules({ loadConfigMock, getSwapClientMock });

    const { buyToken } = await import("../lib/trades.js");
    await buyToken(MINT, 0.25);

    expect(loadConfigMock).toHaveBeenCalledTimes(1);
    expect(getSwapClientMock).toHaveBeenCalledWith({ cfg: { ...BASE_CFG, slippage: 9 } });
  });
});
