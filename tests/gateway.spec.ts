import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { DEFAULT_CONFIG } from "../src/constants.js";
import {
  HttpHermesGateway,
  buildSignedAdapterHeaders,
  createHermesGateway,
  resolveCliSessionState,
  shouldUseDirectAdapterFetch,
} from "../src/hermes/gateway.js";
import manifest from "../src/manifest.js";
import type { HermesRequest, MasterChatPluginConfig } from "../src/types.js";

function buildConfig(overrides: Partial<MasterChatPluginConfig> = {}): MasterChatPluginConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    defaultEnabledSkills: [...(overrides.defaultEnabledSkills ?? DEFAULT_CONFIG.defaultEnabledSkills)],
    defaultToolsets: [...(overrides.defaultToolsets ?? DEFAULT_CONFIG.defaultToolsets)],
    availablePluginTools: [...(overrides.availablePluginTools ?? DEFAULT_CONFIG.availablePluginTools)],
  };
}

function sampleRequest(overrides: Partial<HermesRequest> = {}): HermesRequest {
  return {
    requestId: "req_1",
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
    continuity: {
      strategy: "recent-history-only",
      olderMessageCount: 0,
      totalMessageCount: 1,
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
    ...overrides,
  };
}

describe("createHermesGateway", () => {
  it("falls back to mock in auto mode when no gateway is available", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    const result = await createHermesGateway(harness.ctx, buildConfig({
      gatewayMode: "auto",
      hermesCommand: "definitely-not-a-real-hermes-binary",
      gatewayRequestTimeoutMs: 2_000,
      defaultEnabledSkills: ["paperclip-search"],
      defaultToolsets: ["web"],
      availablePluginTools: ["paperclip.dashboard"],
    }));

    expect(result.selection).toBe("mock");
    expect(result.reason).toBe("auto_fallback_mock");
  });

  it("rejects non-loopback insecure HTTP adapters unless explicitly allowed", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });

    await expect(createHermesGateway(harness.ctx, buildConfig({
      gatewayMode: "http",
      hermesBaseUrl: "http://adapter.example.com",
      hermesAuthToken: "secret-token",
      gatewayRequestTimeoutMs: 2_000,
      defaultProfileId: "default",
      defaultProvider: "auto",
      defaultModel: "MiniMax-M2.7",
      defaultToolsets: ["web"],
    }))).rejects.toThrow(/https/i);
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
      const gateway = new HttpHermesGateway(harness.ctx, buildConfig({
        gatewayMode: "http",
        hermesBaseUrl: "http://127.0.0.1:8788",
        hermesAuthToken: "secret-token",
        gatewayRequestTimeoutMs: 2_000,
        defaultProfileId: "default",
        defaultProvider: "auto",
        defaultModel: "MiniMax-M2.7",
        defaultToolsets: ["web"],
        availablePluginTools: ["paperclip.dashboard"],
      }));

      const response = await gateway.sendMessage(sampleRequest());
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
      const gateway = new HttpHermesGateway(harness.ctx, buildConfig({
        gatewayMode: "http",
        hermesBaseUrl: "http://127.0.0.1:8788",
        hermesAuthToken: "secret-token",
        gatewayRequestTimeoutMs: 2_000,
        defaultProfileId: "default",
        defaultProvider: "auto",
        defaultModel: "MiniMax-M2.7",
      }));

      const response = await gateway.sendMessage(sampleRequest({ history: [] }));
      expect(response.sessionId).toBe("sess_http_1");
      expect(response.continuationMode).toBe("durable");
    } finally {
      globalThis.fetch = originalFetch;
      harness.ctx.http.fetch = ctxFetch;
    }
  });

  it("marks HTTP continuation as synthetic when the adapter has no real session id but receives summarized prior context", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    const originalFetch = globalThis.fetch;
    const ctxFetch = harness.ctx.http.fetch;

    globalThis.fetch = async () => new Response(JSON.stringify({
      assistantText: "READY",
      toolTraces: [],
      provider: "auto",
      model: "MiniMax-M2.7",
      gatewayMode: "http",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    harness.ctx.http.fetch = async () => {
      throw new Error("ctx.http.fetch should not be used for loopback adapter URLs");
    };

    try {
      const gateway = new HttpHermesGateway(harness.ctx, buildConfig({
        gatewayMode: "http",
        hermesBaseUrl: "http://127.0.0.1:8788",
        hermesAuthToken: "secret-token",
        gatewayRequestTimeoutMs: 2_000,
      }));

      const response = await gateway.sendMessage(sampleRequest({
        continuity: {
          strategy: "synthetic-summary",
          olderMessageCount: 2,
          totalMessageCount: 4,
          summary: "- User: Earlier scope discussion",
        },
      }));
      expect(response.continuationMode).toBe("synthetic");
    } finally {
      globalThis.fetch = originalFetch;
      harness.ctx.http.fetch = ctxFetch;
    }
  });

  it("posts image-analysis requests to the adapter and normalizes the result", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    const originalFetch = globalThis.fetch;
    const ctxFetch = harness.ctx.http.fetch;

    globalThis.fetch = async (input, init) => {
      expect(String(input)).toContain("/images/analyze");
      expect(init?.headers).toMatchObject({ authorization: "Bearer secret-token" });
      return new Response(JSON.stringify({
        status: "complete",
        summary: "Screenshot of a dashboard",
        extractedText: "ERROR RATE 2%",
        notableDetails: ["orange alert badge"],
        provider: "auto",
        model: "MiniMax-M2.7",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    harness.ctx.http.fetch = async () => {
      throw new Error("ctx.http.fetch should not be used for loopback adapter URLs");
    };

    try {
      const gateway = new HttpHermesGateway(harness.ctx, buildConfig({
        gatewayMode: "http",
        hermesBaseUrl: "http://127.0.0.1:8788",
        hermesAuthToken: "secret-token",
        gatewayRequestTimeoutMs: 2_000,
      }));

      const result = await gateway.analyzeImage?.({
        requestId: "req_img_1",
        session: { profileId: "default", provider: "auto", model: "MiniMax-M2.7" },
        metadata: { threadId: "thr_1", title: "Thread" },
        attachment: {
          id: "img_1",
          type: "image",
          name: "dashboard.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,aGVsbG8=",
          source: "inline",
        },
      });

      expect(result).toEqual({
        status: "complete",
        summary: "Screenshot of a dashboard",
        extractedText: "ERROR RATE 2%",
        notableDetails: ["orange alert badge"],
        provider: "auto",
        model: "MiniMax-M2.7",
        errorMessage: undefined,
      });
    } finally {
      globalThis.fetch = originalFetch;
      harness.ctx.http.fetch = ctxFetch;
    }
  });

  it("does not bypass the guarded HTTP client for RFC1918 hosts unless explicitly allowed", () => {
    expect(shouldUseDirectAdapterFetch("http://127.0.0.1:8788", buildConfig({
      gatewayMode: "http",
      hermesBaseUrl: "http://127.0.0.1:8788",
      hermesAuthToken: "secret-token",
      gatewayRequestTimeoutMs: 2_000,
    }))).toBe(true);

    expect(shouldUseDirectAdapterFetch("http://192.168.1.12:8788", buildConfig({
      gatewayMode: "http",
      hermesBaseUrl: "http://192.168.1.12:8788",
      hermesAuthToken: "secret-token",
      gatewayRequestTimeoutMs: 2_000,
      allowPrivateAdapterHosts: false,
    }))).toBe(false);

    expect(shouldUseDirectAdapterFetch("http://192.168.1.12:8788", buildConfig({
      gatewayMode: "http",
      hermesBaseUrl: "http://192.168.1.12:8788",
      hermesAuthToken: "secret-token",
      gatewayRequestTimeoutMs: 2_000,
      allowPrivateAdapterHosts: true,
      allowInsecureHttpAdapters: true,
    }))).toBe(true);
  });

  it("signs adapter requests with timestamp, nonce, and HMAC headers", () => {
    const headers = buildSignedAdapterHeaders(buildConfig({
      gatewayMode: "http",
      hermesBaseUrl: "http://127.0.0.1:8788",
      hermesAuthToken: "secret-token",
      gatewayRequestTimeoutMs: 2_000,
    }), "POST", "/sessions/continue", "{\"ok\":true}");

    expect(headers.authorization).toBe("Bearer secret-token");
    expect(headers["x-master-chat-date"]).toBeTruthy();
    expect(headers["x-master-chat-nonce"]).toBeTruthy();
    expect(headers["x-master-chat-signature"]).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("treats new CLI sessions as durable when Hermes returns a real session id", () => {
    expect(resolveCliSessionState(sampleRequest({ history: [] }), "Session ID: sess_cli123")).toEqual({
      sessionId: "sess_cli123",
      continuationMode: "durable",
    });
  });
});
