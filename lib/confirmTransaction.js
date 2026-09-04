const CONFIRMED_STATUSES = new Set(["processed", "confirmed", "finalized"]);

export const CONFIRM_DELAY_SCHEDULE_MS = Object.freeze([
  1000,
  2000,
  4000,
  8000,
  10000,
  12000,
  13000,
]);

export const ON_CHAIN_FAILED_MESSAGE = "Transaction failed on-chain. Check the explorer.";
export const CONFIRMATION_TIMEOUT_INFO =
  "Confirmation timed out after 50s. Check the explorer — the swap may still have landed.";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function classifySignatureStatus(value) {
  if (value == null) {
    return "pending";
  }

  if (value.err != null) {
    return "failed";
  }

  if (CONFIRMED_STATUSES.has(value.confirmationStatus)) {
    return "confirmed";
  }

  return "pending";
}

export function extractSignatureFromError(err) {
  const message = String(err?.message ?? err ?? "");
  const match = message.match(/\b([1-9A-HJ-NP-Za-km-z]{87,88})\b/);
  return match ? match[1] : null;
}

export function isTransientSignatureStatusError(err) {
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

function unwrapStatusResult(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, "value")) {
    return result.value;
  }
  return result;
}

async function createRpcStatusFetcher(rpcUrl) {
  const [{ Connection }, { ensureAdvancedTx }] = await Promise.all([
    import("@solana/web3.js"),
    import("./swapClient.js"),
  ]);
  const connection = new Connection(ensureAdvancedTx(rpcUrl), "confirmed");
  return (signature) => connection.getSignatureStatus(signature);
}

export async function confirmTransaction({
  signature,
  rpcUrl,
  getSignatureStatus,
  delays = CONFIRM_DELAY_SCHEDULE_MS,
  sleep: sleepFn = sleep,
} = {}) {
  const fetchStatus = getSignatureStatus ?? (rpcUrl ? await createRpcStatusFetcher(rpcUrl) : null);
  if (typeof fetchStatus !== "function") {
    throw new Error("confirmTransaction requires getSignatureStatus or rpcUrl.");
  }

  const inspect = async () => {
    try {
      const result = await fetchStatus(signature);
      const value = unwrapStatusResult(result);
      return {
        status: classifySignatureStatus(value),
        err: value?.err ?? null,
      };
    } catch {
      return { status: "pending", err: null };
    }
  };

  let snapshot = await inspect();
  if (snapshot.status === "confirmed" || snapshot.status === "failed") {
    return snapshot;
  }

  for (const waitMs of delays) {
    await sleepFn(waitMs);
    snapshot = await inspect();
    if (snapshot.status === "confirmed" || snapshot.status === "failed") {
      return snapshot;
    }
  }

  return { status: "unknown", err: null };
}
