# Security and Caveats

## Security posture

This plugin follows the current Paperclip alpha plugin model:

- plugin UI and worker should be treated as **trusted code**
- the plugin is installed **instance-wide**, not per-company
- the browser does **not** talk directly to Hermes
- tool policies are allowlist-driven and live in worker-controlled state/config

## Runtime controls now enforced in code

- company/project/issue/agent scope references are validated against company-scoped Paperclip records
- attachment count/type/per-file-size/total-size limits are enforced in both the UI and worker, and the worker recomputes image byte size from the actual base64 payload instead of trusting client-provided metadata
- inline image data can be disabled with `allowInlineImageData=false`
- the worker allows only one in-flight send per thread at a time
- retry replays only the failed assistant continuation instead of duplicating the user turn
- tool traces are redacted before persistence when `redactToolPayloads=true`
- HTTP adapter mode fails closed unless `hermesAuthToken` is configured
- the bundled local adapter service requires the configured auth header/token before it will continue sessions
- the bundled local adapter service compares auth tokens with `timingSafeEqual` and rejects oversized request bodies with `413`
- the bundled local adapter service compares auth headers in constant time and rejects oversized JSON bodies before parsing them
- unsupported Hermes capability preferences are filtered before local CLI or adapter requests so host-specific catalogs do not become runtime footguns
- loopback adapter URLs are treated as trusted-host deployments and use direct Node `fetch` instead of Paperclip's SSRF-guarded `ctx.http.fetch`
- non-loopback RFC1918/private adapter URLs require `allowPrivateAdapterHosts=true`
- config validation rejects invalid HTTP adapter settings before the worker accepts them
- message text is capped with `maxMessageChars` and enforced in both the UI and worker

## Recommended controls

1. **Run shared instances in authenticated mode** — avoid `local_trusted` outside single-operator environments.
2. **Prefer `gatewayMode=auto` or `gatewayMode=cli` only on trusted single-host deployments** — these modes execute the local Hermes CLI from the Paperclip host.
3. **Prefer `gatewayMode=http` behind an internal adapter service** when you want a stricter process boundary, richer request auditing, or centralized provider policy.
4. **Treat loopback adapter URLs as a trusted-host feature, not a general remote deployment pattern.** The direct-fetch bypass exists so a same-VPS adapter can work even though Paperclip's guarded HTTP client blocks private ranges by design.
5. **Enable `allowPrivateAdapterHosts` only when you truly need an RFC1918/private non-loopback adapter URL.** It widens the trusted-network surface intentionally.
6. **Keep `availablePluginTools` minimal** — default-deny dangerous tools.
7. **Audit activity** — the worker already writes lightweight activity summaries and failure metrics; extend this in production.
8. **Rate limit upstream of the adapter or Paperclip host** — this repo exposes clear integration seams, but infra-level quotas still belong in the deployment.
9. **Keep adapter default env aligned with plugin defaults** (`MASTER_CHAT_ADAPTER_DEFAULT_PROFILE/PROVIDER/MODEL`) when you reuse the same Hermes host install through HTTP mode.

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
