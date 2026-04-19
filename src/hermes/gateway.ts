import { spawn } from "node:child_process";
import { randomUUID, createHmac } from "node:crypto";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { configError, timeoutError, unavailableError, upstreamError } from "../errors.js";
import type {
  HermesContinuationMode,
  HermesGatewaySelection,
  HermesRequest,
  HermesResponse,
  HermesStreamEvent,
  HermesToolTrace,
  MasterChatPluginConfig,
} from "../types.js";
import { buildHermesCliInvocation, buildHermesCliPrompt } from "./cli.js";
import { buildHermesGatewayPayload } from "./payload.js";
import { loadHermesCapabilityInventory, sanitizeSkillPolicy } from "./capabilities.js";
import { armProcessTimeout } from "../process.js";

export interface HermesGateway {
  sendMessage(
    request: HermesRequest,
    options?: { onEvent?: (event: HermesStreamEvent) => void },
  ): Promise<HermesResponse>;
}

export interface SelectedHermesGateway {
  gateway: HermesGateway;
  selection: HermesGatewaySelection;
  reason: string;
}

function emitTextDeltas(text: string, onEvent?: (event: HermesStreamEvent) => void) {
  if (!onEvent) return;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  for (const sentence of sentences) {
    onEvent({ type: "delta", text: sentence });
  }
}

function summarizeScope(request: HermesRequest): string {
  const company = request.context.company?.name ?? request.scope.companyId;
  const project = request.context.project?.name;
  const issue = request.context.linkedIssue?.name;
  const agents = request.context.selectedAgents.map((agent) => agent.name).join(", ");
  const parts = [`company ${company}`];
  if (project) parts.push(`project ${project}`);
  if (issue) parts.push(`issue ${issue}`);
  if (agents) parts.push(`agents ${agents}`);
  return parts.join(", ");
}

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;]*m/g, "").replace(/\r/g, "");
}

function authHeaderValue(config: MasterChatPluginConfig): string {
  if (!config.hermesAuthToken.trim()) {
    throw configError("Hermes HTTP mode requires hermesAuthToken");
  }
  if (config.hermesAuthHeaderName.toLowerCase() === "authorization" && !/^bearer\s+/i.test(config.hermesAuthToken)) {
    return `Bearer ${config.hermesAuthToken}`;
  }
  return config.hermesAuthToken;
}

function buildAdapterSignature(
  config: MasterChatPluginConfig,
  method: string,
  path: string,
  date: string,
  nonce: string,
  body: string,
): string {
  return createHmac("sha256", config.hermesAuthToken)
    .update([method.toUpperCase(), path, date, nonce, body].join("\n"))
    .digest("hex");
}

export function buildSignedAdapterHeaders(
  config: MasterChatPluginConfig,
  method: string,
  path: string,
  body: string,
): Record<string, string> {
  const date = new Date().toISOString();
  const nonce = randomUUID();
  return {
    [config.hermesAuthHeaderName]: authHeaderValue(config),
    "x-master-chat-date": date,
    "x-master-chat-nonce": nonce,
    "x-master-chat-signature": buildAdapterSignature(config, method, path, date, nonce, body),
  };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
}

function isRfc1918Host(hostname: string): boolean {
  if (/^10(?:\.\d{1,3}){3}$/u.test(hostname)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/u.test(hostname)) return true;
  const match172 = hostname.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/u);
  if (!match172) return false;
  const octet = Number(match172[1]);
  return octet >= 16 && octet <= 31;
}

