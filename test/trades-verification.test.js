import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const BASE_CFG = {
  rpcUrl: "https://example.invalid/rpc",
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
const SIG = "2BfkdW9NWGm9chRf4AdNpq5yBHrgScBLrb9P6ym5scfSA8tcECJgBxzDhS7dEd5McFeTPu1zNyvVjR5L1jaA7ijg";

function makeTracker(performSwap = jest.fn().mockResolvedValue({ signature: SIG })) {
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
    performSwap,
  };
}

const ON_CHAIN_FAILED_MESSAGE = "Transaction failed on-chain. Check the explorer.";

async function loadBuy({ tracker, confirmTransaction, notify = jest.fn(), cfg = BASE_CFG }) {
  const confirmMock = confirmTransaction;
  jest.unstable_mockModule("../lib/config.js", () => ({
    loadConfig: jest.fn().mockResolvedValue(cfg),
  }));
  jest.unstable_mockModule("../lib/swapClient.js", () => ({
    getSwapClient: jest.fn().mockResolvedValue(tracker),
    ensureAdvancedTx: (url) => url,
  }));
  jest.unstable_mockModule("../utils/notify.js", () => ({ notify }));
  jest.unstable_mockModule("../lib/confirmTransaction.js", () => ({
    confirmTransaction: confirmMock,
    extractSignatureFromError: (err) => {
      const message = String(err?.message ?? err ?? "");
      const match = message.match(/\b([1-9A-HJ-NP-Za-km-z]{87,88})\b/);
      return match ? match[1] : null;
    },
    ON_CHAIN_FAILED_MESSAGE,
  }));
  const { buyToken } = await import("../lib/trades.js");
  return { buyToken, notify, ON_CHAIN_FAILED_MESSAGE };
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("trade verification behavior", () => {
  test("marks verification confirmed when RPC status confirms", async () => {
    const tracker = makeTracker();
    const confirmTransaction = jest.fn().mockResolvedValue({ status: "confirmed", err: null });
    const { buyToken } = await loadBuy({ tracker, confirmTransaction });

    const result = await buyToken(MINT, 0.2);

    expect(result.verificationStatus).toBe("confirmed");
    expect(result.txid).toBe(SIG);
    expect(confirmTransaction).toHaveBeenCalledWith(expect.objectContaining({ signature: SIG }));
    expect(tracker.performSwap).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipConfirmationCheck: true })
    );
  });

  test("returns unknown when confirmation times out instead of throwing", async () => {
    const tracker = makeTracker();
    const confirmTransaction = jest.fn().mockResolvedValue({ status: "unknown", err: null });
    const notify = jest.fn();
    const { buyToken } = await loadBuy({ tracker, confirmTransaction, notify });

    const result = await buyToken(MINT, 0.2);

    expect(result.verificationStatus).toBe("unknown");
    expect(result.txid).toBe(SIG);
    expect(notify).not.toHaveBeenCalled();
  });

  test("throws a short SwapError when on-chain status reports err", async () => {
    const tracker = makeTracker();
    const err = { InstructionError: [2, { Custom: 1 }] };
    const confirmTransaction = jest.fn().mockResolvedValue({ status: "failed", err });
    const notify = jest.fn();
    const { buyToken, ON_CHAIN_FAILED_MESSAGE } = await loadBuy({
      tracker,
      confirmTransaction,
      notify,
      cfg: { ...BASE_CFG, notificationsEnabled: true },
    });

    await expect(buyToken(MINT, 0.2)).rejects.toMatchObject({
      name: "SwapError",
      message: ON_CHAIN_FAILED_MESSAGE,
      details: { txid: SIG, err },
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ subtitle: "Buy failed" }));
  });

  test("polls a signature extracted from a performSwap throw", async () => {
    const tracker = makeTracker(
      jest.fn().mockRejectedValue(new Error(`Swap ${SIG} failed: Transaction failed after maximum retries`))
    );
    const confirmTransaction = jest.fn().mockResolvedValue({ status: "confirmed", err: null });
    const { buyToken } = await loadBuy({ tracker, confirmTransaction });

    const result = await buyToken(MINT, 0.2);

    expect(result.verificationStatus).toBe("confirmed");
    expect(result.txid).toBe(SIG);
    expect(confirmTransaction).toHaveBeenCalledWith(expect.objectContaining({ signature: SIG }));
  });

  test("throws when performSwap fails without a signature", async () => {
    const tracker = makeTracker(
      jest.fn().mockRejectedValue(new Error("Failed to send transaction"))
    );
    const confirmTransaction = jest.fn();
    const { buyToken } = await loadBuy({ tracker, confirmTransaction });

    await expect(buyToken(MINT, 0.2)).rejects.toThrow("Swap failed: Failed to send transaction");
    expect(confirmTransaction).not.toHaveBeenCalled();
  });
});
