export type ChatMode = "single_agent" | "multi_agent" | "company_wide";
export type HermesGatewayMode = "auto" | "mock" | "http" | "cli";
export type HermesGatewaySelection = "mock" | "http" | "cli";
export type HermesContinuationMode = "durable" | "synthetic" | "stateless";
export type ImageAnalysisStatus = "complete" | "error" | "skipped";
export type MasterChatErrorCode =
  | "validation"
  | "authorization"
  | "not_found"
  | "timeout"
  | "unavailable"
  | "config"
  | "upstream"
  | "concurrency"
  | "unknown";

export interface ThreadScope {
  companyId: string;
  projectId?: string;
  linkedIssueId?: string;
  selectedAgentIds: string[];
  mode: ChatMode;
}

export interface SkillPolicy {
  enabled: string[];
  disabled: string[];
  toolsets: string[];
}

export interface ToolPolicy {
  allowedPluginTools: string[];
  allowedHermesToolsets: string[];
}

export interface InlineImageAttachment {
  id: string;
  type: "image";
  name: string;
  mimeType: string;
  dataUrl?: string;
  byteSize?: number;
  sha256?: string;
  altText?: string;
  assetId?: string;
  storageKey?: string;
  source: "inline" | "paperclip-asset" | "remote" | "filesystem";
  analysis?: ImageAnalysis;
}

export interface ImageAnalysis {
  status: ImageAnalysisStatus;
  summary?: string;
  extractedText?: string;
  notableDetails?: string[];
  generatedAt: string;
  provider?: string;
  model?: string;
  cached?: boolean;
  errorMessage?: string;
}

export interface TextMessagePart {
  type: "text";
  text: string;
}

export interface ImageMessagePart extends InlineImageAttachment {}

export interface ToolCallMessagePart {
  type: "tool_call";
  toolName: string;
  summary: string;
  input?: Record<string, unknown>;
}

export interface ToolResultMessagePart {
  type: "tool_result";
  toolName: string;
  summary: string;
  output?: Record<string, unknown>;
}

export interface StatusMessagePart {
  type: "status";
  status: string;
  detail?: string;
  code?: MasterChatErrorCode;
  retryable?: boolean;
}

export type ChatMessagePart =
  | TextMessagePart
  | ImageMessagePart
  | ToolCallMessagePart
  | ToolResultMessagePart
  | StatusMessagePart;

export type ChatMessageRole = "user" | "assistant" | "system" | "tool";
export type ChatMessageStatus = "pending" | "streaming" | "complete" | "error";