function assertAllowedHttpAdapterUrl(config: MasterChatPluginConfig): string {
  if (!config.hermesBaseUrl.trim()) {
    throw configError("Hermes HTTP gateway mode requires hermesBaseUrl");
  }

  let url: URL;
  try {
    url = new URL(config.hermesBaseUrl);
  } catch {
    throw configError("hermesBaseUrl must be a valid absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configError("hermesBaseUrl must use http or https");
  }

  const hostname = url.hostname.toLowerCase();
  const isLoopback = isLoopbackHost(hostname);
  if (!isLoopback && isRfc1918Host(hostname) && !config.allowPrivateAdapterHosts) {
    throw configError("RFC1918 hermesBaseUrl hosts require allowPrivateAdapterHosts=true");
  }
  if (!isLoopback && url.protocol === "http:" && !config.allowInsecureHttpAdapters) {
    throw configError("Non-loopback hermesBaseUrl values must use https unless allowInsecureHttpAdapters=true");
  }

  return config.hermesBaseUrl.replace(/\/$/, "");
}

export function shouldUseDirectAdapterFetch(rawUrl: string, config: MasterChatPluginConfig): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (isLoopbackHost(hostname)) return true;
    return config.allowPrivateAdapterHosts && isRfc1918Host(hostname);
  } catch {
    return false;
  }
}

async function performGatewayFetch(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (shouldUseDirectAdapterFetch(url, config)) {
    return await fetch(url, init);
  }
  return await ctx.http.fetch(url, init);
}

