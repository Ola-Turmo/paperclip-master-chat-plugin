import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";
import type { HermesGatewayPayload, HermesPayloadMessage } from "./hermes/payload.js";
import { loadHermesCapabilityInventory, sanitizeSkillPolicy } from "./hermes/capabilities.js";
import { buildImageAnalysisFromPath, buildMetadataFallbackAnalysis, cleanupTempDir, dataUrlToTempFile } from "./hermes/image-analysis.js";
import type { HermesCapabilityInventory } from "./hermes/capabilities.js";
import type { HermesContinuationMode, HermesImageAnalysisResult, HermesResponse, HermesToolTrace } from "./types.js";
import { armProcessTimeout } from "./process.js";

export interface AdapterInvocation {
  command: string;
  args: string[];
  cwd?: string;
}

export interface AdapterServiceConfig {
  port: number;
  host: string;
  hermesCommand: string;
  hermesWorkingDirectory?: string;
  defaultProfileId?: string;
  defaultProvider?: string;
  defaultModel?: string;
  authToken: string;
  authHeaderName: string;
  timeoutMs: number;
  maxRequestBodyBytes: number;
  maxClockSkewMs: number;
}

const HTTP_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

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
    defaultProfileId: process.env.MASTER_CHAT_ADAPTER_DEFAULT_PROFILE || "",
    defaultProvider: process.env.MASTER_CHAT_ADAPTER_DEFAULT_PROVIDER || "",
    defaultModel: process.env.MASTER_CHAT_ADAPTER_DEFAULT_MODEL || "",
    authToken: process.env.MASTER_CHAT_ADAPTER_TOKEN || "",
    authHeaderName: (process.env.MASTER_CHAT_ADAPTER_HEADER || "authorization").toLowerCase(),
    timeoutMs: envNumber("MASTER_CHAT_ADAPTER_TIMEOUT_MS", 45_000),
    maxRequestBodyBytes: envNumber("MASTER_CHAT_ADAPTER_MAX_BODY_BYTES", 15_000_000),
    maxClockSkewMs: envNumber("MASTER_CHAT_ADAPTER_MAX_CLOCK_SKEW_MS", 300_000),
  };
}

export function getExpectedAuthValue(config: AdapterServiceConfig): string {
  if (config.authHeaderName === "authorization" && !/^bearer\s+/i.test(config.authToken)) {
    return `Bearer ${config.authToken}`;
  }
  return config.authToken;
}

export function validateAdapterServiceConfig(config: AdapterServiceConfig): string[] {
  const errors: string[] = [];
  if (!config.authToken.trim()) errors.push("authToken is required");
  if (!config.authHeaderName.trim()) {
    errors.push("authHeaderName must not be empty");
  } else if (!HTTP_HEADER_NAME_RE.test(config.authHeaderName)) {
    errors.push("authHeaderName must be a valid HTTP header name");
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    errors.push("port must be an integer between 1 and 65535");
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1_000) {
    errors.push("timeoutMs must be at least 1000");
  }
  if (!Number.isFinite(config.maxRequestBodyBytes) || config.maxRequestBodyBytes < 1) {
    errors.push("maxRequestBodyBytes must be at least 1");
  }
  if (!Number.isFinite(config.maxClockSkewMs) || config.maxClockSkewMs < 1) {
    errors.push("maxClockSkewMs must be at least 1");
  }
  return errors;
}

