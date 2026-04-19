import { randomUUID } from "node:crypto";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, STREAM_PREFIX } from "../constants.js";
import type {
  ChatMessage,
  ChatThread,
  CreateThreadInput,
  MasterChatPluginConfig,
  MasterChatStore,
  SkillPolicy,
  ThreadScope,
  ThreadSummary,
  ToolPolicy,
} from "../types.js";

export const STORE_STATE_KEY = "master-chat-store";
export const STORE_SCHEMA_VERSION = 2;

export function nowIso(): string {
  return new Date().toISOString();
}

export function createDefaultScope(companyId: string): ThreadScope {
  return {
    companyId,
    selectedAgentIds: [],
    mode: "company_wide",
  };
}

export function createDefaultSkillPolicy(config: MasterChatPluginConfig): SkillPolicy {
  return {
    enabled: [...config.defaultEnabledSkills],
    disabled: [],
    toolsets: [...config.defaultToolsets],
  };
}

export function createToolPolicy(config: MasterChatPluginConfig, skills: SkillPolicy): ToolPolicy {
  return {
    allowedPluginTools: [...new Set(config.availablePluginTools)],
    allowedHermesToolsets: [...new Set(skills.toolsets)],
  };
}

export function createEmptyStore(): MasterChatStore {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    threads: [],
    messages: [],
  };
}

export function migrateStore(store: MasterChatStore | null | undefined): MasterChatStore {
  if (!store) return createEmptyStore();
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    threads: Array.isArray(store.threads) ? store.threads : [],
    messages: Array.isArray(store.messages) ? store.messages : [],
  };
}

export function inferScopeMode(scope: ThreadScope): ThreadScope {
  if (scope.selectedAgentIds.length > 1) return { ...scope, mode: "multi_agent" };
  if (scope.selectedAgentIds.length === 1) return { ...scope, mode: "single_agent" };
  return { ...scope, mode: "company_wide" };
}

export function buildThreadTitle(text: string, fallback = "New master chat thread"): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return fallback;
  return clean.length <= 48 ? clean : `${clean.slice(0, 45)}…`;
}

export function summarizeScope(scope: ThreadScope): string {
  const parts = [scope.projectId ? `project:${scope.projectId}` : "company"];
  if (scope.linkedIssueId) parts.push(`issue:${scope.linkedIssueId}`);
  if (scope.selectedAgentIds.length > 0) parts.push(`agents:${scope.selectedAgentIds.length}`);
  return parts.join(" · ");
}

export function streamChannelForThread(threadId: string): string {
  return `${STREAM_PREFIX}:${threadId}`;
}

export async function loadStore(ctx: PluginContext, companyId: string): Promise<MasterChatStore> {
  const loaded = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: STORE_STATE_KEY,
  }) as MasterChatStore | null;
  return migrateStore(loaded);
}

export async function saveStore(ctx: PluginContext, companyId: string, store: MasterChatStore): Promise<void> {
  await ctx.state.set({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: STORE_STATE_KEY,
  }, {
    ...migrateStore(store),
    schemaVersion: STORE_SCHEMA_VERSION,
  });
}

export function listThreadSummaries(store: MasterChatStore): ThreadSummary[] {
  return [...store.threads]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((thread) => ({
      threadId: thread.threadId,
      title: thread.title,
      updatedAt: thread.updatedAt,
      archived: Boolean(thread.metadata.archivedAt),
      lastAssistantPreview: thread.metadata.lastAssistantPreview,
      scopeLabel: summarizeScope(thread.scope),
    }));
}

export function getThread(store: MasterChatStore, threadId: string): ChatThread {
  const thread = store.threads.find((entry) => entry.threadId === threadId);
  if (!thread) throw new Error(`Thread '${threadId}' not found`);
  return thread;
}

export function getThreadMessages(store: MasterChatStore, threadId: string): ChatMessage[] {
  return store.messages
    .filter((message) => message.threadId === threadId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function upsertThread(store: MasterChatStore, thread: ChatThread): void {
  const index = store.threads.findIndex((entry) => entry.threadId === thread.threadId);
  if (index === -1) {
    store.threads.push(thread);
    return;
  }
  store.threads[index] = thread;
}

export function upsertMessage(store: MasterChatStore, message: ChatMessage): void {
  const index = store.messages.findIndex((entry) => entry.messageId === message.messageId);
  if (index === -1) {
    store.messages.push(message);
    return;
  }
  store.messages[index] = message;
}

export function findMessageByRequestId(
  store: MasterChatStore,
  threadId: string,
  requestId: string,
  role?: ChatMessage["role"],
): ChatMessage | undefined {
  return getThreadMessages(store, threadId)
    .find((message) => message.requestId === requestId && (!role || message.role === role));
}

export function createThreadRecord(
  input: CreateThreadInput,
  config: MasterChatPluginConfig,
): ChatThread {
  const createdAt = nowIso();
  const scope = inferScopeMode({
    ...createDefaultScope(input.companyId),
    ...(input.scope ?? {}),
    companyId: input.companyId,
    selectedAgentIds: input.scope?.selectedAgentIds ?? [],
  });
  const skills: SkillPolicy = {
    ...createDefaultSkillPolicy(config),
    ...(input.skills ?? {}),
    enabled: input.skills?.enabled ? [...new Set(input.skills.enabled)] : [...config.defaultEnabledSkills],
    disabled: input.skills?.disabled ? [...new Set(input.skills.disabled)] : [],
    toolsets: input.skills?.toolsets ? [...new Set(input.skills.toolsets)] : [...config.defaultToolsets],
  };
  return {
    threadId: randomUUID(),
    title: input.title?.trim() || "New master chat thread",
    scope,
    hermes: {
      profileId: config.defaultProfileId,
      model: config.defaultModel,
      provider: config.defaultProvider,
      continuationMode: "stateless",
    },
    skills,
    metadata: {
      visibility: "company_scoped",
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function createMessageRecord(input: {
  threadId: string;
  role: ChatMessage["role"];
  parts: ChatMessage["parts"];
  routing: ThreadScope;
  toolPolicy: ToolPolicy;
  requestId?: string;
  status?: ChatMessage["status"];
  errorMessage?: string;
}): ChatMessage {
  const createdAt = nowIso();
  return {
    messageId: randomUUID(),
    threadId: input.threadId,
    role: input.role,
    parts: input.parts,
    routing: inferScopeMode(input.routing),
    toolPolicy: input.toolPolicy,
    requestId: input.requestId,
    status: input.status ?? "complete",
    createdAt,
    updatedAt: createdAt,
    errorMessage: input.errorMessage,
  };
}

export function touchThread(thread: ChatThread, patch?: Partial<ChatThread>): ChatThread {
  return {
    ...thread,
    ...patch,
    metadata: {
      ...thread.metadata,
      ...(patch?.metadata ?? {}),
    },
    updatedAt: nowIso(),
  };
}

export function threadContextLimit(config: MasterChatPluginConfig): number {
  return Math.max(4, config.maxHistoryMessages || DEFAULT_CONFIG.maxHistoryMessages);
}
