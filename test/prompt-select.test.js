import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { promptSelect } from "../lib/promptSelect.js";

function mockRl(answers) {
  const queue = [...answers];
  return {
    question(_prompt, cb) {
      if (queue.length === 0) {
        throw new Error("asked again after answers were exhausted");
      }
      cb(queue.shift());
    },
  };
}

describe("promptSelect", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("Enter keeps the current value for required selects", async () => {
    const result = await promptSelect(
      mockRl([""]),
      "Priority fee level",
      ["min", "low", "medium", "high", "veryHigh"],
      { current: "medium", required: true }
    );

    expect(result).toBe("medium");
  });

  test("whitespace-only Enter keeps the current value", async () => {
    const result = await promptSelect(
      mockRl(["  "]),
      "Execution mode",
      ["basic", "fast"],
      { current: "fast", required: true }
    );

    expect(result).toBe("fast");
  });

  test("required select with no current value rejects empty Enter", async () => {
    await expect(
      promptSelect(mockRl([""]), "Priority fee level", ["min", "low", "medium"], {
        required: true,
      })
    ).rejects.toThrow("asked again after answers were exhausted");
    expect(logSpy).toHaveBeenCalledWith("⚠️  Selection required.");
  });
});
