import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { notFoundError, validationError } from "./errors.js";
import type { ChatMessage, InlineImageAttachment, MasterChatPluginConfig } from "./types.js";

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function storageRoot(config: MasterChatPluginConfig): string {
  return path.resolve(config.attachmentStorageDirectory || ".paperclip-master-chat-attachments");
}

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

function ensureImageDataUrl(attachment: InlineImageAttachment): string {
  if (!attachment.dataUrl) {
    throw validationError(`Attachment '${attachment.name}' is missing dataUrl content`);
  }
  return attachment.dataUrl;
}

function dataUrlToBuffer(attachment: InlineImageAttachment): Buffer {
  const dataUrl = ensureImageDataUrl(attachment);
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/u);
  if (!match) {
    throw validationError(`Attachment '${attachment.name}' must be a base64 data URL`);
  }
  return Buffer.from(match[2].replace(/\s+/gu, ""), "base64");
}

function toDataUrl(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function persistFilesystemAttachment(input: {
  config: MasterChatPluginConfig;
  companyId: string;
  threadId: string;
  messageId: string;
  attachment: InlineImageAttachment;
}): Promise<InlineImageAttachment> {
  const { config, companyId, threadId, messageId, attachment } = input;
  const bytes = dataUrlToBuffer(attachment);
  const root = storageRoot(config);
  const relativePath = path.join(
    sanitizeSegment(companyId),
    sanitizeSegment(threadId),
    sanitizeSegment(messageId),
    `${sanitizeSegment(attachment.id)}.${extensionForMime(attachment.mimeType)}`,
  );
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return {
    ...attachment,
    dataUrl: undefined,
    source: "filesystem",
    storageKey: relativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function persistAttachments(input: {
  config: MasterChatPluginConfig;
  companyId: string;
  threadId: string;
  messageId: string;
  attachments: InlineImageAttachment[];
}): Promise<InlineImageAttachment[]> {
  const { config, attachments } = input;
  if (config.attachmentStorageMode === "inline") {
    return attachments;
  }
  return await Promise.all(attachments.map(async (attachment) => {
    if (attachment.source === "filesystem" && attachment.storageKey) return attachment;
    return await persistFilesystemAttachment({ ...input, attachment });
  }));
}

export async function hydrateAttachment(
  config: MasterChatPluginConfig,
  attachment: InlineImageAttachment,
): Promise<InlineImageAttachment> {
  if (attachment.dataUrl) return attachment;
  if (attachment.source !== "filesystem" || !attachment.storageKey) {
    return attachment;
  }
  const absolutePath = path.join(storageRoot(config), attachment.storageKey);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch (error) {
    throw notFoundError(`Stored attachment '${attachment.name}' is missing at ${attachment.storageKey}`);
  }
  return {
    ...attachment,
    dataUrl: toDataUrl(attachment.mimeType, bytes),
    byteSize: attachment.byteSize ?? bytes.length,
    sha256: attachment.sha256 ?? createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function hydrateMessages(
  config: MasterChatPluginConfig,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  return await Promise.all(messages.map(async (message) => ({
    ...message,
    parts: await Promise.all(message.parts.map(async (part) => {
      if (part.type !== "image") return part;
      return await hydrateAttachment(config, part);
    })),
  })));
}

export async function migrateInlineAttachments(input: {
  config: MasterChatPluginConfig;
  companyId: string;
  messages: ChatMessage[];
}): Promise<{ messages: ChatMessage[]; changed: boolean }> {
  const { config, companyId, messages } = input;
  if (config.attachmentStorageMode === "inline") {
    return { messages, changed: false };
  }

  let changed = false;
  const migratedMessages = await Promise.all(messages.map(async (message) => {
    let messageChanged = false;
    const imageParts = message.parts.filter((part): part is InlineImageAttachment => part.type === "image");
    if (imageParts.length === 0) return message;
    const persisted = await persistAttachments({
      config,
      companyId,
      threadId: message.threadId,
      messageId: message.messageId,
      attachments: imageParts,
    });
    let imageIndex = 0;
    const parts = message.parts.map((part) => {
      if (part.type !== "image") return part;
      const next = persisted[imageIndex++];
      if (next !== part || next.source === "filesystem") {
        messageChanged = true;
      }
      return next;
    });
    if (!messageChanged) return message;
    changed = true;
    return { ...message, parts };
  }));

  return { messages: migratedMessages, changed };
}
