import { describe, expect, it } from "vitest";
import { buildHermesCliInvocation, buildHermesCliPrompt } from "../src/hermes/cli.js";
import { DEFAULT_CONFIG } from "../src/constants.js";
import type { HermesRequest, MasterChatPluginConfig } from "../src/types.js";

function buildConfig(overrides: Partial<MasterChatPluginConfig> = {}): MasterChatPluginConfig {
  return {
    ...DEFAULT_CONFIG,
    defaultEnabledSkills: [...DEFAULT_CONFIG.defaultEnabledSkills],
    defaultToolsets: [...DEFAULT_CONFIG.defaultToolsets],
    availablePluginTools: [...DEFAULT_CONFIG.availablePluginTools],
    hermesCommandArgs: [...DEFAULT_CONFIG.hermesCommandArgs],
    ...overrides,
  };
}

function sampleRequest(): HermesRequest {
  return {
    requestId: "req_1",
    session: {
      profileId: "default",
      sessionId: "sess_1",
      model: "MiniMax-M2.7",
      provider: "minimax",
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
    continuity: {
      strategy: "synthetic-summary",
      olderMessageCount: 4,
      totalMessageCount: 5,
      summary: "- User: Earlier architecture review\n- Assistant: Highlighted delivery risk",
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
            analysis: {
              status: "complete",
              summary: "Architecture diagram with a highlighted bottleneck",
              extractedText: "CRITICAL PATH",
              notableDetails: ["Red connector between services"],
              generatedAt: "2026-04-19T08:00:00Z",
            },
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
    expect(prompt).toContain("Continuity strategy: synthetic-summary");
    expect(prompt).toContain("Synthetic continuity summary:");
    expect(prompt).toContain("- User: Earlier architecture review");
    expect(prompt).toContain("Vision summary: Architecture diagram with a highlighted bottleneck");
    expect(prompt).toContain("Extracted text:\nCRITICAL PATH");
  });

  it("builds a CLI invocation that resumes durable Hermes sessions", () => {
    const config = buildConfig({
      hermesCommand: "hermes",
      hermesCommandArgs: [],
      hermesWorkingDirectory: "/root/hermes-agent",
      defaultEnabledSkills: ["paperclip-search"],
      defaultToolsets: ["web"],
      availablePluginTools: ["paperclip.dashboard"],
    });

    const invocation = buildHermesCliInvocation(sampleRequest(), config);
    expect(invocation.command).toBe("hermes");
    expect(invocation.cwd).toBe("/root/hermes-agent");
    expect(invocation.args).toContain("-p");
    expect(invocation.args).toContain("default");
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
    const config = buildConfig({
      hermesCommand: "hermes",
      hermesCommandArgs: [],
      hermesWorkingDirectory: "/root/hermes-agent",
      defaultEnabledSkills: ["paperclip-search"],
      defaultToolsets: ["web"],
      availablePluginTools: ["paperclip.dashboard"],
    });

    const invocation = buildHermesCliInvocation(request, config);
    expect(invocation.args).toContain("--provider");
    expect(invocation.args).toContain("anthropic");
    expect(invocation.args).toContain("-m");
    expect(invocation.args).toContain("claude-4.5-sonnet");
  });

  it("supports launching Hermes through an explicit interpreter plus script path", () => {
    const config = buildConfig({
      hermesCommand: "/root/.hermes/hermes-agent/venv/bin/python",
      hermesCommandArgs: ["/root/.hermes/hermes-agent/hermes"],
      hermesWorkingDirectory: "/root/.hermes/hermes-agent",
    });

    const invocation = buildHermesCliInvocation(sampleRequest(), config);
    expect(invocation.command).toBe("/root/.hermes/hermes-agent/venv/bin/python");
    expect(invocation.args[0]).toBe("/root/.hermes/hermes-agent/hermes");
    expect(invocation.args).toContain("chat");
    expect(invocation.args).toContain("--resume");
  });
});
