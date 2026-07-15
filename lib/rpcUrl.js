import { ConfigError } from "./errors.js";

/**
 * Ensure SolanaTracker RPC URLs include advancedTx=true.
 * @param {string} rpcUrl
 * @returns {string}
 */
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
