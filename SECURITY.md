# Security Policy

## Supported Versions

Security fixes are released from the latest published version of `@vault77/summon`.
Users should upgrade with:

```bash
npm install -g @vault77/summon@latest
```

## Threat Model

### At rest

- Wallet private keys are stored in the macOS Keychain via `keytar`, not in
  `config.json` or other project files.
- Non-secret operator settings (RPC URL, slippage, fees, execution mode, etc.)
  live in `~/Library/Application Support/summonTheWarlord/config.json`.
- The RPC URL may embed an API key as a query parameter; treat that file as
  sensitive on shared machines and avoid pasting full URLs into public logs.

### In use

- On trade (and related) paths, the key is read from Keychain into the Node
  process heap, expanded into a Solana `Keypair`, and held on a memoized
  `SolanaTracker` client for the lifetime of that process so retries do not
  re-prompt or re-load unnecessarily.
- Keys therefore **do** exist in JavaScript/process memory while the CLI is
  running a swap session. They are not claimed to be hardware-enclave-only or
  zero-knowledge to the local process.
- Temporary parse buffers used only for validation may be zeroed; the live
  `Keypair` secret buffer is retained for signing (wiping it would break trades).
- Signing happens locally with that keypair. The private key is not intended
  to leave the machine via the swap HTTP API.
- Private key paste requires an interactive terminal; non-TTY pipe/paste is
  refused so secrets are not echoed into logs.

### Same-user malware / local compromise

- Anything that can run as the same macOS user (or with Keychain access and
  process memory access) can potentially read Keychain items the user has
  unlocked, dump process memory, or abuse an already-loaded keypair.
- This tool does not defend against a fully compromised operator account.
  Use OS updates, least privilege, and a dedicated trading wallet.

### Remote swap API trust

- Swap transactions are built by the SolanaTracker swap backend
  (`solana-swap` / swap-v2 API). The CLI signs those transactions locally and
  submits them via the configured RPC.
- Operators must trust that the remote service returns transactions that match
  the intended mint, amounts, and program paths. `executionMode=basic` enables
  RPC preflight simulation; it does not independently re-verify every
  instruction against a full local policy engine.
- Network path: quote/build over HTTPS to SolanaTracker; send/confirm over the
  operator’s RPC endpoint.

### RPC API keys in URLs

- SolanaTracker-style RPC endpoints often include credentials in the URL.
  Those strings appear in config, may appear in DEBUG/SDK logs, and are sent
  to the RPC host on every request.
- Do not commit config files or share debug dumps that contain full RPC URLs.

## Execution Modes

| Mode    | Preflight (`skipPreflight`) | Latency | Notes |
|---------|-----------------------------|---------|--------|
| `fast`  | Skipped (`true`)            | Lower   | Default. Optimized for speed; failed txs surface after submission. |
| `basic` | Enabled (`false`)           | Higher  | RPC simulates the transaction before send; better chance to catch bad builds early. |

**Recommendation:** Default remains `fast` for trench latency. Prefer
`executionMode=basic` for larger sizes, unfamiliar mints, or when you want
safer preflight at the cost of speed. Configure via setup/wizard or:

```bash
summon config set executionMode basic
```

`DEBUG_MODE` is independent: it controls verbose SDK/network logging, not
preflight. Only `DEBUG_MODE` (not `NODE_ENV`) enables swap debug logging.

## What We Never Do

- Send the private key over the swap HTTP API (only public key / signed payloads
  as required by the SDK flow).
- Intentionally log private keys or Keychain secrets.
- Ship or package wallet secrets, API keys, or operator `config.json` in the
  npm tarball.
- Store `walletSecretKey` in config as a supported setting (legacy values are
  stripped; see below).

## Operator Recommendations

- Use a **dedicated trading wallet** with limited balances—not your cold or
  primary holdings wallet.
- Prefer `executionMode=basic` for larger trade sizes or when latency is less
  critical.
- Keep Keychain unlocked only as needed; understand that same-user malware can
  target Keychain and process memory.
- Avoid enabling `DEBUG_MODE` when sharing terminal output or CI logs that may
  include full RPC URLs with API keys.
- Verify token mints and amounts before every live swap.
- Rotate RPC credentials if a URL may have leaked.
- Run `summon keychain store` only in an interactive terminal; the CLI validates
  key format before writing to Keychain and never prints the key on
  `summon keychain unlock`.

## Legacy Config

- `walletSecretKey` and `swapAPIKey` are deprecated keys.
- On load and normalize, these keys are **stripped** from the in-memory config
  and rewritten config so secrets are not reintroduced into
  `config.json`.
- Migrate any historical disk secrets into Keychain with
  `summon keychain store`, then confirm with `summon keychain unlock` and
  `summon config view` that the file no longer contains a secret key field.

## Reporting a Vulnerability

Report suspected vulnerabilities privately through GitHub Security Advisories for
this repository, or email the maintainer address listed in `package.json`.

Do not open a public issue for vulnerabilities that could expose private keys,
API keys, wallet balances, trade execution behavior, or npm release integrity.

Helpful reports include:

- affected version
- operating system and Node.js version
- exact command or workflow involved
- whether private keys, API keys, or trade execution may be affected
- reproduction steps that avoid exposing real wallet secrets

## Release Integrity

Official npm releases are published from GitHub Actions. The publish workflow:

- installs from `package-lock.json` with `npm ci`
- runs the automated test suite before publishing
- verifies the npm package file allowlist before publishing
- publishes with npm provenance enabled
- uploads an npm SBOM artifact for release review

Release tags use the `vX.Y.Z` format.

## Supply Chain Controls

This repository keeps `package-lock.json` committed and uses `npm ci` in CI and
release workflows. Dependency version updates land through Dependabot against
`develop`, with cooldowns for routine version updates. CI flags pull requests
that introduce new lockfile packages with install scripts.

Production dependency changes that affect key storage, Solana RPC, swap
construction, signing, or HTTP transport require manual review and trade-path
verification before release.
