import { notify } from "../utils/notify.js";
import { loadConfig } from "./config.js";
import { SwapError } from "./errors.js";
import { getSwapClient } from "./swapClient.js";
import { OPERATOR_FEE, WRAPPED_SOL_MINT } from "./constants.js";
import {
  baseUnitsToHuman,
  getMintDecimals,
  resolveInputAmountBaseUnits,
  solToLamportsNumber,
  toSlippageBps,
} from "./amounts.js";
import { signSwapTransaction } from "./txSign.js";
import { mapTxVersionForRaptor, mapPriorityFeeForRaptor } from "./raptorOptions.js";

const VERIFY_DELAY_SCHEDULE_MS = [500, 1000, 2000, 3000, 4000, 5000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build common Raptor swap option fields from config.
 * @param {object} cfg
 * @param {"buy"|"sell"} side
 */
export function buildRaptorSwapOptions(cfg, side) {
  const opts = {
    wrapUnwrapSol: cfg.wrapUnwrapSol !== false,
    txVersion: mapTxVersionForRaptor(cfg.txVersion),
    feeAccount: OPERATOR_FEE.wallet,
    feeBps: OPERATOR_FEE.bps,
    // Buy: fee from SOL input. Sell: fee from token input.
    feeFromInput: true,
  };

  Object.assign(opts, mapPriorityFeeForRaptor(cfg));

  if (cfg.maxPriorityFee != null && cfg.maxPriorityFee !== "") {
    opts.maxPriorityFee = Number(cfg.maxPriorityFee);
  }
  if (cfg.computeUnitPriceMicroLamports != null && cfg.computeUnitPriceMicroLamports !== "") {
    opts.computeUnitPriceMicroLamports = Number(cfg.computeUnitPriceMicroLamports);
  }
  if (cfg.computeUnitLimit != null && cfg.computeUnitLimit !== "") {
    opts.computeUnitLimit = Number(cfg.computeUnitLimit);
  }
  if (cfg.dexes) {
    opts.dexes = String(cfg.dexes);
  }
  if (cfg.pools) {
    opts.pools = String(cfg.pools);
  }
  if (cfg.maxHops != null && cfg.maxHops !== "") {
    opts.maxHops = Number(cfg.maxHops);
  }
  if (cfg.onlyDirectRoutes === true) {
    opts.onlyDirectRoutes = true;
  }
  if (cfg.destinationTokenAccount) {
    opts.destinationTokenAccount = String(cfg.destinationTokenAccount);
  }
  if (cfg.chargeBps != null && cfg.chargeBps !== "") {
    opts.chargeBps = Number(cfg.chargeBps);
  }

  // Tips: new tip config, with legacy jito migration support
  const tipEnabled = cfg.tip?.enabled === true
    || (cfg.tip?.enabled == null && cfg.jito?.enabled === true);
  if (tipEnabled) {
    if (cfg.tip?.account) {
      opts.tipAccount = String(cfg.tip.account);
    }
    const tipSol = cfg.tip?.lamports != null
      ? null
      : (cfg.tip?.sol ?? cfg.jito?.tip);
    if (cfg.tip?.lamports != null && cfg.tip.lamports !== "") {
      opts.tipLamports = Number(cfg.tip.lamports);
    } else if (tipSol != null && tipSol !== "") {
      opts.tipLamports = solToLamportsNumber(tipSol);
    }
  }

  // silence unused side for now (feeFromInput always true for operator fee on input)
  void side;
  return opts;
}

async function verifySwap(raptor, txid) {
  const check = async () => {
    try {
      const details = await raptor.getTransactionStatus(txid);
      const status = String(details?.status || "").toLowerCase();
      if (status === "confirmed" || status === "success" || status === "succeeded") {
        return "confirmed";
      }
      if (status === "failed" || status === "failure" || status === "error") {
        throw new Error(`Transaction failed: ${details?.error || details?.status || "failed"}`);
      }
      if (status === "expired") {
        throw new Error("Transaction expired before confirmation.");
      }
      return "pending";
    } catch (err) {
      if (err instanceof SwapError || (err?.message && err.message.startsWith("Transaction"))) {
        throw err;
      }
      const status = err?.status ?? err?.statusCode;
      if (typeof status === "number" && [404, 408, 425, 429, 500, 502, 503, 504].includes(status)) {
        return "pending";
      }
      const message = String(err?.message ?? err ?? "").toLowerCase();
      if (
        message.includes("not found")
        || message.includes("timeout")
        || message.includes("network")
        || message.includes("fetch failed")
      ) {
        return "pending";
      }
      throw err;
    }
  };

  const immediate = await check();
  if (immediate === "confirmed") return true;

  for (const waitMs of VERIFY_DELAY_SCHEDULE_MS) {
    await sleep(waitMs);
    const state = await check();
    if (state === "confirmed") return true;
  }
  return false;
}

/**
 * Execute quote → swap → sign → send → verify.
 * @param {object} args
 */
async function executeSwap({
  side,
  inputMint,
  outputMint,
  amount,
  context = {},
}) {
  const cfg = context?.cfg ?? await loadConfig();
  const client = await getSwapClient({ cfg });
  const { signer, publicKey, rpc, raptor } = client;
  const debugEnabled = Boolean(cfg.DEBUG_MODE || process.env.NODE_ENV === "development");
  const notificationsEnabled = cfg.notificationsEnabled !== false;

  const amountBase = await resolveInputAmountBaseUnits({
    side,
    amount,
    inputMint,
    rpc,
    owner: signer.address,
  });

  const slippageBps = toSlippageBps(cfg.slippage);
  const swapOpts = buildRaptorSwapOptions(cfg, side);

  const quoteQuery = {
    inputMint,
    outputMint,
    amount: amountBase,
    slippageBps,
  };
  if (swapOpts.dexes) quoteQuery.dexes = swapOpts.dexes;
  if (swapOpts.pools) quoteQuery.pools = swapOpts.pools;
  if (swapOpts.maxHops != null) quoteQuery.maxHops = swapOpts.maxHops;
  if (swapOpts.onlyDirectRoutes) quoteQuery.onlyDirectRoutes = true;

  let quote;
  let swapBuild;
  try {
    quote = await raptor.getQuote(quoteQuery);
    if (debugEnabled || cfg.showQuoteDetails) {
      console.log(JSON.stringify({ quote }, null, 2));
    }
    swapBuild = await raptor.buildSwap({
      userPublicKey: publicKey,
      quoteResponse: quote,
      wrapUnwrapSol: swapOpts.wrapUnwrapSol,
      txVersion: swapOpts.txVersion,
      priorityFee: swapOpts.priorityFee,
      maxPriorityFee: swapOpts.maxPriorityFee,
      computeUnitPriceMicroLamports: swapOpts.computeUnitPriceMicroLamports,
      computeUnitLimit: swapOpts.computeUnitLimit,
      tipAccount: swapOpts.tipAccount,
      tipLamports: swapOpts.tipLamports,
      feeAccount: swapOpts.feeAccount,
      feeBps: swapOpts.feeBps,
      feeFromInput: swapOpts.feeFromInput,
      chargeBps: swapOpts.chargeBps,
      destinationTokenAccount: swapOpts.destinationTokenAccount,
    });
  } catch (err) {
    if (notificationsEnabled) {
      notify({
        title: "❌ Swap Failed",
        subtitle: side === "buy" ? "Buy failed" : "Sell failed",
        message: err?.message || "Failed to build swap.",
        sound: "Basso",
      });
    }
    throw err instanceof SwapError ? err : new SwapError(`Swap failed: ${err.message || err}`, { cause: err });
  }

  let txid;
  try {
    const { signedBase64, signature } = await signSwapTransaction(signer, swapBuild.swapTransaction);
    const sendResult = await raptor.sendTransaction(signedBase64);
    txid = sendResult?.signature || signature;
    if (!txid) {
      throw new SwapError("Raptor send-transaction did not return a signature.");
    }
  } catch (err) {
    if (notificationsEnabled) {
      notify({
        title: "❌ Swap Failed",
        subtitle: side === "buy" ? "Buy failed" : "Sell failed",
        message: err?.message || "Swap failed during execution.",
        sound: "Basso",
      });
    }
    throw err instanceof SwapError ? err : new SwapError(`Swap failed: ${err.message || err}`, { cause: err });
  }

  const outDecimals = await getMintDecimals(rpc, outputMint).catch(() => (outputMint === WRAPPED_SOL_MINT ? 9 : 6));
  const amountOutRaw = quote?.amountOut ?? "0";
  const amountOutHuman = baseUnitsToHuman(BigInt(amountOutRaw), outDecimals);
  const fee = Number(quote?.feeAmount ?? 0);
  const priceImpact = quote?.priceImpact;

  let verificationStatus = "pending";
  try {
    const verified = await verifySwap(raptor, txid);
    verificationStatus = verified ? "confirmed" : "pending";
  } catch (err) {
    if (notificationsEnabled) {
      notify({
        title: "❌ Swap Failed",
        subtitle: side === "buy" ? "Buy failed" : "Sell failed",
        message: err?.message || "Swap failed during verification.",
        sound: "Basso",
      });
    }
    throw new SwapError(`Swap failed: ${err.message || err}`, { cause: err });
  }

  return {
    txid,
    quote,
    swapBuild,
    amountOutHuman,
    amountOutRaw,
    totalFees: fee,
    priceImpact,
    verificationStatus,
  };
}

/**
 * Buy tokens with SOL.
 */
export async function buyToken(mint, amountSol, context = {}) {
  const cfg = context?.cfg ?? await loadConfig();
  const notificationsEnabled = cfg.notificationsEnabled !== false;
  const result = await executeSwap({
    side: "buy",
    inputMint: WRAPPED_SOL_MINT,
    outputMint: mint,
    amount: amountSol,
    context: { cfg },
  });

  const shortMint = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const amountSolDisplay = typeof amountSol === "number"
    ? `${amountSol} SOL`
    : `${amountSol} of SOL balance`;
  const tokensReceivedDecimal = Number(result.amountOutHuman);
  if (notificationsEnabled) {
    notify({
      title: "🟢 Buy Completed",
      subtitle: `Token: ${shortMint}`,
      message: `Spent ${amountSolDisplay}\nReceived ${Number.isFinite(tokensReceivedDecimal) ? tokensReceivedDecimal.toFixed(4) : result.amountOutHuman} tokens`,
      sound: "Ping",
    });
  }
  return {
    txid: result.txid,
    tokensReceivedDecimal: Number.isFinite(tokensReceivedDecimal) ? tokensReceivedDecimal : 0,
    totalFees: result.totalFees,
    priceImpact: result.priceImpact,
    quote: result.quote,
    verificationStatus: result.verificationStatus,
  };
}

/**
 * Sell tokens for SOL.
 */
export async function sellToken(mint, amount, context = {}) {
  const cfg = context?.cfg ?? await loadConfig();
  const notificationsEnabled = cfg.notificationsEnabled !== false;
  const result = await executeSwap({
    side: "sell",
    inputMint: mint,
    outputMint: WRAPPED_SOL_MINT,
    amount,
    context: { cfg },
  });

  const shortMint = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const soldDisplay = amount === "auto" ? "full balance" : amount;
  const solReceivedDecimal = Number(result.amountOutHuman);
  if (notificationsEnabled) {
    notify({
      title: "🔴 Sell Completed",
      subtitle: `Token: ${shortMint}`,
      message: `Sold ${soldDisplay} tokens\nReceived ${Number.isFinite(solReceivedDecimal) ? solReceivedDecimal.toFixed(4) : result.amountOutHuman} SOL`,
      sound: "Ping",
    });
  }
  return {
    txid: result.txid,
    solReceivedDecimal: Number.isFinite(solReceivedDecimal) ? solReceivedDecimal : 0,
    totalFees: result.totalFees,
    priceImpact: result.priceImpact,
    quote: result.quote,
    verificationStatus: result.verificationStatus,
  };
}
