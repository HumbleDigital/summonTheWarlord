import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import { RaptorClient } from "../lib/raptorClient.js";

describe("RaptorClient", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("requires api key", () => {
    expect(() => new RaptorClient({ apiKey: "" })).toThrow(/API key/i);
  });

  test("sends x-api-key and builds quote query", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ amountOut: "1" }),
    });
    const client = new RaptorClient({
      apiKey: "test-key",
      baseUrl: "https://raptor.example",
      fetchImpl,
    });

    await client.getQuote({
      inputMint: "in",
      outputMint: "out",
      amount: "100",
      slippageBps: "50",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("https://raptor.example/quote?");
    expect(url).toContain("amount=100");
    expect(init.headers["x-api-key"]).toBe("test-key");
  });

  test("throws SwapError on non-OK response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "unauthorized" }),
    });
    const client = new RaptorClient({ apiKey: "k", fetchImpl });
    await expect(client.health()).rejects.toThrow(/unauthorized|Raptor error/i);
  });
});
