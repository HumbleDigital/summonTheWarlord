import { test, expect } from "@jest/globals";
import fs from "node:fs/promises";

test("required selectors accept Enter when a current value is displayed", async () => {
  const cli = await fs.readFile(new URL("../summon-cli.js", import.meta.url), "utf8");

  expect(cli).toMatch(
    /if \(!answer\) \{\s*if \(current !== undefined\) \{\s*return current;\s*\}\s*if \(required\)/
  );
});
