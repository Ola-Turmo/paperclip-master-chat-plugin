import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { HttpHermesGateway, buildSignedAdapterHeaders, createHermesGateway, resolveCliSessionState, shouldUseDirectAdapterFetch } from "../src/hermes/gateway.js";
import manifest from "../src/manifest.js";
import type { HermesRequest } from "../src/types.js";

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
      allowPrivateAdapterHosts: false,
      allowInsecureHttpAdapters: false,
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "paperclip-master",
      defaultProvider: "openrouter",
      defaultModel: "anthropic/claude-sonnet-4",
      defaultEnabledSkills: ["paperclip-search"],
      defaultToolsets: ["web"],
      availablePluginTools: ["paperclip.dashboard"],
      maxHistoryMessages: 24,
      maxMessageChars: 12_000,
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

  it("rejects non-loopback insecure HTTP adapters unless explicitly allowed", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });

    await expect(createHermesGateway(harness.ctx, {
      gatewayMode: "http",
      hermesBaseUrl: "http://adapter.example.com",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      hermesAuthToken: "secret-token",
      hermesAuthHeaderName: "authorization",
      allowPrivateAdapterHosts: false,
      allowInsecureHttpAdapters: false,
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "default",
      defaultProvider: "auto",
      defaultModel: "MiniMax-M2.7",
      defaultEnabledSkills: [],
      defaultToolsets: ["web"],
      availablePluginTools: [],
      maxHistoryMessages: 24,
      maxMessageChars: 12_000,
      allowInlineImageData: true,
      maxAttachmentCount: 4,
      maxAttachmentBytesPerFile: 5_000_000,
      maxTotalAttachmentBytes: 12_000_000,
      maxCatalogRecords: 1000,
      scopePageSize: 200,
      redactToolPayloads: true,
      enableActivityLogging: true,
    })).rejects.toThrow(/https/i);
  });

  it("uses direct fetch for trusted local adapter URLs", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    const originalFetch = globalThis.fetch;
    const ctxFetch = harness.ctx.http.fetch;

    globalThis.fetch = async () => new Response(JSON.stringify({
      assistantText: "READY",
      toolTraces: [],
      provider: "auto",
      model: "MiniMax-M2.7",
      gatewayMode: "http",
      continuationMode: "stateless",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    harness.ctx.http.fetch = async () => {
      throw new Error("ctx.http.fetch should not be used for loopback adapter URLs");
    };

    try {
      const gateway = new HttpHermesGateway(harness.ctx, {
        gatewayMode: "http",
        hermesBaseUrl: "http://127.0.0.1:8788",
        hermesCommand: "hermes",
        hermesWorkingDirectory: "",
        hermesAuthToken: "secret-token",
        hermesAuthHeaderName: "authorization",
        allowPrivateAdapterHosts: false,
        allowInsecureHttpAdapters: false,
        gatewayRequestTimeoutMs: 2_000,
        defaultProfileId: "default",
        defaultProvider: "auto",
        defaultModel: "MiniMax-M2.7",
        defaultEnabledSkills: [],
        defaultToolsets: ["web"],
        availablePluginTools: ["paperclip.dashboard"],
        maxHistoryMessages: 24,
        maxMessageChars: 12_000,
        allowInlineImageData: true,
        maxAttachmentCount: 4,
        maxAttachmentBytesPerFile: 5_000_000,
        maxTotalAttachmentBytes: 12_000_000,
        maxCatalogRecords: 1000,
        scopePageSize: 200,
        redactToolPayloads: true,
        enableActivityLogging: true,
      });

      const response = await gateway.sendMessage({
        requestId: "req_local_http",
        metadata: { threadId: "thr_1", title: "Thread" },
        session: { profileId: "default", provider: "auto", model: "MiniMax-M2.7" },
        scope: { companyId: "comp_1", selectedAgentIds: [], mode: "company_wide" },
        skillPolicy: { enabled: [], disabled: [], toolsets: ["web"] },
        toolPolicy: { allowedPluginTools: [], allowedHermesToolsets: ["web"] },
        tools: [],
        context: {
          company: { id: "comp_1", name: "Acme" },
          selectedAgents: [],
          issueCount: 0,
          agentCount: 0,
          projectCount: 0,
          catalog: {
            companies: { loaded: 1, pageSize: 50, truncated: false },
            projects: { loaded: 0, pageSize: 50, truncated: false },
            issues: { loaded: 0, pageSize: 50, truncated: false },
            agents: { loaded: 0, pageSize: 50, truncated: false },
          },
          warnings: [],
        },
        history: [{
          messageId: "msg_1",
          threadId: "thr_1",
          role: "user",
          parts: [{ type: "text", text: "Reply READY." }],
          routing: { companyId: "comp_1", selectedAgentIds: [], mode: "company_wide" },
          toolPolicy: { allowedPluginTools: [], allowedHermesToolsets: ["web"] },
          status: "complete",
          createdAt: "2026-04-19T00:00:00Z",
          updatedAt: "2026-04-19T00:00:00Z",
        }],
      });

      expect(response.assistantText).toBe("READY");
      expect(response.gatewayMode).toBe("http");
    } finally {
      globalThis.fetch = originalFetch;
      harness.ctx.http.fetch = ctxFetch;
    }
  });

  it("infers durable HTTP continuation when the adapter returns a session id", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    const originalFetch = globalThis.fetch;
    const ctxFetch = harness.ctx.http.fetch;

    globalThis.fetch = async () => new Response(JSON.stringify({
      assistantText: "READY",
      toolTraces: [],
      provider: "auto",
      model: "MiniMax-M2.7",
      sessionId: "sess_http_1",
      gatewayMode: "http",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    harness.ctx.http.fetch = async () => {
      throw new Error("ctx.http.fetch should not be used for loopback adapter URLs");
    };

    try {
      const gateway = new HttpHermesGateway(harness.ctx, {
        gatewayMode: "http",
        hermesBaseUrl: "http://127.0.0.1:8788",
        hermesCommand: "hermes",
        hermesWorkingDirectory: "",
        hermesAuthToken: "secret-token",
        hermesAuthHeaderName: "authorization",
        allowPrivateAdapterHosts: false,
        allowInsecureHttpAdapters: false,
        gatewayRequestTimeoutMs: 2_000,
        defaultProfileId: "default",
        defaultProvider: "auto",
        defaultModel: "MiniMax-M2.7",
        defaultEnabledSkills: [],
        defaultToolsets: ["web"],
        availablePluginTools: ["paperclip.dashboard"],
        maxHistoryMessages: 24,
        maxMessageChars: 12_000,
        allowInlineImageData: true,
        maxAttachmentCount: 4,
        maxAttachmentBytesPerFile: 5_000_000,
        maxTotalAttachmentBytes: 12_000_000,
        maxCatalogRecords: 1000,
        scopePageSize: 200,
        redactToolPayloads: true,
        enableActivityLogging: true,
      });

      const response = await gateway.sendMessage({
        requestId: "req_local_http_session",
        metadata: { threadId: "thr_1", title: "Thread" },
        session: { profileId: "default", provider: "auto", model: "MiniMax-M2.7" },
        scope: { companyId: "comp_1", selectedAgentIds: [], mode: "company_wide" },
        skillPolicy: { enabled: [], disabled: [], toolsets: ["web"] },
        toolPolicy: { allowedPluginTools: [], allowedHermesToolsets: ["web"] },
        tools: [],
        context: {
          company: { id: "comp_1", name: "Acme" },
          selectedAgents: [],
          issueCount: 0,
          agentCount: 0,
          projectCount: 0,
          catalog: {
            companies: { loaded: 1, pageSize: 50, truncated: false },
            projects: { loaded: 0, pageSize: 50, truncated: false },
            issues: { loaded: 0, pageSize: 50, truncated: false },
            agents: { loaded: 0, pageSize: 50, truncated: false },
          },
          warnings: [],
        },
        history: [],
      });

      expect(response.sessionId).toBe("sess_http_1");
      expect(response.continuationMode).toBe("durable");
    } finally {
      globalThis.fetch = originalFetch;
      harness.ctx.http.fetch = ctxFetch;
    }
  });

  it("does not bypass the guarded HTTP client for RFC1918 hosts unless explicitly allowed", () => {
    expect(shouldUseDirectAdapterFetch("http://127.0.0.1:8788", {
      gatewayMode: "http",
      hermesBaseUrl: "http://127.0.0.1:8788",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      hermesAuthToken: "secret-token",
      hermesAuthHeaderName: "authorization",
      allowPrivateAdapterHosts: false,
      allowInsecureHttpAdapters: false,
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "default",
      defaultProvider: "auto",
      defaultModel: "MiniMax-M2.7",
      defaultEnabledSkills: [],
      defaultToolsets: ["web"],
      availablePluginTools: [],
      maxHistoryMessages: 24,
      maxMessageChars: 12_000,
      allowInlineImageData: true,
      maxAttachmentCount: 4,
      maxAttachmentBytesPerFile: 5_000_000,
      maxTotalAttachmentBytes: 12_000_000,
      maxCatalogRecords: 1000,
      scopePageSize: 200,
      redactToolPayloads: true,
      enableActivityLogging: true,
    })).toBe(true);

    expect(shouldUseDirectAdapterFetch("http://192.168.1.12:8788", {
      gatewayMode: "http",
      hermesBaseUrl: "http://192.168.1.12:8788",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      hermesAuthToken: "secret-token",
      hermesAuthHeaderName: "authorization",
      allowPrivateAdapterHosts: false,
      allowInsecureHttpAdapters: false,
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "default",
      defaultProvider: "auto",
      defaultModel: "MiniMax-M2.7",
      defaultEnabledSkills: [],
      defaultToolsets: ["web"],
      availablePluginTools: [],
      maxHistoryMessages: 24,
      maxMessageChars: 12_000,
      allowInlineImageData: true,
      maxAttachmentCount: 4,
      maxAttachmentBytesPerFile: 5_000_000,
      maxTotalAttachmentBytes: 12_000_000,
      maxCatalogRecords: 1000,
      scopePageSize: 200,
      redactToolPayloads: true,
      enableActivityLogging: true,
    })).toBe(false);

    expect(shouldUseDirectAdapterFetch("http://192.168.1.12:8788", {
      gatewayMode: "http",
      hermesBaseUrl: "http://192.168.1.12:8788",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      hermesAuthToken: "secret-token",
      hermesAuthHeaderName: "authorization",
      allowPrivateAdapterHosts: true,
      allowInsecureHttpAdapters: true,
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "default",
      defaultProvider: "auto",
      defaultModel: "MiniMax-M2.7",
      defaultEnabledSkills: [],
      defaultToolsets: ["web"],
      availablePluginTools: [],
      maxHistoryMessages: 24,
      maxMessageChars: 12_000,
      allowInlineImageData: true,
      maxAttachmentCount: 4,
      maxAttachmentBytesPerFile: 5_000_000,
      maxTotalAttachmentBytes: 12_000_000,
      maxCatalogRecords: 1000,
      scopePageSize: 200,
      redactToolPayloads: true,
      enableActivityLogging: true,
    })).toBe(true);
  });

  it("signs adapter requests with timestamp, nonce, and HMAC headers", () => {
    const headers = buildSignedAdapterHeaders({
      gatewayMode: "http",
      hermesBaseUrl: "http://127.0.0.1:8788",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      hermesAuthToken: "secret-token",
      hermesAuthHeaderName: "authorization",
      allowPrivateAdapterHosts: false,
      allowInsecureHttpAdapters: false,
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "default",
      defaultProvider: "auto",
      defaultModel: "MiniMax-M2.7",
      defaultEnabledSkills: [],
      defaultToolsets: ["web"],
      availablePluginTools: [],
      maxHistoryMessages: 24,
      maxMessageChars: 12_000,
      allowInlineImageData: true,
      maxAttachmentCount: 4,
      maxAttachmentBytesPerFile: 5_000_000,
      maxTotalAttachmentBytes: 12_000_000,
      maxCatalogRecords: 1000,
      scopePageSize: 200,
      redactToolPayloads: true,
      enableActivityLogging: true,
    }, "POST", "/sessions/continue", "{\"ok\":true}");

    expect(headers.authorization).toBe("Bearer secret-token");
    expect(headers["x-master-chat-date"]).toBeTruthy();
    expect(headers["x-master-chat-nonce"]).toBeTruthy();
    expect(headers["x-master-chat-signature"]).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects insecure non-loopback HTTP adapters unless explicitly allowed", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    await expect(createHermesGateway(harness.ctx, {
      gatewayMode: "http",
      hermesBaseUrl: "http://adapter.example.com",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      hermesAuthToken: "secret-token",
      hermesAuthHeaderName: "authorization",
      allowPrivateAdapterHosts: false,
      allowInsecureHttpAdapters: false,
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "default",
      defaultProvider: "auto",
      defaultModel: "MiniMax-M2.7",
      defaultEnabledSkills: [],
      defaultToolsets: ["web"],
      availablePluginTools: [],
      maxHistoryMessages: 24,
      maxMessageChars: 12_000,
      allowInlineImageData: true,
      maxAttachmentCount: 4,
      maxAttachmentBytesPerFile: 5_000_000,
      maxTotalAttachmentBytes: 12_000_000,
      maxCatalogRecords: 1000,
      scopePageSize: 200,
      redactToolPayloads: true,
      enableActivityLogging: true,
    })).rejects.toThrow(/https/i);
  });

  it("treats new CLI sessions as durable when Hermes returns a real session id", () => {
    const request: HermesRequest = {
      requestId: "req_cli",
      metadata: { threadId: "thr_cli", title: "CLI thread" },
      session: { profileId: "default", provider: "auto", model: "MiniMax-M2.7" },
      scope: { companyId: "comp_1", selectedAgentIds: [], mode: "company_wide" },
      skillPolicy: { enabled: [], disabled: [], toolsets: ["web"] },
      toolPolicy: { allowedPluginTools: [], allowedHermesToolsets: ["web"] },
      tools: [],
      context: {
        company: { id: "comp_1", name: "Acme" },
        selectedAgents: [],
        issueCount: 0,
        agentCount: 0,
        projectCount: 0,
        catalog: {
          companies: { loaded: 1, pageSize: 50, truncated: false },
          projects: { loaded: 0, pageSize: 50, truncated: false },
          issues: { loaded: 0, pageSize: 50, truncated: false },
          agents: { loaded: 0, pageSize: 50, truncated: false },
        },
        warnings: [],
      },
      history: [],
    };

    expect(resolveCliSessionState(request, "Session ID: sess_cli123")).toEqual({
      sessionId: "sess_cli123",
      continuationMode: "durable",
    });
  });
});
