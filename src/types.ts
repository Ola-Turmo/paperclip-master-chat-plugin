export type ChatMode = "single_agent" | "multi_agent" | "company_wide";
export type HermesGatewayMode = "mock" | "http";

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
  dataUrl: string;
  altText?: string;
  assetId?: string;
  source: "inline" | "paperclip-asset" | "remote";
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
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export interface HermesSessionConfig {
  profileId: string;
  sessionId?: string;
  model: string;
  provider: string;
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
  };
  createdAt: string;
  updatedAt: string;
}

export interface MasterChatStore {
  threads: ChatThread[];
  messages: ChatMessage[];
}

export interface AvailableContextOption {
  id: string;
  name: string;
  status?: string | null;
  description?: string | null;
}

export interface ScopeContextSnapshot {
  company?: AvailableContextOption;
  project?: AvailableContextOption;
  linkedIssue?: AvailableContextOption;
  selectedAgents: AvailableContextOption[];
  issueCount: number;
  agentCount: number;
  projectCount: number;
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
  hermesBaseUrl: string;
  defaultProfileId: string;
  defaultProvider: string;
  defaultModel: string;
  defaultEnabledSkills: string[];
  defaultToolsets: string[];
  availablePluginTools: string[];
  maxHistoryMessages: number;
  allowInlineImageData: boolean;
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
  config: MasterChatPluginConfig;
}

export interface ThreadDetailData {
  thread: ChatThread;
  messages: ChatMessage[];
  context: ScopeContextSnapshot;
  streamChannel: string;
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
}

export interface RetryMessageInput {
  companyId: string;
  threadId: string;
}

export interface HermesToolDescriptor {
  name: string;
  description: string;
  kind: "paperclip" | "plugin" | "hermes";
}

export interface HermesRequest {
  session: HermesSessionConfig;
  scope: ThreadScope;
  skillPolicy: SkillPolicy;
  toolPolicy: ToolPolicy;
  context: ScopeContextSnapshot;
  history: ChatMessage[];
  tools: HermesToolDescriptor[];
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
  | { type: "status"; stage: "started" | "tool_call" | "tool_result" | "completed"; message: string; toolName?: string }
  | { type: "delta"; text: string };

export interface HermesResponse {
  assistantText: string;
  toolTraces: HermesToolTrace[];
  provider: string;
  model: string;
  sessionId: string;
}
