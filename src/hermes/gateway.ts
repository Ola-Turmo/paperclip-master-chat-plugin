import { spawn } from "node:child_process";
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
import { buildHermesCliInvocation } from "./cli.js";
import { buildHermesGatewayPayload } from "./payload.js";

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

async function runCommand(command: string, args: string[], cwd: string | undefined, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(timeoutError(`Hermes CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(unavailableError(`Failed to launch Hermes CLI command '${command}'`, error));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.gatewayRequestTimeoutMs, 5_000));
  try {
    const response = await ctx.http.fetch(`${config.hermesBaseUrl.replace(/\/$/, "")}/health`, {
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
    if (!this.config.hermesBaseUrl.trim()) {
      throw configError("Hermes HTTP gateway mode requires hermesBaseUrl");
    }

    options?.onEvent?.({
      type: "status",
      stage: "started",
      message: `Posting request to Hermes adapter at ${this.config.hermesBaseUrl}`,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.gatewayRequestTimeoutMs);

    try {
      const response = await this.ctx.http.fetch(`${this.config.hermesBaseUrl.replace(/\/$/, "")}/sessions/continue`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [this.config.hermesAuthHeaderName]: authHeaderValue(this.config),
        },
        body: JSON.stringify(buildHermesGatewayPayload(request)),
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
      return {
        assistantText,
        toolTraces: Array.isArray(data.toolTraces) ? data.toolTraces : [],
        provider: typeof data.provider === "string" ? data.provider : request.session.provider,
        model: typeof data.model === "string" ? data.model : request.session.model,
        sessionId: typeof data.sessionId === "string" ? data.sessionId : (request.session.sessionId ?? `http-${request.metadata.threadId}`),
        gatewayMode: "http",
        continuationMode: (data.continuationMode as HermesContinuationMode | undefined) ?? (request.session.sessionId ? "durable" : "stateless"),
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

    const invocation = buildHermesCliInvocation(request, this.config);

    options?.onEvent?.({
      type: "status",
      stage: "started",
      message: `Running local Hermes CLI via ${invocation.command}`,
    });

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

    const resumed = Boolean(request.session.sessionId);
    return {
      assistantText,
      toolTraces: [],
      provider: request.session.provider,
      model: request.session.model,
      sessionId: parseSessionId(combinedOutput) ?? request.session.sessionId ?? `cli-${request.metadata.threadId}`,
      gatewayMode: "cli",
      continuationMode: resumed ? "durable" : "stateless",
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
      if (!config.hermesBaseUrl.trim()) throw configError("gatewayMode=http requires hermesBaseUrl");
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
