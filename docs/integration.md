# Integration

## Supported Hermes integration modes

### 1. Local CLI/runtime reuse (`gatewayMode=auto` or `gatewayMode=cli`)

This is the preferred path on a single VPS that already has Hermes installed.

The worker shells out to the configured Hermes binary and passes:

- the chosen Hermes profile (`-p <profile>`)
- provider override (`--provider`)
- model override (`-m`)
- `--resume <sessionId>` when a durable Hermes session is already known
- a normalized Paperclip-aware prompt assembled from thread scope and history, with unsupported Hermes skills/toolsets filtered out automatically after probing the host install
- `--image <path>` on dedicated image-analysis turns so Hermes can produce OCR/detail summaries before the chat turn is persisted

Representative invocation:

```bash
hermes -p default chat -Q --source tool \
  --provider auto \
  -m MiniMax-M2.7 \
  --resume sess_existing_optional \
  -q "<normalized Paperclip scope + history prompt>"
```

This mode reuses the **existing Hermes agent installation on the host** instead of requiring a separate adapter service.

### Session continuity semantics

- Existing CLI-backed threads reuse `sessionId` with `--resume`.
- New CLI-backed threads start `stateless`, upgrade to `synthetic` continuity as soon as the plugin has enough recent history or a deterministic summary to replay, and upgrade again to `durable` automatically once Hermes returns a real session ID.
- HTTP-backed threads also upgrade to `durable` automatically whenever the adapter returns a real `sessionId`, even if the adapter omits `continuationMode`.
- HTTP mode remains the preferred path for production-grade durable continuation.
- When older thread history is truncated, the worker includes a deterministic synthetic continuity summary instead of claiming durable memory.
- The bundled adapter's `/images/analyze` route now attempts Hermes vision first, falls back to local OCR via `tesseract` when the provider rejects image understanding, and only then degrades to metadata-backed output if neither path yields text, so remote HTTPS deployments can still validate multimodal transport without overstating OCR fidelity.

### 2. External HTTP adapter (`gatewayMode=http`)

The plugin's alternative production seam is an HTTP adapter service.

#### Request

```http
POST /sessions/continue
content-type: application/json
authorization: Bearer <token>
```

Request body shape:

```json
{
  "session": {
    "profileId": "default",
    "sessionId": "sess_existing_optional",
    "model": "MiniMax-M2.7",
    "provider": "auto"
  },
  "metadata": {
    "threadId": "thr_123",
    "title": "CTO alignment"
  },
  "scope": {
    "companyId": "comp_123",
    "projectId": "proj_456",
    "linkedIssueId": "iss_789",
    "selectedAgentIds": ["agt_cto"],
    "mode": "single_agent"
  },
  "skillPolicy": {
    "enabled": [],
    "disabled": [],
    "toolsets": ["web", "file", "vision"]
  },
  "toolPolicy": {
    "allowedPluginTools": ["paperclip.dashboard"],
    "allowedHermesToolsets": ["web", "file", "vision"]
  },
  "continuity": {
    "strategy": "synthetic-summary",
    "olderMessageCount": 6,
    "totalMessageCount": 10,
    "summary": "- User: Earlier board review requested a concise launch-risk summary."
  },
  "context": {
    "company": { "id": "comp_123", "name": "Acme" },
    "project": { "id": "proj_456", "name": "Core App" },
    "linkedIssue": { "id": "iss_789", "name": "Launch risk" },
    "selectedAgents": [{ "id": "agt_cto", "name": "CTO" }],
    "issueCount": 12,
    "agentCount": 4,
    "projectCount": 3,
    "catalog": {
      "companies": { "loaded": 1, "pageSize": 200, "truncated": false },
      "projects": { "loaded": 3, "pageSize": 200, "truncated": false },
      "issues": { "loaded": 12, "pageSize": 200, "truncated": false },
      "agents": { "loaded": 4, "pageSize": 200, "truncated": false }
    },
    "warnings": []
  },
  "tools": [
    {
      "name": "paperclip.dashboard",
      "description": "Allowed Paperclip/plugin tool: paperclip.dashboard",
      "kind": "paperclip"
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Compare delivery risk." },
        { "type": "image", "mimeType": "image/png", "data": "<base64>" },
        { "type": "text", "text": "[image_analysis:diagram.png]\\nVision summary: Architecture screenshot..." }
      ]
    }
  ]
}
```

### 3. Bundled local adapter service

This repo now ships a small Node-based adapter service at `dist/adapter-service.js`.

It is useful when you want:

- the stronger process boundary of HTTP mode,
- auth-protected plugin-to-adapter traffic,
- host-local reuse of the already installed Hermes CLI,
- richer structured metadata than the direct CLI path.

Start it like this:

```bash
MASTER_CHAT_ADAPTER_TOKEN=change-me \
MASTER_CHAT_HERMES_COMMAND=/usr/local/bin/hermes \
MASTER_CHAT_HERMES_CWD=/root/hermes-agent \
MASTER_CHAT_ADAPTER_DEFAULT_PROFILE=default \
MASTER_CHAT_ADAPTER_DEFAULT_PROVIDER=auto \
MASTER_CHAT_ADAPTER_DEFAULT_MODEL=MiniMax-M2.7 \
pnpm adapter:start
```

