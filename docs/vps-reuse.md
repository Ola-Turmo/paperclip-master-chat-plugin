# VPS Reuse Guide

This repository was adapted to **reuse the existing Hermes and Paperclip installs already present on the VPS whenever possible**.

## What the plugin can reuse

### Hermes

If `hermes` is already installed on the host, the plugin can use it directly via:

```json
{
  "gatewayMode": "auto",
  "hermesCommand": "hermes",
  "hermesWorkingDirectory": "/root/hermes-agent"
}
```

`gatewayMode=auto` prefers the local CLI/runtime first, so you do not need a separate adapter service just to get the plugin talking to Hermes.

If you want an HTTP boundary while still reusing the same local Hermes install, run the bundled adapter service:

```bash
MASTER_CHAT_ADAPTER_TOKEN=change-me \
MASTER_CHAT_HERMES_COMMAND=/usr/local/bin/hermes \
MASTER_CHAT_HERMES_CWD=/root/hermes-agent \
pnpm adapter:start
```

### Paperclip

If the Paperclip repo already exists locally, you can install the plugin into that checkout from a **local path**.

For this VPS the expected pattern is:

```bash
cd /root/work/paperclip
pnpm paperclipai plugin install /root/projects/paperclip-master-chat-plugin
```

That matches Paperclip's documented local-path plugin workflow.

## Detect what is available

Run:

```bash
pnpm vps:check
```

The script reports:

- whether `hermes` is on `PATH`
- whether `/root/hermes-agent` exists
- whether `/root/work/paperclip` exists
- whether Hermes-related ports such as `8787` or `8642` are listening
- the recommended plugin config snippet for this host

## Recommended setup for this VPS

1. Build the plugin:

```bash
pnpm build
```

2. Confirm local reuse detection:

```bash
pnpm vps:check
```

3. Install into the local Paperclip checkout if desired:

```bash
cd /root/work/paperclip
pnpm paperclipai plugin install /root/projects/paperclip-master-chat-plugin
```

4. In Paperclip plugin settings, use config like:

```json
{
  "gatewayMode": "auto",
  "hermesCommand": "hermes",
  "hermesWorkingDirectory": "/root/hermes-agent"
}
```

Or, for the bundled local adapter service:

```json
{
  "gatewayMode": "http",
  "hermesBaseUrl": "http://127.0.0.1:8788",
  "hermesAuthToken": "change-me"
}
```

## Why this is useful

Reusing the local installations means:

- no duplicate Hermes packaging just for the plugin
- no extra adapter service required for trusted single-host deployments
- easier iteration against the existing Paperclip checkout on the VPS
- less configuration drift between the plugin and the server's already configured Hermes profiles

## When not to reuse directly

Choose `gatewayMode=http` instead when:

- you want a stricter process boundary
- you need a richer normalized adapter contract with structured tool traces
- Hermes lives on a different machine or container
- you want central rate limiting, auth, or audit policy outside the plugin worker
