import { describe, expect, test } from "@jest/globals";
import { SwapError } from "../lib/errors.js";
import {
  ON_CHAIN_FAILED_MESSAGE,
  CONFIRMATION_TIMEOUT_INFO,
} from "../lib/confirmTransaction.js";
import { buildTradeStatusView, orbExplorerUrl } from "../lib/tradeStatus.js";

const MINT = "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g";
const SIG = "2BfkdW9NWGm9chRf4AdNpq5yBHrgScBLrb9P6ym5scfSA8tcECJgBxzDhS7dEd5McFeTPu1zNyvVjR5L1jaA7ijg";

function rowMap(rows) {
  return Object.fromEntries(rows);
}

describe("buildTradeStatusView", () => {
  test("renders confirmed buy as SUCCESS with string cells only", () => {
    const view = buildTradeStatusView({
      type: "buy",
      mint: MINT,
      amount: 0.02,
      result: {
        txid: SIG,
        tokensReceivedDecimal: 12.5,
        totalFees: 0.03,
        priceImpact: 0.5,
        verificationStatus: "confirmed",
      },
    });

    expect(view.title).toBe("SUCCESS");
    expect(view.tone).toBe("green");
    expect(view.exitCode).toBe(0);
    const rows = rowMap(view.rows);
    expect(rows.TXID).toBe(SIG);
    expect(rows.Explorer).toBe(orbExplorerUrl(SIG));
    expect(rows.Verification).toBe("confirmed");
    expect(rows.Info).toContain("12.5");
    for (const [, value] of view.rows) {
      expect(typeof value).toBe("string");
      expect(value).not.toBe("[object Object]");
      expect(value).not.toMatch(/InstructionError/);
    }
  });

  test("renders timeout as UNKNOWN with explorer hint", () => {
    const view = buildTradeStatusView({
      type: "sell",
      mint: MINT,
      amount: "100%",
      result: {
        txid: SIG,
        solReceivedDecimal: 0.02,
        totalFees: 0.01,
        priceImpact: 0.1,
        verificationStatus: "unknown",
      },
    });

    expect(view.title).toBe("UNKNOWN");
    expect(view.tone).toBe("yellow");
    expect(view.exitCode).toBe(0);
    const rows = rowMap(view.rows);
    expect(rows.Verification).toBe("unknown");
    expect(rows.Info).toBe(CONFIRMATION_TIMEOUT_INFO);
    expect(rows.Explorer).toBe(orbExplorerUrl(SIG));
    expect(JSON.stringify(view.rows)).not.toMatch(/confirmationStatus|"context"/);
  });

  test("renders on-chain failure with short error and txid from details", () => {
    const view = buildTradeStatusView({
      type: "buy",
      mint: MINT,
      amount: 0.02,
      error: new SwapError(ON_CHAIN_FAILED_MESSAGE, {
        details: { txid: SIG, err: { InstructionError: [2, { Custom: 1 }] } },
      }),
    });

    expect(view.title).toBe("FAILED");
    expect(view.tone).toBe("red");
    expect(view.exitCode).toBe(1);
    const rows = rowMap(view.rows);
    expect(rows.Error).toBe(ON_CHAIN_FAILED_MESSAGE);
    expect(rows.Error).not.toMatch(/\{/);
    expect(rows.TXID).toBe(SIG);
    expect(rows.Explorer).toBe(orbExplorerUrl(SIG));
    expect(JSON.stringify(view.rows)).not.toMatch(/InstructionError/);
  });

  test("renders send failure without a signature", () => {
    const view = buildTradeStatusView({
      type: "buy",
      mint: MINT,
      amount: 0.02,
      error: new SwapError("Swap failed: Failed to send transaction"),
    });

    const rows = rowMap(view.rows);
    expect(view.title).toBe("FAILED");
    expect(rows.TXID).toBe("-");
    expect(rows.Explorer).toBe("-");
    expect(rows.Error).toBe("Swap failed: Failed to send transaction");
  });
});
