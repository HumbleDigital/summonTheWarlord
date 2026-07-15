import { SwapError } from "./errors.js";

const LEVELS = new Set([
  "min",
  "low",
  "medium",
  "high",
  "veryhigh",
  "turbo",
  "unsafemax",
  "auto",
]);

/**
 * Map config txVersion (v0|legacy) to Raptor enum (V0|LEGACY).
 * @param {string} [txVersion]
 */
export function mapTxVersionForRaptor(txVersion) {
  const v = String(txVersion || "v0").trim().toLowerCase();
  if (v === "v0" || v === "0") return "V0";
  if (v === "legacy") return "LEGACY";
  // already API form
  if (v === "V0" || txVersion === "V0") return "V0";
  if (String(txVersion).toUpperCase() === "LEGACY") return "LEGACY";
  throw new SwapError(`Invalid txVersion: ${txVersion}`);
}

/**
 * Map priority fee config to Raptor priorityFee field.
 * - priorityFee "auto" → priorityFeeLevel string (medium, high, …)
 * - priorityFee number → microlamports (integer string/number)
 * @param {object} cfg
 */
export function mapPriorityFeeForRaptor(cfg) {
  const levelRaw = String(cfg?.priorityFeeLevel || "medium").trim();
  const levelKey = levelRaw.toLowerCase().replace(/_/g, "");
  const levelOut = levelKey === "veryhigh"
    ? "veryHigh"
    : levelKey === "unsafemax"
      ? "unsafeMax"
      : levelRaw;

  const pf = cfg?.priorityFee;
  if (pf === undefined || pf === null || pf === "" || (typeof pf === "string" && pf.trim().toLowerCase() === "auto")) {
    return { priorityFee: levelOut };
  }
  if (typeof pf === "string" && LEVELS.has(pf.trim().toLowerCase().replace(/_/g, ""))) {
    const k = pf.trim().toLowerCase().replace(/_/g, "");
    return {
      priorityFee: k === "veryhigh" ? "veryHigh" : k === "unsafemax" ? "unsafeMax" : pf.trim(),
    };
  }
  const num = Number(pf);
  if (!Number.isFinite(num) || num < 0) {
    throw new SwapError(`Invalid priorityFee: ${pf}`);
  }
  // Numeric values are treated as microlamports for Raptor.
  return { priorityFee: String(Math.round(num)) };
}
