import type {
  ChatMessage,
  ChatMessagePart,
  HermesRequest,
  HermesToolDescriptor,
  InlineImageAttachment,
} from "../types.js";
import { buildImageAnalysisFallbackText } from "./image-analysis.js";

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
  continuity: HermesRequest["continuity"];
  messages: HermesPayloadMessage[];
}

function toTextBlock(text: string): HermesContentBlock[] {
  const trimmed = text.trim();
  return trimmed ? [{ type: "text", text: trimmed }] : [];
}

function fromImagePart(part: InlineImageAttachment): HermesContentBlock[] {
  const dataUrl = part.dataUrl;
  if (!dataUrl) {
    throw new Error(`Image attachment '${part.name}' must be hydrated before Hermes payload construction`);
  }
  const fallbackText = buildImageAnalysisFallbackText(part.analysis, 2_500);
  return [
    {
      type: "image",
      mimeType: part.mimeType,
      data: dataUrl.split(",", 2)[1] ?? "",
      name: part.name,
      altText: part.altText ?? part.analysis?.summary,
    },
    ...(fallbackText ? [{ type: "text" as const, text: `[image_analysis:${part.name}]\n${fallbackText}` }] : []),
  ];
}

function partToBlocks(part: ChatMessagePart): HermesContentBlock[] {
  switch (part.type) {
    case "text":
      return toTextBlock(part.text);
    case "image":
      return fromImagePart(part);
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
    continuity: request.continuity,
    messages: request.history.map((message) => ({
      role: message.role,
      content: message.parts.flatMap(partToBlocks),
    })),
  };
}
