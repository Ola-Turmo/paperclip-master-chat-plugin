import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, EXPORT_NAMES, PAGE_ROUTE, PLUGIN_ID, PLUGIN_VERSION, SLOT_IDS } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Master Chat",
  description: "Plugin-owned Paperclip chat surface that scopes conversations and delegates orchestration to Hermes.",
  author: "turmo.dev",
  categories: ["ui", "automation", "connector"],
  capabilities: [
    "companies.read",
    "projects.read",
    "issues.read",
    "agents.read",
    "plugin.state.read",
    "plugin.state.write",
    "http.outbound",
    "activity.log.write",
    "metrics.write",
    "ui.page.register",
    "ui.sidebar.register",
    "ui.dashboardWidget.register",
    "ui.detailTab.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      gatewayMode: {
        type: "string",
        title: "Hermes gateway mode",
        enum: ["auto", "mock", "http", "cli"],
        default: DEFAULT_CONFIG.gatewayMode,
      },
      attachmentStorageMode: {
        type: "string",
        title: "Attachment storage mode",
        enum: ["filesystem", "inline"],
        default: DEFAULT_CONFIG.attachmentStorageMode,
      },
      attachmentStorageDirectory: {
        type: "string",
        title: "Filesystem attachment storage directory",
        default: DEFAULT_CONFIG.attachmentStorageDirectory,
      },
      hermesBaseUrl: {
        type: "string",
        title: "Hermes adapter base URL",
        default: DEFAULT_CONFIG.hermesBaseUrl,
      },
      hermesCommand: {
        type: "string",
        title: "Local Hermes CLI command",
        default: DEFAULT_CONFIG.hermesCommand,
      },
      hermesWorkingDirectory: {
        type: "string",
        title: "Optional local Hermes working directory",
        default: DEFAULT_CONFIG.hermesWorkingDirectory,
      },
      hermesAuthToken: {
        type: "string",
        title: "Hermes adapter authentication token",
        default: DEFAULT_CONFIG.hermesAuthToken,
      },
      hermesAuthHeaderName: {
        type: "string",
        title: "Hermes adapter authentication header name",
        default: DEFAULT_CONFIG.hermesAuthHeaderName,
      },
      allowPrivateAdapterHosts: {
        type: "boolean",
        title: "Allow direct fetch to RFC1918 adapter hosts",
        default: DEFAULT_CONFIG.allowPrivateAdapterHosts,
      },
      allowInsecureHttpAdapters: {
        type: "boolean",
        title: "Allow non-HTTPS remote Hermes adapter URLs",
        default: DEFAULT_CONFIG.allowInsecureHttpAdapters,
      },
      gatewayRequestTimeoutMs: {
        type: "number",
        title: "Gateway request timeout (ms)",
        default: DEFAULT_CONFIG.gatewayRequestTimeoutMs,
      },
      defaultProfileId: {
        type: "string",
        title: "Default Hermes profile",
        default: DEFAULT_CONFIG.defaultProfileId,
      },
      defaultProvider: {
        type: "string",
        title: "Default Hermes provider",
        default: DEFAULT_CONFIG.defaultProvider,
      },
      defaultModel: {
        type: "string",
        title: "Default Hermes model",
        default: DEFAULT_CONFIG.defaultModel,
      },
      defaultEnabledSkills: {
        type: "array",
        title: "Default enabled skills",
        items: { type: "string" },
        default: DEFAULT_CONFIG.defaultEnabledSkills,
      },
      defaultToolsets: {
        type: "array",
        title: "Default Hermes toolsets",
        items: { type: "string" },
        default: DEFAULT_CONFIG.defaultToolsets,
      },
      availablePluginTools: {
        type: "array",
        title: "Allowed Paperclip/plugin tools",
        items: { type: "string" },
        default: DEFAULT_CONFIG.availablePluginTools,
      },
      maxHistoryMessages: {
        type: "number",
        title: "Maximum history messages forwarded to Hermes",
        default: DEFAULT_CONFIG.maxHistoryMessages,
      },
      maxMessageChars: {
        type: "number",
        title: "Maximum text characters accepted per turn",
        default: DEFAULT_CONFIG.maxMessageChars,
      },
      enableVisionAnalysis: {
        type: "boolean",
        title: "Analyze images for OCR and detailed fallback text",
        default: DEFAULT_CONFIG.enableVisionAnalysis,
      },
      imageAnalysisMaxChars: {
        type: "number",
        title: "Maximum persisted OCR/vision text characters per image",
        default: DEFAULT_CONFIG.imageAnalysisMaxChars,
      },
      allowInlineImageData: {
        type: "boolean",
        title: "Allow inline image data URLs",
        default: DEFAULT_CONFIG.allowInlineImageData,
      },
      maxAttachmentCount: {
        type: "number",
        title: "Maximum inline attachments per turn",
        default: DEFAULT_CONFIG.maxAttachmentCount,
      },
      maxAttachmentBytesPerFile: {
        type: "number",
        title: "Maximum bytes per inline attachment",
        default: DEFAULT_CONFIG.maxAttachmentBytesPerFile,
      },
      maxTotalAttachmentBytes: {
        type: "number",
        title: "Maximum total inline attachment bytes per turn",
        default: DEFAULT_CONFIG.maxTotalAttachmentBytes,
      },
      maxCatalogRecords: {
        type: "number",
        title: "Maximum scope records loaded per collection",
        default: DEFAULT_CONFIG.maxCatalogRecords,
      },
      scopePageSize: {
        type: "number",
        title: "Scope loader page size",
        default: DEFAULT_CONFIG.scopePageSize,
      },
      redactToolPayloads: {
        type: "boolean",
        title: "Redact tool inputs/outputs before persistence",
        default: DEFAULT_CONFIG.redactToolPayloads,
      },
      enableActivityLogging: {
        type: "boolean",
        title: "Write audit summaries to activity log",
        default: DEFAULT_CONFIG.enableActivityLogging,
      },
    },
  },
  ui: {
    slots: [
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: "Master Chat",
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "sidebar",
        id: SLOT_IDS.sidebar,
        displayName: "Master Chat",
        exportName: EXPORT_NAMES.sidebar,
      },
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "Master Chat Overview",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
      {
        type: "detailTab",
        id: SLOT_IDS.issueTab,
        displayName: "Master Chat",
        exportName: EXPORT_NAMES.issueTab,
        entityTypes: ["issue"],
      },
    ],
  },
};

export default manifest;
