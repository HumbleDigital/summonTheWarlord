# Raptor API Key Wizard Design

## Problem

The config wizard currently asks a yes/no question before requesting a missing Raptor API key. Users can paste the key at the yes/no prompt, which consumes it as the confirmation answer and leaves the wizard waiting for another line. The wizard also catches Keychain errors and continues, allowing setup to appear complete without a key required for swaps.

## Design

The wizard will make the API-key step explicit and stateful:

- If a Raptor API key is already stored, ask whether to replace it. A blank response, `n`, or `no` keeps the existing key and continues.
- If no key is stored, prompt directly for the key. The prompt will explain that the key is required for swaps and that blank, `n`, or `no` exits without saving it.
- A non-empty key is sent through the existing Keychain storage helper. The raw key is never logged, displayed, or written to config.
- A blank, `n`, or `no` response when no key exists returns a controlled incomplete result. The wizard closes its readline interface, prints that no key was saved and swaps remain unavailable, skips `saveConfig()`, and exits with a non-success status without a stack trace.
- Keychain failures remain visible as actionable errors and also produce an incomplete wizard result; configuration is not reported as successfully completed.

The shared wizard runner will return a completion result rather than making callers infer success from reaching the end of the function. Both `config wizard` and `setup` will honor that result and close the interface before returning.

## Language

Use direct wording such as:

`Paste your Raptor API key (required for swaps; press Enter, or type n/no, to exit):`

The surrounding heading will say that the key is stored in macOS Keychain and sent as the `x-api-key` request header, not written to `config.json`.

## Testing

Add focused tests for the decision behavior:

- missing key plus a non-empty input stores the key and completes the step;
- missing key plus blank, `n`, or `no` returns an incomplete result without storing;
- existing key plus blank, `n`, or `no` keeps the key and completes;
- existing key plus `y` stores the replacement;
- storage errors return an incomplete result and do not claim completion.

Keep the existing Keychain implementation and secret masking path; the change is limited to prompt semantics, completion propagation, and user-facing text.
