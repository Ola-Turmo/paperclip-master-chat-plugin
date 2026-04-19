import { createHash, randomUUID } from "node:crypto";
import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS, DEFAULT_CONFIG, PAGE_ROUTE, PLUGIN_ID, SAFE_INLINE_IMAGE_MIME_TYPES } from "./constants.js";
import { concurrencyError, normalizeMasterChatError, validationError } from "./errors.js";
import { hydrateMessages, migrateInlineAttachments, persistAttachments } from "./attachments.js";
import { buildContinuitySnapshot } from "./continuity.js";
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

const HTTP_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

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
    attachmentStorageMode: config?.attachmentStorageMode === "inline" || config?.attachmentStorageMode === "filesystem"
      ? config.attachmentStorageMode
      : DEFAULT_CONFIG.attachmentStorageMode,
    attachmentStorageDirectory: typeof config?.attachmentStorageDirectory === "string" && config.attachmentStorageDirectory.trim()
      ? config.attachmentStorageDirectory.trim()
      : DEFAULT_CONFIG.attachmentStorageDirectory,
    hermesBaseUrl: typeof config?.hermesBaseUrl === "string" ? config.hermesBaseUrl.trim() : DEFAULT_CONFIG.hermesBaseUrl,
    hermesCommand: typeof config?.hermesCommand === "string" ? config.hermesCommand.trim() : DEFAULT_CONFIG.hermesCommand,
    hermesWorkingDirectory: typeof config?.hermesWorkingDirectory === "string" ? config.hermesWorkingDirectory.trim() : DEFAULT_CONFIG.hermesWorkingDirectory,
    hermesAuthToken: typeof config?.hermesAuthToken === "string" ? config.hermesAuthToken.trim() : DEFAULT_CONFIG.hermesAuthToken,
    hermesAuthHeaderName: typeof config?.hermesAuthHeaderName === "string" && config.hermesAuthHeaderName.trim()
      ? config.hermesAuthHeaderName.trim().toLowerCase()
      : DEFAULT_CONFIG.hermesAuthHeaderName,
    allowPrivateAdapterHosts: typeof config?.allowPrivateAdapterHosts === "boolean"
      ? config.allowPrivateAdapterHosts
      : DEFAULT_CONFIG.allowPrivateAdapterHosts,
    allowInsecureHttpAdapters: typeof config?.allowInsecureHttpAdapters === "boolean"
      ? config.allowInsecureHttpAdapters
      : DEFAULT_CONFIG.allowInsecureHttpAdapters,
    gatewayRequestTimeoutMs: numberConfig(config?.gatewayRequestTimeoutMs, DEFAULT_CONFIG.gatewayRequestTimeoutMs, 1_000),
    defaultProfileId: typeof config?.defaultProfileId === "string" && config.defaultProfileId.trim()
      ? config.defaultProfileId.trim()
      : DEFAULT_CONFIG.defaultProfileId,
    defaultProvider: typeof config?.defaultProvider === "string" && config.defaultProvider.trim()
      ? config.defaultProvider.trim()
      : DEFAULT_CONFIG.defaultProvider,
    defaultModel: typeof config?.defaultModel === "string" && config.defaultModel.trim()
      ? config.defaultModel.trim()
      : DEFAULT_CONFIG.defaultModel,
    defaultEnabledSkills: stringArray(config?.defaultEnabledSkills, [...DEFAULT_CONFIG.defaultEnabledSkills]),
    defaultToolsets: stringArray(config?.defaultToolsets, [...DEFAULT_CONFIG.defaultToolsets]),
    availablePluginTools: stringArray(config?.availablePluginTools, [...DEFAULT_CONFIG.availablePluginTools]),
    maxHistoryMessages: numberConfig(config?.maxHistoryMessages, DEFAULT_CONFIG.maxHistoryMessages, 4),
    maxMessageChars: numberConfig(config?.maxMessageChars, DEFAULT_CONFIG.maxMessageChars, 1),
    enableVisionAnalysis: typeof config?.enableVisionAnalysis === "boolean"
      ? config.enableVisionAnalysis
      : DEFAULT_CONFIG.enableVisionAnalysis,
    imageAnalysisMaxChars: numberConfig(config?.imageAnalysisMaxChars, DEFAULT_CONFIG.imageAnalysisMaxChars, 256),
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
  if (config.attachmentStorageMode === "filesystem") {
    warnings.push(`Image binaries are persisted on the Paperclip host filesystem under ${config.attachmentStorageDirectory}.`);
  }
  if (config.gatewayMode === "cli" || config.gatewayMode === "auto") {
    warnings.push("Local Hermes CLI reuse runs trusted host code. Restrict plugin install to trusted Paperclip instances.");
  }
  if (config.gatewayMode === "http" && !config.hermesAuthToken) {
    warnings.push("Hermes HTTP mode is configured without adapter authentication and will fail closed until hermesAuthToken is set.");
  }
  if (config.allowPrivateAdapterHosts) {
    warnings.push("Private adapter hosts are allowed for direct fetch. Enable this only on trusted internal deployments.");
  }
  if (config.allowInsecureHttpAdapters) {
    warnings.push("Non-HTTPS remote adapter URLs are allowed. Enable this only for trusted internal or transitional deployments.");
  }
  if (config.enableVisionAnalysis) {
    warnings.push("Inline images are enriched with Hermes vision/OCR analysis before persistence to reduce multimodal fallback risk.");
  }
  return warnings;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
}

