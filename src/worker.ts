import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS, DEFAULT_CONFIG, PAGE_ROUTE, PLUGIN_ID } from "./constants.js";
import {
  buildThreadTitle,
  createDefaultSkillPolicy,
  createDefaultToolPolicy,
  createMessageRecord,
  createThreadRecord,
  getThread,
  getThreadMessages,
  listThreadSummaries,
  loadStore,
  saveStore,
  streamChannelForThread,
  threadContextLimit,
  touchThread,
  upsertMessage,
  upsertThread,
} from "./domain/store.js";
import { createHermesGateway } from "./hermes/gateway.js";
import { buildDefaultScope, buildScopeContextSnapshot, buildToolDescriptors, loadCompanyScopedOptions } from "./paperclip/context.js";
import type {
  BootstrapData,
  MasterChatPluginConfig,
  SkillPolicy,
  ThreadDetailData,
  ThreadScope,
} from "./types.js";

function normalizeConfig(config: Record<string, unknown> | null | undefined): MasterChatPluginConfig {
  return {
    gatewayMode: config?.gatewayMode === "http" ? "http" : DEFAULT_CONFIG.gatewayMode,
    hermesBaseUrl: typeof config?.hermesBaseUrl === "string" ? config.hermesBaseUrl : DEFAULT_CONFIG.hermesBaseUrl,
    defaultProfileId: typeof config?.defaultProfileId === "string" ? config.defaultProfileId : DEFAULT_CONFIG.defaultProfileId,
    defaultProvider: typeof config?.defaultProvider === "string" ? config.defaultProvider : DEFAULT_CONFIG.defaultProvider,
    defaultModel: typeof config?.defaultModel === "string" ? config.defaultModel : DEFAULT_CONFIG.defaultModel,
    defaultEnabledSkills: Array.isArray(config?.defaultEnabledSkills)
      ? config.defaultEnabledSkills.filter((value): value is string => typeof value === "string")
      : [...DEFAULT_CONFIG.defaultEnabledSkills],
    defaultToolsets: Array.isArray(config?.defaultToolsets)
      ? config.defaultToolsets.filter((value): value is string => typeof value === "string")
      : [...DEFAULT_CONFIG.defaultToolsets],
    availablePluginTools: Array.isArray(config?.availablePluginTools)
      ? config.availablePluginTools.filter((value): value is string => typeof value === "string")
      : [...DEFAULT_CONFIG.availablePluginTools],
    maxHistoryMessages: typeof config?.maxHistoryMessages === "number" ? config.maxHistoryMessages : DEFAULT_CONFIG.maxHistoryMessages,
    allowInlineImageData: typeof config?.allowInlineImageData === "boolean" ? config.allowInlineImageData : DEFAULT_CONFIG.allowInlineImageData,
    enableActivityLogging: typeof config?.enableActivityLogging === "boolean" ? config.enableActivityLogging : DEFAULT_CONFIG.enableActivityLogging,
  };
}

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = typeof params.companyId === "string" ? params.companyId : "";
  if (!companyId) throw new Error("companyId is required");
  return companyId;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeScope(base: ThreadScope, patch?: Partial<ThreadScope>): ThreadScope {
  const selectedAgentIds = patch?.selectedAgentIds ? [...patch.selectedAgentIds] : [...base.selectedAgentIds];
  return {
    ...base,
    ...(patch ?? {}),
    companyId: base.companyId,
    selectedAgentIds,
    mode: selectedAgentIds.length > 1 ? "multi_agent" : selectedAgentIds.length === 1 ? "single_agent" : "company_wide",
  };
}

function normalizeSkillPatch(config: MasterChatPluginConfig, patch?: Partial<SkillPolicy>): SkillPolicy {
  return {
    enabled: patch?.enabled ? [...patch.enabled] : [...config.defaultEnabledSkills],
    disabled: patch?.disabled ? [...patch.disabled] : [],
    toolsets: patch?.toolsets ? [...patch.toolsets] : [...config.defaultToolsets],
  };
}

async function buildBootstrap(ctx: PluginContext, config: MasterChatPluginConfig, companyId: string): Promise<BootstrapData> {
  const options = await loadCompanyScopedOptions(ctx, companyId);
  const store = await loadStore(ctx, companyId);
  return {
    pluginId: PLUGIN_ID,
    routePath: PAGE_ROUTE,
    companyId,
    companies: options.companies,
    projects: options.projects,
    issues: options.issues,
    agents: options.agents,
    threads: listThreadSummaries(store),
    availableSkills: [...config.defaultEnabledSkills],
    availableToolsets: [...config.defaultToolsets],
    availablePluginTools: [...config.availablePluginTools],
    defaults: {
      scope: buildDefaultScope(config, companyId),
      skills: createDefaultSkillPolicy(config),
      hermes: {
        profileId: config.defaultProfileId,
        provider: config.defaultProvider,
        model: config.defaultModel,
      },
      
    },
    config,
  };
}

