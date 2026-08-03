import { test, expect } from "@jest/globals";

import { maskSensitiveValue, redactSensitiveUrl } from "../lib/redact.js";

test("redacts api key query params and userinfo", () => {
  const redacted = redactSensitiveUrl("https://u:p@rpc.example/path?apiKey=supersecret&x=1");
  expect(redacted).not.toContain("supersecret");
  expect(redacted).not.toMatch(/:p@/);
  expect(redacted).toContain("x=1");
});

test("redacts token query param", () => {
  const redacted = redactSensitiveUrl("https://rpc.example/?token=abc123secrettoken");
  expect(redacted).not.toContain("abc123secrettoken");
  expect(redacted).toMatch(/token=/);
});

test("returns empty input unchanged", () => {
  expect(redactSensitiveUrl("")).toBe("");
  expect(redactSensitiveUrl("   ")).toBe("");
  expect(redactSensitiveUrl(null)).toBe("");
  expect(redactSensitiveUrl(undefined)).toBe("");
});

test("invalid URL falls back to regex redaction", () => {
  const redacted = redactSensitiveUrl("not-a-url?apiKey=supersecret&token=tokensecret");
  expect(redacted).not.toContain("supersecret");
  expect(redacted).not.toContain("tokensecret");
  expect(redacted).toMatch(/apiKey=/);
  expect(redacted).toMatch(/token=/);
});

test("maskSensitiveValue masks short and long values", () => {
  expect(maskSensitiveValue("")).toBe("");
  expect(maskSensitiveValue("ab")).toBe("**");
  expect(maskSensitiveValue("abcd")).toBe("****");
  expect(maskSensitiveValue("supersecret")).toBe("*******cret");
});
