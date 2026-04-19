import { describe, expect, it } from "vitest";
import { buildHermesCliInvocation, buildHermesCliPrompt } from "../src/hermes/cli.js";
import type { HermesRequest, MasterChatPluginConfig } from "../src/types.js";

function sampleRequest(): HermesRequest {
  return {
    requestId: "req_1",
    session: {
      profileId: "paperclip-master",
      sessionId: "sess_1",
      model: "anthropic/claude-sonnet-4",
      provider: "openrouter",
      continuationMode: "durable",
    },
    scope: {
      companyId: "comp_1",
      projectId: "proj_1",
      linkedIssueId: "iss_1",
      selectedAgentIds: ["agent_1"],
      mode: "single_agent",
    },
    skillPolicy: {
      enabled: ["paperclip-search", "issue-summarize"],
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
      agentCount: 2,
      projectCount: 1,
      catalog: {
        companies: { loaded: 1, pageSize: 50, truncated: false },
        projects: { loaded: 1, pageSize: 50, truncated: false },
        issues: { loaded: 5, pageSize: 50, truncated: false },
        agents: { loaded: 2, pageSize: 50, truncated: false },
      },
      warnings: [],
    },
    history: [
      {
        messageId: "msg_1",
        threadId: "thr_1",
        role: "user",
        requestId: "req_1",
        parts: [
          { type: "text", text: "Compare delivery risk." },
          {
            id: "img_1",
            type: "image",
            name: "diagram.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,aGVsbG8=",
            byteSize: 5,
            source: "inline",
          },
        ],
        routing: {
          companyId: "comp_1",
          projectId: "proj_1",
          linkedIssueId: "iss_1",
          selectedAgentIds: ["agent_1"],
          mode: "single_agent",
        },
        toolPolicy: {
          allowedPluginTools: ["paperclip.dashboard"],
          allowedHermesToolsets: ["web", "file"],
        },
        status: "complete",
        createdAt: "2026-04-18T10:00:00Z",
        updatedAt: "2026-04-18T10:00:00Z",
      },
    ],
    tools: [{ name: "paperclip.dashboard", description: "Scoped dashboard tool", kind: "paperclip" }],
    metadata: {
      threadId: "thr_1",
      title: "Risk review",
    },
  };
}

describe("Hermes CLI helpers", () => {
  it("builds a prompt with scope and conversation details", () => {
    const prompt = buildHermesCliPrompt(sampleRequest());
    expect(prompt).toContain("Thread title: Risk review");
    expect(prompt).toContain("Request id: req_1");
    expect(prompt).toContain("Selected agents: CTO");
    expect(prompt).toContain("[Image attachment: diagram.png");
    expect(prompt).toContain("Compare delivery risk.");
  });

  it("builds a CLI invocation that resumes durable Hermes sessions", () => {
    const config: MasterChatPluginConfig = {
      gatewayMode: "auto",
      hermesBaseUrl: "",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "/root/hermes-agent",
      hermesAuthToken: "",
      hermesAuthHeaderName: "authorization",
      allowPrivateAdapterHosts: false,
      gatewayRequestTimeoutMs: 45_000,
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
    };

    const invocation = buildHermesCliInvocation(sampleRequest(), config);
    expect(invocation.command).toBe("hermes");
    expect(invocation.cwd).toBe("/root/hermes-agent");
    expect(invocation.args).toContain("-p");
    expect(invocation.args).toContain("paperclip-master");
    expect(invocation.args).toContain("-Q");
    expect(invocation.args).toContain("--resume");
    expect(invocation.args).toContain("sess_1");
    expect(invocation.args).not.toContain("--provider");
    expect(invocation.args).not.toContain("-m");
    expect(invocation.args).not.toContain("-t");
    expect(invocation.args).not.toContain("-s");
    expect(invocation.args.at(-1)).toContain("Hermes capability preferences: paperclip-search, issue-summarize");
    expect(invocation.args.at(-1)).toContain("Hermes runtime tools requested: web, file");
  });

  it("passes provider and model only when they override the configured defaults", () => {
    const request = sampleRequest();
    request.session.provider = "anthropic";
    request.session.model = "claude-4.5-sonnet";
    const config: MasterChatPluginConfig = {
      gatewayMode: "auto",
      hermesBaseUrl: "",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "/root/hermes-agent",
      hermesAuthToken: "",
      hermesAuthHeaderName: "authorization",
      allowPrivateAdapterHosts: false,
      gatewayRequestTimeoutMs: 45_000,
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
    };

    const invocation = buildHermesCliInvocation(request, config);
    expect(invocation.args).toContain("--provider");
    expect(invocation.args).toContain("anthropic");
    expect(invocation.args).toContain("-m");
    expect(invocation.args).toContain("claude-4.5-sonnet");
  });
});
