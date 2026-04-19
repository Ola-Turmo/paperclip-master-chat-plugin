# Contributing

## Baseline workflow

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Run the fast contributor lane:
   ```bash
   pnpm verify
   ```
3. Run the production dependency audit before opening a PR:
   ```bash
   pnpm audit:prod
   ```

## Required checks

Every substantive change should keep these green:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm audit:prod`
- `pnpm repo:check`

## Environment notes

- `gatewayMode=mock` is the default contributor-safe lane for deterministic tests.
- `gatewayMode=auto` and `gatewayMode=cli` reuse trusted host-local Hermes installs.
- `gatewayMode=http` now requires adapter authentication material (`hermesAuthToken`).
- CLI smoke tests against a real Hermes install remain opt-in and environment-specific.

## Change expectations

- Keep config, docs, and tests aligned when gateway semantics or limits change.
- Prefer adding regression tests for worker/runtime behavior before broad refactors.
- Treat plugin UI and worker code as trusted instance code under Paperclip's current alpha runtime model.