function isRfc1918Host(hostname: string): boolean {
  if (/^10(?:\.\d{1,3}){3}$/u.test(hostname)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/u.test(hostname)) return true;
  const match172 = hostname.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/u);
  if (!match172) return false;
  const octet = Number(match172[1]);
  return octet >= 16 && octet <= 31;
}

function validateConfigShape(config: MasterChatPluginConfig): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings = pluginWarnings(config);
  const requestedGatewayMode = config.gatewayMode;

  if (config.attachmentStorageMode !== "filesystem" && config.attachmentStorageMode !== "inline") {
    errors.push("attachmentStorageMode must be either 'filesystem' or 'inline'");
  }

  if (!config.hermesAuthHeaderName.trim()) {
    errors.push("hermesAuthHeaderName must not be empty");
  } else if (!HTTP_HEADER_NAME_RE.test(config.hermesAuthHeaderName)) {
    errors.push("hermesAuthHeaderName must be a valid HTTP header name");
  }

  if (!config.attachmentStorageDirectory.trim()) {
    errors.push("attachmentStorageDirectory must not be empty");
  }

  if (requestedGatewayMode === "cli" && !config.hermesCommand.trim()) {
    errors.push("gatewayMode=cli requires hermesCommand");
  }

  if (requestedGatewayMode === "http") {
    if (!config.hermesBaseUrl.trim()) {
      errors.push("gatewayMode=http requires hermesBaseUrl");
    }
    if (!config.hermesAuthToken.trim()) {
      errors.push("gatewayMode=http requires hermesAuthToken");
    }

    if (config.hermesBaseUrl.trim()) {
      try {
        const url = new URL(config.hermesBaseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          errors.push("hermesBaseUrl must use http or https");
        }
        const hostname = url.hostname.toLowerCase();
        const isLoopback = isLoopbackHost(hostname);
        if (!isLoopback && url.protocol === "http:" && !config.allowInsecureHttpAdapters) {
          errors.push("Non-loopback hermesBaseUrl values must use https unless allowInsecureHttpAdapters=true");
        }
        if (!isLoopback && isRfc1918Host(hostname) && !config.allowPrivateAdapterHosts) {
          errors.push("RFC1918 hermesBaseUrl hosts require allowPrivateAdapterHosts=true");
        }
      } catch {
        errors.push("hermesBaseUrl must be a valid absolute URL");
      }
    }
  }

  if (config.maxTotalAttachmentBytes < config.maxAttachmentBytesPerFile) {
    errors.push("maxTotalAttachmentBytes must be greater than or equal to maxAttachmentBytesPerFile");
  }

  if (config.maxMessageChars < 1) {
    errors.push("maxMessageChars must be at least 1");
  }

  if (config.imageAnalysisMaxChars < 256) {
    errors.push("imageAnalysisMaxChars must be at least 256");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function validateConfigInput(rawConfig: Record<string, unknown> | null | undefined): { ok: boolean; errors: string[]; warnings: string[] } {
  const config = normalizeConfig(rawConfig);
  const errors: string[] = [];
  const explicitGatewayMode = rawConfig?.gatewayMode;
  const gatewayMode = explicitGatewayMode === "http" || explicitGatewayMode === "mock" || explicitGatewayMode === "cli" || explicitGatewayMode === "auto"
    ? explicitGatewayMode
    : config.gatewayMode;

  if (typeof rawConfig?.hermesAuthHeaderName === "string" && !rawConfig.hermesAuthHeaderName.trim()) {
    errors.push("hermesAuthHeaderName must not be empty");
  } else if (typeof rawConfig?.hermesAuthHeaderName === "string" && !HTTP_HEADER_NAME_RE.test(rawConfig.hermesAuthHeaderName.trim())) {
    errors.push("hermesAuthHeaderName must be a valid HTTP header name");
  }

  if (
    typeof rawConfig?.attachmentStorageMode === "string"
    && rawConfig.attachmentStorageMode !== "filesystem"
    && rawConfig.attachmentStorageMode !== "inline"
  ) {
    errors.push("attachmentStorageMode must be either 'filesystem' or 'inline'");
  }

  if (typeof rawConfig?.attachmentStorageDirectory === "string" && !rawConfig.attachmentStorageDirectory.trim()) {
    errors.push("attachmentStorageDirectory must not be empty");
  }

  if (gatewayMode === "cli" && typeof rawConfig?.hermesCommand === "string" && !rawConfig.hermesCommand.trim()) {
    errors.push("gatewayMode=cli requires hermesCommand");
  }

  if (typeof rawConfig?.maxMessageChars === "number" && (!Number.isFinite(rawConfig.maxMessageChars) || rawConfig.maxMessageChars < 1)) {
    errors.push("maxMessageChars must be at least 1");
  }

  if (
    typeof rawConfig?.imageAnalysisMaxChars === "number"
    && (!Number.isFinite(rawConfig.imageAnalysisMaxChars) || rawConfig.imageAnalysisMaxChars < 256)
  ) {
    errors.push("imageAnalysisMaxChars must be at least 256");
  }

  if (typeof rawConfig?.maxAttachmentBytesPerFile === "number" && (!Number.isFinite(rawConfig.maxAttachmentBytesPerFile) || rawConfig.maxAttachmentBytesPerFile < 1)) {
    errors.push("maxAttachmentBytesPerFile must be at least 1");
  }

  if (typeof rawConfig?.maxTotalAttachmentBytes === "number" && (!Number.isFinite(rawConfig.maxTotalAttachmentBytes) || rawConfig.maxTotalAttachmentBytes < 1)) {
    errors.push("maxTotalAttachmentBytes must be at least 1");
  }

  if (
    typeof rawConfig?.maxAttachmentBytesPerFile === "number"
    && typeof rawConfig?.maxTotalAttachmentBytes === "number"
    && Number.isFinite(rawConfig.maxAttachmentBytesPerFile)
    && Number.isFinite(rawConfig.maxTotalAttachmentBytes)
    && rawConfig.maxTotalAttachmentBytes < rawConfig.maxAttachmentBytesPerFile
  ) {
    errors.push("maxTotalAttachmentBytes must be greater than or equal to maxAttachmentBytesPerFile");
  }

  if (gatewayMode === "http") {
    if (typeof rawConfig?.hermesBaseUrl === "string" && !rawConfig.hermesBaseUrl.trim()) {
      errors.push("gatewayMode=http requires hermesBaseUrl");
    }
    if (typeof rawConfig?.hermesAuthToken === "string" && !rawConfig.hermesAuthToken.trim()) {
      errors.push("gatewayMode=http requires hermesAuthToken");
    }
    if (
      typeof rawConfig?.hermesBaseUrl === "string"
      && rawConfig.hermesBaseUrl.trim()
      && typeof rawConfig?.allowInsecureHttpAdapters !== "boolean"
    ) {
      try {
        const url = new URL(rawConfig.hermesBaseUrl);
        const hostname = url.hostname.toLowerCase();
        if (!isLoopbackHost(hostname) && url.protocol === "http:") {
          errors.push("Non-loopback hermesBaseUrl values must use https unless allowInsecureHttpAdapters=true");
        }
      } catch {
        // handled by normalized validation
      }
    }
  }

  const normalizedValidation = validateConfigShape(config);
  errors.push(...normalizedValidation.errors);

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: normalizedValidation.warnings,
  };
}

