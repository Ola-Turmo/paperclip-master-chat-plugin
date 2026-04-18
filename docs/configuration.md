# Configuration

The plugin uses manifest-based instance configuration.

## Fields

| Field | Type | Default | Purpose |
|---|---|---:|---|
| `gatewayMode` | `mock` \| `http` | `mock` | Selects whether the worker uses the built-in deterministic mock gateway or calls an external Hermes adapter service. |
| `hermesBaseUrl` | string | `http://127.0.0.1:8787` | Base URL for the adapter service when `gatewayMode=http`. |
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

### Local development

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

## Operational guidance

- Keep `availablePluginTools` tightly allowlisted.
- Prefer environment- or instance-specific routing in the adapter service rather than exposing provider secrets to the plugin UI.
- If you expect large inline images, lower browser-side limits or migrate to asset-backed persistence first.
