import { test, expect, jest } from "@jest/globals";
import { promptRaptorApiKey } from "../lib/raptorApiKeyPrompt.js";

test("wizard asks for a missing Raptor API key directly", async () => {
  const askSecretQuestion = jest.fn().mockResolvedValue("raptor-secret");

  await promptRaptorApiKey({
    hasRaptorApiKey: jest.fn().mockResolvedValue(false),
    askSecretQuestion,
    storeRaptorApiKey: jest.fn().mockResolvedValue(undefined),
  });

  expect(askSecretQuestion).toHaveBeenCalledWith(
    "Paste your Raptor API key (required for swaps; press Enter, or type n/no, to exit): "
  );
});

test("stores a pasted key when no key exists", async () => {
  const storeRaptorApiKey = jest.fn().mockResolvedValue(undefined);

  const result = await promptRaptorApiKey({
    hasRaptorApiKey: jest.fn().mockResolvedValue(false),
    askSecretQuestion: jest.fn().mockResolvedValue("raptor-secret"),
    storeRaptorApiKey,
  });

  expect(result).toEqual({ completed: true, stored: true, kept: false });
  expect(storeRaptorApiKey).toHaveBeenCalledWith("raptor-secret");
});

test.each(["", "n", "no"])("bails out cleanly for missing key input %j", async (input) => {
  const storeRaptorApiKey = jest.fn();

  const result = await promptRaptorApiKey({
    hasRaptorApiKey: jest.fn().mockResolvedValue(false),
    askSecretQuestion: jest.fn().mockResolvedValue(input),
    storeRaptorApiKey,
  });

  expect(result).toEqual({ completed: false, stored: false, kept: false });
  expect(storeRaptorApiKey).not.toHaveBeenCalled();
});

test("pressing Enter keeps an existing key", async () => {
  const storeRaptorApiKey = jest.fn();

  const result = await promptRaptorApiKey({
    hasRaptorApiKey: jest.fn().mockResolvedValue(true),
    askSecretQuestion: jest.fn().mockResolvedValue(""),
    storeRaptorApiKey,
  });

  expect(result).toEqual({ completed: true, stored: false, kept: true });
  expect(storeRaptorApiKey).not.toHaveBeenCalled();
});

test("stores a pasted replacement for an existing key", async () => {
  const storeRaptorApiKey = jest.fn().mockResolvedValue(undefined);

  const result = await promptRaptorApiKey({
    hasRaptorApiKey: jest.fn().mockResolvedValue(true),
    askSecretQuestion: jest.fn().mockResolvedValue("new-raptor-secret"),
    storeRaptorApiKey,
  });

  expect(result).toEqual({ completed: true, stored: true, kept: false });
  expect(storeRaptorApiKey).toHaveBeenCalledWith("new-raptor-secret");
});

test("reports Keychain failures as an incomplete result", async () => {
  const keychainError = new Error("Keychain unavailable");

  const result = await promptRaptorApiKey({
    hasRaptorApiKey: jest.fn().mockResolvedValue(false),
    askSecretQuestion: jest.fn().mockResolvedValue("raptor-secret"),
    storeRaptorApiKey: jest.fn().mockRejectedValue(keychainError),
  });

  expect(result).toMatchObject({ completed: false, stored: false, kept: false, error: keychainError });
});
