# summonTheWarlord — Agent Guide

## Project Summary
- CLI (`summon-cli.js`) buys/sells SPL tokens via **Solana Tracker Raptor** HTTP (`lib/raptorClient.js` + `lib/trades.js`) and signs with **Solana Kit** (`lib/txSign.js`, `lib/wallet.js`).
- Configuration lives in JSON under `~/Library/Application Support/summonTheWarlord/config.json`.
- Secrets in Keychain: wallet private key + Raptor API key (`x-api-key`) via `utils/keychain.js`.
- Notifications are macOS-only (`utils/notify.js`).
- Design notes: `docs/ARCHITECTURE.md`. Roadmap: `docs/ROADMAP.md`.

## Repository Expectations
- Prefer an isolated git worktree for multi-PR or large changes (see existing `summonWarlord.worktrees/`).
- Keep changes small and targeted unless a refactor is explicitly requested.
- Run `npm test` and `npm run lint` after changes in `lib/`, `utils/`, `scripts/`, `summon-cli.js`, or `test/`.
- Never log or persist private keys or API keys; use the Keychain flows.
- Prefer `rg` for search and focused patches over broad rewrites.
- If a change affects on-chain trades, call out manual verification steps.

## Solana Developer MCP
When Solana MCP tools are available (remote server `https://mcp.solana.com/mcp`, configured in Grok as `solana-mcp`), prefer them over model memory for Solana questions.

| Tool | Use for |
|---|---|
| `list_sections` | Discover doc source/section ids before non-trivial questions |
| `get_documentation` | Canonical docs for a known source, framework, or library |
| `Solana_Documentation_Search` | Narrow semantic search (APIs, Token-2022, RPC, etc.) |
| `Solana_Expert__Ask_For_Help` | How-to, debugging, failed tx logs, program design |
| `program_autofixer` | Anchor/Pinocchio Rust review (loop until no further pass required) |

Workflow:
1. Capture cluster, SDK language, CLI/Anchor versions, errors, and desired outcome.
2. Use `list_sections` first for non-trivial topics, then `get_documentation` or search/expert tools.
3. This repo is a **Node CLI trading client**, not an on-chain program. Prefer MCP for RPC/web3/SPL questions; use local code + SolanaTracker docs for swap CLI behavior.
4. If you write or modify Solana **program** Rust (rare here), call `program_autofixer` before returning code; apply fixes and re-run until `require_another_tool_call_after_fixing` is false.

## Environment & Tooling
- Target Node.js ≥22.12.0 with ES modules (`"type": "module"`). Dependencies are installed via `npm ci` / `npm install`.
- Assumes macOS Keychain; do not bypass secure storage.
- RPC endpoints must include `advancedTx=true`; `lib/rpcUrl.js` / `ensureAdvancedTx` appends the flag when missing.
- Raptor base URL defaults to `https://raptor-beta.solanatracker.io` (`raptorBaseUrl`). Trade flow: quote → `/swap` → Kit sign → `/send-transaction` → status poll.
- Raptor `txVersion` API values are `V0`/`LEGACY` (config still stores `v0`/`legacy`).
- Tests use **Jest** with `NODE_OPTIONS=--experimental-vm-modules` (ESM). Lint uses ESLint flat config (`eslint.config.js`).
- Stack: `@solana/kit` (no `@solana/web3.js`, no `solana-swap`).

## Configuration & Secrets
- Never commit wallet secrets or API keys. Use `summon keychain` commands to inspect or update stored keys.
- Default config (`lib/config.js`) seeds a public RPC. The swap discount code is hardcoded and must remain hidden from users.
- `priorityFee` may be `"auto"` or numeric. Percent-based amounts are strings ending with `%`; `"auto"` consumes the full balance for sells only.
- Operator fee is hardcoded (`lib/constants.js` → `OPERATOR_FEE`: wallet + 40 bps) and sent as Raptor `feeAccount`/`feeBps`.

## Execution & Testing
- Run the CLI via `node summon-cli.js ...` or the `summon` bin. Buying with `"auto"` is disallowed; selling supports `"auto"` and percentage strings.
- Automated tests: `npm test` / `npm run test:ci`. Lint: `npm run lint`.
- Validate critical trade paths manually on mainnet after Raptor/Kit changes: small buy + sell, doctor, API key missing path.
- When debugging trades, log the quote only if `showQuoteDetails` or `DEBUG_MODE` is true.

## Development Notes
- Wallet secrets → Kit signer in `lib/wallet.js` (`bs58` for secret decode).
- Amounts: human SOL/token/`%`/`auto` → base units in `lib/amounts.js` via Kit RPC balances.
- Signing: `lib/txSign.js` decodes Raptor base64 wire tx, `signTransaction([keyPair], tx)`, re-encodes base64.
- Respect memoized `getSwapClient()` (wallet + rpc + raptor context).
- Keychain failures should surface clear `Error` objects with actionable guidance.

## Dependency Change Rules
- Prefer patch/minor lockfile refreshes over major bumps.
- Do not reintroduce `@solana/web3.js` or `solana-swap` without an explicit decision.
- ESLint 10 is intentionally deferred (Dependabot ignore); stay on 9.x until plugins/config are ready.
- Production deps that touch keys, RPC, swaps, signing, or HTTP need manual review + trade-path verification (see `SECURITY.md`).
- After production dep changes: CI on Node 22+24, `summon doctor -v`, small mainnet smoke test, then tag `vX.Y.Z` for npm publish.

## Operational Checks
- If swaps suddenly fail, hit upstream REST endpoints with `curl` to separate SDK vs backend issues.
- RPC health still depends on operator-provided hosts; the CLI only appends `advancedTx=true`.
- Confirm macOS notification permissions during setup (`summon setup`).

## Agent Instruction Notes
- This file is repository-level guidance. Add `AGENTS.override.md` in a subdirectory when specialized rules are needed.
- Keep this file concise; put long design and roadmap detail in `docs/`.

## Review Checklist
- No changes that bypass Keychain storage or expose secrets in logs.
- RPC URLs still include `advancedTx=true`; swap fee changes update both buy/sell paths.
- If `solana-swap` or RPC behavior changes, note manual verification steps.
- Solana MCP used for Solana doc/API questions when tools are available.
- Large refactors land on a dedicated branch/worktree with tests green before merge.
