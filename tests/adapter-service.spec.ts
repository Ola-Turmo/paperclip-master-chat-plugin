import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAdapterInvocation,
  buildAdapterPrompt,
  getExpectedAuthValue,
  isAuthorized,
  parseSessionId,
  readJsonLimited,
  resolveAdapterSessionState,
  validateAdapterServiceConfig,
  validateGatewayPayload,
  verifySignedRequest,
} from "../src/adapter-service.js";
import type { HermesCapabilityInventory } from "../src/hermes/capabilities.js";
import type { HermesGatewayPayload } from "../src/hermes/payload.js";

function samplePayload(): HermesGatewayPayload {
  return {
    session: {
      profileId: "paperclip-master",
      sessionId: "sess_123",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
    },
    metadata: {
      threadId: "thr_1",
      title: "Board review",
    },
    scope: {
      companyId: "comp_1",
      projectId: "proj_1",
      linkedIssueId: "iss_1",
      selectedAgentIds: ["agent_1"],
      mode: "single_agent",
    },
    skillPolicy: {
      enabled: ["paperclip-search"],
      disabled: [],
      toolsets: ["web", "file"],
    },
    toolPolicy: {
      allowedPluginTools: ["paperclip.dashboard"],
      allowedHermesToolsets: ["web", "file"],
    },
    context: {
      company: { id: "comp_1", name: "Acme" },
      project: { id: "proj_1", name: "Core App" },
      linkedIssue: { id: "iss_1", name: "Risk Review" },
      selectedAgents: [{ id: "agent_1", name: "CTO" }],
      issueCount: 5,
      agentCount: 1,
      projectCount: 1,
      catalog: {
        companies: { loaded: 1, pageSize: 50, truncated: false },
        projects: { loaded: 1, pageSize: 50, truncated: false },
        issues: { loaded: 5, pageSize: 50, truncated: false },
        agents: { loaded: 1, pageSize: 50, truncated: false },
      },
      warnings: ["issues list truncated"],
    },
    tools: [{ name: "paperclip.dashboard", description: "Dashboard tool", kind: "paperclip" }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Summarize the current risk posture." },
          { type: "image", name: "diagram.png", mimeType: "image/png", data: "abc" },
        ],
      },
    ],
  };
}