Set the `MASTER_CHAT_ADAPTER_DEFAULT_*` variables to the same profile/provider/model defaults used by the plugin when the adapter is reusing the same host Hermes install. That avoids re-forcing CLI flags that the local profile already covers.

The service exposes:

- `GET /health`
- `POST /sessions/continue`
- `POST /images/analyze`

#### Response

```json
{
  "assistantText": "Hermes response…",
  "toolTraces": [
    {
      "toolName": "paperclip.dashboard",
      "summary": "Prepared scoped context",
      "input": { "scope": { "companyId": "comp_123" } },
      "output": { "ok": true }
    }
  ],
  "provider": "auto",
  "model": "MiniMax-M2.7",
  "sessionId": "sess_new_or_existing",
  "gatewayMode": "http",
  "continuationMode": "durable"
}
```

## Adapter responsibilities

The external adapter service should:

1. Continue or create Hermes sessions.
2. Translate plugin-provided scope and tools into Hermes system/context prompts.
3. Route multimodal blocks to Hermes in the form expected by the target provider.
4. Analyze images separately when requested and return normalized summary/OCR/detail fields.
5. Filter unsupported Hermes skills/toolsets against the host runtime before passing `-s/-t`.
6. Return normalized text + tool traces.
7. Expose health checks because `gatewayMode=auto` now uses adapter health to decide fallback behavior.
8. Support trusted-host deployments explicitly. This repo now uses direct Node `fetch` automatically for loopback adapter URLs on the same VPS, because Paperclip's guarded `ctx.http.fetch` correctly blocks private ranges. Non-loopback RFC1918/private adapter URLs require explicit `allowPrivateAdapterHosts=true`.
9. Require secure remote transport by default. Non-loopback adapter URLs must use `https` unless the operator explicitly sets `allowInsecureHttpAdapters=true`.
10. Enforce a maximum request body size. The bundled adapter defaults to `MASTER_CHAT_ADAPTER_MAX_BODY_BYTES=15000000` and returns `413` when callers exceed it.
11. Require `application/json` and reject malformed payloads with `400` instead of passing unvalidated input to Hermes.
12. Verify signed requests. The worker now sends `x-master-chat-date`, `x-master-chat-nonce`, and `x-master-chat-signature` headers; the bundled adapter rejects stale or replayed signatures using the shared adapter secret as the HMAC key.
13. Enforce adapter auth in a side-channel-resistant way.

## Remote HTTPS smoke validation

This repo now ships two adapter validation helpers:

- `pnpm remote:smoke:local` — builds the repo, starts the bundled adapter, places an ephemeral self-signed HTTPS proxy in front of it, and exercises the signed remote adapter contract locally.
- `pnpm remote:smoke` — targets an existing remote adapter URL using the same signed request format as the worker.

Example:

```bash
MASTER_CHAT_REMOTE_ADAPTER_URL=https://hermes-adapter.example.com \
MASTER_CHAT_REMOTE_ADAPTER_TOKEN=replace-me \
pnpm remote:smoke
```

The smoke client verifies `/health`, signs requests exactly like the worker, and always exercises `POST /sessions/continue`. Set `MASTER_CHAT_REMOTE_ATTEMPT_IMAGE_ANALYSIS=true` to probe `POST /images/analyze` with the same READY-card PNG, or `MASTER_CHAT_REMOTE_REQUIRE_IMAGE_ANALYSIS=true` to make that image-analysis leg mandatory for the run.

## Paperclip runtime considerations

- The worker persists thread state through `ctx.state` with a schema version.
- Image bytes are persisted to a host-local filesystem store by default and hydrated lazily back into thread detail responses.
- UI calls use the built-in plugin bridge only.
- The browser never needs Hermes secrets or direct provider access.
- Scope selectors are loaded paginated and now surface truncation warnings instead of silently hiding records.
- Retry re-runs only the failed assistant continuation; it does not create a new user turn.
- Worker config updates are validated before apply, so invalid adapter URLs, malformed auth header names, or missing auth fail early instead of breaking the next live turn.

## Multimodal enrichment flow

1. The browser sends a supported inline image data URL.
2. The worker validates bytes/MIME, computes a content hash, and checks prior thread history for cached analysis.
3. If needed, Hermes performs an image-analysis turn:
   - CLI mode uses `hermes chat --image <path>`
   - HTTP mode calls `POST /images/analyze`
4. The worker persists the resulting summary/OCR/details next to the image metadata.
5. The main chat turn includes both the actual image block and a compact text fallback derived from the analysis so providers without strong multimodal continuity still get the critical context.

## Suggested deployment shapes

### Same VPS reuse

```mermaid
sequenceDiagram
  participant UI as Plugin UI
  participant W as Plugin Worker
  participant C as Local Hermes CLI/runtime

  UI->>W: send-message
  W->>C: hermes chat -Q --resume ...
  C-->>W: assistant text
  W-->>UI: persisted thread + stream events
```

### External adapter boundary

```mermaid
sequenceDiagram
  participant UI as Plugin UI
  participant W as Plugin Worker
  participant A as Hermes Adapter
  participant H as Hermes Runtime

  UI->>W: send-message
  W->>A: POST /sessions/continue
  A->>H: continue session + invoke tools
  H-->>A: assistant turn + traces
  A-->>W: normalized response
  W-->>UI: persisted thread + stream events
```
