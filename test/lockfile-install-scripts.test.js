import { describe, expect, test } from "@jest/globals";

import { findNewInstallScriptPackages } from "../scripts/check-new-install-scripts.js";

const makeLockfile = (packages) => ({
  name: "@vault77/summon",
  lockfileVersion: 3,
  packages
});

describe("findNewInstallScriptPackages", () => {
  test("flags dependencies that newly introduce install scripts", () => {
    const baseLockfile = makeLockfile({
      "": { name: "@vault77/summon" },
      "node_modules/existing": {
        version: "1.0.0",
        hasInstallScript: true
      }
    });
    const headLockfile = makeLockfile({
      "": { name: "@vault77/summon" },
      "node_modules/existing": {
        version: "1.0.1",
        hasInstallScript: true
      },
      "node_modules/new-native-helper": {
        version: "2.0.0",
        hasInstallScript: true
      },
      "node_modules/no-script": {
        version: "3.0.0"
      }
    });

    expect(findNewInstallScriptPackages(baseLockfile, headLockfile)).toEqual([
      {
        path: "node_modules/new-native-helper",
        name: "new-native-helper",
        version: "2.0.0"
      }
    ]);
  });

  test("ignores install scripts already present in the base lockfile", () => {
    const baseLockfile = makeLockfile({
      "node_modules/keytar": {
        version: "7.9.0",
        hasInstallScript: true
      }
    });
    const headLockfile = makeLockfile({
      "node_modules/keytar": {
        version: "7.9.0",
        hasInstallScript: true
      }
    });

    expect(findNewInstallScriptPackages(baseLockfile, headLockfile)).toEqual([]);
  });
});
