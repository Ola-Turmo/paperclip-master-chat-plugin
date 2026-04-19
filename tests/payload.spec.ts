import { describe, expect, it } from "vitest";
import { buildHermesGatewayPayload } from "../src/hermes/payload.js";
import type { HermesRequest } from "../src/types.js";

describe("buildHermesGatewayPayload", () => {
  it("converts text and image parts into Hermes content blocks", () => {
    const request: HermesRequest = {
      requestId: "req_1",
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
        enabled: ["paperclip-search"],
        disabled: [],
        toolsets: ["web"],
      },
      toolPolicy: {
        allowedPluginTools: ["paperclip.dashboard"],
        allowedHermesToolsets: ["web"],
      },
      context: {
        company: { id: "comp_1", name: "Acme" },
        project: { id: "proj_1", name: "Core App" },
        linkedIssue: { id: "iss_1", name: "Risk Review" },
        selectedAgents: [{ id: "agent_1", name: "CTO" }],
        issueCount: 2,
        agentCount: 1,
        projectCount: 1,
        catalog: {
          companies: { loaded: 1, pageSize: 50, truncated: false },
          projects: { loaded: 1, pageSize: 50, truncated: false },
          issues: { loaded: 2, pageSize: 50, truncated: false },
          agents: { loaded: 1, pageSize: 50, truncated: false },
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
            allowedHermesToolsets: ["web"],
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

    const payload = buildHermesGatewayPayload(request);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]?.content).toEqual([
      { type: "text", text: "Compare delivery risk." },
      {
        type: "image",
        mimeType: "image/png",
        data: "aGVsbG8=",
        name: "diagram.png",
        altText: undefined,
      },
    ]);
  });
});
