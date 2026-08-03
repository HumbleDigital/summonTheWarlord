import { loadConfig } from "./config.js";
import { getPrivateKey } from "../utils/keychain.js";
import { notify } from "../utils/notify.js";
import { ensureAdvancedTx, getSwapClient } from "./swapClient.js";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const TRUMP_MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";
const MIN_SWAP_SOL = 0.0001;

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
    await getPrivateKey();
    return { ok: true, result: makeResult("keychain", "ok", "Private key accessible.") };
  } catch (err) {
    const message = err?.message || "";
    const missing = /not found/i.test(message);
    return {
      ok: false,
      result: makeResult(
        "keychain",
        "fail",
        missing ? "No private key stored." : "Unable to read private key.",
        missing ? undefined : message,
        "Run `summon keychain store`."
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

async function checkSwapApi(cfg, keychainOk) {
  if (!cfg) {
    return makeResult("swap", "skip", "Swap check skipped (config unavailable).");
  }
  if (!keychainOk) {
    return makeResult("swap", "skip", "Swap check skipped (missing keychain).");
  }
  try {
    const tracker = await getSwapClient();
    const opts = {
      txVersion: cfg.txVersion || "v0",
      priorityFeeLevel: cfg.priorityFeeLevel || "medium",
      fee: { wallet: "8aBKXBErcp1Bi5LmaeGnaXCj9ot7PE4T2wuqHQfeT5E6", percentage: 0.4 },
      feeType: "add",
    };
    const swapResp = await tracker.getSwapInstructions(
      WRAPPED_SOL_MINT,
      TRUMP_MINT,
      MIN_SWAP_SOL,
      cfg.slippage,
      tracker.keypair.publicKey.toBase58(),
      cfg.priorityFee,
      false,
      opts
    );
    const quote = swapResp?.quote ?? swapResp?.rate;
    if (!quote) {
      return makeResult(
        "swap",
        "fail",
        "Swap API response missing quote.",
        undefined,
        "Rerun `summon doctor -v` and verify SolanaTracker account/RPC."
      );
    }
    return makeResult("swap", "ok", "Swap API reachable.");
  } catch (err) {
    return makeResult(
      "swap",
      "fail",
      "Swap API check failed.",
      err?.message,
      "Rerun `summon doctor -v` and verify SolanaTracker account/RPC."
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

export async function runDoctor({ verbose = false } = {}) {
  const results = [];
  const { cfg, result: configResult } = await checkConfig();
  results.push(configResult);

  const { ok: keychainOk, result: keychainResult } = await checkKeychain();
  results.push(keychainResult);

  const rpcResult = await checkRpc(cfg?.rpcUrl);
  results.push(rpcResult);

  const swapResult = await checkSwapApi(cfg, keychainOk);
  results.push(swapResult);

  const notifyResult = await checkNotifications(cfg);
  results.push(notifyResult);

  if (verbose) {
    return results.map((item) => ({
      ...item,
      details: item.details || undefined,
      hint: item.hint || undefined,
    }));
  }
  return results;
}
