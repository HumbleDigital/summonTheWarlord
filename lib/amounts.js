import { SwapError } from "./errors.js";
import {
  LAMPORTS_PER_SOL,
  SOL_RESERVE_LAMPORTS,
  WRAPPED_SOL_MINT,
} from "./constants.js";
import { asAddress } from "./wallet.js";

/**
 * @param {bigint} value
 * @returns {string}
 */
export function bigintToAmountString(value) {
  if (value < 0n) {
    throw new SwapError("Amount cannot be negative.");
  }
  return value.toString();
}

/**
 * Convert a human decimal string/number to base units.
 * @param {number|string} amount
 * @param {number} decimals
 */
export function humanToBaseUnits(amount, decimals) {
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new SwapError(`Invalid mint decimals: ${decimals}`);
  }
  const text = String(amount).trim();
  if (!text || text === "auto" || text.endsWith("%")) {
    throw new SwapError(`Cannot convert non-numeric amount to base units: ${amount}`);
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new SwapError(`Invalid amount: ${amount}`);
  }
  const [wholePart, fracPartRaw = ""] = text.split(".");
  if (fracPartRaw.length > decimals) {
    throw new SwapError(`Amount has more than ${decimals} decimal places.`);
  }
  const fracPart = fracPartRaw.padEnd(decimals, "0");
  const combined = `${wholePart}${fracPart}`.replace(/^0+(?=\d)/, "") || "0";
  return BigInt(combined);
}

/**
 * @param {bigint} baseUnits
 * @param {number} decimals
 * @param {number} [maxFrac=6]
 */
export function baseUnitsToHuman(baseUnits, decimals, maxFrac = 6) {
  const neg = baseUnits < 0n;
  const value = neg ? -baseUnits : baseUnits;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  let fracStr = frac.toString().padStart(decimals, "0");
  if (maxFrac < decimals) {
    fracStr = fracStr.slice(0, maxFrac);
  }
  fracStr = fracStr.replace(/0+$/, "");
  const out = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return neg ? `-${out}` : out;
}

/**
 * Map CLI slippage (% or auto) to Raptor slippageBps.
 * @param {number|string} slippage
 * @returns {string}
 */
export function toSlippageBps(slippage) {
  if (typeof slippage === "string" && slippage.trim().toLowerCase() === "auto") {
    return "dynamic";
  }
  const num = Number(slippage);
  if (!Number.isFinite(num) || num < 0) {
    throw new SwapError(`Invalid slippage: ${slippage}`);
  }
  // Config stores percent (10 = 10%). Raptor wants bps (1000 = 10%).
  return String(Math.round(num * 100));
}

/**
 * @param {import('@solana/kit').Rpc<any>} rpc
 * @param {import('@solana/kit').Address} owner
 */
export async function getSolLamports(rpc, owner) {
  const { value } = await rpc.getBalance(owner).send();
  return BigInt(value);
}

/**
 * @param {import('@solana/kit').Rpc<any>} rpc
 * @param {string} mint
 */
export async function getMintDecimals(rpc, mint) {
  if (mint === WRAPPED_SOL_MINT) {
    return 9;
  }
  const { value } = await rpc.getTokenSupply(asAddress(mint)).send();
  if (value == null || typeof value.decimals !== "number") {
    throw new SwapError(`Unable to read decimals for mint ${mint}`);
  }
  return value.decimals;
}

/**
 * Sum token account amounts for owner+mint.
 * @param {import('@solana/kit').Rpc<any>} rpc
 * @param {import('@solana/kit').Address} owner
 * @param {string} mint
 */
export async function getTokenBalanceBaseUnits(rpc, owner, mint) {
  const { value } = await rpc
    .getTokenAccountsByOwner(
      owner,
      { mint: asAddress(mint) },
      { encoding: "jsonParsed", commitment: "confirmed" }
    )
    .send();

  let total = 0n;
  for (const account of value || []) {
    const amount = account?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (amount != null) {
      total += BigInt(amount);
    }
  }
  return total;
}

/**
 * Resolve trade amount into base-unit string for Raptor.
 * @param {object} args
 * @param {"buy"|"sell"} args.side
 * @param {number|string} args.amount
 * @param {string} args.inputMint
 * @param {import('@solana/kit').Rpc<any>} args.rpc
 * @param {import('@solana/kit').Address} args.owner
 */
export async function resolveInputAmountBaseUnits({
  side,
  amount,
  inputMint,
  rpc,
  owner,
}) {
  const normalized = typeof amount === "string" ? amount.trim() : amount;

  if (normalized === "auto") {
    if (side !== "sell") {
      throw new SwapError("Buying with 'auto' is not supported.");
    }
    if (inputMint === WRAPPED_SOL_MINT) {
      const lamports = await getSolLamports(rpc, owner);
      const spendable = lamports > SOL_RESERVE_LAMPORTS ? lamports - SOL_RESERVE_LAMPORTS : 0n;
      if (spendable <= 0n) {
        throw new SwapError("Insufficient SOL balance for auto sell.");
      }
      return bigintToAmountString(spendable);
    }
    const bal = await getTokenBalanceBaseUnits(rpc, owner, inputMint);
    if (bal <= 0n) {
      throw new SwapError("No token balance to sell.");
    }
    return bigintToAmountString(bal);
  }

  if (typeof normalized === "string" && normalized.endsWith("%")) {
    const pct = Number(normalized.slice(0, -1));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      throw new SwapError(`Invalid percentage amount: ${normalized}`);
    }
    if (inputMint === WRAPPED_SOL_MINT) {
      const lamports = await getSolLamports(rpc, owner);
      const spendable = lamports > SOL_RESERVE_LAMPORTS ? lamports - SOL_RESERVE_LAMPORTS : 0n;
      const units = (spendable * BigInt(Math.floor(pct * 1000))) / 100000n;
      if (units <= 0n) {
        throw new SwapError("Percentage of SOL balance is zero after reserve.");
      }
      return bigintToAmountString(units);
    }
    const bal = await getTokenBalanceBaseUnits(rpc, owner, inputMint);
    const units = (bal * BigInt(Math.floor(pct * 1000))) / 100000n;
    if (units <= 0n) {
      throw new SwapError("Percentage of token balance is zero.");
    }
    return bigintToAmountString(units);
  }

  const decimals = await getMintDecimals(rpc, inputMint);
  const units = humanToBaseUnits(normalized, decimals);
  if (units <= 0n) {
    throw new SwapError("Amount must be greater than zero.");
  }
  return bigintToAmountString(units);
}

/**
 * @param {number|string} tipSol
 * @returns {number}
 */
export function solToLamportsNumber(tipSol) {
  const n = Number(tipSol);
  if (!Number.isFinite(n) || n < 0) {
    throw new SwapError(`Invalid tip SOL amount: ${tipSol}`);
  }
  return Math.round(n * Number(LAMPORTS_PER_SOL));
}
