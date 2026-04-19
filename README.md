# Paperclip Master Chat Plugin

A standalone **Paperclip plugin** that adds a plugin-owned **Master Chat** surface backed by **Hermes**.

The plugin is intentionally aligned with Paperclip's current product boundary: Paperclip core remains a control plane, while rich conversational UX lives in a plugin. This repo packages the worker, UI, Hermes gateway seam, tests, and documentation needed to develop and ship that plugin as a standalone project.

## What ships in this repo

- **Plugin worker** with `getData` / `performAction` handlers for threads, scope, skills, and message sending
- **Paperclip-native UI** with a thread rail, scoped context controls, inline image attachments, dashboard widget, sidebar entry, and issue detail tab
- **Hermes integration seam** with:
  - `auto` mode that prefers an existing local Hermes CLI/runtime on the host VPS
  - a deterministic `mock` gateway for local development/tests
  - an `http` gateway mode for an external Hermes adapter service
  - a `cli` mode for explicitly shelling out to the local Hermes binary
- **Plugin-owned thread store** persisted via Paperclip plugin state
- **Typed multimodal payload builder** that converts message history into Hermes-friendly content blocks
- **Docs** for architecture, configuration, integration, security, and VPS reuse
- **Tests** for payload transformation, CLI prompt building, worker behavior, and UI helpers

## Architecture summary

```mermaid
flowchart LR
  User[Board user] --> UI[Master Chat plugin UI]
  UI --> Bridge[Paperclip bridge]
  Bridge --> Worker[Plugin worker]
  Worker --> Store[(Plugin state)]
  Worker --> Hermes[Hermes gateway seam]
  Hermes --> Local[Existing local Hermes CLI/runtime]
  Hermes --> Adapter[External adapter service]
  Hermes --> Mock[Deterministic mock gateway]
```

### Current alpha/runtime reality

Paperclip's current plugin runtime does **not** expose a stable `ctx.assets` API. To keep the plugin functional today, this repo ships **inline image attachment support** (via browser `FileReader` data URLs) and documents how to migrate to Paperclip asset persistence once the host runtime exposes that capability.

## Features

- Company-scoped thread list and chat page
- Project / issue / agent scope selection
- Skill toggles and Hermes toolset policy hints
- Inline image previews and multimodal payload packing
- Hermes transcript cards and worker stream updates
- Activity logging + metric emission on successful sends
- Dashboard widget and issue detail entry point
- VPS-aware reuse of an existing `hermes` install when available

## Quick start

### 1) Install

```bash
pnpm install
```

### 2) Verify

```bash
pnpm verify
```

### 3) Check local VPS reuse options

```bash
pnpm vps:check
```

On this VPS, the script detects whether:
- `hermes` is already installed and runnable
- `/root/hermes-agent` exists as a local Hermes checkout
- `/root/work/paperclip` exists as a local Paperclip checkout
- local Hermes ports such as `8787` or `8642` are listening

### 4) Build for Paperclip

```bash
pnpm build
```

Artifacts land in `dist/` and can be installed into a Paperclip instance as a local-path plugin during development.

## Configuration

The plugin exposes instance config fields through the Paperclip manifest schema:

- `gatewayMode`: `auto`, `mock`, `http`, or `cli`
- `hermesCommand`: command/path for the local Hermes CLI
- `hermesWorkingDirectory`: optional cwd for the local Hermes checkout/runtime
- `hermesBaseUrl`: base URL for an external Hermes adapter service when `gatewayMode=http`
- `defaultProfileId`
- `defaultProvider`
- `defaultModel`
- `defaultEnabledSkills`
- `defaultToolsets`
- `availablePluginTools`
- `maxHistoryMessages`
- `allowInlineImageData`
- `enableActivityLogging`

See [`docs/configuration.md`](./docs/configuration.md).

## Hermes integration modes

### `gatewayMode=auto` (recommended on this VPS)

The worker prefers the existing local Hermes install by running the configured `hermesCommand` directly. This is the most direct way to reuse the Hermes agent already present on the server.

### `gatewayMode=cli`

Force local CLI execution even outside auto-detection. Useful when you want predictable host-local routing through the already installed Hermes profile and model setup.

### `gatewayMode=http`

Send normalized payloads to an external adapter service:

```text
POST {hermesBaseUrl}/sessions/continue
```

Expected response:

```json
{
  "assistantText": "Hermes response…",
  "toolTraces": [
    {
      "toolName": "paperclip.dashboard",
      "summary": "Prepared scoped context",
      "input": { "scope": {} },
      "output": { "ok": true }
    }
  ],
  "provider": "openrouter",
  "model": "anthropic/claude-sonnet-4",
  "sessionId": "sess_123"
}
```

See [`docs/integration.md`](./docs/integration.md) for the full contract.

## Repository layout

```text
src/constants.ts          plugin IDs, routes, defaults
src/types.ts              shared domain and gateway types
src/domain/store.ts       plugin-owned state store helpers
src/paperclip/context.ts  Paperclip scope/bootstrap helpers
src/hermes/*              payload builder + CLI/HTTP gateway implementations
src/worker.ts             plugin worker
src/manifest.ts           plugin manifest
src/ui/*                  plugin React UI
tests/*                   payload + CLI + worker + UI helper tests
scripts/*                 VPS reuse detection helpers
```

## Development notes

- `auto` gateway mode is the default and is the best match for this VPS because it reuses the already installed Hermes CLI.
- `mock` keeps unit tests deterministic.
- `http` remains the production seam for a dedicated adapter service.
- The UI uses inline styles and self-contained React components to match Paperclip's current plugin authoring guidance.
- The repo intentionally avoids extra runtime dependencies beyond the Paperclip SDK snapshot and build tools.

## Documentation

- [Architecture](./docs/architecture.md)
- [Configuration](./docs/configuration.md)
- [Integration](./docs/integration.md)
- [Security and caveats](./docs/security.md)
- [VPS reuse guide](./docs/vps-reuse.md)
- [Repository improvement PRD](./docs/prd-repo-improvements.md)

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm vps:check
```

## Status

This repository is production-oriented **plugin code**, but it is honest about current Paperclip alpha limitations. The worker/UI flow, thread state, Hermes reuse strategy, docs, and tests are complete in this repo; production rollout still depends on the target Paperclip instance and whichever Hermes integration mode you enable.
