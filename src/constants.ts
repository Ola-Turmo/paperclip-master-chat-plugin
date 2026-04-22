export const PLUGIN_ID = "paperclip-master-chat-plugin";
export const PLUGIN_VERSION = "0.2.0";
export const PAGE_ROUTE = "master-chat";

export const SLOT_IDS = {
  page: "master-chat-page",
  sidebar: "master-chat-sidebar",
  dashboardWidget: "master-chat-dashboard-widget",
  issueTab: "master-chat-issue-tab",
  toolbarButton: "master-chat-toolbar-button",
} as const;

export const EXPORT_NAMES = {
  page: "MasterChatPage",
  sidebar: "MasterChatSidebar",
  dashboardWidget: "MasterChatDashboardWidget",
  issueTab: "MasterChatIssueTab",
  toolbarButton: "MasterChatToolbarButton",
  launcherModal: "MasterChatLauncherModal",
} as const;

export const DATA_KEYS = {
  bootstrap: "chat-bootstrap",
  threadList: "thread-list",
  threadDetail: "thread-detail",
  pluginConfig: "plugin-config",
} as const;

export const ACTION_KEYS = {
  createThread: "create-thread",
  setThreadScope: "set-thread-scope",
  setThreadSkills: "set-thread-skills",
  sendMessage: "send-message",
  retryLastTurn: "retry-last-turn",
  archiveThread: "archive-thread",
} as const;

export const STREAM_PREFIX = "master-chat";

export const DEFAULT_SKILLS = [] as const;

export const DEFAULT_HERMES_TOOLSETS = ["web", "file", "vision"] as const;

export const DEFAULT_PLUGIN_TOOLS = [
  "paperclip.dashboard",
  "paperclip.activity.search",
  "plugin.linear:search-issues",
] as const;

export const SAFE_INLINE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const DEFAULT_CONFIG = {
  gatewayMode: "auto",
  attachmentStorageMode: "filesystem",
  attachmentStorageDirectory: ".paperclip-master-chat-attachments",
  hermesBaseUrl: "",
  hermesCommand: "hermes",
  hermesCommandArgs: [],
  hermesWorkingDirectory: "",
  hermesAuthToken: "",
  hermesAuthHeaderName: "authorization",
  allowPrivateAdapterHosts: false,
  allowInsecureHttpAdapters: false,
  gatewayRequestTimeoutMs: 45_000,
  defaultProfileId: "default",
  defaultProvider: "minimax",
  defaultModel: "MiniMax-M2.7",
  defaultEnabledSkills: [...DEFAULT_SKILLS],
  defaultToolsets: [...DEFAULT_HERMES_TOOLSETS],
  availablePluginTools: [...DEFAULT_PLUGIN_TOOLS],
  maxHistoryMessages: 24,
  maxMessageChars: 12_000,
  enableVisionAnalysis: true,
  imageAnalysisMaxChars: 4_000,
  allowInlineImageData: true,
  maxAttachmentCount: 4,
  maxAttachmentBytesPerFile: 5_000_000,
  maxTotalAttachmentBytes: 12_000_000,
  maxCatalogRecords: 1000,
  scopePageSize: 200,
  redactToolPayloads: true,
  enableActivityLogging: true,
} as const;