async function buildThreadDetail(
  ctx: PluginContext,
  _config: MasterChatPluginConfig,
  companyId: string,
  threadId: string,
): Promise<ThreadDetailData> {
  const store = await loadStore(ctx, companyId);
  const thread = getThread(store, threadId);
  const messages = getThreadMessages(store, threadId);
  const options = await loadCompanyScopedOptions(ctx, companyId);
  return {
    thread,
    messages,
    context: buildScopeContextSnapshot({
      scope: thread.scope,
      companies: options.companies,
      projects: options.projects,
      issues: options.issues,
      agents: options.agents,
    }),
    streamChannel: streamChannelForThread(threadId),
  };
}

async function createThreadAction(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  params: Record<string, unknown>,
) {
  const companyId = requireCompanyId(params);
  const store = await loadStore(ctx, companyId);
  const thread = createThreadRecord({
    companyId,
    title: typeof params.title === "string" ? params.title : undefined,
    scope: {
      projectId: typeof params.projectId === "string" ? params.projectId : undefined,
      linkedIssueId: typeof params.linkedIssueId === "string" ? params.linkedIssueId : undefined,
      selectedAgentIds: asStringArray(params.selectedAgentIds),
    },
    skills: {
      enabled: asStringArray(params.enabledSkills),
      disabled: asStringArray(params.disabledSkills),
      toolsets: asStringArray(params.toolsets),
    },
  }, config);
  upsertThread(store, thread);
  await saveStore(ctx, companyId, store);
  return { threadId: thread.threadId };
}

