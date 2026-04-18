import type {
  ChatMessage,
  ChatMessagePart,
  HermesRequest,
  HermesToolDescriptor,
  InlineImageAttachment,
} from "../types.js";

export interface HermesContentBlock {
  type: "text" | "image";
  text?: string;
  mimeType?: string;
  data?: string;
  name?: string;
  altText?: string;
}

export interface HermesPayloadMessage {
  role: ChatMessage["role"];
  content: HermesContentBlock[];
}

export interface HermesGatewayPayload {
  session: HermesRequest["session"];
  metadata: HermesRequest["metadata"];
  scope: HermesRequest["scope"];
  skillPolicy: HermesRequest["skillPolicy"];
  toolPolicy: HermesRequest["toolPolicy"];
  context: HermesRequest["context"];
  tools: HermesToolDescriptor[];
  messages: HermesPayloadMessage[];
}

function toTextBlock(text: string): HermesContentBlock[] {
  const trimmed = text.trim();
  return trimmed ? [{ type: "text", text: trimmed }] : [];
}

function fromImagePart(part: InlineImageAttachment): HermesContentBlock {
  const [, payload = ""] = part.dataUrl.split(",", 2);
  return {
    type: "image",
    mimeType: part.mimeType,
    data: payload,
    name: part.name,
    altText: part.altText,
  };
}

function partToBlocks(part: ChatMessagePart): HermesContentBlock[] {
  switch (part.type) {
    case "text":
      return toTextBlock(part.text);
    case "image":
      return [fromImagePart(part)];
    case "tool_call":
      return toTextBlock(`[tool_call] ${part.toolName}: ${part.summary}`);
    case "tool_result":
      return toTextBlock(`[tool_result] ${part.toolName}: ${part.summary}`);
    case "status":
      return part.detail ? toTextBlock(`[status] ${part.status}: ${part.detail}`) : toTextBlock(`[status] ${part.status}`);
    default:
      return [];
  }
}

export function buildHermesGatewayPayload(request: HermesRequest): HermesGatewayPayload {
  return {
    session: request.session,
    metadata: request.metadata,
    scope: request.scope,
    skillPolicy: request.skillPolicy,
    toolPolicy: request.toolPolicy,
    context: request.context,
    tools: request.tools,
    messages: request.history.map((message) => ({
      role: message.role,
      content: message.parts.flatMap(partToBlocks),
    })),
  };
}
