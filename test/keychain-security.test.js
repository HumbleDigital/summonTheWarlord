import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("storePrivateKey security", () => {
  test("rejects invalid keys without calling keytar.setPassword", async () => {
    const setPassword = jest.fn();
    jest.unstable_mockModule("keytar", () => ({
      default: {
        setPassword,
        getPassword: jest.fn(),
        deletePassword: jest.fn(),
      },
    }));
    jest.spyOn(console, "log").mockImplementation(() => {});

    const { storePrivateKey } = await import("../utils/keychain.js");
    await expect(storePrivateKey("not-valid")).rejects.toThrow(/Invalid private key/);
    expect(setPassword).not.toHaveBeenCalled();
  });

  test("stores validated base58 key via keytar", async () => {
    const setPassword = jest.fn().mockResolvedValue(undefined);
    jest.unstable_mockModule("keytar", () => ({
      default: {
        setPassword,
        getPassword: jest.fn(),
        deletePassword: jest.fn(),
      },
    }));
    jest.spyOn(console, "log").mockImplementation(() => {});

    const encoded = bs58.encode(Keypair.generate().secretKey);
    const { storePrivateKey } = await import("../utils/keychain.js");
    await storePrivateKey(`  ${encoded}  `);
    expect(setPassword).toHaveBeenCalledWith(
      "summonTheWarlord",
      "wallet-private-key",
      encoded
    );
  });

  test("logger/error paths never include the raw secret", async () => {
    const secret = bs58.encode(Keypair.generate().secretKey);
    const setPassword = jest.fn().mockRejectedValue(new Error(`boom ${secret}`));
    const loggerError = jest.fn();
    jest.unstable_mockModule("keytar", () => ({
      default: { setPassword, getPassword: jest.fn(), deletePassword: jest.fn() },
    }));
    jest.unstable_mockModule("../utils/logger.js", () => ({
      logger: { error: loggerError, warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    }));

    const { storePrivateKey } = await import("../utils/keychain.js");
    await expect(storePrivateKey(secret)).rejects.toThrow();
    const logged = JSON.stringify(loggerError.mock.calls);
    expect(logged).not.toContain(secret);
  });
});
