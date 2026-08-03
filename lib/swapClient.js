import { SolanaTracker } from "solana-swap";
import { loadConfig } from "./config.js";
import { logger } from "../utils/logger.js";
import { ConfigError, SwapError } from "./errors.js";
import { notify } from "../utils/notify.js";

const SWAP_DISCOUNT_CODE = "jduck-d815-4c28-b85d-17e9fc3a21a8";

let clientPromise = null;
let clientFactory = defaultFactory;
let memoizedRpcUrl = null;
let warnedOnConflictingCfg = false;

export function ensureAdvancedTx(rpcUrl) {
  if (!rpcUrl || typeof rpcUrl !== "string") {
    throw new ConfigError("RPC URL is missing or invalid.");
  }
  if (rpcUrl.includes("advancedTx")) {
    return rpcUrl;
  }
  const separator = rpcUrl.includes("?") ? "&" : "?";
  return `${rpcUrl}${separator}advancedTx=true`;
}

export function setSwapClientFactory(factory) {
  clientFactory = factory;
  clientPromise = null;
  memoizedRpcUrl = null;
  warnedOnConflictingCfg = false;
}

function getConfigRpcUrl(cfg) {
  if (!cfg || typeof cfg !== "object" || typeof cfg.rpcUrl !== "string") {
    return null;
  }
  try {
    return ensureAdvancedTx(cfg.rpcUrl);
  } catch {
    // Keep getSwapClient backward-compatible: ignore unusable cfg hints once client is memoized.
    return null;
  }
}

/**
 * Returns the shared swap client instance.
 * `options.cfg` is only consumed during initial client creation; subsequent calls always reuse
 * the memoized client to preserve existing behavior.
 */
export async function getSwapClient(options = {}) {
  const requestedRpcUrl = getConfigRpcUrl(options?.cfg);

  if (!clientPromise) {
    memoizedRpcUrl = requestedRpcUrl;
    clientPromise = clientFactory(options).catch((err) => {
      clientPromise = null;
      memoizedRpcUrl = null;
      warnedOnConflictingCfg = false;
      throw err;
    });
  } else if (
    requestedRpcUrl
    && memoizedRpcUrl
    && requestedRpcUrl !== memoizedRpcUrl
    && !warnedOnConflictingCfg
  ) {
    warnedOnConflictingCfg = true;
    logger.warn(
      "getSwapClient received cfg.rpcUrl that differs from the memoized client; reusing existing client."
    );
  }

  return clientPromise;
}

async function defaultFactory(options = {}) {
  const cfg = options.cfg ?? await loadConfig();
  const { getPrivateKey } = await import("../utils/keychain.js");
  let raw;
  try {
    raw = await getPrivateKey();
  } catch (err) {
    if (cfg.notificationsEnabled !== false) {
      notify({
        title: "🔑 Keychain Missing",
        subtitle: "No private key found",
        message: "Run `summon keychain store` to add your wallet.",
        sound: "Ping",
      });
    }
    throw err;
  }

  // Lazy-load heavy deps only when needed
  const [{ Keypair }, { parsePrivateKeyToSecretKey }] = await Promise.all([
    import("@solana/web3.js"),
    import("./privateKey.js"),
  ]);

  // Do NOT wipe secretBytes after fromSecretKey: web3.js Keypair retains the
  // same Uint8Array reference for secretKey (no copy). Zeroing it would break
  // all signing for the process lifetime. Drop the string only.
  const secretBytes = parsePrivateKeyToSecretKey(raw);
  const keypair = Keypair.fromSecretKey(secretBytes);
  raw = "";

  const rpcUrl = ensureAdvancedTx(cfg.rpcUrl);
  const apiKey = SWAP_DISCOUNT_CODE;
  // Debug only when explicitly enabled in config — never via NODE_ENV
  const debugEnabled = Boolean(cfg.DEBUG_MODE);

  try {
    const tracker = new SolanaTracker(keypair, rpcUrl, apiKey, debugEnabled);
    if (debugEnabled && typeof tracker.setDebug === "function") {
      tracker.setDebug(true);
    }
    return tracker;
  } catch (err) {
    logger.error("Failed to initialize swap client.", { error: err?.message });
    throw new SwapError("Unable to initialize swap client.", { cause: err });
  }
}
