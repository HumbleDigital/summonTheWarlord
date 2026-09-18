import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("swap client memoization", () => {
  test("reuses memoized client and warns once for conflicting cfg rpcUrl", async () => {
    const loggerWarn = jest.fn();

    jest.unstable_mockModule("solana-swap", () => ({ SolanaTracker: class {} }));
    jest.unstable_mockModule("../utils/logger.js", () => ({ logger: { warn: loggerWarn, error: jest.fn() } }));

    const { getSwapClient, setSwapClientFactory } = await import("../lib/swapClient.js");

    const client = { id: "memoized-client" };
    const factory = jest.fn().mockResolvedValue(client);
    setSwapClientFactory(factory);

    const first = await getSwapClient({ cfg: { rpcUrl: "https://rpc-a.example" } });
    const second = await getSwapClient({ cfg: { rpcUrl: "https://rpc-b.example" } });
    const third = await getSwapClient({ cfg: { rpcUrl: "https://rpc-c.example" } });

    expect(first).toBe(client);
    expect(second).toBe(client);
    expect(third).toBe(client);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith(
      "getSwapClient received cfg.rpcUrl that differs from the memoized client; reusing existing client."
    );
  });

  test("does not warn when follow-up cfg resolves to the same advancedTx rpcUrl", async () => {
    const loggerWarn = jest.fn();

    jest.unstable_mockModule("solana-swap", () => ({ SolanaTracker: class {} }));
    jest.unstable_mockModule("../utils/logger.js", () => ({ logger: { warn: loggerWarn, error: jest.fn() } }));

    const { getSwapClient, setSwapClientFactory } = await import("../lib/swapClient.js");

    const client = { id: "memoized-client" };
    const factory = jest.fn().mockResolvedValue(client);
    setSwapClientFactory(factory);

    await getSwapClient({ cfg: { rpcUrl: "https://rpc.example" } });
    await getSwapClient({ cfg: { rpcUrl: "https://rpc.example?advancedTx=true" } });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(loggerWarn).not.toHaveBeenCalled();
  });
});

describe("defaultFactory debug gating and keypair secret integrity", () => {
  async function loadDefaultFactoryWithMocks({ debugMode, secretBase58, mockPrivateKey = true }) {
    const SolanaTracker = jest.fn().mockImplementation(function (keypair, rpcUrl, apiKey, debug) {
      this.keypair = keypair;
      this.rpcUrl = rpcUrl;
      this.apiKey = apiKey;
      this.debug = debug;
      this.setDebug = jest.fn();
    });

    jest.unstable_mockModule("solana-swap", () => ({ SolanaTracker }));
    jest.unstable_mockModule("../utils/logger.js", () => ({
      logger: { warn: jest.fn(), error: jest.fn() },
    }));
    jest.unstable_mockModule("../utils/keychain.js", () => ({
      getPrivateKey: jest.fn().mockResolvedValue(secretBase58),
    }));
    jest.unstable_mockModule("../utils/notify.js", () => ({ notify: jest.fn() }));

    let parsePrivateKeyToSecretKey;
    if (mockPrivateKey) {
      parsePrivateKeyToSecretKey = jest.fn((secret) => {
        const decoded = bs58.decode(String(secret).trim());
        return decoded instanceof Uint8Array ? decoded : Uint8Array.from(decoded);
      });
      jest.unstable_mockModule("../lib/privateKey.js", () => ({
        parsePrivateKeyToSecretKey,
        wipeBytes: jest.fn((bytes) => {
          if (bytes && bytes.fill) bytes.fill(0);
        }),
      }));
    }

    const { getSwapClient } = await import("../lib/swapClient.js");
    const cfg = {
      rpcUrl: "https://rpc.example",
      DEBUG_MODE: debugMode,
      notificationsEnabled: false,
    };
    const client = await getSwapClient({ cfg });
    return { SolanaTracker, parsePrivateKeyToSecretKey, client };
  }

  test("passes debug=false when NODE_ENV is development but DEBUG_MODE is false", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const original = Keypair.generate();
      const secretBase58 = bs58.encode(original.secretKey);
      const { SolanaTracker, parsePrivateKeyToSecretKey, client } =
        await loadDefaultFactoryWithMocks({ debugMode: false, secretBase58 });

      expect(parsePrivateKeyToSecretKey).toHaveBeenCalledWith(secretBase58);
      expect(SolanaTracker).toHaveBeenCalledTimes(1);
      const [keypair, , , debugArg] = SolanaTracker.mock.calls[0];
      expect(debugArg).toBe(false);
      // Live Keypair secret must remain non-zero and match input (not wiped).
      expect(keypair.secretKey.every((b) => b === 0)).toBe(false);
      expect(Buffer.from(keypair.secretKey).equals(Buffer.from(original.secretKey))).toBe(true);
      expect(client.keypair).toBe(keypair);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test("passes debug=true when DEBUG_MODE is true", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const secretBase58 = bs58.encode(Keypair.generate().secretKey);
      const { SolanaTracker, client } = await loadDefaultFactoryWithMocks({
        debugMode: true,
        secretBase58,
      });

      expect(SolanaTracker).toHaveBeenCalledTimes(1);
      const [, , , debugArg] = SolanaTracker.mock.calls[0];
      expect(debugArg).toBe(true);
      expect(client.setDebug).toHaveBeenCalledWith(true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test("defaultFactory with real privateKey leaves Keypair.secretKey intact", async () => {
    const original = Keypair.generate();
    const secretBase58 = bs58.encode(original.secretKey);
    const { SolanaTracker, client } = await loadDefaultFactoryWithMocks({
      debugMode: false,
      secretBase58,
      mockPrivateKey: false,
    });

    const keypair = SolanaTracker.mock.calls[0][0];
    expect(keypair.secretKey).toBeInstanceOf(Uint8Array);
    expect(keypair.secretKey.length).toBe(64);
    expect(keypair.secretKey.every((b) => b === 0)).toBe(false);
    expect(Buffer.from(keypair.secretKey).equals(Buffer.from(original.secretKey))).toBe(true);
    expect(keypair.publicKey.equals(original.publicKey)).toBe(true);
    expect(client.keypair).toBe(keypair);
  });
});
