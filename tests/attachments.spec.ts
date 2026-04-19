import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/constants.js";
import { hydrateMessages, migrateInlineAttachments, persistAttachments } from "../src/attachments.js";
import type { ChatMessage, MasterChatPluginConfig } from "../src/types.js";

function buildConfig(overrides: Partial<MasterChatPluginConfig> = {}): MasterChatPluginConfig {
  return {
    ...DEFAULT_CONFIG,
    defaultEnabledSkills: [...DEFAULT_CONFIG.defaultEnabledSkills],
    defaultToolsets: [...DEFAULT_CONFIG.defaultToolsets],
    availablePluginTools: [...DEFAULT_CONFIG.availablePluginTools],
    ...overrides,
  };
}

function sampleMessage(): ChatMessage {
  return {
    messageId: "msg_1",
    threadId: "thr_1",
    role: "user",
    requestId: "req_1",
    parts: [
      { type: "text", text: "Analyze the upload." },
      {
        id: "img_1",
        type: "image",
        name: "ready.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,aGVsbG8=",
        byteSize: 5,
        source: "inline",
        analysis: {
          status: "complete",
          summary: "The word READY on a white card",
          extractedText: "READY",
          notableDetails: ["Bold black uppercase text"],
          generatedAt: "2026-04-19T08:00:00Z",
        },
      },
    ],
    routing: {
      companyId: "comp_1",
      selectedAgentIds: [],
      mode: "company_wide",
    },
    toolPolicy: {
      allowedPluginTools: [],
      allowedHermesToolsets: ["vision"],
    },
    status: "complete",
    createdAt: "2026-04-19T08:00:00Z",
    updatedAt: "2026-04-19T08:00:00Z",
  };
}

describe("attachment storage helpers", () => {
  it("persists filesystem attachments and hydrates them back into UI-ready messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "master-chat-attachments-"));
    try {
      const config = buildConfig({
        attachmentStorageMode: "filesystem",
        attachmentStorageDirectory: dir,
      });

      const [persisted] = await persistAttachments({
        config,
        companyId: "comp_1",
        threadId: "thr_1",
        messageId: "msg_1",
        attachments: [sampleMessage().parts[1] as Extract<ChatMessage["parts"][number], { type: "image" }>],
      });

      expect(persisted?.source).toBe("filesystem");
      expect(persisted?.storageKey).toMatch(/comp_1/);
      expect(persisted?.dataUrl).toBeUndefined();

      const [hydratedMessage] = await hydrateMessages(config, [{
        ...sampleMessage(),
        parts: [sampleMessage().parts[0], persisted!],
      }]);

      const hydratedImage = hydratedMessage?.parts[1];
      expect(hydratedImage && hydratedImage.type === "image" ? hydratedImage.dataUrl : undefined).toBe("data:image/png;base64,aGVsbG8=");
      expect(hydratedImage && hydratedImage.type === "image" ? hydratedImage.analysis?.extractedText : undefined).toBe("READY");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates stored inline attachments to filesystem references while preserving analysis metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "master-chat-attachments-"));
    try {
      const config = buildConfig({
        attachmentStorageMode: "filesystem",
        attachmentStorageDirectory: dir,
      });

      const migrated = await migrateInlineAttachments({
        config,
        companyId: "comp_1",
        messages: [sampleMessage()],
      });

      expect(migrated.changed).toBe(true);
      const migratedImage = migrated.messages[0]?.parts[1];
      expect(migratedImage && migratedImage.type === "image" ? migratedImage.source : undefined).toBe("filesystem");
      expect(migratedImage && migratedImage.type === "image" ? migratedImage.storageKey : undefined).toBeTruthy();
      expect(migratedImage && migratedImage.type === "image" ? migratedImage.analysis?.summary : undefined).toContain("READY");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
