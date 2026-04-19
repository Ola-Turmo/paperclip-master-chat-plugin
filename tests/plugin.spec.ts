import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

function seedHarness(harness: ReturnType<typeof createTestHarness>) {
  harness.seed({
    companies: [{ id: "comp_1", name: "Acme", status: "active", createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" } as never],
    projects: [{ id: "proj_1", companyId: "comp_1", name: "Core App", status: "active", createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" } as never],
    issues: [{ id: "iss_1", companyId: "comp_1", projectId: "proj_1", title: "Risk Review", status: "todo", priority: "medium", createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" } as never],
    agents: [{ id: "agent_1", companyId: "comp_1", name: "CTO", status: "idle", createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" } as never],
  });
}

describe("master chat plugin", () => {
  it("boots, creates threads, and persists Hermes-mediated replies", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    seedHarness(harness);

    await plugin.definition.setup(harness.ctx);

    const bootstrap = await harness.getData<{ threads: unknown[]; warnings: string[] }>("chat-bootstrap", { companyId: "comp_1" });
    expect(bootstrap.threads).toHaveLength(0);
    expect(Array.isArray(bootstrap.warnings)).toBe(true);

    const created = await harness.performAction<{ threadId: string }>("create-thread", {
      companyId: "comp_1",
      projectId: "proj_1",
      linkedIssueId: "iss_1",
      selectedAgentIds: ["agent_1"],
      enabledSkills: ["paperclip-search"],
      toolsets: ["web"],
    });

    const sendResult = await harness.performAction<{ threadId: string; status: string; gatewayMode: string }>("send-message", {
      companyId: "comp_1",
      threadId: created.threadId,
      requestId: "req_success",
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
    expect(sendResult.gatewayMode).toBe("mock");
    expect(harness.metrics.some((metric) => metric.name === "master_chat.send")).toBe(true);
    expect(harness.activity).toHaveLength(1);

    const detail = await harness.getData<{ messages: Array<{ role: string; requestId?: string; parts: Array<{ type: string }> }> }>("thread-detail", {
      companyId: "comp_1",
      threadId: created.threadId,
    });
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]?.role).toBe("assistant");
    expect(detail.messages[1]?.requestId).toBe("req_success");
    expect(detail.messages[1]?.parts.some((part) => part.type === "tool_call")).toBe(true);
  });

  it("does not duplicate the user turn when retrying a failed assistant response", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "http", hermesBaseUrl: "http://adapter.invalid", hermesAuthToken: "" } });
    seedHarness(harness);

    await plugin.definition.setup(harness.ctx);

    const created = await harness.performAction<{ threadId: string }>("create-thread", {
      companyId: "comp_1",
      projectId: "proj_1",
      linkedIssueId: "iss_1",
      selectedAgentIds: ["agent_1"],
    });

    await expect(harness.performAction("send-message", {
      companyId: "comp_1",
      threadId: created.threadId,
      requestId: "req_fail_1",
      text: "This will fail because auth is missing.",
    })).rejects.toThrow(/hermesAuthToken/i);

    await expect(harness.performAction("retry-last-turn", {
      companyId: "comp_1",
      threadId: created.threadId,
      requestId: "req_fail_2",
    })).rejects.toThrow(/hermesAuthToken/i);

    const detail = await harness.getData<{ messages: Array<{ role: string; status: string }> }>("thread-detail", {
      companyId: "comp_1",
      threadId: created.threadId,
    });
    expect(detail.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(detail.messages.filter((message) => message.role === "assistant" && message.status === "error")).toHaveLength(2);
  });

  it("rejects out-of-scope identifiers instead of trusting caller input", async () => {
    const harness = createTestHarness({ manifest, config: { gatewayMode: "mock" } });
    seedHarness(harness);

    await plugin.definition.setup(harness.ctx);

    await expect(harness.performAction("create-thread", {
      companyId: "comp_1",
      selectedAgentIds: ["agent_missing"],
    })).rejects.toThrow(/unknown agent ids/i);
  });
});
