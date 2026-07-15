# Roadmap — larger updates

Working plan derived from dependency and architecture review (2026-07). Use this when scheduling multi-PR work. Ship in worktrees; keep `develop` releasable.

## North stars

1. **Safe trade path** — no silent breakage of buy/sell/confirm.
2. **Secret hygiene** — Keychain-only keys; no secret leakage in logs or packages.
3. **Currency without churn** — stay on supported Node and maintainable deps; avoid speculative majors.

## What is already true

- Most direct dependencies are at latest within their lines.
- Package is ESM-native and interops with dual/CJS deps.
- Dependabot (npm), install-script PR checks, provenance publish, and SBOM upload are in place.
- Solana Developer MCP (`https://mcp.solana.com/mcp`) is available for agents that configure it.

## Workstreams

### WS0 — Docs & agent readiness (this branch)

- [x] Worktree for large-change prep
- [x] `AGENTS.md` Solana MCP + accurate tooling notes
- [x] `docs/ARCHITECTURE.md` / `docs/ROADMAP.md`
- [ ] Optional: project-level Grok MCP config if the team wants repo-shared Solana MCP (user-level already configured)

### WS1 — Low-risk dependency hygiene

Goal: clean audit noise and patch currency without trade-path risk.

- [ ] Bump `fs-extra` to latest 11.x patch
- [ ] Bump ESLint 9.x / `@eslint/js` 9.x patches only
- [ ] `npm audit fix` for fixable **dev** transitives (`@babel/core`, `js-yaml`)
- [ ] Remove unused `eslint-plugin-import` or wire it into `eslint.config.js`
- [ ] Document why `axios` is a direct dependency (or drop the direct dep and re-verify hoisting)

**Exit criteria:** `npm test`, `npm run lint`, no production behavior change.

### WS2 — CI / Actions alignment

Goal: consistent, current automation.

- [ ] Add Dependabot `github-actions` ecosystem targeting `develop`
- [ ] Align `actions/checkout`, `actions/setup-node`, `upload-artifact`, CodeQL actions across `ci.yml`, `codeql.yml`, `publish.yml`
- [ ] Confirm Dependabot PRs still open against cooldowns (not silently stuck)

**Exit criteria:** CI green on 22+24; publish workflow unchanged in intent (test → packlist → provenance).

### WS3 — Keychain modernization

Goal: leave unmaintained `keytar` (last real release 2022) for a maintained macOS secret store.

- [ ] Spike candidates (e.g. `@napi-rs/keyring` or thin Security.framework binding)
- [ ] Compatibility: preserve service/account names so existing stored keys keep working
- [ ] Feature-flag or dual-read migration path if needed
- [ ] Update `summon doctor`, setup, and keychain tests
- [ ] Manual macOS Keychain verification on Apple Silicon

**Exit criteria:** store/unlock/delete work without re-entry for existing users; doctor green; no keys on disk.

### WS4 — Solana stack strategy (only when forced or clearly beneficial)

Goal: decide how to track `@solana/web3.js` / kit and `uuid` transitive advisories.

**Do not** major-bump web3 while `solana-swap` requires 1.x.

Options (pick one when ready):

| Option | When | Effort |
|---|---|---|
| A. Stay on web3 1.x + exact `solana-swap` | Default | Low |
| B. Upstream `solana-swap` adopts newer stack | Prefer if SolanaTracker ships it | Medium |
| C. Replace SDK with direct SolanaTracker HTTP + own signing | If SDK stalls | High |

- [ ] Track `solana-swap` releases and SolanaTracker API docs
- [ ] If choosing C: design swap client interface that keeps `lib/trades.js` stable
- [ ] Any swap-path change: mainnet quote + tiny buy/sell smoke tests

**Exit criteria:** documented decision; if code changes, manual trade verification checklist completed.

### WS5 — Optional tooling quality-of-life

- [ ] Evaluate `node:test` vs Jest ESM experimental flag
- [ ] ESLint 10 when plugin/ecosystem support is clear (remove Dependabot ignore)
- [ ] Consider `npm overrides` for `uuid` **only** after compatibility check of `jayson` / `rpc-websockets` (default: avoid)

## Suggested PR sequence

1. **docs** — this roadmap + agent guide (no runtime change)
2. **chore(deps)** — WS1 patches
3. **ci** — WS2 Actions/Dependabot
4. **feat(keychain)** — WS3 behind careful review
5. **feat(swap)** — WS4 only after explicit product decision

## Manual verification (any trade-path PR)

```bash
npm ci
npm test
npm run lint
node summon-cli.js doctor -v
# Then operator-only:
# node summon-cli.js buy <mint> <small-sol-amount>
# node summon-cli.js sell <mint> <percent-or-auto>
```

Never automate mainnet trades in CI.

## Explicit non-goals (for now)

- Dual CJS+ESM packaging of `@vault77/summon`
- Supporting non-macOS platforms
- Migrating to Solana web3 2 / kit without SDK or replacement plan
- Broadening `solana-swap` from an exact version pin without release testing
