export class AppError extends Error {
  constructor(message, { cause, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    if (cause) {
      this.cause = cause;
    }
    if (details) {
      this.details = details;
    }
  }
}

export class ConfigError extends AppError {}
export class KeychainError extends AppError {}
export class SwapError extends AppError {}
export class NotificationError extends AppError {}
export class DoctorError extends AppError {}

/**
 * Operator-facing message for swap send/simulation failures.
 * Keeps upstream text and adds actionable hint for known SolanaTracker RPC faults.
 */
export function formatSwapExecutionError(err) {
  const msg = err?.message || String(err);
  if (/no proxy available/i.test(msg)) {
    return (
      `${msg} — SolanaTracker RPC had no send/simulate proxy available. ` +
      `Retry shortly, or set executionMode=fast to skip preflight (higher risk). ` +
      `summon doctor only checks quote/API health, not transaction send.`
    );
  }
  return msg;
}