export interface ChatMessage {
  messageId: string;
  threadId: string;
  role: ChatMessageRole;
  parts: ChatMessagePart[];
  routing: ThreadScope;
  toolPolicy: ToolPolicy;
  status: ChatMessageStatus;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export interface HermesSessionConfig {
  profileId: string;
  sessionId?: string;
  model: string;
  provider: string;
  continuationMode?: HermesContinuationMode;
}

export interface ChatThread {
  threadId: string;
  title: string;
  scope: ThreadScope;
  hermes: HermesSessionConfig;
  skills: SkillPolicy;
  metadata: {
    createdByUserId?: string;
    visibility: "company_scoped" | "private";
    archivedAt?: string;
    lastAssistantPreview?: string;
    lastErrorCode?: MasterChatErrorCode;
    lastErrorMessage?: string;
    lastFailureAt?: string;
    gatewayMode?: HermesGatewaySelection;
    gatewayReason?: string;
    inFlightRequestId?: string;
    lastUserMessageId?: string;
    continuitySummary?: string;
    continuityStrategy?: "hermes-session" | "synthetic-summary" | "recent-history-only";
    olderMessageCount?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MasterChatStore {
  schemaVersion: number;
  threads: ChatThread[];
  messages: ChatMessage[];
}

export interface AvailableContextOption {
  id: string;
  name: string;
  status?: string | null;
  description?: string | null;
}

export interface ContextCollectionMeta {
  loaded: number;
  pageSize: number;
  truncated: boolean;
}

export interface ContextCatalogMeta {
  companies: ContextCollectionMeta;
  projects: ContextCollectionMeta;
  issues: ContextCollectionMeta;
  agents: ContextCollectionMeta;
}

export interface CompanyScopedOptions {
  companies: AvailableContextOption[];
  projects: AvailableContextOption[];
  issues: AvailableContextOption[];
  agents: AvailableContextOption[];
  catalog: ContextCatalogMeta;
  warnings: string[];
}

export interface ScopeContextSnapshot {
  company?: AvailableContextOption;
  project?: AvailableContextOption;
  linkedIssue?: AvailableContextOption;
  selectedAgents: AvailableContextOption[];
  issueCount: number;
  agentCount: number;
  projectCount: number;
  catalog: ContextCatalogMeta;
  warnings: string[];
}

export interface ThreadSummary {
  threadId: string;
  title: string;
  updatedAt: string;
  archived: boolean;
  lastAssistantPreview?: string;
  scopeLabel: string;
}

export interface MasterChatPluginConfig {
  gatewayMode: HermesGatewayMode;
  attachmentStorageMode: "inline" | "filesystem";
  attachmentStorageDirectory: string;
  hermesBaseUrl: string;
  hermesCommand: string;
  hermesCommandArgs: string[];
  hermesWorkingDirectory?: string;
  hermesAuthToken: string;
  hermesAuthHeaderName: string;
  allowPrivateAdapterHosts: boolean;
  allowInsecureHttpAdapters: boolean;
  gatewayRequestTimeoutMs: number;
  defaultProfileId: string;
  defaultProvider: string;
  defaultModel: string;
  defaultEnabledSkills: string[];
  defaultToolsets: string[];
  availablePluginTools: string[];
  maxHistoryMessages: number;
  maxMessageChars: number;
  enableVisionAnalysis: boolean;
  imageAnalysisMaxChars: number;
  allowInlineImageData: boolean;
  maxAttachmentCount: number;
  maxAttachmentBytesPerFile: number;
  maxTotalAttachmentBytes: number;
  maxCatalogRecords: number;
  scopePageSize: number;
  redactToolPayloads: boolean;
  enableActivityLogging: boolean;
}

export interface BootstrapData {
  pluginId: string;
  routePath: string;
  companyId: string;
  companies: AvailableContextOption[];
  projects: AvailableContextOption[];
  issues: AvailableContextOption[];
  agents: AvailableContextOption[];
  threads: ThreadSummary[];
  availableSkills: string[];
  availableToolsets: string[];
  availablePluginTools: string[];
  defaults: {
    scope: ThreadScope;
    skills: SkillPolicy;
    hermes: Omit<HermesSessionConfig, "sessionId">;
  };
  catalog: ContextCatalogMeta;
  warnings: string[];
  config: MasterChatPluginConfig;
}

export interface ThreadDetailData {
  thread: ChatThread;
  messages: ChatMessage[];
  context: ScopeContextSnapshot;
  streamChannel: string;
  warnings: string[];
}

export interface CreateThreadInput {
  companyId: string;
  title?: string;
  scope?: Partial<ThreadScope>;
  skills?: Partial<SkillPolicy>;
}

export interface SendMessageInput {
  companyId: string;
  threadId?: string;
  text: string;
  attachments?: InlineImageAttachment[];
  scope?: Partial<ThreadScope>;
  skills?: Partial<SkillPolicy>;
  requestId?: string;
}

export interface RetryMessageInput {
  companyId: string;
  threadId: string;
  requestId?: string;
}

export interface HermesToolDescriptor {
  name: string;
  description: string;
  kind: "paperclip" | "plugin" | "hermes";
}

export interface HermesRequest {
  requestId: string;
  session: HermesSessionConfig;
  scope: ThreadScope;
  skillPolicy: SkillPolicy;
  toolPolicy: ToolPolicy;
  context: ScopeContextSnapshot;
  history: ChatMessage[];
  tools: HermesToolDescriptor[];
  continuity: {
    strategy: "hermes-session" | "synthetic-summary" | "recent-history-only";
    olderMessageCount: number;
    totalMessageCount: number;
    summary?: string;
  };
  metadata: {
    threadId: string;
    title: string;
  };
}

export interface HermesImageAnalysisRequest {
  requestId: string;
  attachment: InlineImageAttachment;
  session: HermesSessionConfig;
  metadata: {
    threadId: string;
    title: string;
  };
}

export interface HermesToolTrace {
  toolName: string;
  summary: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export type HermesStreamEvent =
  | { type: "status"; stage: "started" | "image_analysis" | "tool_call" | "tool_result" | "completed"; message: string; toolName?: string }
  | { type: "delta"; text: string };

export interface HermesResponse {
  assistantText: string;
  toolTraces: HermesToolTrace[];
  provider: string;
  model: string;
  sessionId: string;
  gatewayMode: HermesGatewaySelection;
  continuationMode: HermesContinuationMode;
}

export interface HermesImageAnalysisResult {
  status: ImageAnalysisStatus;
  summary?: string;
  extractedText?: string;
  notableDetails?: string[];
  provider?: string;
  model?: string;
  errorMessage?: string;
}
