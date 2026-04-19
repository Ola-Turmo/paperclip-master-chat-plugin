import { describe, expect, it } from "vitest";
import { buildContinuitySnapshot, inferContinuationMode } from "../src/continuity.js";
import type { ChatMessage, HermesSessionConfig } from "../src/types.js";

function message(role: ChatMessage["role"], text: string, messageId: string): ChatMessage {
  return {
    messageId,
    threadId: "thr_1",
    role,
    requestId: messageId,
    parts: [{ type: "text", text }],
    routing: {
      companyId: "comp_1",
      selectedAgentIds: [],
      mode: "company_wide",
    },
    toolPolicy: {
      allowedPluginTools: [],
      allowedHermesToolsets: ["web"],
    },
    status: "complete",
    createdAt: "2026-04-19T08:00:00Z",
    updatedAt: "2026-04-19T08:00:00Z",
  };
}

describe("buildContinuitySnapshot", () => {
  it("uses Hermes-session continuity when a durable session id exists", () => {
    const session: HermesSessionConfig = {
      profileId: "default",
      sessionId: "sess_1",
      provider: "auto",
      model: "MiniMax-M2.7",
      continuationMode: "durable",
    };

    const continuity = buildContinuitySnapshot({
      session,
      historyLimit: 2,
      messages: [
        message("user", "Earlier context 1", "msg_1"),
        message("assistant", "Earlier context 2", "msg_2"),
        message("user", "Current question", "msg_3"),
      ],
    });

    expect(continuity.strategy).toBe("hermes-session");
    expect(continuity.olderMessageCount).toBe(1);
    expect(continuity.summary).toContain("Earlier context 1");
  });

  it("falls back to a synthetic summary when older messages are truncated without a durable session", () => {
    const session: HermesSessionConfig = {
      profileId: "default",
      provider: "auto",
      model: "MiniMax-M2.7",
      continuationMode: "stateless",
    };

    const continuity = buildContinuitySnapshot({
      session,
      historyLimit: 2,
      messages: [
        message("user", "Architecture review kickoff", "msg_1"),
        message("assistant", "Need concise executive summary", "msg_2"),
        message("user", "What changed since yesterday?", "msg_3"),
        message("assistant", "Recent answer", "msg_4"),
      ],
    });

    expect(continuity.strategy).toBe("synthetic-summary");
    expect(continuity.olderMessageCount).toBe(2);
    expect(continuity.totalMessageCount).toBe(4);
    expect(continuity.summary).toContain("Architecture review kickoff");
    expect(continuity.summary).toContain("Need concise executive summary");
  });

  it("marks summary-backed continuity as synthetic when Hermes provides no real session id", () => {
    expect(inferContinuationMode({
      continuity: {
        strategy: "synthetic-summary",
        olderMessageCount: 2,
        totalMessageCount: 4,
        summary: "- User: Earlier architecture review kickoff",
      },
    })).toBe("synthetic");
  });

  it("keeps first-turn continuity stateless when there is no prior context to reconstruct", () => {
    expect(inferContinuationMode({
      continuity: {
        strategy: "recent-history-only",
        olderMessageCount: 0,
        totalMessageCount: 1,
      },
    })).toBe("stateless");
  });
});