describe("adapter service helpers", () => {
  it("builds an adapter prompt with scope and warning details", () => {
    const prompt = buildAdapterPrompt(samplePayload());
    expect(prompt).toContain("Thread title: Board review");
    expect(prompt).toContain("Allowed plugin tools: paperclip.dashboard");
    expect(prompt).toContain("Hermes host compatibility notes: none");
    expect(prompt).toContain("Warnings: issues list truncated");
    expect(prompt).toContain("[Image attachment: diagram.png");
  });

  it("normalizes bearer auth for authorization headers", () => {
    const expected = getExpectedAuthValue({
      port: 8788,
      host: "127.0.0.1",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      defaultProfileId: "paperclip-master",
      defaultProvider: "auto",
      defaultModel: "anthropic/claude-sonnet-4",
      authToken: "secret-token",
      authHeaderName: "authorization",
      timeoutMs: 45_000,
      maxRequestBodyBytes: 15_000_000,
      maxClockSkewMs: 300_000,
    });
    expect(expected).toBe("Bearer secret-token");
    expect(isAuthorized({ authorization: expected }, {
      port: 8788,
      host: "127.0.0.1",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      defaultProfileId: "paperclip-master",
      defaultProvider: "auto",
      defaultModel: "anthropic/claude-sonnet-4",
      authToken: "secret-token",
      authHeaderName: "authorization",
      timeoutMs: 45_000,
      maxRequestBodyBytes: 15_000_000,
      maxClockSkewMs: 300_000,
    })).toBe(true);
  });

  it("rejects oversized adapter request bodies", async () => {
    await expect(readJsonLimited((async function* () {
      yield Buffer.from("{\"data\":\"");
      yield Buffer.from("x".repeat(32));
      yield Buffer.from("\"}");
    }()), 16)).rejects.toMatchObject({ name: "PayloadTooLargeError" });
  });

  it("rejects invalid adapter config values before the server starts", () => {
    expect(validateAdapterServiceConfig({
      port: 8788,
      host: "127.0.0.1",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      defaultProfileId: "paperclip-master",
      defaultProvider: "auto",
      defaultModel: "anthropic/claude-sonnet-4",
      authToken: "secret-token",
      authHeaderName: "bad header",
      timeoutMs: 45_000,
      maxRequestBodyBytes: 15_000_000,
      maxClockSkewMs: 300_000,
    })).toContain("authHeaderName must be a valid HTTP header name");
  });

  it("rejects malformed gateway payloads before invoking Hermes", () => {
    expect(validateGatewayPayload({
      session: {},
      metadata: { threadId: "" },
      scope: {},
      messages: "nope",
      skillPolicy: {},
      toolPolicy: {},
    })).toEqual(expect.arrayContaining([
      "metadata.threadId is required",
      "scope.companyId is required",
      "messages must be an array",
      "skillPolicy must include enabled, disabled, and toolsets arrays",
      "toolPolicy must include allowedPluginTools and allowedHermesToolsets arrays",
    ]));
  });

  it("keeps Hermes capability preferences in the prompt instead of forwarding -s/-t flags", async () => {
    const inventory: HermesCapabilityInventory = {
      availableSkills: [],
      enabledToolsets: ["web", "file"],
    };
    const invocation = await buildAdapterInvocation({
      port: 8788,
      host: "127.0.0.1",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      defaultProfileId: "paperclip-master",
      defaultProvider: "openrouter",
      defaultModel: "anthropic/claude-sonnet-4",
      authToken: "secret-token",
      authHeaderName: "authorization",
      timeoutMs: 45_000,
      maxRequestBodyBytes: 15_000_000,
      maxClockSkewMs: 300_000,
    }, samplePayload(), inventory);

    expect(invocation.invocation.args).not.toContain("-s");
    expect(invocation.invocation.args).not.toContain("-t");
    expect(invocation.invocation.args).not.toContain("--provider");
    expect(invocation.invocation.args).not.toContain("-m");
    expect(invocation.invocation.args.at(-1)).toContain("Hermes capability preferences: None");
    expect(invocation.invocation.args.at(-1)).toContain("Hermes runtime tools requested: web, file");
    expect(invocation.warnings).toContain("Skipped 1 unavailable Hermes skill preference(s).");
  });

  it("parses Hermes session IDs from output", () => {
    expect(parseSessionId("Session ID: sess_abc123")).toBe("sess_abc123");
  });

  it("treats new adapter sessions as durable when Hermes returns a real session id", () => {
    const payload = samplePayload();
    payload.session.sessionId = undefined;

    expect(resolveAdapterSessionState(payload, "session=sess_new123")).toEqual({
      sessionId: "sess_new123",
      continuationMode: "durable",
    });
  });

  it("rejects mismatched bearer headers", () => {
    expect(isAuthorized({ authorization: "Bearer wrong-token" }, {
      port: 8788,
      host: "127.0.0.1",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      defaultProfileId: "paperclip-master",
      defaultProvider: "auto",
      defaultModel: "anthropic/claude-sonnet-4",
      authToken: "secret-token",
      authHeaderName: "authorization",
      timeoutMs: 45_000,
      maxRequestBodyBytes: 15_000_000,
      maxClockSkewMs: 300_000,
    })).toBe(false);
  });

  it("accepts signed adapter requests once and rejects replayed nonces", () => {
    const config = {
      port: 8788,
      host: "127.0.0.1",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      defaultProfileId: "paperclip-master",
      defaultProvider: "auto",
      defaultModel: "anthropic/claude-sonnet-4",
      authToken: "secret-token",
      authHeaderName: "authorization",
      timeoutMs: 45_000,
      maxRequestBodyBytes: 15_000_000,
      maxClockSkewMs: 300_000,
    } as const;
    const body = "{\"ok\":true}";
    const date = new Date("2026-04-19T07:20:00.000Z").toISOString();
    const nonce = "nonce-1";
    const signature = createHmac("sha256", config.authToken)
      .update(["POST", "/sessions/continue", date, nonce, body].join("\n"))
      .digest("hex");

    const headers = {
      authorization: "Bearer secret-token",
      "x-master-chat-date": date,
      "x-master-chat-nonce": nonce,
      "x-master-chat-signature": signature,
    };

    const seenNonces = new Map<string, number>();
    expect(verifySignedRequest(headers, config, "POST", "/sessions/continue", body, seenNonces, Date.parse(date))).toEqual({ ok: true });
    expect(verifySignedRequest(headers, config, "POST", "/sessions/continue", body, seenNonces, Date.parse(date))).toEqual({ ok: false, error: "replayed_signature" });
  });
});
