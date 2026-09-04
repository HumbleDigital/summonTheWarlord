import {
  CONFIRMATION_TIMEOUT_INFO,
  extractSignatureFromError,
} from "./confirmTransaction.js";

export function orbExplorerUrl(txid) {
  return `https://orbmarkets.io/tx/${txid}`;
}

function mintDisplay(mint) {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function baseRows({ type, mint, amount }) {
  return [
    ["Action", type === "buy" ? "Buy" : "Sell"],
    ["Mint", mintDisplay(mint)],
    ["Amount", String(amount)],
  ];
}

export function buildTradeStatusView({ type, mint, amount, result = null, error = null }) {
  const base = baseRows({ type, mint, amount });

  if (error) {
    const txid = error.details?.txid || extractSignatureFromError(error) || "-";
    const explorer = txid !== "-" ? orbExplorerUrl(txid) : "-";
    return {
      title: "FAILED",
      tone: "red",
      exitCode: 1,
      rows: [
        ...base,
        ["TXID", String(txid)],
        ["Explorer", explorer],
        ["Error", String(error.message || "Unknown error")],
      ],
    };
  }

  const txid = String(result?.txid ?? "-");
  const explorer = txid !== "-" ? orbExplorerUrl(txid) : "-";

  if (result?.verificationStatus === "unknown") {
    return {
      title: "UNKNOWN",
      tone: "yellow",
      exitCode: 0,
      rows: [
        ...base,
        ["TXID", txid],
        ["Explorer", explorer],
        ["Info", CONFIRMATION_TIMEOUT_INFO],
        ["Verification", "unknown"],
      ],
    };
  }

  const info = type === "buy"
    ? `Received ${result.tokensReceivedDecimal} tokens | Fees ${result.totalFees} | Impact ${result.priceImpact}`
    : `Received ${result.solReceivedDecimal} SOL | Fees ${result.totalFees} | Impact ${result.priceImpact}`;

  return {
    title: "SUCCESS",
    tone: "green",
    exitCode: 0,
    rows: [
      ...base,
      ["TXID", txid],
      ["Explorer", explorer],
      ["Info", String(info)],
      ["Verification", "confirmed"],
    ],
  };
}
