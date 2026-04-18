# Configuration

The plugin uses manifest-based instance configuration.

## Fields

| Field | Type | Default | Purpose |
|---|---|---:|---|
| `gatewayMode` | `auto` \| `mock` \| `http` \| `cli` | `auto` | Chooses the Hermes integration path. `auto` prefers the existing local Hermes CLI on the host. |
| `hermesBaseUrl` | string | `""` | Base URL for an external adapter service when `gatewayMode=http`. |
| `hermesCommand` | string | `hermes` | Command or absolute path for the local Hermes CLI. |
| `hermesWorkingDirectory` | string | `""` | Optional cwd for local Hermes execution, useful when reusing a checked-out Hermes repo on the VPS. |
| `defaultProfileId` | string | `paperclip-master` | Default Hermes profile identifier. |
| `defaultProvider` | string | `openrouter` | Default Hermes provider label. |
| `defaultModel` | string | `anthropic/claude-sonnet-4` | Default Hermes model label. |
| `defaultEnabledSkills` | string[] | built-in list | Default skill toggles shown in the UI and forwarded to Hermes. |
| `defaultToolsets` | string[] | built-in list | Default Hermes toolset policy. |
| `availablePluginTools` | string[] | built-in list | Allowed Paperclip/plugin tool descriptors attached to the Hermes request. |
| `maxHistoryMessages` | number | `24` | Maximum number of recent messages included in each Hermes request. |
| `allowInlineImageData` | boolean | `true` | Allows inline image data URLs from the browser composer. |
| `enableActivityLogging` | boolean | `true` | Writes a summary activity log entry after successful turns. |

## Recommended environments

### This VPS / host-local reuse

```json
{
  "gatewayMode": "auto",
  "hermesCommand": "hermes",
  "hermesWorkingDirectory": "/root/hermes-agent",
  "hermesBaseUrl": ""
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
  "defaultProfileId": "paperclip-master",
  "defaultProvider": "openrouter",
  "defaultModel": "anthropic/claude-sonnet-4"
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
- Use `gatewayMode=http` when you want a dedicated adapter boundary or richer structured traces.
- Keep `availablePluginTools` tightly allowlisted.
- Prefer environment- or instance-specific routing in the adapter service rather than exposing provider secrets to the plugin UI.
- If you expect large inline images, lower browser-side limits or migrate to asset-backed persistence first.
- Run `pnpm vps:check` before local install so you can confirm the plugin can reuse the existing Hermes and Paperclip paths on the host.
