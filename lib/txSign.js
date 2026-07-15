import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  signTransaction,
} from "@solana/kit";
import { SwapError } from "./errors.js";

/**
 * Sign a Raptor base64 swap transaction with a Kit keypair signer.
 * @param {import('@solana/kit').KeyPairSigner} signer
 * @param {string} swapTransactionBase64
 * @returns {Promise<{ signedBase64: string, signature: string }>}
 */
export async function signSwapTransaction(signer, swapTransactionBase64) {
  if (!swapTransactionBase64 || typeof swapTransactionBase64 !== "string") {
    throw new SwapError("Missing swapTransaction from Raptor.");
  }
  if (!signer?.keyPair) {
    throw new SwapError("Wallet signer is missing a keyPair.");
  }

  let tx;
  try {
    const bytes = new Uint8Array(Buffer.from(swapTransactionBase64, "base64"));
    tx = getTransactionDecoder().decode(bytes);
  } catch (err) {
    throw new SwapError("Failed to decode Raptor swap transaction.", { cause: err });
  }

  const required = Object.keys(tx.signatures || {});
  if (required.length && !required.includes(signer.address)) {
    throw new SwapError(
      `Wallet ${signer.address} is not a required signer for this transaction (expected ${required.join(", ")}).`
    );
  }

  let signed;
  try {
    signed = await signTransaction([signer.keyPair], tx);
  } catch (err) {
    throw new SwapError(`Failed to sign swap transaction: ${err?.message || err}`, { cause: err });
  }

  try {
    return {
      signedBase64: getBase64EncodedWireTransaction(signed),
      signature: getSignatureFromTransaction(signed),
    };
  } catch (err) {
    throw new SwapError("Failed to encode signed transaction.", { cause: err });
  }
}
