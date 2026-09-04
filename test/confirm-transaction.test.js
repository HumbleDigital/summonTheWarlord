import { afterEach, describe, expect, jest, test } from "@jest/globals";

const {
  classifySignatureStatus,
  extractSignatureFromError,
  isTransientSignatureStatusError,
  confirmTransaction,
  CONFIRM_DELAY_SCHEDULE_MS,
  ON_CHAIN_FAILED_MESSAGE,
  CONFIRMATION_TIMEOUT_INFO,
} = await import("../lib/confirmTransaction.js");

const SIG = "2BfkdW9NWGm9chRf4AdNpq5yBHrgScBLrb9P6ym5scfSA8tcECJgBxzDhS7dEd5McFeTPu1zNyvVjR5L1jaA7ijg";
const MINT = "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g";

afterEach(() => {
  jest.useRealTimers();
});

describe("classifySignatureStatus", () => {
  test("treats null value as pending", () => {
    expect(classifySignatureStatus(null)).toBe("pending");
    expect(classifySignatureStatus(undefined)).toBe("pending");
  });

  test("treats on-chain err as failed", () => {
    expect(classifySignatureStatus({ err: { InstructionError: [2, { Custom: 1 }] } })).toBe("failed");
  });

  test("treats processed/confirmed/finalized as confirmed", () => {
    expect(classifySignatureStatus({ err: null, confirmationStatus: "processed" })).toBe("confirmed");
    expect(classifySignatureStatus({ err: null, confirmationStatus: "confirmed" })).toBe("confirmed");
    expect(classifySignatureStatus({ err: null, confirmationStatus: "finalized" })).toBe("confirmed");
  });

  test("keeps polling when err is null but confirmationStatus is missing", () => {
    expect(classifySignatureStatus({ err: null })).toBe("pending");
    expect(classifySignatureStatus({ err: null, slot: 1 })).toBe("pending");
  });
});

describe("extractSignatureFromError", () => {
  test("extracts an 87-88 character signature from an SDK error message", () => {
    expect(extractSignatureFromError(new Error(`Swap ${SIG} failed: Transaction failed after maximum retries`))).toBe(SIG);
  });

  test("does not treat a mint address as a signature", () => {
    expect(extractSignatureFromError(new Error(`Swap failed: bad mint ${MINT}`))).toBeNull();
  });

  test("returns null when no signature is present", () => {
    expect(extractSignatureFromError(new Error("Failed to send transaction"))).toBeNull();
  });
});

describe("isTransientSignatureStatusError", () => {
  test("retries HTTP 503 and timeout messages", () => {
    expect(isTransientSignatureStatusError({ status: 503 })).toBe(true);
    expect(isTransientSignatureStatusError(new Error("fetch failed"))).toBe(true);
    expect(isTransientSignatureStatusError({ code: "ETIMEDOUT" })).toBe(true);
  });

  test("does not treat a programming error as transient", () => {
    expect(isTransientSignatureStatusError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});

describe("confirmTransaction", () => {
  test("returns confirmed on the first status check", async () => {
    const getSignatureStatus = jest.fn().mockResolvedValue({
      value: { err: null, confirmationStatus: "confirmed" },
    });

    const result = await confirmTransaction({
      signature: SIG,
      getSignatureStatus,
      sleep: async () => {},
    });

    expect(result).toEqual({ status: "confirmed", err: null });
    expect(getSignatureStatus).toHaveBeenCalledTimes(1);
    expect(getSignatureStatus).toHaveBeenCalledWith(SIG);
  });

  test("returns failed with the on-chain err payload", async () => {
    const err = { InstructionError: [2, { Custom: 1 }] };
    const getSignatureStatus = jest.fn().mockResolvedValue({
      value: { err, confirmationStatus: "confirmed" },
    });

    const result = await confirmTransaction({
      signature: SIG,
      getSignatureStatus,
      sleep: async () => {},
    });

    expect(result.status).toBe("failed");
    expect(result.err).toEqual(err);
  });

  test("returns unknown when status never appears within the delay schedule", async () => {
    jest.useFakeTimers();
    const getSignatureStatus = jest.fn().mockResolvedValue({ value: null });

    const pending = confirmTransaction({
      signature: SIG,
      getSignatureStatus,
    });
    await jest.runAllTimersAsync();
    const result = await pending;

    expect(result).toEqual({ status: "unknown", err: null });
    expect(getSignatureStatus).toHaveBeenCalledTimes(1 + CONFIRM_DELAY_SCHEDULE_MS.length);
  });

  test("retries a transient RPC error then confirms", async () => {
    jest.useFakeTimers();
    const getSignatureStatus = jest.fn()
      .mockRejectedValueOnce({ status: 503, message: "temporarily unavailable" })
      .mockResolvedValueOnce({ value: { err: null, confirmationStatus: "processed" } });

    const pending = confirmTransaction({
      signature: SIG,
      getSignatureStatus,
    });
    await jest.runAllTimersAsync();
    const result = await pending;

    expect(result).toEqual({ status: "confirmed", err: null });
    expect(getSignatureStatus).toHaveBeenCalledTimes(2);
  });

  test("does not confirm a value with err null and no confirmationStatus", async () => {
    jest.useFakeTimers();
    const getSignatureStatus = jest.fn().mockResolvedValue({ value: { err: null, slot: 9 } });

    const pending = confirmTransaction({
      signature: SIG,
      getSignatureStatus,
      delays: [5],
    });
    await jest.runAllTimersAsync();
    const result = await pending;

    expect(result.status).toBe("unknown");
  });
});

describe("copy constants", () => {
  test("failed and timeout copy are short UI sentences without JSON", () => {
    expect(ON_CHAIN_FAILED_MESSAGE).toBe("Transaction failed on-chain. Check the explorer.");
    expect(CONFIRMATION_TIMEOUT_INFO).toBe(
      "Confirmation timed out after 50s. Check the explorer — the swap may still have landed."
    );
    expect(ON_CHAIN_FAILED_MESSAGE).not.toMatch(/\{/);
    expect(CONFIRMATION_TIMEOUT_INFO).not.toMatch(/\{/);
  });

  test("delay schedule sums to 50 seconds", () => {
    const total = CONFIRM_DELAY_SCHEDULE_MS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBe(50000);
  });
});
