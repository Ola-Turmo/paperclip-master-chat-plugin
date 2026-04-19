import { describe, expect, it } from "vitest";
import { buildAdapterPrompt, getExpectedAuthValue, isAuthorized, parseSessionId } from "../src/adapter-service.js";
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
      authToken: "secret-token",
      authHeaderName: "authorization",
      timeoutMs: 45_000,
    });
    expect(expected).toBe("Bearer secret-token");
    expect(isAuthorized({ authorization: expected }, {
      port: 8788,
      host: "127.0.0.1",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "",
      authToken: "secret-token",
      authHeaderName: "authorization",
      timeoutMs: 45_000,
    })).toBe(true);
  });

  it("parses Hermes session IDs from output", () => {
    expect(parseSessionId("Session ID: sess_abc123")).toBe("sess_abc123");
  });
});
