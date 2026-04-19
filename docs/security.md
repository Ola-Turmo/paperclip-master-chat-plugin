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
- filesystem attachment persistence is the default, reducing long-lived inline blob exposure inside plugin state
- image analysis results are cached by attachment hash, reducing repeated vision/OCR calls for the same image within a thread
- inline image data can be disabled with `allowInlineImageData=false`
- the worker allows only one in-flight send per thread at a time
- retry replays only the failed assistant continuation instead of duplicating the user turn
- tool traces are redacted before persistence when `redactToolPayloads=true`
- HTTP adapter mode fails closed unless `hermesAuthToken` is configured
- the bundled local adapter service requires the configured auth header/token before it will continue sessions
- the bundled local adapter service compares auth tokens with `timingSafeEqual`, requires timestamped HMAC signature headers, rejects stale/replayed nonces, requires `application/json`, validates the payload shape, and rejects oversized request bodies with `413`
- adapter responses that include a real `sessionId` are treated as durable continuation even if the adapter omits `continuationMode`, which reduces accidental stateless fallbacks in mixed adapter fleets
- unsupported Hermes capability preferences are filtered before local CLI or adapter requests so host-specific catalogs do not become runtime footguns
- loopback adapter URLs are treated as trusted-host deployments and use direct Node `fetch` instead of Paperclip's SSRF-guarded `ctx.http.fetch`
- non-loopback RFC1918/private adapter URLs require `allowPrivateAdapterHosts=true`
- non-loopback remote adapter URLs must use `https` unless `allowInsecureHttpAdapters=true`
- config validation rejects invalid HTTP adapter settings before the worker accepts them, including malformed auth header names
- message text is capped with `maxMessageChars` and enforced in both the UI and worker
- invalid runtime config changes are ignored instead of replacing the last known-safe worker config

## Recommended controls

1. **Run shared instances in authenticated mode** — avoid `local_trusted` outside single-operator environments.
2. **Prefer `gatewayMode=auto` or `gatewayMode=cli` only on trusted single-host deployments** — these modes execute the local Hermes CLI from the Paperclip host.
3. **Prefer `gatewayMode=http` behind an internal adapter service** when you want a stricter process boundary, richer request auditing, or centralized provider policy.
4. **Treat loopback adapter URLs as a trusted-host feature, not a general remote deployment pattern.** The direct-fetch bypass exists so a same-VPS adapter can work even though Paperclip's guarded HTTP client blocks private ranges by design.
5. **Enable `allowPrivateAdapterHosts` only when you truly need an RFC1918/private non-loopback adapter URL.** It widens the trusted-network surface intentionally.
6. **Keep `allowInsecureHttpAdapters` disabled unless you are deliberately using an internal non-HTTPS adapter.** Public or cross-host adapter traffic should be HTTPS by default.
7. **Keep `availablePluginTools` minimal** — default-deny dangerous tools.
8. **Audit activity** — the worker already writes lightweight activity summaries and failure metrics; extend this in production.
9. **Rate limit upstream of the adapter or Paperclip host** — this repo exposes clear integration seams, but infra-level quotas still belong in the deployment.
10. **Keep adapter default env aligned with plugin defaults** (`MASTER_CHAT_ADAPTER_DEFAULT_PROFILE/PROVIDER/MODEL`) when you reuse the same Hermes host install through HTTP mode.
11. **Keep the adapter clock sane** — HMAC freshness checks use `MASTER_CHAT_ADAPTER_MAX_CLOCK_SKEW_MS` (default 5 minutes), so host time drift can cause legitimate requests to fail.
12. **Exercise the signed adapter transport before rollout** — use `pnpm remote:smoke` or `pnpm remote:smoke:local` so `/sessions/continue` is validated under the same auth/signature scheme, and enable `MASTER_CHAT_REMOTE_ATTEMPT_IMAGE_ANALYSIS=true` when the target Hermes runtime should also be expected to pass `/images/analyze`.

## Current runtime caveats

### No stable asset API

Paperclip's current plugin authoring guidance says `ctx.assets` is not part of the supported runtime yet. This repo therefore stores image bytes in a host-local filesystem attachment store by default, hydrates them only when needed for UI/Hermes use, and documents the migration path to asset-backed persistence later.

### Same-origin plugin UI

The current plugin runtime does not provide a strong browser sandbox boundary for UI bundles. Treat plugin UI as privileged instance code.

### Local CLI reuse has host-level trust implications

When you enable `gatewayMode=auto` or `gatewayMode=cli`, the plugin worker executes the local `hermes` command with the configured profile/toolsets. That means:

- Paperclip and Hermes share the same host trust boundary
- Hermes inherits whatever tools and credentials are already configured for that profile
- operator review of the Hermes profile/toolsets matters as much as plugin configuration

This is a feature for a trusted VPS, but it is not the same isolation level as an external adapter.

### State storage is simple by design

Using plugin state for thread persistence is appropriate for the current alpha plugin surface and tests, but higher-scale installs may prefer a richer backing store when the host runtime exposes it. The current filesystem attachment backend is intentionally local-host scoped, so shared or ephemeral hosts still need durable storage planning.

## Honest scope of this repository

This repo fully implements the plugin-side system and both documented Hermes integration seams:

- host-local Hermes CLI/runtime reuse
- external HTTP adapter integration

Production readiness still depends on:

- the target Paperclip instance configuration
- the chosen Hermes integration mode
- the operator's auth, rate limiting, and observability posture
- the operator's local storage policy for filesystem-backed image attachments
