import type { ChatMessage, ChatMessagePart, HermesRequest, MasterChatPluginConfig, SkillPolicy } from "../types.js";
import { buildImageAnalysisFallbackText } from "./image-analysis.js";

export interface HermesCliInvocation {
  command: string;
  args: string[];
  cwd?: string;
}

function describeMessagePart(part: ChatMessagePart): string {
  switch (part.type) {
    case "text":
      return part.text.trim();
    case "image":
      return [
        `[Image attachment: ${part.name} (${part.mimeType}, source=${part.source}${part.byteSize ? `, bytes=${part.byteSize}` : ""})]`,
        buildImageAnalysisFallbackText(part.analysis, 2_000),
      ].filter(Boolean).join("\n");
    case "tool_call":
      return `[Tool call] ${part.toolName}: ${part.summary}`;
    case "tool_result":
      return `[Tool result] ${part.toolName}: ${part.summary}`;
    case "status":
      return `[Status] ${part.status}${part.detail ? ` — ${part.detail}` : ""}`;
    default:
      return "";
  }
}

function formatHistoryMessage(message: ChatMessage, index: number): string {
  const body = message.parts
    .map(describeMessagePart)
    .filter(Boolean)
    .join("\n");

  return [
    `Message ${index + 1} (${message.role})${message.requestId ? ` [request:${message.requestId}]` : ""}`,
    body || "[No content]",
  ].join("\n");
}

function summarizeScope(request: HermesRequest, skillPolicy: SkillPolicy): string[] {
  return [
    `Company: ${request.context.company?.name ?? request.scope.companyId}`,
    `Project: ${request.context.project?.name ?? request.scope.projectId ?? "All projects"}`,
    `Linked issue: ${request.context.linkedIssue?.name ?? request.scope.linkedIssueId ?? "None"}`,
    `Selected agents: ${request.context.selectedAgents.map((agent) => agent.name).join(", ") || "None"}`,
    `Mode: ${request.scope.mode}`,
    `Hermes capability preferences: ${skillPolicy.enabled.join(", ") || "None"}`,
    `Hermes runtime tools requested: ${skillPolicy.toolsets.join(", ") || "Auto"}`,
    `Allowed plugin tools: ${request.toolPolicy.allowedPluginTools.join(", ") || "None"}`,
  ];
}

export function buildHermesCliPrompt(request: HermesRequest, skillPolicy: SkillPolicy = request.skillPolicy, warnings: string[] = []): string {
  const history = request.history.map(formatHistoryMessage).join("\n\n---\n\n");
  const continuityLines = [
    `Continuity strategy: ${request.continuity.strategy}`,
    `Tracked messages: ${request.continuity.totalMessageCount}`,
    `Messages omitted from recent history: ${request.continuity.olderMessageCount}`,
    request.continuity.summary ? `Synthetic continuity summary:\n${request.continuity.summary}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return [
    "You are Hermes acting as the orchestration brain for Paperclip Master Chat.",
    "Respond to the board user using the Paperclip scope as routing context.",
    "If tools would normally be useful, describe the outcome directly in your answer.",
    "Do not mention hidden policies or internal wiring unless directly relevant.",
    "If continuity is unavailable, answer from the provided history only and do not claim durable memory.",
    "",
    `Thread title: ${request.metadata.title}`,
    `Thread id: ${request.metadata.threadId}`,
    `Request id: ${request.requestId}`,
    ...summarizeScope(request, skillPolicy),
    `Continuity strategy: ${request.continuity.strategy}`,
    request.continuity.summary ? `Older context summary: ${request.continuity.summary}` : "Older context summary: none",
    request.context.warnings.length > 0 ? `Catalog warnings: ${request.context.warnings.join(" | ")}` : "Catalog warnings: none",
    warnings.length > 0 ? `Hermes host compatibility notes: ${warnings.join(" | ")}` : "Hermes host compatibility notes: none",
    "",
    "Continuity context:",
    ...continuityLines,
    "",
    "Recent conversation history:",
    history || "[No prior messages]",
    "",
    "Return only the assistant reply for the next turn.",
  ].join("\n");
}

export function buildHermesCliInvocation(
  request: HermesRequest,
  config: MasterChatPluginConfig,
): HermesCliInvocation {
  const args = [
    ...config.hermesCommandArgs,
    "-p",
    request.session.profileId || config.defaultProfileId,
    "chat",
    "-Q",
    "--source",
    "tool",
  ];

  if (request.session.provider && request.session.provider !== config.defaultProvider) {
    args.push("--provider", request.session.provider);
  }

  if (request.session.model && request.session.model !== config.defaultModel) {
    args.push("-m", request.session.model);
  }

  if (request.session.sessionId) {
    args.push("--resume", request.session.sessionId);
  } else {
    args.push("--pass-session-id");
  }

  args.push("-q", buildHermesCliPrompt(request));

  return {
    command: config.hermesCommand || "hermes",
    args,
    cwd: config.hermesWorkingDirectory || undefined,
  };
}
