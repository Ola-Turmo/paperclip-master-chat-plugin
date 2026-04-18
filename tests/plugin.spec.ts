import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("master chat plugin", () => {
  it("boots, creates threads, and persists Hermes-mediated replies", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    harness.seed({
      companies: [{ id: "comp_1", name: "Acme", status: "active", createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" } as never],
      projects: [{ id: "proj_1", companyId: "comp_1", name: "Core App", status: "active", createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" } as never],
      issues: [{ id: "iss_1", companyId: "comp_1", projectId: "proj_1", title: "Risk Review", status: "todo", priority: "medium", createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" } as never],
      agents: [{ id: "agent_1", companyId: "comp_1", name: "CTO", status: "idle", createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" } as never],
    });

    await plugin.definition.setup(harness.ctx);

    const bootstrap = await harness.getData<{ threads: unknown[] }>("chat-bootstrap", { companyId: "comp_1" });
    expect(bootstrap.threads).toHaveLength(0);

    const created = await harness.performAction<{ threadId: string }>("create-thread", {
      companyId: "comp_1",
      projectId: "proj_1",
      linkedIssueId: "iss_1",
      selectedAgentIds: ["agent_1"],
      enabledSkills: ["paperclip-search"],
      toolsets: ["web"],
    });

    const sendResult = await harness.performAction<{ threadId: string; status: string }>("send-message", {
      companyId: "comp_1",
      threadId: created.threadId,
      text: "Compare delivery risk across the CTO context.",
      scope: {
        projectId: "proj_1",
        linkedIssueId: "iss_1",
        selectedAgentIds: ["agent_1"],
      },
      skills: {
        enabled: ["paperclip-search", "issue-summarize"],
        toolsets: ["web", "paperclip-context"],
      },
    });

    expect(sendResult.threadId).toBe(created.threadId);
    expect(sendResult.status).toBe("complete");
    expect(harness.metrics.some((metric) => metric.name === "master_chat.send")).toBe(true);
    expect(harness.activity).toHaveLength(1);

    const detail = await harness.getData<{ messages: Array<{ role: string; parts: Array<{ type: string }> }> }>("thread-detail", {
      companyId: "comp_1",
      threadId: created.threadId,
    });
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]?.role).toBe("assistant");
    expect(detail.messages[1]?.parts.some((part) => part.type === "tool_call")).toBe(true);
  });
});
