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
| `hermesAuthHeaderName` | string | `authorization` | Header name used to forward `hermesAuthToken`. |
| `gatewayRequestTimeoutMs` | number | `45000` | Timeout budget for CLI and HTTP requests. |
| `defaultProfileId` | string | `paperclip-master` | Default Hermes profile identifier. |
| `defaultProvider` | string | `openrouter` | Default Hermes provider label. |
| `defaultModel` | string | `anthropic/claude-sonnet-4` | Default Hermes model label. |
| `defaultEnabledSkills` | string[] | `[]` | Default skill toggles shown in the UI. Unsupported Hermes skills are filtered out automatically in CLI/adapter mode. |
| `defaultToolsets` | string[] | `["web", "file", "vision"]` | Default Hermes toolset policy. Unsupported toolsets are filtered out automatically before the Hermes call. |
| `availablePluginTools` | string[] | built-in list | Allowed Paperclip/plugin tool descriptors attached to the Hermes request. |
| `maxHistoryMessages` | number | `24` | Maximum number of recent messages included in each Hermes request. |
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
- Keep `availablePluginTools` tightly allowlisted.
- Prefer environment- or instance-specific routing in the adapter service rather than exposing provider secrets to the plugin UI.
- If you expect large inline images, lower browser-side limits or migrate to asset-backed persistence first.
- Run `pnpm vps:check` before local install so you can confirm the plugin can reuse the existing Hermes and Paperclip paths on the host.
- Watch for bootstrap/thread warnings: they now surface catalog truncation and trusted-host caveats directly in the UI.
- Use `pnpm adapter:start` when you want a host-local HTTP boundary while still reusing the same Hermes CLI install on the VPS.

## CLI compatibility note

When `gatewayMode` is `cli` or `auto` and the local Hermes CLI is selected, the plugin probes the host Hermes install (`hermes skills list` + `hermes tools list`) and filters out unsupported preferences before the request is sent. The remaining compatible preferences are passed as routing context without failing the turn.
