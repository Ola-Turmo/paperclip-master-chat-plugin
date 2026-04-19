import { describe, expect, it } from "vitest";
import { flattenTextParts, scopeSummary, summarizeMessage } from "../src/ui/view-model.js";
import type { ChatMessage } from "../src/types.js";

describe("view-model helpers", () => {
  it("summarizes scope and messages for the UI", () => {
    expect(scopeSummary({
      companyId: "comp_1",
      projectId: "proj_1",
      linkedIssueId: "iss_1",
      selectedAgentIds: ["agent_1", "agent_2"],
      mode: "multi_agent",
    })).toContain("2 selected agents");

    const message: ChatMessage = {
      messageId: "msg_1",
      threadId: "thr_1",
      role: "assistant",
      requestId: "req_1",
      parts: [{ type: "text", text: "First line" }, { type: "text", text: "Second line" }],
      routing: {
        companyId: "comp_1",
        selectedAgentIds: [],
        mode: "company_wide",
      },
      toolPolicy: {
        allowedPluginTools: [],
        allowedHermesToolsets: [],
      },
      status: "complete",
      createdAt: "2026-04-18T10:00:00Z",
      updatedAt: "2026-04-18T10:00:00Z",
    };

    expect(flattenTextParts(message.parts)).toBe("First line\nSecond line");
    expect(summarizeMessage(message)).toBe("First line\nSecond line");
  });
});
