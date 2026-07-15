# Security Policy

## Supported Versions

Security fixes are released from the latest published version of `@vault77/summon`.
Users should upgrade with:

```bash
npm install -g @vault77/summon@latest
```

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

### High-sensitivity dependencies

| Area | Packages / services | Notes |
|---|---|---|
| Key storage | `keytar` | Native install scripts; macOS Keychain for wallet + Raptor API key. Preserve service/account names on migrations. |
| Swap execution | Raptor HTTP API | Base URL configurable; requires `x-api-key`. Quote/build/send must be verified after URL or field changes. |
| Signing / RPC | `@solana/kit`, `bs58` | Kit signs Raptor wire transactions and reads balances; keep surface intentional. |

### Planned hardening (see `docs/ROADMAP.md`)

- Replace unmaintained Keychain bindings when a maintained macOS-safe alternative is validated.
- Align GitHub Actions majors via Dependabot for the Actions ecosystem.
- Track Raptor GA endpoint when beta ends; keep `raptorBaseUrl` overridable.
