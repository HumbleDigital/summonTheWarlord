const DECLINE_INPUTS = new Set(["", "n", "no"]);

function normalizeInput(value) {
  return String(value ?? "").trim();
}

function isDeclineInput(value) {
  return DECLINE_INPUTS.has(normalizeInput(value).toLowerCase());
}

/**
 * Prompt for the Raptor API key without a yes/no gate.
 *
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.hasRaptorApiKey
 * @param {(prompt: string) => Promise<string>} deps.askSecretQuestion
 * @param {(key: string) => Promise<void>} deps.storeRaptorApiKey
 * @returns {Promise<{completed: boolean, stored: boolean, kept: boolean, error?: Error}>}
 */
export async function promptRaptorApiKey({
  hasRaptorApiKey,
  askSecretQuestion,
  storeRaptorApiKey,
}) {
  try {
    const existing = await hasRaptorApiKey();
    const prompt = existing
      ? "🔑 Raptor API key already stored. Press Enter to keep it, or paste a replacement: "
      : "Paste your Raptor API key (required for swaps; press Enter, or type n/no, to exit): ";
    const input = normalizeInput(await askSecretQuestion(prompt));

    if (existing && isDeclineInput(input)) {
      return { completed: true, stored: false, kept: true };
    }

    if (!existing && isDeclineInput(input)) {
      return { completed: false, stored: false, kept: false };
    }

    await storeRaptorApiKey(input);
    return { completed: true, stored: true, kept: false };
  } catch (error) {
    return {
      completed: false,
      stored: false,
      kept: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