async function runCommand(command: string, args: string[], cwd: string | undefined, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const clearTimeouts = armProcessTimeout(child, timeoutMs, () => {
      reject(timeoutError(`Hermes CLI timed out after ${timeoutMs}ms`));
    });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeouts();
      reject(unavailableError(`Failed to launch Hermes CLI command '${command}'`, error));
    });

    child.on("close", (code) => {
      clearTimeouts();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(upstreamError(`Hermes CLI exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function probeCliCommand(config: MasterChatPluginConfig): Promise<boolean> {
  if (!config.hermesCommand.trim()) return false;
  try {
    await runCommand(config.hermesCommand, ["chat", "--help"], config.hermesWorkingDirectory || undefined, Math.min(config.gatewayRequestTimeoutMs, 5_000));
    return true;
  } catch {
    return false;
  }
}

async function probeHttpGateway(ctx: PluginContext, config: MasterChatPluginConfig): Promise<boolean> {
  if (!config.hermesBaseUrl.trim() || !config.hermesAuthToken.trim()) return false;
  let baseUrl = "";
  try {
    baseUrl = assertAllowedHttpAdapterUrl(config);
  } catch {
    return false;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.gatewayRequestTimeoutMs, 5_000));
  try {
    const response = await performGatewayFetch(ctx, config, `${baseUrl}/health`, {
      method: "GET",
      headers: {
        [config.hermesAuthHeaderName]: authHeaderValue(config),
      },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSessionId(output: string): string | undefined {
  const match = output.match(/session(?:\s+id)?\s*[:=]\s*([a-zA-Z0-9._-]+)/i);
  return match?.[1];
}

export function resolveCliSessionState(
  request: HermesRequest,
  combinedOutput: string,
): { sessionId: string; continuationMode: HermesContinuationMode } {
  const parsedSessionId = parseSessionId(combinedOutput);
  const sessionId = parsedSessionId ?? request.session.sessionId ?? `cli-${request.metadata.threadId}`;
  return {
    sessionId,
    continuationMode: request.session.sessionId || parsedSessionId ? "durable" : "stateless",
  };
}

export class MockHermesGateway implements HermesGateway {
  async sendMessage(
    request: HermesRequest,
    options?: { onEvent?: (event: HermesStreamEvent) => void },
  ): Promise<HermesResponse> {
    const { onEvent } = options ?? {};
    const latestUser = [...request.history].reverse().find((message) => message.role === "user");
    const imageCount = latestUser?.parts.filter((part) => part.type === "image").length ?? 0;
    const tool = request.tools[0];
    const toolTraces: HermesToolTrace[] = [];

    onEvent?.({
      type: "status",
      stage: "started",
      message: `Hermes mock gateway continuing session for ${request.metadata.threadId}`,
    });

    if (tool) {
      onEvent?.({
        type: "status",
        stage: "tool_call",
        message: `Calling ${tool.name}`,
        toolName: tool.name,
      });
      toolTraces.push({
        toolName: tool.name,
        summary: `Prepared ${tool.kind} tool for scoped synthesis`,
        input: {
          scope: request.scope,
          enabledSkills: request.skillPolicy.enabled,
        },
        output: {
          toolKind: tool.kind,
          scopeSummary: summarizeScope(request),
        },
      });
      onEvent?.({
        type: "status",
        stage: "tool_result",
        message: `${tool.name} returned scoped context`,
        toolName: tool.name,
      });
    }

    const enabledSkills = request.skillPolicy.enabled.length > 0
      ? request.skillPolicy.enabled.join(", ")
      : "no explicit skills";

    const assistantText = [
      `Hermes is mediating across ${summarizeScope(request)}.`,
      `Enabled skills: ${enabledSkills}.`,
      imageCount > 0
        ? `I received ${imageCount} inline image attachment${imageCount === 1 ? "" : "s"} and would route them as multimodal content blocks.`
        : "No images were attached to this turn.",
      "Recommended next actions: compare agent perspectives, inspect linked activity/issues, and promote the best summary into a Paperclip issue or activity log if needed.",
    ].join(" ");

    emitTextDeltas(assistantText, onEvent);
    onEvent?.({
      type: "status",
      stage: "completed",
      message: "Hermes mock response completed",
    });

    return {
      assistantText,
      toolTraces,
      provider: request.session.provider,
      model: request.session.model,
      sessionId: request.session.sessionId ?? `mock-${request.metadata.threadId}`,
      gatewayMode: "mock",
      continuationMode: request.session.sessionId ? "durable" : "stateless",
    };
  }
}

export class HttpHermesGateway implements HermesGateway {
  constructor(
    private readonly ctx: PluginContext,
    private readonly config: MasterChatPluginConfig,
  ) {}

  async sendMessage(
    request: HermesRequest,
    options?: { onEvent?: (event: HermesStreamEvent) => void },
  ): Promise<HermesResponse> {
    const baseUrl = assertAllowedHttpAdapterUrl(this.config);

    options?.onEvent?.({
      type: "status",
      stage: "started",
      message: `Posting request to Hermes adapter at ${baseUrl}`,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.gatewayRequestTimeoutMs);
    const path = "/sessions/continue";
    const body = JSON.stringify(buildHermesGatewayPayload(request));

    try {
      const response = await performGatewayFetch(this.ctx, this.config, `${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildSignedAdapterHeaders(this.config, "POST", path, body),
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw upstreamError(`Hermes adapter returned ${response.status}: ${text}`);
      }

      const data = await response.json() as Partial<HermesResponse>;
      const assistantText = typeof data.assistantText === "string" ? data.assistantText : "";
      if (!assistantText.trim()) {
        throw upstreamError("Hermes adapter returned no assistantText");
      }
      emitTextDeltas(assistantText, options?.onEvent);
      options?.onEvent?.({
        type: "status",
        stage: "completed",
        message: "Hermes adapter response completed",
      });
      const sessionId = typeof data.sessionId === "string"
        ? data.sessionId
        : (request.session.sessionId ?? `http-${request.metadata.threadId}`);
      return {
        assistantText,
        toolTraces: Array.isArray(data.toolTraces) ? data.toolTraces : [],
        provider: typeof data.provider === "string" ? data.provider : request.session.provider,
        model: typeof data.model === "string" ? data.model : request.session.model,
        sessionId,
        gatewayMode: "http",
        continuationMode: (data.continuationMode as HermesContinuationMode | undefined) ?? ((request.session.sessionId || typeof data.sessionId === "string") ? "durable" : "stateless"),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw timeoutError(`Hermes HTTP gateway timed out after ${this.config.gatewayRequestTimeoutMs}ms`, error);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class CliHermesGateway implements HermesGateway {
  constructor(private readonly config: MasterChatPluginConfig) {}

  async sendMessage(
    request: HermesRequest,
    options?: { onEvent?: (event: HermesStreamEvent) => void },
  ): Promise<HermesResponse> {
    if (!this.config.hermesCommand.trim()) {
      throw configError("Hermes CLI gateway mode requires hermesCommand");
    }

    let warnings: string[] = [];
    let effectiveSkillPolicy = request.skillPolicy;

    try {
      const inventory = await loadHermesCapabilityInventory(this.config);
      const sanitized = sanitizeSkillPolicy(request.skillPolicy, inventory);
      effectiveSkillPolicy = sanitized.skillPolicy;
      warnings = sanitized.warnings;
    } catch {
      const sanitized = sanitizeSkillPolicy(request.skillPolicy);
      effectiveSkillPolicy = sanitized.skillPolicy;
      warnings = sanitized.warnings;
    }

    const invocation = buildHermesCliInvocation({
      ...request,
      skillPolicy: effectiveSkillPolicy,
    }, this.config);
    invocation.args[invocation.args.length - 1] = buildHermesCliPrompt(request, effectiveSkillPolicy, warnings);

    options?.onEvent?.({
      type: "status",
      stage: "started",
      message: `Running local Hermes CLI via ${invocation.command}`,
    });

    for (const warning of warnings) {
      options?.onEvent?.({
        type: "status",
        stage: "tool_result",
        message: warning,
      });
    }

    const { stdout, stderr } = await runCommand(invocation.command, invocation.args, invocation.cwd, Math.max(10_000, this.config.gatewayRequestTimeoutMs));
    const combinedOutput = `${stdout}\n${stderr}`.trim();
    const assistantText = stripAnsi(stdout).trim() || stripAnsi(stderr).trim();

    if (!assistantText) {
      throw upstreamError("Hermes CLI returned no assistant output");
    }

    emitTextDeltas(assistantText, options?.onEvent);
    options?.onEvent?.({
      type: "status",
      stage: "completed",
      message: "Hermes CLI response completed",
    });

    const sessionState = resolveCliSessionState(request, combinedOutput);
    return {
      assistantText,
      toolTraces: [],
      provider: request.session.provider,
      model: request.session.model,
      sessionId: sessionState.sessionId,
      gatewayMode: "cli",
      continuationMode: sessionState.continuationMode,
    };
  }
}

export async function createHermesGateway(ctx: PluginContext, config: MasterChatPluginConfig): Promise<SelectedHermesGateway> {
  switch (config.gatewayMode) {
    case "cli":
      return {
        gateway: new CliHermesGateway(config),
        selection: "cli",
        reason: "configured_cli_mode",
      };
    case "http":
      assertAllowedHttpAdapterUrl(config);
      if (!config.hermesAuthToken.trim()) throw configError("gatewayMode=http requires hermesAuthToken");
      return {
        gateway: new HttpHermesGateway(ctx, config),
        selection: "http",
        reason: "configured_http_mode",
      };
    case "mock":
      return {
        gateway: new MockHermesGateway(),
        selection: "mock",
        reason: "configured_mock_mode",
      };
    case "auto":
    default: {
      const cliAvailable = await probeCliCommand(config);
      if (cliAvailable) {
        return {
          gateway: new CliHermesGateway(config),
          selection: "cli",
          reason: "auto_detected_local_cli",
        };
      }

      const httpAvailable = await probeHttpGateway(ctx, config);
      if (httpAvailable) {
        return {
          gateway: new HttpHermesGateway(ctx, config),
          selection: "http",
          reason: "auto_detected_http_gateway",
        };
      }

      return {
        gateway: new MockHermesGateway(),
        selection: "mock",
        reason: "auto_fallback_mock",
      };
    }
  }
}
