# Configuration

The plugin uses manifest-based instance configuration.

## Fields

| Field | Type | Default | Purpose |
|---|---|---:|---|
| `gatewayMode` | `auto` \| `mock` \| `http` \| `cli` | `auto` | Chooses the Hermes integration path. `auto` probes the local CLI before trying the authenticated HTTP adapter. |
| `hermesBaseUrl` | string | `""` | Base URL for an external adapter service when `gatewayMode=http`. |
| `hermesCommand` | string | `hermes` | Command or absolute path for the local Hermes CLI. |
| `hermesWorkingDirectory` | string | `""` | Optional cwd for local Hermes execution, useful when reusing a checked-out Hermes repo on the VPS. |
| `hermesAuthToken` | string | `""` | Shared secret or bearer token for the Hermes HTTP adapter. Required for `gatewayMode=http`. |
| `hermesAuthHeaderName` | string | `authorization` | Header name used to forward `hermesAuthToken`. Must be a valid HTTP header token. |
| `allowPrivateAdapterHosts` | boolean | `false` | Allows direct Node `fetch` to RFC1918/private adapter hosts beyond loopback. Leave disabled unless the adapter lives on a trusted internal network. |
| `allowInsecureHttpAdapters` | boolean | `false` | Allows non-loopback `http://` adapter URLs. Leave disabled unless you are intentionally using a trusted internal adapter without HTTPS. |
| `gatewayRequestTimeoutMs` | number | `45000` | Timeout budget for CLI and HTTP requests. |
| `defaultProfileId` | string | `paperclip-master` | Default Hermes profile identifier. |
| `defaultProvider` | string | `openrouter` | Default Hermes provider label. |
| `defaultModel` | string | `anthropic/claude-sonnet-4` | Default Hermes model label. |
| `defaultEnabledSkills` | string[] | `[]` | Default skill toggles shown in the UI. Unsupported Hermes skills are filtered out automatically in CLI/adapter mode. |
| `defaultToolsets` | string[] | `["web", "file", "vision"]` | Default Hermes toolset policy. Unsupported toolsets are filtered out automatically before the Hermes call. |
| `availablePluginTools` | string[] | built-in list | Allowed Paperclip/plugin tool descriptors attached to the Hermes request. |
| `maxHistoryMessages` | number | `24` | Maximum number of recent messages included in each Hermes request. |
| `maxMessageChars` | number | `12000` | Maximum trimmed text length accepted for one user turn. Enforced in both the UI and worker. |
| `allowInlineImageData` | boolean | `true` | Allows inline image data URLs from the browser composer. |
| `maxAttachmentCount` | number | `4` | Maximum images accepted in one turn. |
| `maxAttachmentBytesPerFile` | number | `5000000` | Per-file inline image limit. |
| `maxTotalAttachmentBytes` | number | `12000000` | Total inline image budget for a single turn. |
| `maxCatalogRecords` | number | `1000` | Maximum records loaded for each company-scoped selector collection before truncation is surfaced. |
| `scopePageSize` | number | `200` | Page size used while loading scope selectors. |
| `redactToolPayloads` | boolean | `true` | Redacts tool input/output payloads before persistence. |
| `enableActivityLogging` | boolean | `true` | Writes a summary activity log entry after successful turns. |

## Recommended environments

### This VPS / host-local reuse

```json
{
  "gatewayMode": "auto",
  "hermesCommand": "/usr/local/bin/hermes",
  "hermesWorkingDirectory": "/root/hermes-agent",
  "hermesBaseUrl": "",
  "defaultProfileId": "default",
  "defaultProvider": "auto",
  "defaultModel": "MiniMax-M2.7",
  "defaultEnabledSkills": [],
  "defaultToolsets": ["web", "file", "vision"]
}
```

### Local development without a live Hermes runtime

```json
{
  "gatewayMode": "mock",
  "enableActivityLogging": false
}
```

### Shared/dev Paperclip instance with external adapter

```json
{
  "gatewayMode": "http",
  "hermesBaseUrl": "https://hermes-adapter.internal",
  "hermesAuthToken": "replace-me",
  "hermesAuthHeaderName": "authorization",
  "defaultProfileId": "paperclip-master",
  "defaultProvider": "openrouter",
  "defaultModel": "anthropic/claude-sonnet-4"
}
```

### Host-local bundled adapter service

```json
{
  "gatewayMode": "http",
  "hermesBaseUrl": "http://127.0.0.1:8788",
  "hermesAuthToken": "replace-me",
  "hermesAuthHeaderName": "authorization"
}
```

