export function assertInteractiveSecretEntry({ stdinIsTTY, stdoutIsTTY } = {}) {
  if (!stdinIsTTY || !stdoutIsTTY) {
    throw new Error(
      "Private key entry requires an interactive terminal. " +
        "Run `summon keychain store` in a TTY, or use a secure prompt. " +
        "Piping secrets is disabled to prevent echo and log capture."
    );
  }
}
