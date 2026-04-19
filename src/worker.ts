import { randomUUID } from "node:crypto";
import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS, DEFAULT_CONFIG, PAGE_ROUTE, PLUGIN_ID, SAFE_INLINE_IMAGE_MIME_TYPES } from "./constants.js";
import { concurrencyError, normalizeMasterChatError, validationError } from "./errors.js";
import {
  buildThreadTitle,
  createDefaultSkillPolicy,
  createMessageRecord,
  createThreadRecord,
  createToolPolicy,
  findMessageByRequestId,
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
import {
  buildDefaultScope,
  buildScopeContextSnapshot,
  buildToolDescriptors,
  loadCompanyScopedOptions,
  validateScopeAgainstOptions,
} from "./paperclip/context.js";
import type {
  BootstrapData,
  ChatMessage,
  HermesToolTrace,
  InlineImageAttachment,
  MasterChatPluginConfig,
  SkillPolicy,
  ThreadDetailData,
  ThreadScope,
  ToolPolicy,
} from "./types.js";

function numberConfig(value: unknown, fallback: number, minimum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
}

function normalizeConfig(config: Record<string, unknown> | null | undefined): MasterChatPluginConfig {
  const gatewayMode = config?.gatewayMode;
  return {
    gatewayMode: gatewayMode === "http" || gatewayMode === "mock" || gatewayMode === "cli" || gatewayMode === "auto"
      ? gatewayMode
      : DEFAULT_CONFIG.gatewayMode,
    hermesBaseUrl: typeof config?.hermesBaseUrl === "string" ? config.hermesBaseUrl.trim() : DEFAULT_CONFIG.hermesBaseUrl,
    hermesCommand: typeof config?.hermesCommand === "string" ? config.hermesCommand.trim() : DEFAULT_CONFIG.hermesCommand,
    hermesWorkingDirectory: typeof config?.hermesWorkingDirectory === "string" ? config.hermesWorkingDirectory.trim() : DEFAULT_CONFIG.hermesWorkingDirectory,
    hermesAuthToken: typeof config?.hermesAuthToken === "string" ? config.hermesAuthToken.trim() : DEFAULT_CONFIG.hermesAuthToken,
    hermesAuthHeaderName: typeof config?.hermesAuthHeaderName === "string" && config.hermesAuthHeaderName.trim()
      ? config.hermesAuthHeaderName.trim().toLowerCase()
      : DEFAULT_CONFIG.hermesAuthHeaderName,
    gatewayRequestTimeoutMs: numberConfig(config?.gatewayRequestTimeoutMs, DEFAULT_CONFIG.gatewayRequestTimeoutMs, 1_000),
    defaultProfileId: typeof config?.defaultProfileId === "string" ? config.defaultProfileId : DEFAULT_CONFIG.defaultProfileId,
    defaultProvider: typeof config?.defaultProvider === "string" ? config.defaultProvider : DEFAULT_CONFIG.defaultProvider,
    defaultModel: typeof config?.defaultModel === "string" ? config.defaultModel : DEFAULT_CONFIG.defaultModel,
    defaultEnabledSkills: stringArray(config?.defaultEnabledSkills, [...DEFAULT_CONFIG.defaultEnabledSkills]),
    defaultToolsets: stringArray(config?.defaultToolsets, [...DEFAULT_CONFIG.defaultToolsets]),
    availablePluginTools: stringArray(config?.availablePluginTools, [...DEFAULT_CONFIG.availablePluginTools]),
    maxHistoryMessages: numberConfig(config?.maxHistoryMessages, DEFAULT_CONFIG.maxHistoryMessages, 4),
    allowInlineImageData: typeof config?.allowInlineImageData === "boolean" ? config.allowInlineImageData : DEFAULT_CONFIG.allowInlineImageData,
    maxAttachmentCount: numberConfig(config?.maxAttachmentCount, DEFAULT_CONFIG.maxAttachmentCount, 0),
    maxAttachmentBytesPerFile: numberConfig(config?.maxAttachmentBytesPerFile, DEFAULT_CONFIG.maxAttachmentBytesPerFile, 1),
    maxTotalAttachmentBytes: numberConfig(config?.maxTotalAttachmentBytes, DEFAULT_CONFIG.maxTotalAttachmentBytes, 1),
    maxCatalogRecords: numberConfig(config?.maxCatalogRecords, DEFAULT_CONFIG.maxCatalogRecords, 100),
    scopePageSize: numberConfig(config?.scopePageSize, DEFAULT_CONFIG.scopePageSize, 25),
    redactToolPayloads: typeof config?.redactToolPayloads === "boolean" ? config.redactToolPayloads : DEFAULT_CONFIG.redactToolPayloads,
    enableActivityLogging: typeof config?.enableActivityLogging === "boolean" ? config.enableActivityLogging : DEFAULT_CONFIG.enableActivityLogging,
  };
}

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = typeof params.companyId === "string" ? params.companyId : "";
  if (!companyId) throw validationError("companyId is required");
  return companyId;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))] : [];
}