Recommended bundled adapter environment on this VPS:

```bash
MASTER_CHAT_ADAPTER_TOKEN=replace-me \
MASTER_CHAT_HERMES_COMMAND=/usr/local/bin/hermes \
MASTER_CHAT_HERMES_CWD=/root/hermes-agent \
MASTER_CHAT_ADAPTER_DEFAULT_PROFILE=default \
MASTER_CHAT_ADAPTER_DEFAULT_PROVIDER=auto \
MASTER_CHAT_ADAPTER_DEFAULT_MODEL=MiniMax-M2.7 \
MASTER_CHAT_ADAPTER_MAX_BODY_BYTES=15000000 \
pnpm adapter:start
```

The `MASTER_CHAT_ADAPTER_DEFAULT_*` values let the adapter mirror the Hermes host defaults instead of redundantly forcing provider/model flags that are already satisfied by the local profile.
`MASTER_CHAT_ADAPTER_MAX_BODY_BYTES` bounds incoming JSON request size before the adapter parses it.

### Force the local CLI explicitly

```json
{
  "gatewayMode": "cli",
  "hermesCommand": "/usr/local/bin/hermes",
  "hermesWorkingDirectory": "/root/hermes-agent"
}
```

## Operational guidance

- Use `gatewayMode=auto` when the plugin and Hermes run on the same trusted VPS.
- Use `gatewayMode=http` when you want a dedicated adapter boundary, stronger service auth, or richer structured traces.
- Keep `allowPrivateAdapterHosts=false` unless you explicitly need a non-loopback RFC1918 adapter URL. Loopback URLs already work without this flag.
- Keep `allowInsecureHttpAdapters=false` unless the adapter is on a trusted internal network and HTTPS is genuinely unavailable.
- Keep `availablePluginTools` tightly allowlisted.
- Prefer environment- or instance-specific routing in the adapter service rather than exposing provider secrets to the plugin UI.
- If you expect large inline images, lower browser-side limits or migrate to asset-backed persistence first.
- Tune `maxMessageChars` alongside attachment limits if you need tighter anti-abuse budgets.
- Run `pnpm vps:check` before local install so you can confirm the plugin can reuse the existing Hermes and Paperclip paths on the host.
- Run `pnpm vps:smoke` when you want one command that rebuilds the repo, refreshes the local Paperclip install, and verifies both CLI and HTTP paths end to end.
- Watch for bootstrap/thread warnings: they now surface catalog truncation and trusted-host caveats directly in the UI.
- Use `pnpm adapter:start` when you want a host-local HTTP boundary while still reusing the same Hermes CLI install on the VPS.
- The bundled adapter honors `MASTER_CHAT_ADAPTER_MAX_BODY_BYTES` (default `15000000`) so authenticated callers cannot stream arbitrarily large JSON payloads into the adapter process.
- The bundled adapter also honors `MASTER_CHAT_ADAPTER_MAX_CLOCK_SKEW_MS` (default `300000`) for signed request freshness checks.

## Validation behavior

The worker validates config updates before accepting them:

- `gatewayMode=http` requires both `hermesBaseUrl` and `hermesAuthToken`
- `hermesBaseUrl` must be an absolute `http` or `https` URL
- `hermesAuthHeaderName` must be a syntactically valid HTTP header name
- non-loopback adapter URLs must use `https` unless `allowInsecureHttpAdapters=true`
- loopback adapter URLs are always allowed for same-host deployments
- RFC1918/private adapter URLs require `allowPrivateAdapterHosts=true`
- `maxTotalAttachmentBytes` must be at least `maxAttachmentBytesPerFile`
- `maxMessageChars` must be at least `1`
- explicit blank or malformed `hermesAuthHeaderName` values and explicit `maxMessageChars <= 0` are rejected instead of being silently coerced to defaults
- invalid runtime config changes are ignored instead of replacing the last known-safe worker config
- the bundled adapter expects timestamped HMAC signature headers on `/sessions/continue` and rejects stale or replayed nonces

## CLI compatibility note

When `gatewayMode` is `cli` or `auto` and the local Hermes CLI is selected, the plugin probes the host Hermes install (`hermes skills list` + `hermes tools list`) and filters out unsupported preferences before the request is sent. The remaining compatible preferences are passed as routing context without failing the turn. If Hermes returns a real session ID for a new CLI conversation, the plugin now upgrades that thread to durable continuation automatically.
