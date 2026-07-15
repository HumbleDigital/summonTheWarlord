# Architecture

This document is the working map for larger refactors. Keep it accurate when module boundaries change.

## Runtime shape

```text
summon-cli.js              Commander entry (ESM)
  ├─ lib/config.js         JSON config under Application Support
  ├─ lib/doctor.js         Health checks (RPC + Raptor + Keychain)
  ├─ lib/tradeInput.js     Amount/mint validation
  ├─ lib/trades.js         buy/sell orchestration
  ├─ lib/swapClient.js     Memoized wallet + RPC + Raptor context
  ├─ lib/raptorClient.js   Raptor HTTP (x-api-key)
  ├─ lib/wallet.js         Kit signer from Keychain secret
  ├─ lib/txSign.js         Sign Raptor base64 wire transactions
  ├─ lib/amounts.js        Human/%/auto → base units via Kit RPC
  ├─ lib/raptorOptions.js  Config → Raptor field mapping
  ├─ lib/constants.js      WSOL, operator fee, defaults
  ├─ utils/keychain.js     keytar: wallet + raptor-api-key
  ├─ utils/notify.js       osascript notifications
  └─ utils/logger.js       Structured logging
```

## Module system

| Layer | Format | Notes |
|---|---|---|
| This package | ESM (`"type": "module"`) | Node ≥22.12.0 |
| `@solana/kit` | Dual (node import/require) | RPC, keys, transaction codecs/signing |
| `keytar` | CJS native addon | Node interop via default import |
| `bs58` | Dual | Private-key secret decoding only |
| Raptor | Hosted HTTP | Default `https://raptor-beta.solanatracker.io` |

## Trade path

1. CLI validates mint/amount (`lib/tradeInput.js`).
2. `getSwapClient()` loads config, Raptor API key, wallet signer, Kit RPC.
3. Resolve amount to base units (`lib/amounts.js`) using balances/decimals.
4. `GET /quote` then `POST /swap` on Raptor with operator fee + config knobs.
5. Kit signs returned base64 `swapTransaction` (`lib/txSign.js`).
6. `POST /send-transaction` → poll `GET /transaction/:sig`.
7. Optional macOS notification.

## Security boundaries

| Asset | Storage | Code owner |
|---|---|---|
| Private key | macOS Keychain `wallet-private-key` | `utils/keychain.js` |
| Raptor API key | macOS Keychain `raptor-api-key` | `utils/keychain.js` |
| Config (RPC, fees, flags) | JSON on disk | `lib/config.js` |
| Operator fee | Hardcoded constants | `lib/constants.js` (`OPERATOR_FEE`) |
| npm publish | GitHub Actions + provenance | `.github/workflows/publish.yml` |

Never log raw keys, API keys, or full RPC URLs with embedded credentials.

## Dependency graph (production, conceptual)

```text
@vault77/summon
  ├─ commander, open, fs-extra     CLI UX / config IO
  ├─ keytar                       Keychain (wallet + API key)
  ├─ bs58                         Secret decode
  └─ @solana/kit                  Signer, RPC balances/decimals, tx codec/sign
       (Raptor is HTTP via fetch — not an npm package)
```

## Test layout

- Runner: Jest 30 with `--experimental-vm-modules`
- Tests: `test/*.test.js`
- Supply-chain helpers: `scripts/check-new-install-scripts.js`, `scripts/verify-packlist.js`
- CI matrix: Node 22 and 24 on macOS
