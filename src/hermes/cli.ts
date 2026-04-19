import type { ChatMessage, ChatMessagePart, HermesRequest, MasterChatPluginConfig } from "../types.js";

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
      return `[Image attachment: ${part.name} (${part.mimeType}, source=${part.source}${part.byteSize ? `, bytes=${part.byteSize}` : ""})]`;
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

function summarizeScope(request: HermesRequest): string[] {
  return [
    `Company: ${request.context.company?.name ?? request.scope.companyId}`,
    `Project: ${request.context.project?.name ?? request.scope.projectId ?? "All projects"}`,
    `Linked issue: ${request.context.linkedIssue?.name ?? request.scope.linkedIssueId ?? "None"}`,
    `Selected agents: ${request.context.selectedAgents.map((agent) => agent.name).join(", ") || "None"}`,
    `Mode: ${request.scope.mode}`,
    `Enabled skills: ${request.skillPolicy.enabled.join(", ") || "None"}`,
    `Hermes toolsets: ${request.skillPolicy.toolsets.join(", ") || "None"}`,
    `Allowed plugin tools: ${request.toolPolicy.allowedPluginTools.join(", ") || "None"}`,
  ];
}

export function buildHermesCliPrompt(request: HermesRequest): string {
  const history = request.history.map(formatHistoryMessage).join("\n\n---\n\n");

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
    ...summarizeScope(request),
    request.context.warnings.length > 0 ? `Catalog warnings: ${request.context.warnings.join(" | ")}` : "Catalog warnings: none",
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
    "-p",
    request.session.profileId || config.defaultProfileId,
    "chat",
    "-Q",
    "--source",
    "tool",
    "--provider",
    request.session.provider,
    "-m",
    request.session.model,
  ];

  if (request.session.sessionId) {
    args.push("--resume", request.session.sessionId);
  } else {
    args.push("--pass-session-id");
  }

  if (request.skillPolicy.toolsets.length > 0) {
    args.push("-t", request.skillPolicy.toolsets.join(","));
  }

  if (request.skillPolicy.enabled.length > 0) {
    args.push("-s", request.skillPolicy.enabled.join(","));
  }

  args.push("-q", buildHermesCliPrompt(request));

  return {
    command: config.hermesCommand || "hermes",
    args,
    cwd: config.hermesWorkingDirectory || undefined,
  };
}
