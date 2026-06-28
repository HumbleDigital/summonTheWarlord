#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const packageNameFromPath = (packagePath, packageInfo) => {
  if (packageInfo?.name) {
    return packageInfo.name;
  }

  return packagePath.replace(/^node_modules\//, "");
};

export const findNewInstallScriptPackages = (baseLockfile, headLockfile) => {
  const basePackages = baseLockfile?.packages ?? {};
  const headPackages = headLockfile?.packages ?? {};

  return Object.entries(headPackages)
    .filter(([packagePath, packageInfo]) => {
      if (!packagePath || packagePath === "") {
        return false;
      }

      return Boolean(packageInfo?.hasInstallScript) && !basePackages[packagePath];
    })
    .map(([packagePath, packageInfo]) => ({
      path: packagePath,
      name: packageNameFromPath(packagePath, packageInfo),
      version: packageInfo?.version ?? "unknown"
    }));
};

const readLockfile = (lockfilePath) => JSON.parse(fs.readFileSync(lockfilePath, "utf8"));

const runCli = () => {
  const [, , baseLockfilePath, headLockfilePath = "package-lock.json"] = process.argv;

  if (!baseLockfilePath) {
    console.error("Usage: node scripts/check-new-install-scripts.js <base-package-lock.json> [head-package-lock.json]");
    process.exit(2);
  }

  const findings = findNewInstallScriptPackages(
    readLockfile(baseLockfilePath),
    readLockfile(headLockfilePath)
  );

  if (findings.length === 0) {
    console.log("No newly introduced install scripts found in package-lock.json.");
    return;
  }

  console.error("New dependencies with install scripts require manual review:");
  for (const finding of findings) {
    console.error(`- ${finding.name}@${finding.version} (${finding.path})`);
  }
  process.exit(1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
