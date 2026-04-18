# Security and Caveats

## Security posture

This plugin follows the current Paperclip alpha plugin model:

- plugin UI and worker should be treated as **trusted code**
- the plugin is installed **instance-wide**, not per-company
- the browser does **not** talk directly to Hermes
- tool policies are allowlist-driven and live in worker-controlled state/config

## Recommended controls

1. **Run shared instances in authenticated mode** — avoid `local_trusted` outside single-operator environments.
2. **Prefer `gatewayMode=auto` or `gatewayMode=cli` only on trusted single-host deployments** — these modes execute the local Hermes CLI from the Paperclip host.
3. **Prefer `gatewayMode=http` behind an internal adapter service** when you want a stricter process boundary, richer request auditing, or centralized provider policy.
4. **Keep `availablePluginTools` minimal** — default-deny dangerous tools.
5. **Audit activity** — the worker already writes lightweight activity summaries; extend this in production.
6. **Rate limit upstream of the adapter or Paperclip host** — current plugin code does not enforce infra-level quotas by itself.

## Current runtime caveats

### No stable asset API

Paperclip's current plugin authoring guidance says `ctx.assets` is not part of the supported runtime yet. This repo therefore stores inline image payloads with message records for alpha functionality and documents the migration path to asset-backed persistence later.

### Same-origin plugin UI

The current plugin runtime does not provide a strong browser sandbox boundary for UI bundles. Treat plugin UI as privileged instance code.

### Local CLI reuse has host-level trust implications

When you enable `gatewayMode=auto` or `gatewayMode=cli`, the plugin worker executes the local `hermes` command with the configured profile/toolsets. That means:

- Paperclip and Hermes share the same host trust boundary
- Hermes inherits whatever tools and credentials are already configured for that profile
- operator review of the Hermes profile/toolsets matters as much as plugin configuration

This is a feature for a trusted VPS, but it is not the same isolation level as an external adapter.

### State storage is simple by design

Using plugin state for thread persistence is appropriate for the current alpha plugin surface and tests, but higher-scale installs may prefer a richer backing store when the host runtime exposes it.

## Honest scope of this repository

This repo fully implements the plugin-side system and both documented Hermes integration seams:

- host-local Hermes CLI/runtime reuse
- external HTTP adapter integration

Production readiness still depends on:

- the target Paperclip instance configuration
- the chosen Hermes integration mode
- the operator's auth, rate limiting, and observability posture
