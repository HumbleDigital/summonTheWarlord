import { describe, expect, test } from "@jest/globals";

import { EXPECTED_PACKAGE_FILES, verifyPackageFiles } from "../scripts/verify-packlist.js";

describe("verifyPackageFiles", () => {
  test("accepts the expected npm package file list", () => {
    const files = [...EXPECTED_PACKAGE_FILES].map((path) => ({ path }));

    expect(verifyPackageFiles(files)).toEqual({
      ok: true,
      missing: [],
      unexpected: []
    });
  });

  test("rejects unexpected files", () => {
    const files = [
      ...[...EXPECTED_PACKAGE_FILES].map((path) => ({ path })),
      { path: ".env" }
    ];

    expect(verifyPackageFiles(files)).toEqual({
      ok: false,
      missing: [],
      unexpected: [".env"]
    });
  });

  test("rejects missing expected files", () => {
    const files = [...EXPECTED_PACKAGE_FILES]
      .filter((path) => path !== "summon-cli.js")
      .map((path) => ({ path }));

    expect(verifyPackageFiles(files)).toEqual({
      ok: false,
      missing: ["summon-cli.js"],
      unexpected: []
    });
  });
});
