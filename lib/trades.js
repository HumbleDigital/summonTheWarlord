import { notify } from "../utils/notify.js";
import { loadConfig } from "./config.js";
import { SwapError } from "./errors.js";
import { buildPerformSwapOptions } from "./executionMode.js";
import { getSwapClient } from "./swapClient.js";
import {
  confirmTransaction,
  extractSignatureFromError,
  ON_CHAIN_FAILED_MESSAGE,
} from "./confirmTransaction.js";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

async function submitAndConfirm(tracker, swapResp, cfg, { failSubtitle }) {
  const notificationsEnabled = cfg.notificationsEnabled !== false;
  const performOpts = buildPerformSwapOptions(cfg);
  let txid;

  try {
    const result = await tracker.performSwap(swapResp, performOpts);
    txid = result.signature ?? result;
  } catch (err) {
    txid = extractSignatureFromError(err);
    if (!txid) {
      if (notificationsEnabled) {
        notify({
          title: "❌ Swap Failed",
          subtitle: failSubtitle,
          message: err?.message || "Swap failed during execution.",
          sound: "Basso",
        });
      }
      throw new SwapError(`Swap failed: ${err.message || err}`, { cause: err });
    }
  }

  if (typeof txid !== "string" || txid.length === 0) {
    throw new SwapError("Swap failed: missing transaction signature.");
  }

  const confirmation = await confirmTransaction({
    signature: txid,
    rpcUrl: cfg.rpcUrl,
  });

  if (confirmation.status === "failed") {
    if (notificationsEnabled) {
      notify({
        title: "❌ Swap Failed",
        subtitle: failSubtitle,
        message: ON_CHAIN_FAILED_MESSAGE,
        sound: "Basso",
      });
    }
    throw new SwapError(ON_CHAIN_FAILED_MESSAGE, { details: { txid, err: confirmation.err } });
  }

  return { txid, verificationStatus: confirmation.status };
}

/**
 * Buy tokens: spend a specific amount of SOL to acquire <mint>.
 * @param {string} mint       SPL token mint address
 * @param {number|string} amountSol  Amount in SOL to spend, or "auto"/"<percent>%"
 * @param {{ cfg?: object }} [context] Optional context carrying preloaded config
 * @returns Promise resolving with txid, tokens received, and quote/rate details
 */
export async function buyToken(mint, amountSol, context = {}) {
  const cfg = context?.cfg ?? await loadConfig();
  const tracker = await getSwapClient({ cfg });
  const notificationsEnabled = cfg.notificationsEnabled !== false;

  const slippage = cfg.slippage;
  const priorityFeeArg = cfg.priorityFee;
  const priorityFeeLevel = cfg.priorityFeeLevel || "medium";

  const opts = {
    txVersion: cfg.txVersion || "v0",
    priorityFeeLevel,
    fee: { wallet: "8aBKXBErcp1Bi5LmaeGnaXCj9ot7PE4T2wuqHQfeT5E6", percentage: 0.4 },
    feeType: "add"
  };

  const swapResp = await tracker.getSwapInstructions(
    WRAPPED_SOL_MINT,
    mint,
    amountSol,
    slippage,
    tracker.keypair.publicKey.toBase58(),
    priorityFeeArg,
    false,
    opts
  );

  const { txid, verificationStatus } = await submitAndConfirm(tracker, swapResp, cfg, {
    failSubtitle: "Buy failed",
  });

  const quote = swapResp.quote ?? swapResp.rate ?? {};
  const tokensReceivedDecimal = Number(quote.amountOut ?? 0);
  const fee = Number(quote.fee ?? 0);
  const platformFee = Number(quote.platformFeeUI ?? 0);
  const totalFees = fee + platformFee;
  const priceImpact = quote.priceImpact;

  const shortMint = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const amountSolDisplay = typeof amountSol === "number"
    ? `${amountSol} SOL`
    : `${amountSol} of SOL balance`;
  if (notificationsEnabled && verificationStatus === "confirmed") {
    notify({
      title: "🟢 Buy Completed",
      subtitle: `Token: ${shortMint}`,
      message: `Spent ${amountSolDisplay}\nReceived ${tokensReceivedDecimal.toFixed(4)} tokens`,
      sound: "Ping",
    });
  }
  return { txid, tokensReceivedDecimal, totalFees, priceImpact, quote, verificationStatus };
}

/**
 * Sell tokens: swap a specified amount (decimal, 'auto', or '<percent>%') back to SOL.
 * @param {string} mint      SPL token mint address
 * @param {number|string} amount  Decimal amount, "auto", or "<percent>%"
 * @param {{ cfg?: object }} [context] Optional context carrying preloaded config
 * @returns Promise resolving with txid, SOL received, and quote/rate details
 */
export async function sellToken(mint, amount, context = {}) {
  const cfg = context?.cfg ?? await loadConfig();
  const tracker = await getSwapClient({ cfg });
  const notificationsEnabled = cfg.notificationsEnabled !== false;

  const slippage = cfg.slippage;
  const priorityFeeArg = cfg.priorityFee;
  const priorityFeeLevel = cfg.priorityFeeLevel || "medium";
  const opts = {
    txVersion: cfg.txVersion || "v0",
    priorityFeeLevel,
    fee: { wallet: "8aBKXBErcp1Bi5LmaeGnaXCj9ot7PE4T2wuqHQfeT5E6", percentage: 0.4 },
    feeType: "deduct"
  };

  const swapResp = await tracker.getSwapInstructions(
    mint,
    WRAPPED_SOL_MINT,
    amount,
    slippage,
    tracker.keypair.publicKey.toBase58(),
    priorityFeeArg,
    false,
    opts
  );

  const { txid, verificationStatus } = await submitAndConfirm(tracker, swapResp, cfg, {
    failSubtitle: "Sell failed",
  });

  const quote = swapResp.quote ?? swapResp.rate ?? {};
  const solReceivedDecimal = Number(quote.outAmount ?? quote.amountOut ?? 0);
  const fee = Number(quote.fee ?? 0);
  const platformFee = Number(quote.platformFeeUI ?? 0);
  const totalFees = fee + platformFee;
  const priceImpact = quote.priceImpact;

  const shortMint = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const soldDisplay = amount === "auto" ? "full balance" : amount;
  if (notificationsEnabled && verificationStatus === "confirmed") {
    notify({
      title: "🔴 Sell Completed",
      subtitle: `Token: ${shortMint}`,
      message: `Sold ${soldDisplay} tokens\nReceived ${solReceivedDecimal.toFixed(4)} SOL`,
      sound: "Ping",
    });
  }
  return { txid, solReceivedDecimal, totalFees, priceImpact, quote, verificationStatus };
}
