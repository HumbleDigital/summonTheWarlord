import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_DEBUG_LOG_DIR = path.join(
  os.homedir(),
  "Library",
  "Logs",
  "summonTheWarlord"
);

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /api.?key|authorization|private.?key|secret|password|signed.?base64|transaction/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key ?? ""));
}

function redactString(value) {
  return String(value)
    .replace(/(bearer\s+)[^\s]+/gi, `$1${REDACTED}`)
    .replace(
      /(api[-_ ]?key|authorization|private[-_ ]?key|secret|password)(\s*[:=]\s*)[^,\s]+/gi,
      `$1$2${REDACTED}`
    );
}

/**
 * Redact sensitive fields from debug-log data.
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
export function redactDebugValue(value, key) {
  if (isSensitiveKey(key)) {
    return REDACTED;
  }
  if (value instanceof Error) {
    return redactDebugValue(
      {
        name: value.name,
        message: value.message,
        status: value.status,
        details: value.details,
      },
      key
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDebugValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactDebugValue(entryValue, entryKey),
      ])
    );
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  return value;
}

function safeName(value) {
  return String(value || "trade").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "trade";
}

/**
 * Create a per-operation debug log. Log failures never affect the trade.
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {string} [options.operation]
 * @param {string} [options.directory]
 * @param {Date} [options.now]
 * @param {number} [options.pid]
 * @param {(error: Error) => void} [options.onError]
 * @returns {Promise<{path: string, write: Function, close: Function}|null>}
 */
export async function createDebugLog({
  enabled,
  operation = "trade",
  directory = DEFAULT_DEBUG_LOG_DIR,
  now = new Date(),
  pid = process.pid,
  onError = () => {},
} = {}) {
  if (!enabled) {
    return null;
  }

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(directory, `${safeName(operation)}-${timestamp}-${pid}.log`);
  await fs.writeFile(filePath, "# summonTheWarlord debug log\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  let writeFailed = false;
  const reportWriteError = (error) => {
    if (writeFailed) return;
    writeFailed = true;
    try {
      onError(error instanceof Error ? error : new Error(String(error)));
    } catch {
      // Logging must never alter the trade outcome.
    }
  };

  return {
    path: filePath,
    async write(event, data = {}) {
      try {
        const line = JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            event,
            data: redactDebugValue(data),
          },
          (_key, value) => (typeof value === "bigint" ? `${value}n` : value)
        );
        await fs.appendFile(filePath, `${line}\n`, "utf8");
      } catch (error) {
        reportWriteError(error);
      }
    },
    async close() {},
  };
}
