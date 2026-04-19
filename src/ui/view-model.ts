import type { ChatMessage, ChatMessagePart, HermesStreamEvent, ThreadScope } from "../types.js";

export function scopeSummary(scope: ThreadScope): string {
  const labels = [scope.projectId ? `Project ${scope.projectId}` : "Company-wide"];
  if (scope.linkedIssueId) labels.push(`Issue ${scope.linkedIssueId}`);
  if (scope.selectedAgentIds.length > 0) labels.push(`${scope.selectedAgentIds.length} selected agent${scope.selectedAgentIds.length === 1 ? "" : "s"}`);
  return labels.join(" · ");
}

export function flattenTextParts(parts: ChatMessagePart[]): string {
  return parts
    .filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function summarizeMessage(message: ChatMessage): string {
  const text = flattenTextParts(message.parts);
  if (text) return text;
  const firstImage = message.parts.find((part) => part.type === "image");
  if (firstImage) return `[Image] ${firstImage.name}`;
  const firstTool = message.parts.find((part) => part.type === "tool_call" || part.type === "tool_result");
  if (firstTool && "toolName" in firstTool) return `[Tool] ${firstTool.toolName}`;
  return `[${message.role}]`;
}

export function formatStreamStatus(event: Extract<HermesStreamEvent, { type: "status" }>): string {
  return `${event.stage}: ${event.message}`;
}

export function appendStreamDelta(current: string, event: Extract<HermesStreamEvent, { type: "delta" }>): string {
  const next = event.text.trim();
  if (!next) return current;
  return [current, next].filter(Boolean).join("\n").trim();
}