function validateMessageText(config: MasterChatPluginConfig, text: string): string {
  const normalized = text.trim();
  if (normalized.length > config.maxMessageChars) {
    throw validationError(`Message text exceeds the ${config.maxMessageChars} character limit`);
  }
  return normalized;
}

function estimateAttachmentBytes(attachment: InlineImageAttachment): number {
  if (!attachment.dataUrl) {
    throw validationError(`Attachment '${attachment.name}' must include inline data`);
  }
  const match = attachment.dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/u);
  if (!match) {
    throw validationError(`Attachment '${attachment.name}' must be a base64 data URL`);
  }

  const [, mediaType, encoded] = match;
  if (mediaType.toLowerCase() !== attachment.mimeType.toLowerCase()) {
    throw validationError(`Attachment '${attachment.name}' data URL type does not match '${attachment.mimeType}'`);
  }

  const payload = encoded.replace(/\s+/gu, "");
  if (!payload) {
    throw validationError(`Attachment '${attachment.name}' is empty`);
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const byteSize = Math.floor((payload.length * 3) / 4) - padding;
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw validationError(`Attachment '${attachment.name}' has an invalid byte size`);
  }
  return byteSize;
}

function attachmentSha256(attachment: InlineImageAttachment): string {
  const match = attachment.dataUrl?.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/u);
  if (!match) {
    throw validationError(`Attachment '${attachment.name}' must be a base64 data URL`);
  }
  return createHash("sha256")
    .update(Buffer.from(match[2].replace(/\s+/gu, ""), "base64"))
    .digest("hex");
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
    const sha256 = attachment.sha256 ?? attachmentSha256(attachment);
    if (byteSize > config.maxAttachmentBytesPerFile) {
      throw validationError(`Attachment '${attachment.name}' exceeds the per-file limit of ${config.maxAttachmentBytesPerFile} bytes`);
    }
    totalBytes += byteSize;
    return {
      ...attachment,
      byteSize,
      sha256,
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

function findCachedImageAnalysis(history: ChatMessage[], attachment: InlineImageAttachment): InlineImageAttachment["analysis"] | undefined {
  if (!attachment.sha256) return undefined;
  for (const message of [...history].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (part.type !== "image") continue;
      if (part.sha256 !== attachment.sha256) continue;
      if (!part.analysis || part.analysis.status !== "complete") continue;
      return {
        ...part.analysis,
        cached: true,
      };
    }
  }
  return undefined;
}

