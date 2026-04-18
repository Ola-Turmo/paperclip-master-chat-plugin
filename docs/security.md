# Security and Caveats

## Security posture

This plugin follows the current Paperclip alpha plugin model:

- plugin UI and worker should be treated as **trusted code**
- the plugin is installed **instance-wide**, not per-company
- the browser does **not** talk directly to Hermes
- tool policies are allowlist-driven and live in worker-controlled state/config

## Recommended controls

1. **Run shared instances in authenticated mode** — avoid `local_trusted` outside single-operator environments.
2. **Prefer `gatewayMode=http` behind an internal adapter service** — keep provider credentials and tool routing logic server-side.
3. **Keep `availablePluginTools` minimal** — default-deny dangerous tools.
4. **Audit activity** — the worker already writes lightweight activity summaries; extend this in production.
5. **Rate limit upstream of the adapter** — current plugin code does not enforce infra-level quotas by itself.

## Current runtime caveats

### No stable asset API

Paperclip's current plugin authoring guidance says `ctx.assets` is not part of the supported runtime yet. This repo therefore stores inline image payloads with message records for alpha functionality and documents the migration path to asset-backed persistence later.

### Same-origin plugin UI

The current plugin runtime does not provide a strong browser sandbox boundary for UI bundles. Treat plugin UI as privileged instance code.

### State storage is simple by design

Using plugin state for thread persistence is appropriate for the current alpha plugin surface and tests, but higher-scale installs may prefer a richer backing store when the host runtime exposes it.

## Honest scope of this repository

This repo fully implements the plugin-side system and a documented Hermes integration seam. Production readiness still depends on:

- the target Paperclip instance configuration
- the external Hermes adapter deployment
- the operator's chosen auth, rate limiting, and observability posture
