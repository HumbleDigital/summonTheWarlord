#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const EXPECTED_PACKAGE_FILES = [
  "LICENSE",
  "README.md",
  "lib/config.js",
  "lib/doctor.js",
  "lib/errors.js",
  "lib/swapClient.js",
  "lib/tradeFormat.js",
  "lib/tradeInput.js",
  "lib/trades.js",
  "package.json",
  "summon-cli.js",
  "utils/keychain.js",
  "utils/logger.js",
  "utils/notify.js"
];

export const verifyPackageFiles = (files, expectedFiles = EXPECTED_PACKAGE_FILES) => {
  const actual = files.map((file) => file.path).sort();
  const expected = [...expectedFiles].sort();

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  const missing = expected.filter((file) => !actualSet.has(file));
  const unexpected = actual.filter((file) => !expectedSet.has(file));

  return {
    ok: missing.length === 0 && unexpected.length === 0,
    missing,
    unexpected
  };
};

const readPackJson = (packJsonPath) => {
  const payload = JSON.parse(fs.readFileSync(packJsonPath, "utf8"));
  const [packageInfo] = payload;

  if (!packageInfo?.files) {
    throw new Error(`No package file list found in ${packJsonPath}.`);
  }

  return packageInfo.files;
};

const runCli = () => {
  const [, , packJsonPath] = process.argv;

  if (!packJsonPath) {
    console.error("Usage: node scripts/verify-packlist.js <npm-pack-json-output>");
    process.exit(2);
  }

  const result = verifyPackageFiles(readPackJson(packJsonPath));

  if (result.ok) {
    console.log("npm package file list matches the expected allowlist.");
    return;
  }

  if (result.missing.length > 0) {
    console.error(`Missing expected package files: ${result.missing.join(", ")}`);
  }

  if (result.unexpected.length > 0) {
    console.error(`Unexpected package files: ${result.unexpected.join(", ")}`);
  }

  process.exit(1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
