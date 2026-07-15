/** Wrapped SOL mint on Solana mainnet. */
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Operator platform fee (kept product constant). */
export const OPERATOR_FEE = Object.freeze({
  wallet: "8aBKXBErcp1Bi5LmaeGnaXCj9ot7PE4T2wuqHQfeT5E6",
  /** 0.4% = 40 basis points */
  bps: 40,
});

/** Default hosted Raptor beta base URL. */
export const DEFAULT_RAPTOR_BASE_URL = "https://raptor-beta.solanatracker.io";

/** Leave some SOL for fees / ATA rent when spending % or near-full balance. */
export const SOL_RESERVE_LAMPORTS = 10_000_000n; // 0.01 SOL

export const LAMPORTS_PER_SOL = 1_000_000_000n;
