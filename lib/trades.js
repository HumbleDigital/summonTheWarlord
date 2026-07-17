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

// Keep monitoring long enough to observe Raptor's terminal send outcome.
const VERIFY_DELAY_SCHEDULE_MS = [
  500,
  1000,
  2000,
  3000,
  4000,
  5000,
  5000,
  5000,
  5000,
  5000,
  5000,
  5000,
  5000,
  5000,
  5000,
];
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

const RAPTOR_ERROR_MESSAGES = {
  1: "Insufficient funds or slippage exceeded",
  2: "Invalid account state or permissions",
  3: "Invalid instruction data or parameters",
  6001: "Slippage exceeded — minimum return not reached",
  6002: "Insufficient funds for transaction",
  6003: "Invalid route or pool",
  6004: "Slippage tolerance too low",
};

function decodeRaptorError(error) {
  const raw = String(error ?? "");
  const match = raw.match(/\[([\d,\s]+)\]/);
  if (!match) return raw;

  const bytes = match[1].split(",").map((value) => Number(value.trim()));
  if (bytes.length < 13 || bytes.some((value) => !Number.isInteger(value) || value < 0)) return raw;

  const instructionIndex = bytes[4];
  const customCode = bytes.slice(9, 13).reduce((total, value, index) => total + value * (256 ** index), 0);
  const message = RAPTOR_ERROR_MESSAGES[customCode] || `Custom program error 0x${customCode.toString(16)}`;
  return `Instruction ${instructionIndex}: ${message} (code ${customCode})`;
}

function formatRaptorResponseError(response, fallback = "unknown error") {
  const reason = decodeRaptorError(response?.error || response?.message || fallback);
  const code = response?.code != null ? ` (code ${response.code})` : "";
  return `${reason}${code}`;
}

function formatOnChainError(error) {
  if (error && typeof error === "object" && Array.isArray(error.InstructionError)) {
    const [instructionIndex, instructionError] = error.InstructionError;
    if (instructionError?.Custom != null) {
      const code = Number(instructionError.Custom);
      const message = RAPTOR_ERROR_MESSAGES[code] || `Custom program error 0x${code.toString(16)}`;
      return `Instruction ${instructionIndex}: ${message} (code ${code})`;
    }
  }
  return decodeRaptorError(typeof error === "string" ? error : JSON.stringify(error));
}

async function getOnChainSignatureStatus(rpc, txid, debugLog) {
  const { value } = await rpc
    .getSignatureStatuses([txid], { searchTransactionHistory: true })
    .send();
  const status = value?.[0] ?? null;
  await debugLog?.write("solana.transaction_status", { txid, status });
  return status;
}

async function verifySwap(raptor, rpc, txid, debugLog) {
  const check = async () => {
    let raptorDetails = null;
    try {
      raptorDetails = await raptor.getTransactionStatus(txid);
      await debugLog?.write("raptor.transaction_status", { response: raptorDetails });
      const status = String(raptorDetails?.status || "").toLowerCase();
      if (status === "failed" || status === "failure" || status === "error") {
        throw new SwapError(
          `Raptor reported transaction failure: ${formatRaptorResponseError(raptorDetails, status)}`,
          { details: { raptor: raptorDetails } }
        );
      }
      if (status === "expired") {
        throw new SwapError(
          `Raptor reported transaction expired: ${formatRaptorResponseError(raptorDetails, "expired")}`,
          { details: { raptor: raptorDetails } }
        );
      }
    } catch (err) {
      const status = err?.status ?? err?.statusCode;
      if (err instanceof SwapError && ![404, 408, 425, 429, 500, 502, 503, 504].includes(status)) {
        throw err;
      }
      await debugLog?.write("raptor.transaction_status_error", { txid, error: err });
    }

    let onChainStatus = null;
    try {
      onChainStatus = await getOnChainSignatureStatus(rpc, txid, debugLog);
    } catch (err) {
      await debugLog?.write("solana.transaction_status_error", { txid, error: err });
    }

    if (onChainStatus?.err != null) {
      throw new SwapError(
        `Solana rejected transaction: ${formatOnChainError(onChainStatus.err)}`,
        { details: { solana: onChainStatus, raptor: raptorDetails } }
      );
    }
    if (["processed", "confirmed", "finalized"].includes(onChainStatus?.confirmationStatus)) {
      return "confirmed";
    }
    return "pending";
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
  const debugLog = context?.debugLog;
  const debugEnabled = Boolean(cfg.DEBUG_MODE || process.env.NODE_ENV === "development");
  const notificationsEnabled = cfg.notificationsEnabled !== false;

  const amountBase = await resolveInputAmountBaseUnits({
    side,
    amount,
    inputMint,
    rpc,
    owner: signer.address,
  });
  await debugLog?.write("swap.amount_resolved", { side, inputMint, outputMint, amountBase });

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
    await debugLog?.write("raptor.quote_received", { quoteQuery, quote });
    if (debugEnabled || cfg.showQuoteDetails) {
      console.log(JSON.stringify({ quote }, null, 2));
    }
    const buildRequest = {
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
    };
    await debugLog?.write("raptor.swap_requested", buildRequest);
    swapBuild = await raptor.buildSwap(buildRequest);
  } catch (err) {
    await debugLog?.write("raptor.swap_failed", { error: err });
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
    const { signedBase64, signature: localSignature } = await signSwapTransaction(
      signer,
      swapBuild.swapTransaction
    );
    const sendResult = await raptor.sendTransaction(signedBase64);
    await debugLog?.write("raptor.transaction_response", { response: sendResult });
    const sendStatus = String(sendResult?.status || "").toLowerCase();
    if (
      sendResult?.success === false
      || sendResult?.error
      || ["failed", "failure", "error", "rejected", "expired"].includes(sendStatus)
    ) {
      throw new SwapError(
        `Raptor rejected the transaction: ${formatRaptorResponseError(sendResult)}`
      );
    }
    if (sendResult?.success !== true) {
      throw new SwapError("Raptor did not explicitly accept the transaction.");
    }
    txid = sendResult?.signature;
    if (!txid) {
      throw new SwapError("Raptor send-transaction did not return a signature.");
    }
    const signatureMatch = txid === localSignature;
    await debugLog?.write("raptor.send_accepted", { txid, signatureMatch });
    if (!signatureMatch) {
      throw new SwapError("Raptor accepted a transaction with a different signature than the signed payload.");
    }
    await debugLog?.write("raptor.transaction_queued", { txid });
  } catch (err) {
    await debugLog?.write("raptor.transaction_send_failed", { error: err });
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
    const verified = await verifySwap(raptor, rpc, txid, debugLog);
    if (!verified) {
      await debugLog?.write("transaction.unconfirmed", { txid, reason: "not_seen_on_chain" });
      throw new SwapError(
        `Raptor accepted transaction ${txid}, but Solana did not report it on-chain before monitoring timed out.`
      );
    }
    verificationStatus = "confirmed";
    await debugLog?.write("raptor.transaction_verified", { txid, verificationStatus });
  } catch (err) {
    await debugLog?.write("raptor.transaction_verification_failed", { txid, error: err });
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

  await debugLog?.write("swap.completed", {
    side,
    inputMint,
    outputMint,
    txid,
    amountOutHuman,
    amountOutRaw,
    verificationStatus,
  });

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
    context: { cfg, debugLog: context?.debugLog },
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
    context: { cfg, debugLog: context?.debugLog },
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
