import { beforeEach, describe, expect, jest, test } from "@jest/globals";

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("swap client memoization", () => {
  test("reuses memoized client and warns once for conflicting cfg rpcUrl", async () => {
    const loggerWarn = jest.fn();

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
      "getSwapClient received cfg that differs from the memoized client; reusing existing client."
    );
  });

  test("does not warn when follow-up cfg resolves to the same advancedTx rpcUrl", async () => {
    const loggerWarn = jest.fn();

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
