import { describe, expect, test } from "@jest/globals";
import { buildPerformSwapOptions } from "../lib/executionMode.js";

describe("buildPerformSwapOptions", () => {
  test("fast mode sets skipPreflight true", () => {
    expect(buildPerformSwapOptions({ executionMode: "fast" })).toEqual({
      debug: false,
      sendOptions: { skipPreflight: true },
    });
  });

  test("basic mode sets skipPreflight false", () => {
    expect(buildPerformSwapOptions({ executionMode: "basic" })).toEqual({
      debug: false,
      sendOptions: { skipPreflight: false },
    });
  });

  test("defaults to fast when mode is missing", () => {
    expect(buildPerformSwapOptions({})).toEqual({
      debug: false,
      sendOptions: { skipPreflight: true },
    });
  });

  test("includes jito when enabled", () => {
    expect(
      buildPerformSwapOptions({
        executionMode: "fast",
        jito: { enabled: true, tip: 0.0002 },
      })
    ).toEqual({
      debug: false,
      sendOptions: { skipPreflight: true },
      jito: { enabled: true, tip: 0.0002 },
    });
  });

  test("omits jito when disabled", () => {
    const opts = buildPerformSwapOptions({
      executionMode: "basic",
      jito: { enabled: false, tip: 0.0001 },
    });
    expect(opts.jito).toBeUndefined();
  });

  test("DEBUG_MODE is reflected in debug flag", () => {
    expect(buildPerformSwapOptions({ DEBUG_MODE: true }).debug).toBe(true);
    expect(buildPerformSwapOptions({ DEBUG_MODE: false }).debug).toBe(false);
    expect(buildPerformSwapOptions({}).debug).toBe(false);
  });

  test("normalizes executionMode case-insensitively", () => {
    expect(buildPerformSwapOptions({ executionMode: "BASIC" }).sendOptions.skipPreflight).toBe(false);
    expect(buildPerformSwapOptions({ executionMode: "Fast" }).sendOptions.skipPreflight).toBe(true);
  });
});
