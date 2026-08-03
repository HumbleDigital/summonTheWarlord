import { describe, expect, test } from "@jest/globals";
import { assertInteractiveSecretEntry } from "../lib/secretInput.js";

describe("assertInteractiveSecretEntry", () => {
  test("throws when stdin is not a TTY", () => {
    expect(() =>
      assertInteractiveSecretEntry({ stdinIsTTY: false, stdoutIsTTY: true })
    ).toThrow(/interactive terminal/i);
  });

  test("throws when stdout is not a TTY", () => {
    expect(() =>
      assertInteractiveSecretEntry({ stdinIsTTY: true, stdoutIsTTY: false })
    ).toThrow(/interactive terminal/i);
  });

  test("throws when neither stdin nor stdout is a TTY", () => {
    expect(() =>
      assertInteractiveSecretEntry({ stdinIsTTY: false, stdoutIsTTY: false })
    ).toThrow(/Piping secrets is disabled/i);
  });

  test("passes when both stdin and stdout are TTYs", () => {
    expect(() =>
      assertInteractiveSecretEntry({ stdinIsTTY: true, stdoutIsTTY: true })
    ).not.toThrow();
  });
});
