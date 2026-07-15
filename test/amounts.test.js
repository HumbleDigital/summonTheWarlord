import { describe, expect, test } from "@jest/globals";
import {
  baseUnitsToHuman,
  humanToBaseUnits,
  toSlippageBps,
} from "../lib/amounts.js";
import { mapPriorityFeeForRaptor, mapTxVersionForRaptor } from "../lib/raptorOptions.js";

describe("amount helpers", () => {
  test("converts human amounts to base units", () => {
    expect(humanToBaseUnits("1.5", 9).toString()).toBe("1500000000");
    expect(humanToBaseUnits(0.0001, 9).toString()).toBe("100000");
  });

  test("converts base units to human", () => {
    expect(baseUnitsToHuman(1500000000n, 9)).toBe("1.5");
    expect(baseUnitsToHuman(100000n, 9)).toBe("0.0001");
  });

  test("maps slippage percent to bps and auto to dynamic", () => {
    expect(toSlippageBps(10)).toBe("1000");
    expect(toSlippageBps(0.5)).toBe("50");
    expect(toSlippageBps("auto")).toBe("dynamic");
  });
});

describe("raptor option mapping", () => {
  test("maps tx versions", () => {
    expect(mapTxVersionForRaptor("v0")).toBe("V0");
    expect(mapTxVersionForRaptor("legacy")).toBe("LEGACY");
  });

  test("maps priority fees", () => {
    expect(mapPriorityFeeForRaptor({ priorityFee: "auto", priorityFeeLevel: "high" })).toEqual({
      priorityFee: "high",
    });
    expect(mapPriorityFeeForRaptor({ priorityFee: "auto", priorityFeeLevel: "veryHigh" })).toEqual({
      priorityFee: "veryHigh",
    });
    expect(mapPriorityFeeForRaptor({ priorityFee: 5000 })).toEqual({
      priorityFee: "5000",
    });
  });
});