function normalizeScope(base: ThreadScope, patch?: Partial<ThreadScope>): ThreadScope {
  const selectedAgentIds = patch?.selectedAgentIds ? [...new Set(patch.selectedAgentIds)] : [...base.selectedAgentIds];
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
    enabled: patch?.enabled ? [...new Set(patch.enabled)] : [...config.defaultEnabledSkills],
    disabled: patch?.disabled ? [...new Set(patch.disabled)] : [],
    toolsets: patch?.toolsets ? [...new Set(patch.toolsets)] : [...config.defaultToolsets],
  };
}

function pluginWarnings(config: MasterChatPluginConfig): string[] {
  const warnings: string[] = [];
  if (config.gatewayMode === "cli" || config.gatewayMode === "auto") {
    warnings.push("Local Hermes CLI reuse runs trusted host code. Restrict plugin install to trusted Paperclip instances.");
  }
  if (config.gatewayMode === "http" && !config.hermesAuthToken) {
    warnings.push("Hermes HTTP mode is configured without adapter authentication and will fail closed until hermesAuthToken is set.");
  }
  return warnings;
}

function estimateAttachmentBytes(attachment: InlineImageAttachment): number {
  if (typeof attachment.byteSize === "number" && Number.isFinite(attachment.byteSize)) {
    return attachment.byteSize;
  }
  const [, payload = ""] = attachment.dataUrl.split(",", 2);
  return Math.ceil((payload.length * 3) / 4);
}

function validateAttachments(config: MasterChatPluginConfig, attachments: InlineImageAttachment[]): InlineImageAttachment[] {
  if (attachments.length > config.maxAttachmentCount) {
    throw validationError(`A message can include at most ${config.maxAttachmentCount} attachment(s)`);
  }

  let totalBytes = 0;
  const normalized = attachments.map((attachment) => {
    if (attachment.type !== "image") {
      throw validationError("Only image attachments are currently supported");
    }
    if (!SAFE_INLINE_IMAGE_MIME_TYPES.includes(attachment.mimeType as (typeof SAFE_INLINE_IMAGE_MIME_TYPES)[number])) {
      throw validationError(`Attachment '${attachment.name}' uses an unsupported type '${attachment.mimeType}'`);
    }
    if (!config.allowInlineImageData && attachment.source === "inline") {
      throw validationError("Inline image data is disabled for this plugin instance");
    }
    const byteSize = estimateAttachmentBytes(attachment);
    if (byteSize > config.maxAttachmentBytesPerFile) {
      throw validationError(`Attachment '${attachment.name}' exceeds the per-file limit of ${config.maxAttachmentBytesPerFile} bytes`);
    }
    totalBytes += byteSize;
    return {
      ...attachment,
      byteSize,
    };
  });

  if (totalBytes > config.maxTotalAttachmentBytes) {
    throw validationError(`Attachments exceed the total size limit of ${config.maxTotalAttachmentBytes} bytes`);
  }

  return normalized;
}

