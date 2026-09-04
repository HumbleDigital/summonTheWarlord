const SENSITIVE_URL_KEY_PATTERN = /key|token|secret|auth|signature|sig|password|pwd/i;

export function maskSensitiveValue(value) {
  const text = String(value ?? "");
  if (!text) {
    return text;
  }
  if (text.length <= 4) {
    return "*".repeat(text.length);
  }
  return `${"*".repeat(text.length - 4)}${text.slice(-4)}`;
}

export function redactSensitiveUrl(rawUrl) {
  const urlText = String(rawUrl ?? "").trim();
  if (!urlText) {
    return urlText;
  }

  try {
    const parsed = new URL(urlText);
    if (parsed.username) {
      parsed.username = maskSensitiveValue(parsed.username);
    }
    if (parsed.password) {
      parsed.password = maskSensitiveValue(parsed.password);
    }
    for (const [key, value] of parsed.searchParams.entries()) {
      if (SENSITIVE_URL_KEY_PATTERN.test(key)) {
        parsed.searchParams.set(key, maskSensitiveValue(value));
      }
    }
    return parsed.toString();
  } catch {
    return urlText.replace(
      /([?&][^=]*(?:key|token|secret|auth|signature|sig|password|pwd)[^=]*=)([^&]+)/ig,
      (_, prefix, value) => `${prefix}${maskSensitiveValue(value)}`
    );
  }
}
