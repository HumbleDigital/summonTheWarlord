import { SwapError } from "./errors.js";

/** Canonical Raptor priorityFee level strings (wire form). */
const LEVEL_CANONICAL = {
  auto: "auto",
  min: "min",
  low: "low",
  medium: "medium",
  high: "high",
  veryhigh: "veryHigh",
  turbo: "turbo",
  unsafemax: "unsafeMax",
};

/**
 * @param {string} raw
 * @returns {string|null}
 */
export function canonicalizePriorityLevel(raw) {
  if (raw == null || raw === "") return null;
  const key = String(raw).trim().toLowerCase().replace(/_/g, "");
  return LEVEL_CANONICAL[key] ?? null;
}

/**
 * Map config txVersion (v0|legacy) to Raptor enum (V0|LEGACY).
 * @param {string} [txVersion]
 */
export function mapTxVersionForRaptor(txVersion) {
  const v = String(txVersion || "v0").trim().toLowerCase();
  if (v === "v0" || v === "0") return "V0";
  if (v === "legacy") return "LEGACY";
  if (v === "V0" || txVersion === "V0") return "V0";
  if (String(txVersion).toUpperCase() === "LEGACY") return "LEGACY";
  throw new SwapError(`Invalid txVersion: ${txVersion}`);
}

/**
 * Map priority fee config to Raptor priorityFee field.
 *
 * Raptor accepts:
 * - level names: auto | min | low | medium | high | veryHigh | turbo | unsafeMax
 * - exact microlamports (numeric string)
 *
 * CLI semantics:
 * - priorityFee "auto" → send priorityFeeLevel (default "auto" = Raptor Auto tier)
 * - priorityFee level name → send that level
 * - priorityFee number → microlamports
 *
 * @param {object} cfg
 * @returns {{ priorityFee: string }}
 */
export function mapPriorityFeeForRaptor(cfg) {
  const pf = cfg?.priorityFee;

  if (pf === undefined || pf === null || pf === "") {
    const fromLevel = canonicalizePriorityLevel(cfg?.priorityFeeLevel || "auto");
    return { priorityFee: fromLevel || "auto" };
  }

  if (typeof pf === "string") {
    const lowered = pf.trim().toLowerCase();
    // Explicit "auto" means defer to priorityFeeLevel (Raptor's adaptive tier selector).
    if (lowered === "auto") {
      const fromLevel = canonicalizePriorityLevel(cfg?.priorityFeeLevel || "auto");
      return { priorityFee: fromLevel || "auto" };
    }
    const asLevel = canonicalizePriorityLevel(pf);
    if (asLevel) {
      return { priorityFee: asLevel };
    }
  }

  const num = Number(pf);
  if (!Number.isFinite(num) || num < 0) {
    throw new SwapError(`Invalid priorityFee: ${pf}`);
  }
  return { priorityFee: String(Math.round(num)) };
}
