# summonTheWarlord — Agent Guide

## Project Summary
- CLI (`summon-cli.js`) wraps SolanaTracker's swap SDK (`solana-swap`) to buy/sell SPL tokens with a configured wallet (`lib/trades.js`).
- Configuration lives in a JSON file under `~/Library/Application Support/summonTheWarlord/config.json`; sensitive keys are managed via macOS Keychain (`utils/keychain.js`).
- Notifications are macOS-only (`utils/notify.js`); the project is not intended to run on other operating systems.

## Repository Expectations (Codex)
- Keep changes small and targeted unless a refactor is explicitly requested.
- Run `npm test` and `npm run lint` after changes in `lib/`, `utils/`, `scripts/`, `summon-cli.js`, or `test/`.
- Never log or persist private keys or API keys; use the Keychain flows.
- Prefer `rg` for search and `apply_patch` for focused edits.
- If a change affects on-chain trades, call out manual verification steps.

## Environment & Tooling
- Target Node.js ≥22.12.0 with ES modules enabled. Dependencies are already vendored via `npm install`.
- Assumes macOS access to Keychain; avoid running flows that bypass secure storage.
- RPC endpoints must include `advancedTx=true`; `lib/trades.js` enforces this by appending the flag when missing.
- The Solana swap backend is currently `https://swap-v2.solanatracker.io`. If receiving HTTP 500 errors, confirm whether SolanaTracker has migrated to a new base URL and update the SDK or call `tracker.setBaseUrl(...)` accordingly.

## Configuration & Secrets
- Never commit wallet secrets or API keys. Use the `summon keychain` commands to inspect or update stored keys.
- Default config (`lib/config.js`) seeds a public RPC. The swap discount code is hardcoded and must remain hidden from users.
- `priorityFee` may be `"auto"` or numeric. Percent-based amounts are strings ending with `%`, while `"auto"` consumes the full balance for sells.
- `executionMode` is `basic` or `fast` (default `fast`). `basic` enables RPC preflight (`skipPreflight: false`); `fast` skips preflight for lower latency. See `lib/executionMode.js` and SECURITY.md.
- Swap/SDK debug logging is controlled only by `DEBUG_MODE` (not `NODE_ENV`).
- `walletSecretKey` must not reappear in config: load/normalize strips deprecated secret keys; do not reintroduce disk storage of private keys.

## Execution & Testing
- Run the CLI via `node summon-cli.js ...` or the `summon` bin. Buying with `"auto"` is disallowed; selling supports `"auto"` and percentage strings.
- Automated tests live under `npm test` (Node's built-in test runner). Validate critical paths manually: fetching swap instructions and executing swaps against Solana mainnet.
- When debugging trades, log the swap response only if `showQuoteDetails` is true to avoid noisy console output.

## Development Notes
- Heavy dependencies (`@solana/web3.js`, `bs58`) are lazily imported inside trade helpers for faster CLI startup.
- Swap fees are injected via the `fee` option inside `buyToken`/`sellToken`; adjust both functions if fee policy changes.
- Respect the memoized tracker client `getTrackerClient()` so retries reuse a single SolanaTracker instance.
- Keychain-related failures should surface clear error messages—prefer `Error` objects with actionable guidance instead of generic strings.

## Operational Checks
- If swaps suddenly fail, test the upstream REST endpoints directly with `curl` to isolate SDK vs. backend issues.
- Ensure RPC URLs remain healthy; the CLI appends `advancedTx=true` but still relies on operator-provided hosts for reliability.
- Confirm macOS notification permissions during setup (`summon setup`) so users see trade confirmations.

## Codex Instruction Notes
- This file is repository-level guidance. Add `AGENTS.override.md` in a subdirectory when a team needs specialized rules.
- Keep instructions concise; if this file grows large, split guidance across subdirectories to avoid truncation.

## Review Checklist (Codex)
- No changes that bypass Keychain storage or expose secrets in logs.
- `walletSecretKey` (and other deprecated secret keys) must not reappear in config on disk.
- RPC URLs still include `advancedTx=true`, and swap fee changes update both buy/sell paths.
- `executionMode` remains `basic`|`fast`; debug remains `DEBUG_MODE`-only.
- If `solana-swap` or RPC behavior changes, note manual verification steps.
