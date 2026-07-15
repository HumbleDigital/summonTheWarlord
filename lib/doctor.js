import { loadConfig } from "./config.js";
import {
  getPrivateKey,
  hasPrivateKey,
  hasRaptorApiKey,
  getRaptorApiKey,
} from "../utils/keychain.js";
import { notify } from "../utils/notify.js";
import { ensureAdvancedTx, getSwapClient } from "./swapClient.js";
import { RaptorClient } from "./raptorClient.js";
import { WRAPPED_SOL_MINT } from "./constants.js";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MIN_SWAP_LAMPORTS = "100000"; // 0.0001 SOL

function makeResult(name, status, message, details, hint) {
  return { name, status, message, details, hint };
}

async function checkConfig() {
  try {
    const cfg = await loadConfig();
    return { cfg, result: makeResult("config", "ok", "Loaded and normalized config.") };
  } catch (err) {
    return {
      cfg: null,
      result: makeResult(
        "config",
        "fail",
        "Failed to load config.",
        err?.message,
        "Run `summon setup` or `summon config wizard`."
      ),
    };
  }
}

async function checkKeychain() {
  try {
    const exists = await hasPrivateKey();
    if (!exists) {
      return {
        ok: false,
        result: makeResult(
          "keychain",
          "fail",
          "No private key stored.",
          undefined,
          "Run `summon keychain store`."
        ),
      };
    }
    await getPrivateKey();
    return { ok: true, result: makeResult("keychain", "ok", "Private key accessible.") };
  } catch (err) {
    return {
      ok: false,
      result: makeResult(
        "keychain",
        "fail",
        "Unable to read private key.",
        err?.message,
        "Run `summon keychain store`."
      ),
    };
  }
}

async function checkRaptorKey() {
  try {
    const exists = await hasRaptorApiKey();
    if (!exists) {
      return {
        ok: false,
        result: makeResult(
          "raptorKey",
          "fail",
          "No Raptor API key stored.",
          undefined,
          "Run `summon keychain store-api-key`."
        ),
      };
    }
    await getRaptorApiKey();
    return { ok: true, result: makeResult("raptorKey", "ok", "Raptor API key accessible.") };
  } catch (err) {
    return {
      ok: false,
      result: makeResult(
        "raptorKey",
        "fail",
        "Unable to read Raptor API key.",
        err?.message,
        "Run `summon keychain store-api-key`."
      ),
    };
  }
}

async function checkRpc(rpcUrl) {
  if (!rpcUrl) {
    return makeResult(
      "rpc",
      "fail",
      "RPC URL not configured.",
      undefined,
      "Update `rpcUrl` via `summon config wizard`."
    );
  }
  const healthUrl = ensureAdvancedTx(rpcUrl);
  try {
    const res = await fetch(healthUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
    });
    if (!res.ok) {
      return makeResult(
        "rpc",
        "fail",
        "RPC health check failed.",
        `HTTP ${res.status}`,
        "Update `rpcUrl` via `summon config wizard`."
      );
    }
    const body = await res.json();
    if (body.result !== "ok") {
      return makeResult(
        "rpc",
        "fail",
        "RPC returned unhealthy status.",
        JSON.stringify(body),
        "Update `rpcUrl` via `summon config wizard`."
      );
    }
    return makeResult("rpc", "ok", "RPC reachable.");
  } catch (err) {
    return makeResult(
      "rpc",
      "fail",
      "RPC health check error.",
      err?.message,
      "Update `rpcUrl` via `summon config wizard`."
    );
  }
}

async function checkSwapApi(cfg, keyOk) {
  if (!cfg) {
    return makeResult("swap", "skip", "Swap check skipped (config unavailable).");
  }
  if (!keyOk) {
    return makeResult("swap", "skip", "Swap check skipped (missing Raptor API key).");
  }
  try {
    const apiKey = await getRaptorApiKey();
    const raptor = new RaptorClient({
      baseUrl: cfg.raptorBaseUrl,
      apiKey,
    });
    await raptor.health();
    const quote = await raptor.getQuote({
      inputMint: WRAPPED_SOL_MINT,
      outputMint: USDC_MINT,
      amount: MIN_SWAP_LAMPORTS,
      slippageBps: "50",
    });
    if (!quote?.amountOut) {
      return makeResult(
        "swap",
        "fail",
        "Raptor quote response missing amountOut.",
        undefined,
        "Check raptorBaseUrl and API key; rerun `summon doctor -v`."
      );
    }
    return makeResult("swap", "ok", "Raptor swap API reachable.");
  } catch (err) {
    return makeResult(
      "swap",
      "fail",
      "Raptor swap API check failed.",
      err?.message,
      "Verify `raptorBaseUrl`, API key (`summon keychain store-api-key`), and network."
    );
  }
}

async function checkNotifications(cfg) {
  if (cfg?.notificationsEnabled === false) {
    return makeResult("notifications", "skip", "Notifications disabled in config.");
  }
  if (process.platform !== "darwin") {
    return makeResult("notifications", "skip", "Notifications are macOS-only.");
  }
  try {
    const ok = notify({
      title: "summonTheWarlord",
      subtitle: "Doctor check",
      message: "Notification test from summon doctor.",
      sound: "Ping",
      throwOnError: true,
    });
    if (!ok) {
      return makeResult(
        "notifications",
        "fail",
        "Notification failed.",
        undefined,
        "Enable terminal notifications or disable `notificationsEnabled`."
      );
    }
    return makeResult("notifications", "ok", "Notification sent.");
  } catch (err) {
    return makeResult(
      "notifications",
      "fail",
      "Notification failed.",
      err?.message,
      "Enable terminal notifications or disable `notificationsEnabled`."
    );
  }
}

async function checkWalletLoad(keychainOk) {
  if (!keychainOk) {
    return makeResult("wallet", "skip", "Wallet check skipped (missing keychain).");
  }
  try {
    // Light check: factory can load signer without trading
    const client = await getSwapClient();
    if (!client?.publicKey) {
      return makeResult("wallet", "fail", "Wallet signer missing public key.");
    }
    return makeResult("wallet", "ok", `Wallet loaded (${client.publicKey}).`);
  } catch (err) {
    return makeResult(
      "wallet",
      "fail",
      "Unable to load wallet signer.",
      err?.message,
      "Re-store private key with `summon keychain store`."
    );
  }
}

/**
 * @param {{ verbose?: boolean }} [options]
 * @returns {Promise<Array<{name:string,status:string,message:string,details?:string,hint?:string}>>}
 */
export async function runDoctor(options = {}) {
  const verbose = Boolean(options.verbose);
  const results = [];

  const { cfg, result: configResult } = await checkConfig();
  results.push(configResult);

  const keychain = await checkKeychain();
  results.push(keychain.result);

  const raptorKey = await checkRaptorKey();
  results.push(raptorKey.result);

  results.push(await checkRpc(cfg?.rpcUrl));
  results.push(await checkSwapApi(cfg, raptorKey.ok));

  if (raptorKey.ok && keychain.ok) {
    results.push(await checkWalletLoad(keychain.ok));
  } else {
    results.push(makeResult("wallet", "skip", "Wallet check skipped (missing secrets)."));
  }

  results.push(await checkNotifications(cfg));

  if (verbose) {
    return results.map((item) => ({
      ...item,
      details: item.details || undefined,
      hint: item.hint || undefined,
    }));
  }
  return results;
}