function redactValue(value: Record<string, unknown> | undefined, redact: boolean): Record<string, unknown> | undefined {
  if (!value || !redact) return value;
  return {
    redacted: true,
    keys: Object.keys(value),
  };
}

function sanitizeToolTraces(toolTraces: HermesToolTrace[], config: MasterChatPluginConfig): HermesToolTrace[] {
  return toolTraces.map((trace) => ({
    ...trace,
    input: redactValue(trace.input, config.redactToolPayloads),
    output: redactValue(trace.output, config.redactToolPayloads),
  }));
}

async function buildBootstrap(ctx: PluginContext, config: MasterChatPluginConfig, companyId: string): Promise<BootstrapData> {
  const options = await loadCompanyScopedOptions(ctx, companyId, config);
  validateScopeAgainstOptions(buildDefaultScope(config, companyId), options);
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
        continuationMode: "stateless",
      },
    },
    catalog: options.catalog,
    warnings: [...options.warnings, ...pluginWarnings(config)],
    config,
  };
}

async function buildThreadDetail(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  companyId: string,
  threadId: string,
): Promise<ThreadDetailData> {
  const store = await loadStore(ctx, companyId);
  const thread = getThread(store, threadId);
  const messages = getThreadMessages(store, threadId);
  const options = await loadCompanyScopedOptions(ctx, companyId, config);
  validateScopeAgainstOptions(thread.scope, options);
  return {
    thread,
    messages,
    context: buildScopeContextSnapshot({
      scope: thread.scope,
      options,
    }),
    streamChannel: streamChannelForThread(threadId),
    warnings: [...options.warnings, ...pluginWarnings(config)],
  };
}

