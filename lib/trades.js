import { notify } from "../utils/notify.js";
import { loadConfig } from "./config.js";
import { SwapError } from "./errors.js";
import { buildPerformSwapOptions } from "./executionMode.js";
import { getSwapClient } from "./swapClient.js";

// Wrapped SOL mint address on Solana
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const VERIFY_DELAY_SCHEDULE_MS = [500, 1000, 2000, 3000, 4000, 5000];
const CONFIRMED_TRANSACTION_STATUSES = new Set([
  "processed",
  "confirmed",
  "finalized",
  "success",
  "succeeded",
  "ok",
]);
const FAILED_TRANSACTION_STATUSES = new Set([
  "failed",
  "failure",
  "error",
  "errored",
  "reverted",
  "dropped",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasOwn = (value, key) => Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

function formatTransactionError(err) {
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function classifyTransactionStatus(status) {
  if (status == null) {
    return "unknown";
  }

  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    if (CONFIRMED_TRANSACTION_STATUSES.has(normalized)) {
      return "confirmed";
    }
    if (FAILED_TRANSACTION_STATUSES.has(normalized)) {
      return "failed";
    }
    return "unknown";
  }

  if (typeof status === "object") {
    if ((hasOwn(status, "Err") && status.Err != null)
      || (hasOwn(status, "err") && status.err != null)
      || (hasOwn(status, "error") && status.error != null)) {
      return "failed";
    }
    if (hasOwn(status, "Ok")) {
      return "confirmed";
    }
    if (hasOwn(status, "confirmationStatus")) {
      return classifyTransactionStatus(status.confirmationStatus);
    }
    if (hasOwn(status, "status")) {
      return classifyTransactionStatus(status.status);
    }
  }

  return "unknown";
}

function extractStatusError(status) {
  if (status == null) {
    return "unknown transaction status";
  }
  if (typeof status === "string") {
    return status;
  }
  if (typeof status === "object") {
    return status.Err ?? status.err ?? status.error ?? status;
  }
  return status;
}

function getVerificationState(details) {
  if (!details) {
    return "pending";
  }

  const hasMetaErr = hasOwn(details.meta, "err");
  if (hasMetaErr && details.meta.err != null) {
    throw new Error(`Transaction failed: ${formatTransactionError(details.meta.err)}`);
  }
  if (hasMetaErr && details.meta.err === null) {
    return "confirmed";
  }

  const directErrors = [details.err, details.error, details.value?.err, details.value?.error];
  for (const err of directErrors) {
    if (err != null) {
      throw new Error(`Transaction failed: ${formatTransactionError(err)}`);
    }
  }

  const statusCandidates = [
    details.confirmationStatus,
    details.status,
    details.meta?.status,
    details.value?.confirmationStatus,
    details.value?.status,
  ];
  const hasStatusHint = statusCandidates.some((status) => status != null);

  for (const status of statusCandidates) {
    const state = classifyTransactionStatus(status);
    if (state === "confirmed") {
      return "confirmed";
    }
    if (state === "failed") {
      throw new Error(`Transaction failed: ${formatTransactionError(extractStatusError(status))}`);
    }
  }

  if (!hasStatusHint && details.meta && typeof details.meta === "object") {
    return "confirmed";
  }

  return "pending";
}

function isTransientTransactionDetailsError(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (typeof status === "number" && [408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const code = String(err?.code ?? "").toUpperCase();
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
    return true;
  }

  const message = String(err?.message ?? err ?? "").toLowerCase();
  return [
    "timeout",
    "timed out",
    "network",
    "fetch failed",
    "socket hang up",
    "temporarily unavailable",
    "too many requests",
    "rate limit",
  ].some((needle) => message.includes(needle));
}

async function verifySwap(tracker, txid) {
  const checkDetails = async () => {
    let details;
    try {
      details = await tracker.getTransactionDetails(txid);
    } catch (err) {
      if (isTransientTransactionDetailsError(err)) {
        return "pending";
      }
      throw err;
    }

    return getVerificationState(details);
  };

  const immediateState = await checkDetails();
  if (immediateState === "confirmed") {
    return true;
  }

  for (const waitMs of VERIFY_DELAY_SCHEDULE_MS) {
    await sleep(waitMs);
    const state = await checkDetails();
    if (state === "confirmed") {
      return true;
    }
  }

  return false;
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

  // Advanced opts: keep HTTP-only; include txVersion/priority level; include software fee here
  const opts = {
    txVersion: cfg.txVersion || "v0",
    priorityFeeLevel,
    fee: { wallet: "8aBKXBErcp1Bi5LmaeGnaXCj9ot7PE4T2wuqHQfeT5E6", percentage: 0.4 }, // 0.4%
    feeType: "add"
    // other optional flags that you may expose later:
    // onlyDirectRoutes: false,
    // customTip: undefined,
  };

  // Build swap instructions: WSOL -> target token
  const swapResp = await tracker.getSwapInstructions(
    WRAPPED_SOL_MINT,
    mint,
    amountSol,                         // supports numbers, "auto", or "NN%"
    slippage,
    tracker.keypair.publicKey.toBase58(),
    priorityFeeArg,
    false,                             // forceLegacy; keep false when using txVersion in opts
    opts
  );

  // Execute the swap (HTTP polling only; no websockets)
  let txid;
  try {
    const performOpts = buildPerformSwapOptions(cfg);
    const result = await tracker.performSwap(swapResp, performOpts);
    txid = result.signature ?? result;
  } catch (err) {
    if (notificationsEnabled) {
      notify({
        title: "❌ Swap Failed",
        subtitle: "Buy failed",
        message: err?.message || "Swap failed during execution.",
        sound: "Basso",
      });
    }
    throw new SwapError(`Swap failed: ${err.message || err}`, { cause: err });
  }

  // Normalize quote/rate and extract received tokens
  const quote = swapResp.quote ?? swapResp.rate ?? {};
  const tokensReceivedDecimal = Number(quote.amountOut ?? 0);
  const fee = Number(quote.fee ?? 0);
  const platformFee = Number(quote.platformFeeUI ?? 0);
  const totalFees = fee + platformFee;
  const priceImpact = quote.priceImpact;

  let verificationStatus = "pending";
  try {
    const verified = await verifySwap(tracker, txid);
    verificationStatus = verified ? "confirmed" : "pending";
  } catch (err) {
    if (notificationsEnabled) {
      notify({
        title: "❌ Swap Failed",
        subtitle: "Buy failed",
        message: err?.message || "Swap failed during verification.",
        sound: "Basso",
      });
    }
    throw new SwapError(`Swap failed: ${err.message || err}`, { cause: err });
  }

  const shortMint = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const amountSolDisplay = typeof amountSol === "number"
    ? `${amountSol} SOL`
    : `${amountSol} of SOL balance`;
  if (notificationsEnabled) {
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
    // add operator fee to sells as well:
    fee: { wallet: "8aBKXBErcp1Bi5LmaeGnaXCj9ot7PE4T2wuqHQfeT5E6", percentage: 0.4 }, // 0.4%
    feeType: "deduct"
  };

  // Build swap instructions: token -> WSOL
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

  // Execute the swap (HTTP polling only; no websockets)
  let txid;
  try {
    const performOpts = buildPerformSwapOptions(cfg);
    const result = await tracker.performSwap(swapResp, performOpts);
    txid = result.signature ?? result;
  } catch (err) {
    if (notificationsEnabled) {
      notify({
        title: "❌ Swap Failed",
        subtitle: "Sell failed",
        message: err?.message || "Swap failed during execution.",
        sound: "Basso",
      });
    }
    throw new SwapError(`Swap failed: ${err.message || err}`, { cause: err });
  }

  // Normalize quote/rate and extract SOL received
  const quote = swapResp.quote ?? swapResp.rate ?? {};
  const solReceivedDecimal = Number(quote.outAmount ?? quote.amountOut ?? 0);
  const fee = Number(quote.fee ?? 0);
  const platformFee = Number(quote.platformFeeUI ?? 0);
  const totalFees = fee + platformFee;
  const priceImpact = quote.priceImpact;

  let verificationStatus = "pending";
  try {
    const verified = await verifySwap(tracker, txid);
    verificationStatus = verified ? "confirmed" : "pending";
  } catch (err) {
    if (notificationsEnabled) {
      notify({
        title: "❌ Swap Failed",
        subtitle: "Sell failed",
        message: err?.message || "Swap failed during verification.",
        sound: "Basso",
      });
    }
    throw new SwapError(`Swap failed: ${err.message || err}`, { cause: err });
  }

  const shortMint = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const soldDisplay = amount === "auto" ? "full balance" : amount;
  if (notificationsEnabled) {
    notify({
      title: "🔴 Sell Completed",
      subtitle: `Token: ${shortMint}`,
      message: `Sold ${soldDisplay} tokens\nReceived ${solReceivedDecimal.toFixed(4)} SOL`,
      sound: "Ping",
    });
  }
  return { txid, solReceivedDecimal, totalFees, priceImpact, quote, verificationStatus };
}
