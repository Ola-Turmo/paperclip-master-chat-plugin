import { describe, expect, it } from "vitest";
import { buildHermesCliInvocation, buildHermesCliPrompt } from "../src/hermes/cli.js";
import type { HermesRequest, MasterChatPluginConfig } from "../src/types.js";

function sampleRequest(): HermesRequest {
  return {
    session: {
      profileId: "paperclip-master",
      sessionId: "sess_1",
      model: "anthropic/claude-sonnet-4",
      provider: "openrouter",
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
    },
    history: [
      {
        messageId: "msg_1",
        threadId: "thr_1",
        role: "user",
        parts: [
          { type: "text", text: "Compare delivery risk." },
          {
            id: "img_1",
            type: "image",
            name: "diagram.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,aGVsbG8=",
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
    expect(prompt).toContain("Selected agents: CTO");
    expect(prompt).toContain("[Image attachment: diagram.png");
    expect(prompt).toContain("Compare delivery risk.");
  });

  it("builds a CLI invocation that reuses the local Hermes install", () => {
    const config: MasterChatPluginConfig = {
      gatewayMode: "auto",
      hermesBaseUrl: "",
      hermesCommand: "hermes",
      hermesWorkingDirectory: "/root/hermes-agent",
      defaultProfileId: "paperclip-master",
      defaultProvider: "openrouter",
      defaultModel: "anthropic/claude-sonnet-4",
      defaultEnabledSkills: ["paperclip-search"],
      defaultToolsets: ["web"],
      availablePluginTools: ["paperclip.dashboard"],
      maxHistoryMessages: 24,
      allowInlineImageData: true,
      enableActivityLogging: true,
    };

    const invocation = buildHermesCliInvocation(sampleRequest(), config);
    expect(invocation.command).toBe("hermes");
    expect(invocation.cwd).toBe("/root/hermes-agent");
    expect(invocation.args).toContain("-p");
    expect(invocation.args).toContain("paperclip-master");
    expect(invocation.args).toContain("-Q");
    expect(invocation.args).toContain("-t");
    expect(invocation.args).toContain("web,file");
    expect(invocation.args).toContain("-s");
    expect(invocation.args).toContain("paperclip-search,issue-summarize");
  });
});