async function sendMessageAction(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  params: Record<string, unknown>,
) {
  const companyId = requireCompanyId(params);
  const store = await loadStore(ctx, companyId);
  const gateway = createHermesGateway(ctx, config);
  const toolPolicy = createDefaultToolPolicy(config);
  const scopeDefaults = buildDefaultScope(config, companyId);

  let thread = typeof params.threadId === "string"
    ? getThread(store, params.threadId)
    : createThreadRecord({
      companyId,
      title: buildThreadTitle(typeof params.text === "string" ? params.text : ""),
      scope: scopeDefaults,
    }, config);

  if (!store.threads.some((entry) => entry.threadId === thread.threadId)) {
    upsertThread(store, thread);
  }

  thread = touchThread(thread, {
    title: thread.title || buildThreadTitle(typeof params.text === "string" ? params.text : ""),
    scope: normalizeScope(thread.scope, params.scope as Partial<ThreadScope> | undefined),
    skills: normalizeSkillPatch(config, params.skills as Partial<SkillPolicy> | undefined),
  });
  upsertThread(store, thread);

  const text = typeof params.text === "string" ? params.text.trim() : "";
  const attachments = Array.isArray(params.attachments) ? params.attachments : [];
  if (!text && attachments.length === 0) {
    throw new Error("A message requires text or at least one attachment");
  }

  const userMessage = createMessageRecord({
    threadId: thread.threadId,
    role: "user",
    parts: [
      ...(text ? [{ type: "text", text } as const] : []),
      ...attachments,
    ],
    routing: thread.scope,
    toolPolicy,
  });
  upsertMessage(store, userMessage);
  await saveStore(ctx, companyId, store);

  const options = await loadCompanyScopedOptions(ctx, companyId);
  const context = buildScopeContextSnapshot({
    scope: thread.scope,
    companies: options.companies,
    projects: options.projects,
    issues: options.issues,
    agents: options.agents,
  });

  const history = getThreadMessages(store, thread.threadId).slice(-threadContextLimit(config));
  const streamChannel = streamChannelForThread(thread.threadId);
  ctx.streams.open(streamChannel, companyId);

  try {
    const response = await gateway.sendMessage({
      session: thread.hermes,
      scope: thread.scope,
      skillPolicy: thread.skills,
      toolPolicy,
      context,
      history,
      tools: buildToolDescriptors(config),
      metadata: {
        threadId: thread.threadId,
        title: thread.title,
      },
    }, {
      onEvent: (event) => {
        ctx.streams.emit(streamChannel, event);
      },
    });

    const assistantMessage = createMessageRecord({
      threadId: thread.threadId,
      role: "assistant",
      parts: [
        ...response.toolTraces.flatMap((trace) => ([
          {
            type: "tool_call",
            toolName: trace.toolName,
            summary: trace.summary,
            input: trace.input,
          } as const,
          {
            type: "tool_result",
            toolName: trace.toolName,
            summary: trace.summary,
            output: trace.output,
          } as const,
        ])),
        { type: "text", text: response.assistantText },
      ],
      routing: thread.scope,
      toolPolicy,
    });

    upsertMessage(store, assistantMessage);
    upsertThread(store, touchThread(thread, {
      hermes: {
        ...thread.hermes,
        sessionId: response.sessionId,
      },
      metadata: {
        ...thread.metadata,
        lastAssistantPreview: response.assistantText.slice(0, 180),
      },
    }));
    await saveStore(ctx, companyId, store);

    await ctx.metrics.write("master_chat.send", 1, {
      provider: response.provider,
      model: response.model,
    });

    if (config.enableActivityLogging) {
      await ctx.activity.log({
        companyId,
        message: `Master Chat sent a reply for thread ${thread.threadId}`,
        metadata: {
          threadId: thread.threadId,
          projectId: thread.scope.projectId,
          linkedIssueId: thread.scope.linkedIssueId,
          selectedAgentIds: thread.scope.selectedAgentIds,
        },
      });
    }

    return {
      threadId: thread.threadId,
      messageId: assistantMessage.messageId,
      status: "complete",
      streamChannel,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failedMessage = createMessageRecord({
      threadId: thread.threadId,
      role: "assistant",
      parts: [{ type: "status", status: "error", detail }],
      routing: thread.scope,
      toolPolicy,
      status: "error",
      errorMessage: detail,
    });
    upsertMessage(store, failedMessage);
    await saveStore(ctx, companyId, store);
    await ctx.metrics.write("master_chat.error", 1, { stage: "send" });
    throw error;
  } finally {
    ctx.streams.close(streamChannel);
  }
}

async function retryLastTurnAction(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  params: Record<string, unknown>,
) {
  const companyId = requireCompanyId(params);
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  if (!threadId) throw new Error("threadId is required");
  const store = await loadStore(ctx, companyId);
  const messages = getThreadMessages(store, threadId);
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) throw new Error("No user turn found to retry");
  return await sendMessageAction(ctx, config, {
    companyId,
    threadId,
    text: lastUser.parts
      .filter((part): part is Extract<(typeof lastUser.parts)[number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
    attachments: lastUser.parts.filter((part) => part.type === "image"),
  });
}

const plugin = definePlugin({
  async setup(ctx) {
    const config = normalizeConfig(await ctx.config.get());

    ctx.data.register(DATA_KEYS.pluginConfig, async () => config);
    ctx.data.register(DATA_KEYS.bootstrap, async (params) => buildBootstrap(ctx, config, requireCompanyId(params)));
    ctx.data.register(DATA_KEYS.threadList, async (params) => {
      const companyId = requireCompanyId(params);
      const store = await loadStore(ctx, companyId);
      return listThreadSummaries(store);
    });
    ctx.data.register(DATA_KEYS.threadDetail, async (params) => {
      const companyId = requireCompanyId(params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      if (!threadId) throw new Error("threadId is required");
      return await buildThreadDetail(ctx, config, companyId, threadId);
    });

    ctx.actions.register(ACTION_KEYS.createThread, async (params) => await createThreadAction(ctx, config, params));
    ctx.actions.register(ACTION_KEYS.sendMessage, async (params) => await sendMessageAction(ctx, config, params));
    ctx.actions.register(ACTION_KEYS.retryLastTurn, async (params) => await retryLastTurnAction(ctx, config, params));
    ctx.actions.register(ACTION_KEYS.archiveThread, async (params) => {
      const companyId = requireCompanyId(params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      if (!threadId) throw new Error("threadId is required");
      const store = await loadStore(ctx, companyId);
      const thread = getThread(store, threadId);
      upsertThread(store, touchThread(thread, {
        metadata: {
          ...thread.metadata,
          archivedAt: new Date().toISOString(),
        },
      }));
      await saveStore(ctx, companyId, store);
      return { archived: true };
    });
    ctx.actions.register(ACTION_KEYS.setThreadScope, async (params) => {
      const companyId = requireCompanyId(params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      if (!threadId) throw new Error("threadId is required");
      const store = await loadStore(ctx, companyId);
      const thread = getThread(store, threadId);
      upsertThread(store, touchThread(thread, {
        scope: normalizeScope(thread.scope, params.scope as Partial<ThreadScope> | undefined),
      }));
      await saveStore(ctx, companyId, store);
      return { ok: true };
    });
    ctx.actions.register(ACTION_KEYS.setThreadSkills, async (params) => {
      const companyId = requireCompanyId(params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      if (!threadId) throw new Error("threadId is required");
      const store = await loadStore(ctx, companyId);
      const thread = getThread(store, threadId);
      upsertThread(store, touchThread(thread, {
        skills: normalizeSkillPatch(config, params.skills as Partial<SkillPolicy> | undefined),
      }));
      await saveStore(ctx, companyId, store);
      return { ok: true };
    });
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Master Chat worker is ready",
    };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
