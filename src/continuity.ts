import type { ChatMessage, ChatMessagePart, HermesRequest, HermesSessionConfig } from "./types.js";

function summarizeParts(parts: ChatMessagePart[]): string {
  const text = parts
    .filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ");
  if (text) return text;

  const images = parts.filter((part) => part.type === "image");
  if (images.length > 0) {
    return `[${images.length} image attachment${images.length === 1 ? "" : "s"}]`;
  }

  const tool = parts.find((part) => part.type === "tool_call" || part.type === "tool_result");
  if (tool && "toolName" in tool) {
    return `[${tool.type}] ${tool.toolName}: ${tool.summary}`;
  }

  const status = parts.find((part) => part.type === "status");
  if (status) {
    return `[status] ${status.status}${status.detail ? `: ${status.detail}` : ""}`;
  }

  return "[no content]";
}

function summarizeMessage(message: ChatMessage): string {
  const prefix = message.role === "assistant"
    ? "Assistant"
    : message.role === "user"
      ? "User"
      : message.role === "system"
        ? "System"
        : "Tool";
  return `${prefix}: ${summarizeParts(message.parts)}`;
}

function compactSummary(lines: string[], maxChars = 2_000): string | undefined {
  if (lines.length === 0) return undefined;
  const summary: string[] = [];
  let currentLength = 0;

  for (const line of lines.slice(-10)) {
    const nextLength = currentLength + line.length + 3;
    if (nextLength > maxChars) break;
    summary.push(`- ${line}`);
    currentLength = nextLength;
  }

  return summary.join("\n") || undefined;
}

export function buildContinuitySnapshot(input: {
  session: HermesSessionConfig;
  messages: ChatMessage[];
  historyLimit: number;
}): HermesRequest["continuity"] {
  const { session, messages, historyLimit } = input;
  const totalMessageCount = messages.length;
  const olderMessages = totalMessageCount > historyLimit
    ? messages.slice(0, totalMessageCount - historyLimit)
    : [];

  if (session.sessionId && session.continuationMode === "durable") {
    return {
      strategy: "hermes-session",
      olderMessageCount: olderMessages.length,
      totalMessageCount,
      summary: compactSummary(olderMessages.map(summarizeMessage)),
    };
  }

  if (olderMessages.length > 0) {
    return {
      strategy: "synthetic-summary",
      olderMessageCount: olderMessages.length,
      totalMessageCount,
      summary: compactSummary(olderMessages.map(summarizeMessage)),
    };
  }

  return {
    strategy: "recent-history-only",
    olderMessageCount: 0,
    totalMessageCount,
  };
}
