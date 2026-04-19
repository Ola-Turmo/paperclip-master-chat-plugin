import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { createHermesGateway } from "../src/hermes/gateway.js";
import manifest from "../src/manifest.js";

describe("createHermesGateway", () => {
  it("falls back to mock in auto mode when no gateway is available", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    const result = await createHermesGateway(harness.ctx, {
      gatewayMode: "auto",
      hermesBaseUrl: "",
      hermesCommand: "definitely-not-a-real-hermes-binary",
      hermesWorkingDirectory: "",
      hermesAuthToken: "",
      hermesAuthHeaderName: "authorization",
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "paperclip-master",
      defaultProvider: "openrouter",
      defaultModel: "anthropic/claude-sonnet-4",
      defaultEnabledSkills: ["paperclip-search"],
      defaultToolsets: ["web"],
      availablePluginTools: ["paperclip.dashboard"],
      maxHistoryMessages: 24,
      allowInlineImageData: true,
      maxAttachmentCount: 4,
      maxAttachmentBytesPerFile: 5_000_000,
      maxTotalAttachmentBytes: 12_000_000,
      maxCatalogRecords: 1000,
      scopePageSize: 200,
      redactToolPayloads: true,
      enableActivityLogging: true,
    });

    expect(result.selection).toBe("mock");
    expect(result.reason).toBe("auto_fallback_mock");
  });
});
