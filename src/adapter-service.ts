import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import type { HermesGatewayPayload, HermesPayloadMessage } from "./hermes/payload.js";
import { loadHermesCapabilityInventory, sanitizeSkillPolicy } from "./hermes/capabilities.js";
import type { HermesContinuationMode, HermesResponse, HermesToolTrace } from "./types.js";

export interface AdapterServiceConfig {
  port: number;
  host: string;
  hermesCommand: string;
  hermesWorkingDirectory?: string;
  authToken: string;
  authHeaderName: string;
  timeoutMs: number;
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadAdapterServiceConfig(): AdapterServiceConfig {
  return {
    port: envNumber("MASTER_CHAT_ADAPTER_PORT", 8788),
    host: process.env.MASTER_CHAT_ADAPTER_HOST || "127.0.0.1",
    hermesCommand: process.env.MASTER_CHAT_HERMES_COMMAND || "hermes",
    hermesWorkingDirectory: process.env.MASTER_CHAT_HERMES_CWD || "",
    authToken: process.env.MASTER_CHAT_ADAPTER_TOKEN || "",
    authHeaderName: (process.env.MASTER_CHAT_ADAPTER_HEADER || "authorization").toLowerCase(),
    timeoutMs: envNumber("MASTER_CHAT_ADAPTER_TIMEOUT_MS", 45_000),
  };
}

export function getExpectedAuthValue(config: AdapterServiceConfig): string {
  if (config.authHeaderName === "authorization" && !/^bearer\s+/i.test(config.authToken)) {
    return `Bearer ${config.authToken}`;
  }
  return config.authToken;
}

export function isAuthorized(headers: Record<string, string | string[] | undefined>, config: AdapterServiceConfig): boolean {
  if (!config.authToken.trim()) return false;
  const raw = headers[config.authHeaderName];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === getExpectedAuthValue(config);
}

export function parseSessionId(output: string): string | undefined {
  const match = output.match(/session(?:\s+id)?\s*[:=]\s*([a-zA-Z0-9._-]+)/i);
  return match?.[1];
}

function describeContentBlock(block: HermesPayloadMessage["content"][number]): string {
  if (block.type === "text") return block.text?.trim() ?? "";
  return `[Image attachment: ${block.name ?? "unnamed"} (${block.mimeType ?? "unknown"})]`;
}

export function buildAdapterPrompt(payload: HermesGatewayPayload, warnings: string[] = []): string {
  const conversation = payload.messages.map((message, index) => {
    const body = message.content.map(describeContentBlock).filter(Boolean).join("\n");
    return [`Message ${index + 1} (${message.role})`, body || "[No content]"];
  }).flat().join("\n\n---\n\n");

  return [
    "You are Hermes acting through the Paperclip Master Chat adapter service.",
    "Respond only with the assistant reply for the next turn.",
    "Use the provided Paperclip scope as hard routing context.",
    `Thread title: ${payload.metadata.title}`,
    `Thread id: ${payload.metadata.threadId}`,
    `Company: ${payload.context.company?.name ?? payload.scope.companyId}`,
    `Project: ${payload.context.project?.name ?? payload.scope.projectId ?? "All projects"}`,
    `Issue: ${payload.context.linkedIssue?.name ?? payload.scope.linkedIssueId ?? "None"}`,
    `Selected agents: ${payload.context.selectedAgents.map((agent) => agent.name).join(", ") || "None"}`,
    `Hermes capability preferences: ${payload.skillPolicy.enabled.join(", ") || "None"}`,
    `Hermes runtime tools requested: ${payload.skillPolicy.toolsets.join(", ") || "Auto"}`,
    `Allowed plugin tools: ${payload.toolPolicy.allowedPluginTools.join(", ") || "None"}`,
    payload.context.warnings.length ? `Warnings: ${payload.context.warnings.join(" | ")}` : "Warnings: none",
    warnings.length ? `Hermes host compatibility notes: ${warnings.join(" | ")}` : "Hermes host compatibility notes: none",
    "",
    "Conversation:",
    conversation || "[No prior messages]",
  ].join("\n");
}

function buildSyntheticToolTraces(payload: HermesGatewayPayload): HermesToolTrace[] {
  const traces: HermesToolTrace[] = [];
  if (payload.tools.length > 0) {
    traces.push({
      toolName: "master-chat.tool-manifest",
      summary: `Prepared ${payload.tools.length} allowed tool descriptor(s) for Hermes mediation`,
      input: {
        tools: payload.tools.map((tool) => tool.name),
      },
      output: {
        hermesToolsets: payload.toolPolicy.allowedHermesToolsets,
        pluginTools: payload.toolPolicy.allowedPluginTools,
      },
    });
  }

  traces.push({
    toolName: "master-chat.scope-context",
    summary: "Forwarded company-scoped Paperclip context to the adapter",
    input: {
      companyId: payload.scope.companyId,
      projectId: payload.scope.projectId,
      linkedIssueId: payload.scope.linkedIssueId,
      selectedAgentIds: payload.scope.selectedAgentIds,
    },
    output: {
      catalog: payload.context.catalog,
      warnings: payload.context.warnings,
    },
  });

  return traces;
}

async function runHermesChat(config: AdapterServiceConfig, payload: HermesGatewayPayload): Promise<HermesResponse> {
  let sanitizedWarnings: string[] = [];
  let sanitizedSkillPolicy = payload.skillPolicy;

  try {
    const inventory = await loadHermesCapabilityInventory({
      hermesCommand: config.hermesCommand,
      hermesWorkingDirectory: config.hermesWorkingDirectory,
      gatewayRequestTimeoutMs: config.timeoutMs,
    });
    const sanitized = sanitizeSkillPolicy(payload.skillPolicy, inventory);
    sanitizedSkillPolicy = sanitized.skillPolicy;
    sanitizedWarnings = sanitized.warnings;
  } catch {
    const sanitized = sanitizeSkillPolicy(payload.skillPolicy);
    sanitizedSkillPolicy = sanitized.skillPolicy;
    sanitizedWarnings = sanitized.warnings;
  }

  const effectivePayload = {
    ...payload,
    skillPolicy: sanitizedSkillPolicy,
  } satisfies HermesGatewayPayload;

  const prompt = buildAdapterPrompt(effectivePayload, sanitizedWarnings);
  const args = [
    "-p",
    effectivePayload.session.profileId,
    "chat",
    "-Q",
    "--source",
    "tool",
    "--provider",
    effectivePayload.session.provider,
    "-m",
    effectivePayload.session.model,
  ];

  if (effectivePayload.session.sessionId) {
    args.push("--resume", effectivePayload.session.sessionId);
  } else {
    args.push("--pass-session-id");
  }

  if (effectivePayload.skillPolicy.toolsets.length > 0) {
    args.push("-t", effectivePayload.skillPolicy.toolsets.join(","));
  }

  if (effectivePayload.skillPolicy.enabled.length > 0) {
    args.push("-s", effectivePayload.skillPolicy.enabled.join(","));
  }

  args.push("-q", prompt);

  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(config.hermesCommand, args, {
      cwd: config.hermesWorkingDirectory || undefined,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Hermes adapter timed out after ${config.timeoutMs}ms`));
    }, config.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Hermes adapter CLI exited with code ${code}: ${stderr || stdout}`));
    });
  });

  const output = `${result.stdout}\n${result.stderr}`.trim();
  const assistantText = result.stdout.trim() || result.stderr.trim();
  if (!assistantText) {
    throw new Error("Hermes adapter returned no assistant text");
  }

  const continuationMode: HermesContinuationMode = effectivePayload.session.sessionId ? "durable" : "stateless";
  return {
    assistantText,
    toolTraces: buildSyntheticToolTraces(effectivePayload),
    provider: effectivePayload.session.provider,
    model: effectivePayload.session.model,
    sessionId: parseSessionId(output) ?? effectivePayload.session.sessionId ?? `adapter-${payload.metadata.threadId}`,
    gatewayMode: "http",
    continuationMode,
  };
}

async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

export function createAdapterServer(config: AdapterServiceConfig) {
  return createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendJson(res, 404, { error: "missing_url" });
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host || `${config.host}:${config.port}`}`);
      const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), value]));

      if (url.pathname === "/health" && req.method === "GET") {
        sendJson(res, 200, { ok: true, gateway: "local-hermes-adapter" });
        return;
      }

      if (url.pathname === "/sessions/continue" && req.method === "POST") {
        if (!isAuthorized(headers, config)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        const payload = await readJson(req) as HermesGatewayPayload;
        const response = await runHermesChat(config, payload);
        sendJson(res, 200, response);
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadAdapterServiceConfig();
  if (!config.authToken.trim()) {
    console.error("MASTER_CHAT_ADAPTER_TOKEN is required");
    process.exit(1);
  }
  const server = createAdapterServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`Master Chat Hermes adapter listening on http://${config.host}:${config.port}`);
  });
}