async function createThreadAction(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  params: Record<string, unknown>,
) {
  const companyId = requireCompanyId(params);
  const options = await loadCompanyScopedOptions(ctx, companyId, config);
  const scope = normalizeScope(buildDefaultScope(config, companyId), {
    projectId: typeof params.projectId === "string" ? params.projectId : undefined,
    linkedIssueId: typeof params.linkedIssueId === "string" ? params.linkedIssueId : undefined,
    selectedAgentIds: asStringArray(params.selectedAgentIds),
  });
  validateScopeAgainstOptions(scope, options);

  const store = await loadStore(ctx, companyId);
  const thread = createThreadRecord({
    companyId,
    title: typeof params.title === "string" ? params.title : undefined,
    scope,
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

function idempotentSendResult(storeThreadId: string, store: Awaited<ReturnType<typeof loadStore>>, requestId: string) {
  const priorAssistant = findMessageByRequestId(store, storeThreadId, requestId, "assistant");
  if (priorAssistant && priorAssistant.status === "complete") {
    return {
      threadId: storeThreadId,
      messageId: priorAssistant.messageId,
      status: "complete",
      streamChannel: streamChannelForThread(storeThreadId),
      deduped: true,
    };
  }
  return null;
}

async function performAssistantTurn(input: {
  ctx: PluginContext;
  config: MasterChatPluginConfig;
  companyId: string;
  store: Awaited<ReturnType<typeof loadStore>>;
  thread: ReturnType<typeof touchThread>;
  requestId: string;
  history: ChatMessage[];
}) {
  const { ctx, config, companyId, store, requestId, history } = input;
  let thread = input.thread;
  const options = await loadCompanyScopedOptions(ctx, companyId, config);
  validateScopeAgainstOptions(thread.scope, options);
  const context = buildScopeContextSnapshot({ scope: thread.scope, options });
  const toolPolicy = createToolPolicy(config, thread.skills);
  const streamChannel = streamChannelForThread(thread.threadId);
  const startedAt = Date.now();
  let selection = thread.metadata.gatewayMode ?? "mock";
  let reason = thread.metadata.gatewayReason ?? "uninitialized";

  try {
    const selectedGateway = await createHermesGateway(ctx, config);
    const gateway = selectedGateway.gateway;
    selection = selectedGateway.selection;
    reason = selectedGateway.reason;

    upsertThread(store, touchThread(thread, {
      metadata: {
        ...thread.metadata,
        inFlightRequestId: requestId,
        gatewayMode: selection,
        gatewayReason: reason,
        lastUserMessageId: history.filter((message) => message.role === "user").at(-1)?.messageId,
      },
    }));
    thread = getThread(store, thread.threadId);
    await saveStore(ctx, companyId, store);

    ctx.streams.open(streamChannel, companyId);

    const response = await gateway.sendMessage({
      requestId,
      session: thread.hermes,
      scope: thread.scope,
      skillPolicy: thread.skills,
      toolPolicy,
      context,
      history,
      tools: buildToolDescriptors(toolPolicy),
      metadata: {
        threadId: thread.threadId,
        title: thread.title,
      },
    }, {
      onEvent: (event) => {
        ctx.streams.emit(streamChannel, event);
      },
    });

    const safeToolTraces = sanitizeToolTraces(response.toolTraces, config);
    const assistantMessage = createMessageRecord({
      threadId: thread.threadId,
      role: "assistant",
      requestId,
      parts: [
        ...safeToolTraces.flatMap((trace) => ([
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
        continuationMode: response.continuationMode,
      },
      metadata: {
        ...thread.metadata,
        inFlightRequestId: undefined,
        lastAssistantPreview: response.assistantText.slice(0, 180),
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        lastFailureAt: undefined,
        gatewayMode: response.gatewayMode,
        gatewayReason: reason,
      },
    }));
    await saveStore(ctx, companyId, store);

    const latencyMs = Date.now() - startedAt;
    await ctx.metrics.write("master_chat.send", 1, {
      provider: response.provider,
      model: response.model,
      gatewayMode: response.gatewayMode,
      continuationMode: response.continuationMode,
      latencyMs: String(latencyMs),
    });

    if (config.enableActivityLogging) {
      await ctx.activity.log({
        companyId,
        message: `Master Chat completed a reply for thread ${thread.threadId}`,
        metadata: {
          threadId: thread.threadId,
          requestId,
          gatewayMode: response.gatewayMode,
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
      gatewayMode: response.gatewayMode,
      continuationMode: response.continuationMode,
    };
  } catch (error) {
    const failure = normalizeMasterChatError(error);
    const failedMessage = createMessageRecord({
      threadId: thread.threadId,
      role: "assistant",
      requestId,
      parts: [{ type: "status", status: "error", detail: failure.message, code: failure.code, retryable: failure.retryable }],
      routing: thread.scope,
      toolPolicy,
      status: "error",
      errorMessage: failure.message,
    });
    upsertMessage(store, failedMessage);
    upsertThread(store, touchThread(thread, {
      metadata: {
        ...thread.metadata,
        inFlightRequestId: undefined,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        lastFailureAt: new Date().toISOString(),
        gatewayReason: reason,
      },
    }));
    await saveStore(ctx, companyId, store);
    await ctx.metrics.write("master_chat.error", 1, {
      stage: "send",
      gatewayMode: selection,
      code: failure.code,
    });
    throw failure;
  } finally {
    try {
      ctx.streams.close(streamChannel);
    } catch {
      // ignore close failures when the stream was never opened
    }
  }
}

async function sendMessageAction(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  params: Record<string, unknown>,
) {
  const companyId = requireCompanyId(params);
  const requestId = typeof params.requestId === "string" && params.requestId.trim() ? params.requestId : randomUUID();
  const store = await loadStore(ctx, companyId);
  const options = await loadCompanyScopedOptions(ctx, companyId, config);
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
  validateScopeAgainstOptions(thread.scope, options);

  const deduped = idempotentSendResult(thread.threadId, store, requestId);
  if (deduped) return deduped;

  if (thread.metadata.inFlightRequestId && thread.metadata.inFlightRequestId !== requestId) {
    throw concurrencyError(`Thread '${thread.threadId}' already has an in-flight request`);
  }

  const text = typeof params.text === "string" ? params.text.trim() : "";
  const attachments = validateAttachments(config, Array.isArray(params.attachments) ? params.attachments as InlineImageAttachment[] : []);
  if (!text && attachments.length === 0) {
    throw validationError("A message requires text or at least one attachment");
  }

  const toolPolicy = createToolPolicy(config, thread.skills);
  const userMessage = createMessageRecord({
    threadId: thread.threadId,
    role: "user",
    requestId,
    parts: [
      ...(text ? [{ type: "text", text } as const] : []),
      ...attachments,
    ],
    routing: thread.scope,
    toolPolicy,
  });

  upsertThread(store, thread);
  upsertMessage(store, userMessage);
  await saveStore(ctx, companyId, store);

  const history = getThreadMessages(store, thread.threadId).slice(-threadContextLimit(config));
  return await performAssistantTurn({
    ctx,
    config,
    companyId,
    store,
    thread,
    requestId,
    history,
  });
}

async function retryLastTurnAction(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  params: Record<string, unknown>,
) {
  const companyId = requireCompanyId(params);
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  const requestId = typeof params.requestId === "string" && params.requestId.trim() ? params.requestId : randomUUID();
  if (!threadId) throw validationError("threadId is required");
  const store = await loadStore(ctx, companyId);
  const thread = getThread(store, threadId);
  if (thread.metadata.inFlightRequestId && thread.metadata.inFlightRequestId !== requestId) {
    throw concurrencyError(`Thread '${thread.threadId}' already has an in-flight request`);
  }

  const messages = getThreadMessages(store, threadId);
  const lastUserIndex = [...messages].map((message, index) => ({ message, index })).reverse().find((entry) => entry.message.role === "user")?.index;
  if (lastUserIndex === undefined) throw validationError("No user turn found to retry");

  const lastUser = messages[lastUserIndex];
  if (!lastUser) throw validationError("No user turn found to retry");
  const trailingAssistant = messages.slice(lastUserIndex + 1).find((message) => message.role === "assistant");
  if (trailingAssistant && trailingAssistant.status !== "error") {
    throw validationError("Retry is only available after a failed assistant turn");
  }

  const history = messages.slice(0, lastUserIndex + 1).slice(-threadContextLimit(config));
  return await performAssistantTurn({
    ctx,
    config,
    companyId,
    store,
    thread,
    requestId,
    history,
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
      if (!threadId) throw validationError("threadId is required");
      return await buildThreadDetail(ctx, config, companyId, threadId);
    });

    ctx.actions.register(ACTION_KEYS.createThread, async (params) => await createThreadAction(ctx, config, params));
    ctx.actions.register(ACTION_KEYS.sendMessage, async (params) => await sendMessageAction(ctx, config, params));
    ctx.actions.register(ACTION_KEYS.retryLastTurn, async (params) => await retryLastTurnAction(ctx, config, params));
    ctx.actions.register(ACTION_KEYS.archiveThread, async (params) => {
      const companyId = requireCompanyId(params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      if (!threadId) throw validationError("threadId is required");
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
      if (!threadId) throw validationError("threadId is required");
      const store = await loadStore(ctx, companyId);
      const thread = getThread(store, threadId);
      const options = await loadCompanyScopedOptions(ctx, companyId, config);
      const scope = normalizeScope(thread.scope, params.scope as Partial<ThreadScope> | undefined);
      validateScopeAgainstOptions(scope, options);
      upsertThread(store, touchThread(thread, { scope }));
      await saveStore(ctx, companyId, store);
      return { ok: true };
    });
    ctx.actions.register(ACTION_KEYS.setThreadSkills, async (params) => {
      const companyId = requireCompanyId(params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      if (!threadId) throw validationError("threadId is required");
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
