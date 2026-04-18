import type { PluginContext } from "@paperclipai/plugin-sdk";
import type {
  HermesRequest,
  HermesResponse,
  HermesStreamEvent,
  HermesToolTrace,
  MasterChatPluginConfig,
} from "../types.js";
import { buildHermesGatewayPayload } from "./payload.js";

export interface HermesGateway {
  sendMessage(
    request: HermesRequest,
    options?: { onEvent?: (event: HermesStreamEvent) => void },
  ): Promise<HermesResponse>;
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
        : `No images were attached to this turn.`,
      `Recommended next actions: compare agent perspectives, inspect linked activity/issues, and promote the best summary into a Paperclip issue or activity log if needed.`,
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
    if (!this.config.hermesBaseUrl) {
      throw new Error("Hermes HTTP gateway mode requires hermesBaseUrl");
    }

    options?.onEvent?.({
      type: "status",
      stage: "started",
      message: `Posting request to Hermes adapter at ${this.config.hermesBaseUrl}`,
    });

    const response = await this.ctx.http.fetch(`${this.config.hermesBaseUrl.replace(/\/$/, "")}/sessions/continue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(buildHermesGatewayPayload(request)),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hermes adapter returned ${response.status}: ${text}`);
    }

    const data = await response.json() as HermesResponse;
    emitTextDeltas(data.assistantText, options?.onEvent);
    options?.onEvent?.({
      type: "status",
      stage: "completed",
      message: "Hermes adapter response completed",
    });
    return data;
  }
}

export function createHermesGateway(ctx: PluginContext, config: MasterChatPluginConfig): HermesGateway {
  return config.gatewayMode === "http"
    ? new HttpHermesGateway(ctx, config)
    : new MockHermesGateway();
}
