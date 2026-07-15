import { loadConfig } from "./config.js";
import { logger } from "../utils/logger.js";
import { ConfigError, SwapError } from "./errors.js";
import { notify } from "../utils/notify.js";
import { RaptorClient } from "./raptorClient.js";
import { createRpc, loadWalletSigner } from "./wallet.js";
import { ensureAdvancedTx } from "./rpcUrl.js";
import { getRaptorApiKey } from "../utils/keychain.js";
import { DEFAULT_RAPTOR_BASE_URL } from "./constants.js";

export { ensureAdvancedTx } from "./rpcUrl.js";

let clientPromise = null;
let clientFactory = defaultFactory;
let memoizedRpcUrl = null;
let memoizedRaptorBase = null;
let warnedOnConflictingCfg = false;

/**
 * @typedef {object} SwapContext
 * @property {object} cfg
 * @property {import('@solana/kit').KeyPairSigner} signer
 * @property {string} publicKey
 * @property {import('@solana/kit').Rpc<any>} rpc
 * @property {RaptorClient} raptor
 */

export function setSwapClientFactory(factory) {
  clientFactory = factory;
  clientPromise = null;
  memoizedRpcUrl = null;
  memoizedRaptorBase = null;
  warnedOnConflictingCfg = false;
}

function getConfigRpcUrl(cfg) {
  if (!cfg || typeof cfg !== "object" || typeof cfg.rpcUrl !== "string") {
    return null;
  }
  try {
    return ensureAdvancedTx(cfg.rpcUrl);
  } catch {
    return null;
  }
}

function getRaptorBase(cfg) {
  if (!cfg || typeof cfg !== "object") return DEFAULT_RAPTOR_BASE_URL;
  return String(cfg.raptorBaseUrl || DEFAULT_RAPTOR_BASE_URL).replace(/\/+$/, "");
}

/**
 * Returns the shared swap context (wallet + rpc + raptor).
 * `options.cfg` is only consumed during initial creation.
 * @param {{ cfg?: object }} [options]
 * @returns {Promise<SwapContext>}
 */
export async function getSwapClient(options = {}) {
  const requestedRpcUrl = getConfigRpcUrl(options?.cfg);
  const requestedRaptorBase = options?.cfg ? getRaptorBase(options.cfg) : null;

  if (!clientPromise) {
    memoizedRpcUrl = requestedRpcUrl;
    memoizedRaptorBase = requestedRaptorBase;
    clientPromise = clientFactory(options).catch((err) => {
      clientPromise = null;
      memoizedRpcUrl = null;
      memoizedRaptorBase = null;
      warnedOnConflictingCfg = false;
      throw err;
    });
  } else if (
    !warnedOnConflictingCfg
    && (
      (requestedRpcUrl && memoizedRpcUrl && requestedRpcUrl !== memoizedRpcUrl)
      || (requestedRaptorBase && memoizedRaptorBase && requestedRaptorBase !== memoizedRaptorBase)
    )
  ) {
    warnedOnConflictingCfg = true;
    logger.warn(
      "getSwapClient received cfg that differs from the memoized client; reusing existing client."
    );
  }

  return clientPromise;
}

async function defaultFactory(options = {}) {
  const cfg = options.cfg ?? await loadConfig();
  let rawKey;
  try {
    rawKey = await getRaptorApiKey();
  } catch (err) {
    if (cfg.notificationsEnabled !== false) {
      notify({
        title: "🔑 Raptor API Key Missing",
        subtitle: "No API key found",
        message: "Run `summon keychain store-api-key` to add your Raptor API key.",
        sound: "Ping",
      });
    }
    throw err;
  }

  let signer;
  try {
    signer = await loadWalletSigner();
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

  const rpcUrl = ensureAdvancedTx(cfg.rpcUrl);
  if (!rpcUrl) {
    throw new ConfigError("RPC URL is missing or invalid.");
  }

  try {
    const rpc = createRpc(rpcUrl);
    const raptor = new RaptorClient({
      baseUrl: getRaptorBase(cfg),
      apiKey: rawKey,
    });
    return {
      cfg,
      signer,
      publicKey: signer.address,
      rpc,
      raptor,
    };
  } catch (err) {
    logger.error("Failed to initialize swap client.", { error: err?.message });
    throw new SwapError("Unable to initialize swap client.", { cause: err });
  }
}