async function enrichAttachmentsWithVision(input: {
  gateway: Awaited<ReturnType<typeof createHermesGateway>>["gateway"];
  config: MasterChatPluginConfig;
  thread: ReturnType<typeof touchThread>;
  requestId: string;
  attachments: InlineImageAttachment[];
  history: ChatMessage[];
  ctx: PluginContext;
}): Promise<InlineImageAttachment[]> {
  const { gateway, config, thread, requestId, attachments, history, ctx } = input;
  const analyzeImage = gateway.analyzeImage?.bind(gateway);
  if (!config.enableVisionAnalysis || attachments.length === 0 || !analyzeImage) {
    return attachments;
  }

  return await Promise.all(attachments.map(async (attachment) => {
    if (attachment.analysis?.status === "complete") {
      return attachment;
    }

    const cached = findCachedImageAnalysis(history, attachment);
    if (cached) {
      await ctx.metrics.write("master_chat.image_analysis", 1, { status: "cache_hit" });
      return {
        ...attachment,
        altText: attachment.altText ?? cached.summary,
        analysis: cached,
      };
    }

    try {
      const analysis = await analyzeImage({
        requestId,
        attachment,
        session: thread.hermes,
        metadata: {
          threadId: thread.threadId,
          title: thread.title,
        },
      });
      await ctx.metrics.write("master_chat.image_analysis", 1, { status: analysis.status });
      return {
        ...attachment,
        altText: attachment.altText ?? analysis.summary,
        analysis: {
          status: analysis.status,
          summary: analysis.summary,
          extractedText: analysis.extractedText,
          notableDetails: analysis.notableDetails,
          generatedAt: new Date().toISOString(),
          provider: analysis.provider,
          model: analysis.model,
          errorMessage: analysis.errorMessage,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.metrics.write("master_chat.image_analysis", 1, { status: "error" });
      return {
        ...attachment,
        analysis: {
          status: "error",
          generatedAt: new Date().toISOString(),
          errorMessage: message,
        },
      };
    }
  }));
}

async function prepareThreadMessages(input: {
  ctx: PluginContext;
  config: MasterChatPluginConfig;
  companyId: string;
  store: Awaited<ReturnType<typeof loadStore>>;
  threadId: string;
}): Promise<{
  storedMessages: ChatMessage[];
  hydratedMessages: ChatMessage[];
}> {
  const { ctx, config, companyId, store, threadId } = input;
  const existingMessages = getThreadMessages(store, threadId);
  const migrated = await migrateInlineAttachments({
    config,
    companyId,
    messages: existingMessages,
  });

  if (migrated.changed) {
    for (const message of migrated.messages) {
      upsertMessage(store, message);
    }
    await saveStore(ctx, companyId, store);
  }

  return {
    storedMessages: migrated.messages,
    hydratedMessages: await hydrateMessages(config, migrated.messages),
  };
}

async function buildBootstrap(ctx: PluginContext, config: MasterChatPluginConfig, companyId: string): Promise<BootstrapData> {
  const options = await loadCompanyScopedOptions(ctx, companyId, config);
  validateScopeAgainstOptions(buildDefaultScope(config, companyId), options);
  const store = await ensureAttachmentStorage(ctx, config, companyId, await loadStore(ctx, companyId));
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
  const store = await ensureAttachmentStorage(ctx, config, companyId, await loadStore(ctx, companyId));
  const thread = getThread(store, threadId);
  const { hydratedMessages } = await prepareThreadMessages({
    ctx,
    config,
    companyId,
    store,
    threadId,
  });
  const options = await loadCompanyScopedOptions(ctx, companyId, config);
  validateScopeAgainstOptions(thread.scope, options);
  return {
    thread,
    messages: hydratedMessages,
    context: buildScopeContextSnapshot({
      scope: thread.scope,
      options,
    }),
    streamChannel: streamChannelForThread(threadId),
    warnings: [...options.warnings, ...pluginWarnings(config)],
  };
}

async function ensureAttachmentStorage(
  ctx: PluginContext,
  config: MasterChatPluginConfig,
  companyId: string,
  store: Awaited<ReturnType<typeof loadStore>>,
): Promise<Awaited<ReturnType<typeof loadStore>>> {
  const migrated = await migrateInlineAttachments({
    config,
    companyId,
    messages: store.messages,
  });
  if (!migrated.changed) return store;
  store.messages = migrated.messages;
  await saveStore(ctx, companyId, store);
  return store;
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

  const store = await ensureAttachmentStorage(ctx, config, companyId, await loadStore(ctx, companyId));
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
  selectedGateway?: Awaited<ReturnType<typeof createHermesGateway>>;
  allMessages?: ChatMessage[];
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
    const selectedGateway = input.selectedGateway ?? await createHermesGateway(ctx, config);
    const gateway = selectedGateway.gateway;
    selection = selectedGateway.selection;
    reason = selectedGateway.reason;
    const continuity = buildContinuitySnapshot({
      session: thread.hermes,
      messages: input.allMessages ?? history,
      historyLimit: threadContextLimit(config),
    });

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
      continuity,
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
        continuityStrategy: continuity.strategy,
        continuitySummary: continuity.summary,
        olderMessageCount: continuity.olderMessageCount,
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
  const store = await ensureAttachmentStorage(ctx, config, companyId, await loadStore(ctx, companyId));
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

  const text = typeof params.text === "string" ? validateMessageText(config, params.text) : "";
  let attachments = validateAttachments(config, Array.isArray(params.attachments) ? params.attachments as InlineImageAttachment[] : []);
  if (!text && attachments.length === 0) {
    throw validationError("A message requires text or at least one attachment");
  }

  const selectedGateway = attachments.length > 0 ? await createHermesGateway(ctx, config) : undefined;
  const priorMessages = await hydrateMessages(config, getThreadMessages(store, thread.threadId));
  if (attachments.length > 0 && selectedGateway) {
    attachments = await enrichAttachmentsWithVision({
      gateway: selectedGateway.gateway,
      config,
      thread,
      requestId,
      attachments,
      history: priorMessages,
      ctx,
    });
  }

  const toolPolicy = createToolPolicy(config, thread.skills);
  let userMessage = createMessageRecord({
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
  const persistedAttachments = await persistAttachments({
    config,
    companyId,
    threadId: thread.threadId,
    messageId: userMessage.messageId,
    attachments: attachments,
  });
  userMessage = {
    ...userMessage,
    parts: [
      ...(text ? [{ type: "text", text } as const] : []),
      ...persistedAttachments,
    ],
  };

  upsertThread(store, thread);
  upsertMessage(store, userMessage);
  await saveStore(ctx, companyId, store);

  const allMessages = await hydrateMessages(config, getThreadMessages(store, thread.threadId));
  const history = allMessages.slice(-threadContextLimit(config));
  return await performAssistantTurn({
    ctx,
    config,
    companyId,
    store,
    thread,
    requestId,
    history,
    selectedGateway,
    allMessages,
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
  const store = await ensureAttachmentStorage(ctx, config, companyId, await loadStore(ctx, companyId));
  const thread = getThread(store, threadId);
  if (thread.metadata.inFlightRequestId && thread.metadata.inFlightRequestId !== requestId) {
    throw concurrencyError(`Thread '${thread.threadId}' already has an in-flight request`);
  }

  const messages = await hydrateMessages(config, getThreadMessages(store, threadId));
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
    allMessages: messages,
  });
}

const pluginState: { currentConfig: MasterChatPluginConfig } = {
  currentConfig: normalizeConfig(DEFAULT_CONFIG),
};

const plugin = definePlugin({
  async setup(ctx) {
    pluginState.currentConfig = normalizeConfig(await ctx.config.get());

    ctx.data.register(DATA_KEYS.pluginConfig, async () => pluginState.currentConfig);
    ctx.data.register(DATA_KEYS.bootstrap, async (params) => buildBootstrap(ctx, pluginState.currentConfig, requireCompanyId(params)));
    ctx.data.register(DATA_KEYS.threadList, async (params) => {
      const companyId = requireCompanyId(params);
      const store = await loadStore(ctx, companyId);
      return listThreadSummaries(store);
    });
    ctx.data.register(DATA_KEYS.threadDetail, async (params) => {
      const companyId = requireCompanyId(params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      if (!threadId) throw validationError("threadId is required");
      return await buildThreadDetail(ctx, pluginState.currentConfig, companyId, threadId);
    });

    ctx.actions.register(ACTION_KEYS.createThread, async (params) => await createThreadAction(ctx, pluginState.currentConfig, params));
    ctx.actions.register(ACTION_KEYS.sendMessage, async (params) => await sendMessageAction(ctx, pluginState.currentConfig, params));
    ctx.actions.register(ACTION_KEYS.retryLastTurn, async (params) => await retryLastTurnAction(ctx, pluginState.currentConfig, params));
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
      const options = await loadCompanyScopedOptions(ctx, companyId, pluginState.currentConfig);
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
        skills: normalizeSkillPatch(pluginState.currentConfig, params.skills as Partial<SkillPolicy> | undefined),
      }));
      await saveStore(ctx, companyId, store);
      return { ok: true };
    });
  },

  async onConfigChanged(newConfig) {
    const normalized = normalizeConfig(newConfig);
    const validation = validateConfigShape(normalized);
    if (!validation.ok) {
      console.warn("Ignoring invalid Master Chat config update", validation.errors);
      return;
    }
    Object.assign(pluginState, { currentConfig: normalized });
  },

  async onValidateConfig(config) {
    return validateConfigInput(config);
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