export function isAuthorized(headers: Record<string, string | string[] | undefined>, config: AdapterServiceConfig): boolean {
  if (!config.authToken.trim()) return false;
  const raw = headers[config.authHeaderName];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(getExpectedAuthValue(config));
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function createRequestSignature(
  config: AdapterServiceConfig,
  method: string,
  path: string,
  date: string,
  nonce: string,
  body: string,
): string {
  return createHmac("sha256", config.authToken)
    .update([method.toUpperCase(), path, date, nonce, body].join("\n"))
    .digest("hex");
}

function readHeader(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const raw = headers[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function verifySignedRequest(
  headers: Record<string, string | string[] | undefined>,
  config: AdapterServiceConfig,
  method: string,
  path: string,
  body: string,
  seenNonces: Map<string, number>,
  now = Date.now(),
): { ok: boolean; error?: string } {
  const date = readHeader(headers, "x-master-chat-date");
  const nonce = readHeader(headers, "x-master-chat-nonce");
  const signature = readHeader(headers, "x-master-chat-signature");

  if (!date || !nonce || !signature) {
    return { ok: false, error: "missing_signature_headers" };
  }

  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > config.maxClockSkewMs) {
    return { ok: false, error: "stale_signature" };
  }

  const cutoff = now - config.maxClockSkewMs;
  for (const [knownNonce, seenAt] of seenNonces.entries()) {
    if (seenAt < cutoff) {
      seenNonces.delete(knownNonce);
    }
  }

  if (seenNonces.has(nonce)) {
    return { ok: false, error: "replayed_signature" };
  }

  const expected = Buffer.from(createRequestSignature(config, method, path, date, nonce, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, error: "invalid_signature" };
  }

  seenNonces.set(nonce, now);
  return { ok: true };
}

export function parseSessionId(output: string): string | undefined {
  const match = output.match(/session(?:\s+id)?\s*[:=]\s*([a-zA-Z0-9._-]+)/i);
  return match?.[1];
}

export function resolveAdapterSessionState(
  payload: HermesGatewayPayload,
  output: string,
): { sessionId: string; continuationMode: HermesContinuationMode } {
  const parsedSessionId = parseSessionId(output);
  const sessionId = parsedSessionId ?? payload.session.sessionId ?? `adapter-${payload.metadata.threadId}`;
  return {
    sessionId,
    continuationMode: payload.session.sessionId || parsedSessionId ? "durable" : "stateless",
  };
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
  const continuityLines = [
    `Continuity strategy: ${payload.continuity.strategy}`,
    `Tracked messages: ${payload.continuity.totalMessageCount}`,
    `Messages omitted from recent history: ${payload.continuity.olderMessageCount}`,
    payload.continuity.summary ? `Synthetic continuity summary:\n${payload.continuity.summary}` : undefined,
  ].filter((line): line is string => Boolean(line));

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
    `Continuity strategy: ${payload.continuity.strategy}`,
    payload.continuity.summary ? `Older context summary: ${payload.continuity.summary}` : "Older context summary: none",
    payload.context.warnings.length ? `Warnings: ${payload.context.warnings.join(" | ")}` : "Warnings: none",
    warnings.length ? `Hermes host compatibility notes: ${warnings.join(" | ")}` : "Hermes host compatibility notes: none",
    "",
    "Continuity context:",
    ...continuityLines,
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

function validateImageAnalysisPayload(payload: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(payload)) {
    return ["request body must be a JSON object"];
  }
  if (!isRecord(payload.session)) errors.push("session must be an object");
  if (!isRecord(payload.metadata) || typeof payload.metadata.threadId !== "string" || !payload.metadata.threadId.trim()) {
    errors.push("metadata.threadId is required");
  }
  if (!isRecord(payload.image)) {
    errors.push("image must be an object");
    return errors;
  }
  if (typeof payload.image.name !== "string" || !payload.image.name.trim()) errors.push("image.name is required");
  if (typeof payload.image.mimeType !== "string" || !payload.image.mimeType.trim()) errors.push("image.mimeType is required");
  if (typeof payload.image.dataUrl !== "string" || !payload.image.dataUrl.trim()) errors.push("image.dataUrl is required");
  return errors;
}

export async function buildAdapterInvocation(
  config: AdapterServiceConfig,
  payload: HermesGatewayPayload,
  capabilityInventory?: HermesCapabilityInventory,
): Promise<{
  invocation: AdapterInvocation;
  effectivePayload: HermesGatewayPayload;
  warnings: string[];
}> {
  let sanitizedWarnings: string[] = [];
  let sanitizedSkillPolicy = payload.skillPolicy;

  try {
    const inventory = capabilityInventory ?? await loadHermesCapabilityInventory({
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
    effectivePayload.session.profileId || config.defaultProfileId || "default",
    "chat",
    "-Q",
    "--source",
    "tool",
  ];

  if (effectivePayload.session.provider && effectivePayload.session.provider !== config.defaultProvider && effectivePayload.session.provider !== "auto") {
    args.push("--provider", effectivePayload.session.provider);
  }

  if (effectivePayload.session.model && effectivePayload.session.model !== config.defaultModel) {
    args.push("-m", effectivePayload.session.model);
  }

  if (effectivePayload.session.sessionId) {
    args.push("--resume", effectivePayload.session.sessionId);
  } else {
    args.push("--pass-session-id");
  }

  // Keep Hermes capability preferences in the prompt only. The local adapter is
  // meant to behave like the verified CLI path on this VPS, which avoids
  // forwarding -s/-t flags directly because host catalogs and tool-driven model
  // behavior vary across Hermes installs.
  args.push("-q", prompt);

  return {
    invocation: {
      command: config.hermesCommand,
      args,
      cwd: config.hermesWorkingDirectory || undefined,
    },
    effectivePayload,
    warnings: sanitizedWarnings,
  };
}

async function runHermesChat(config: AdapterServiceConfig, payload: HermesGatewayPayload): Promise<HermesResponse> {
  const { invocation, effectivePayload } = await buildAdapterInvocation(config, payload);

  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const clearTimeouts = armProcessTimeout(child, config.timeoutMs, () => {
      reject(new Error(`Hermes adapter timed out after ${config.timeoutMs}ms`));
    });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeouts();
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeouts();
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

  const sessionState = resolveAdapterSessionState(effectivePayload, output);
  return {
    assistantText,
    toolTraces: buildSyntheticToolTraces(effectivePayload),
    provider: effectivePayload.session.provider,
    model: effectivePayload.session.model,
    sessionId: sessionState.sessionId,
    gatewayMode: "http",
    continuationMode: sessionState.continuationMode,
  };
}

async function runHermesImageAnalysis(
  config: AdapterServiceConfig,
  payload: {
    session: { profileId?: string };
    metadata: { threadId: string };
    image: { name: string; mimeType: string; dataUrl: string; altText?: string };
  },
): Promise<HermesImageAnalysisResult> {
  const temp = await dataUrlToTempFile({
    id: payload.metadata.threadId,
    type: "image",
    name: payload.image.name,
    mimeType: payload.image.mimeType,
    dataUrl: payload.image.dataUrl,
    altText: payload.image.altText,
    source: "inline",
  });

  try {
    try {
      return await buildImageAnalysisFromPath(temp.filePath, {
        hermesCommand: config.hermesCommand,
        hermesWorkingDirectory: config.hermesWorkingDirectory,
        profileId: payload.session.profileId || config.defaultProfileId || "default",
        timeoutMs: config.timeoutMs,
        maxChars: 4_000,
      });
    } catch (error) {
      return buildMetadataFallbackAnalysis({
        name: payload.image.name,
        mimeType: payload.image.mimeType,
        altText: payload.image.altText,
        maxChars: 4_000,
        error,
      });
    }
  } finally {
    await cleanupTempDir(temp.dir);
  }
}

export async function readBodyLimited(
  req: AsyncIterable<Buffer | string>,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      const error = new Error(`Request body exceeds ${maxBytes} bytes`);
      error.name = "PayloadTooLargeError";
      throw error;
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return "";
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonLimited(
  req: AsyncIterable<Buffer | string>,
  maxBytes: number,
): Promise<unknown> {
  const text = await readBodyLimited(req, maxBytes);
  if (!text) return {};
  return JSON.parse(text);
}

function hasJsonContentType(contentType: string | undefined): boolean {
  return typeof contentType === "string" && /^application\/json\b/i.test(contentType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateGatewayPayload(payload: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(payload)) {
    return ["request body must be a JSON object"];
  }

  if (!isRecord(payload.session)) errors.push("session must be an object");
  if (!isRecord(payload.metadata) || typeof payload.metadata.threadId !== "string" || !payload.metadata.threadId.trim()) {
    errors.push("metadata.threadId is required");
  }
  if (!isRecord(payload.scope) || typeof payload.scope.companyId !== "string" || !payload.scope.companyId.trim()) {
    errors.push("scope.companyId is required");
  }
  if (!Array.isArray(payload.messages)) errors.push("messages must be an array");
  if (
    !isRecord(payload.continuity)
    || typeof payload.continuity.strategy !== "string"
    || typeof payload.continuity.olderMessageCount !== "number"
    || typeof payload.continuity.totalMessageCount !== "number"
  ) {
    errors.push("continuity must include strategy, olderMessageCount, and totalMessageCount");
  }
  if (!isRecord(payload.skillPolicy) || !Array.isArray(payload.skillPolicy.enabled) || !Array.isArray(payload.skillPolicy.disabled) || !Array.isArray(payload.skillPolicy.toolsets)) {
    errors.push("skillPolicy must include enabled, disabled, and toolsets arrays");
  }
  if (!isRecord(payload.toolPolicy) || !Array.isArray(payload.toolPolicy.allowedPluginTools) || !Array.isArray(payload.toolPolicy.allowedHermesToolsets)) {
    errors.push("toolPolicy must include allowedPluginTools and allowedHermesToolsets arrays");
  }

  return errors;
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

export function createAdapterServer(config: AdapterServiceConfig) {
  const configErrors = validateAdapterServiceConfig(config);
  if (configErrors.length > 0) {
    throw new Error(`Invalid adapter config: ${configErrors.join("; ")}`);
  }
  const seenNonces = new Map<string, number>();
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
        if (!hasJsonContentType(readHeader(headers, "content-type"))) {
          sendJson(res, 415, { error: "unsupported_media_type" });
          return;
        }
        const bodyText = await readBodyLimited(req, config.maxRequestBodyBytes);
        const signature = verifySignedRequest(headers, config, req.method, url.pathname, bodyText, seenNonces);
        if (!signature.ok) {
          sendJson(res, 401, { error: signature.error });
          return;
        }
        const payload = bodyText ? JSON.parse(bodyText) as unknown : {};
        const payloadErrors = validateGatewayPayload(payload);
        if (payloadErrors.length > 0) {
          sendJson(res, 400, { error: "invalid_request", details: payloadErrors });
          return;
        }
        const response = await runHermesChat(config, payload as HermesGatewayPayload);
        sendJson(res, 200, response);
        return;
      }

      if (url.pathname === "/images/analyze" && req.method === "POST") {
        if (!isAuthorized(headers, config)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        if (!hasJsonContentType(readHeader(headers, "content-type"))) {
          sendJson(res, 415, { error: "unsupported_media_type" });
          return;
        }
        const bodyText = await readBodyLimited(req, config.maxRequestBodyBytes);
        const signature = verifySignedRequest(headers, config, req.method, url.pathname, bodyText, seenNonces);
        if (!signature.ok) {
          sendJson(res, 401, { error: signature.error });
          return;
        }
        const payload = bodyText ? JSON.parse(bodyText) as unknown : {};
        const payloadErrors = validateImageAnalysisPayload(payload);
        if (payloadErrors.length > 0) {
          sendJson(res, 400, { error: "invalid_request", details: payloadErrors });
          return;
        }
        const response = await runHermesImageAnalysis(config, payload as {
          session: { profileId?: string };
          metadata: { threadId: string };
          image: { name: string; mimeType: string; dataUrl: string; altText?: string };
        });
        sendJson(res, 200, response);
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof Error && error.name === "PayloadTooLargeError") {
        sendJson(res, 413, { error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadAdapterServiceConfig();
  const configErrors = validateAdapterServiceConfig(config);
  if (configErrors.length > 0) {
    console.error(`Invalid adapter configuration: ${configErrors.join("; ")}`);
    process.exit(1);
  }
  const server = createAdapterServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`Master Chat Hermes adapter listening on http://${config.host}:${config.port}`);
  });
}
