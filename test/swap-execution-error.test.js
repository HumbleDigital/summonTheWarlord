import { formatSwapExecutionError } from "../lib/errors.js";

describe("formatSwapExecutionError", () => {
  test("annotates SolanaTracker proxy-unavailable send failures", () => {
    const msg = formatSwapExecutionError(
      new Error("Failed to send transaction: Simulation failed. Message: no proxy available.")
    );
    expect(msg).toMatch(/no proxy available/i);
    expect(msg).toMatch(/different rpcUrl/i);
    expect(msg).toMatch(/doctor only checks quote/i);
    expect(msg).not.toMatch(/executionMode=fast/);
    expect(msg).not.toMatch(/sendRpcUrl/);
  });

  test("passes through unrelated errors", () => {
    expect(formatSwapExecutionError(new Error("insufficient funds"))).toBe("insufficient funds");
  });
});
