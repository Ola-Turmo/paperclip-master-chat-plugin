import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import {
  useHostContext,
  usePluginAction,
  usePluginData,
  usePluginStream,
  usePluginToast,
  type PluginDetailTabProps,
  type PluginPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { ACTION_KEYS, DATA_KEYS, PAGE_ROUTE, SAFE_INLINE_IMAGE_MIME_TYPES } from "../constants.js";
import type {
  BootstrapData,
  ChatMessage,
  HermesStreamEvent,
  InlineImageAttachment,
  ThreadDetailData,
  ThreadSummary,
} from "../types.js";
import { appendStreamDelta, formatStreamStatus, scopeSummary } from "./view-model.js";

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

const shellStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  border: "1px solid color-mix(in srgb, var(--foreground) 10%, transparent)",
  borderRadius: "20px",
  padding: "16px",
  background: "linear-gradient(180deg, color-mix(in srgb, var(--background) 96%, #0f172a 4%), color-mix(in srgb, var(--background) 100%, transparent))",
  boxShadow: "0 18px 48px color-mix(in srgb, #020617 14%, transparent)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  flexWrap: "wrap",
};

const cardStyle: CSSProperties = {
  border: "1px solid color-mix(in srgb, var(--foreground) 10%, transparent)",
  borderRadius: "16px",
  padding: "14px",
  background: "color-mix(in srgb, var(--background) 92%, #0f172a 8%)",
};

const mutedStyle: CSSProperties = {
  fontSize: "12px",
  color: "color-mix(in srgb, var(--foreground) 62%, transparent)",
  lineHeight: 1.45,
};

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  borderRadius: "999px",
  padding: "8px 12px",
  border: "1px solid color-mix(in srgb, var(--foreground) 12%, transparent)",
  background: "color-mix(in srgb, var(--background) 88%, #e2e8f0 12%)",
  color: "inherit",
  cursor: "pointer",
  fontSize: "12px",
};

const activeChipStyle: CSSProperties = {
  ...chipStyle,
  borderColor: "color-mix(in srgb, #2563eb 55%, transparent)",
  background: "color-mix(in srgb, #2563eb 16%, var(--background))",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: "12px",
  border: "1px solid color-mix(in srgb, var(--foreground) 12%, transparent)",
  background: "color-mix(in srgb, var(--background) 92%, transparent)",
  color: "inherit",
};

const composerStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "124px",
  resize: "vertical",
  lineHeight: 1.55,
};

const primaryButtonStyle: CSSProperties = {
  ...chipStyle,
  background: "var(--foreground)",
  color: "var(--background)",
  borderColor: "var(--foreground)",
  fontWeight: 600,
};

const ghostButtonStyle: CSSProperties = {
  ...chipStyle,
  background: "transparent",
};

const messageBaseStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  maxWidth: "min(820px, 100%)",
};

const userBubbleStyle: CSSProperties = {
  ...cardStyle,
  background: "color-mix(in srgb, #2563eb 14%, var(--background))",
  justifySelf: "end",
};

const assistantBubbleStyle: CSSProperties = {
  ...cardStyle,
  justifySelf: "start",
};

const errorBubbleStyle: CSSProperties = {
  ...cardStyle,
  borderColor: "color-mix(in srgb, #dc2626 45%, transparent)",
  background: "color-mix(in srgb, #dc2626 10%, var(--background))",
};

function pluginRoute(companyPrefix: string | null | undefined): string {
  return companyPrefix ? `/${companyPrefix}/${PAGE_ROUTE}` : `/${PAGE_ROUTE}`;
}

function initialComposerState() {
  return {
    text: "",
    attachments: [] as InlineImageAttachment[],
  };
}

let fallbackRequestCounter = 0;

function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackRequestCounter += 1;
  return `fallback-${Date.now()}-${fallbackRequestCounter}`;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (typeof error === "object" && error) {
    const candidate = error as {
      message?: unknown;
      error?: unknown;
      detail?: unknown;
      body?: { message?: unknown; error?: unknown; code?: unknown; details?: unknown } | unknown;
      code?: unknown;
    };
    const nested = candidate.body && typeof candidate.body === "object" ? candidate.body as Record<string, unknown> : undefined;
    const values = [
      candidate.message,
      candidate.error,
      candidate.detail,
      nested?.message,
      nested?.error,
      nested?.code,
      candidate.code,
    ];
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "Something went wrong in Master Chat.";
}

async function fileToAttachment(file: File): Promise<InlineImageAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });

  return {
    id: `${file.name}-${file.lastModified}`,
    type: "image",
    name: file.name,
    mimeType: file.type || "image/png",
    dataUrl,
    byteSize: file.size,
    source: "inline",
  };
}

function AttachmentPreview({ attachment, onRemove }: { attachment: InlineImageAttachment; onRemove?: (id: string) => void }) {
  return (
    <div style={{ ...cardStyle, padding: "10px", display: "grid", gap: "8px" }}>
      {attachment.dataUrl ? (
        <img
          src={attachment.dataUrl}
          alt={attachment.altText ?? attachment.name}
          style={{ width: "100%", maxHeight: "160px", objectFit: "cover", borderRadius: "10px" }}
        />
      ) : null}
      <div style={mutedStyle}>{attachment.name} · {humanBytes(attachment.byteSize ?? 0)}</div>
      {attachment.analysis?.summary ? <div style={mutedStyle}>{attachment.analysis.summary}</div> : null}
      {onRemove ? (
        <button type="button" style={ghostButtonStyle} onClick={() => onRemove(attachment.id)}>
          Remove
        </button>
      ) : null}
    </div>
  );
}

function ThreadSelect({
  threads,
  selectedThreadId,
  onSelect,
  onNewChat,
}: {
  threads: ThreadSummary[];
  selectedThreadId?: string;
  onSelect: (threadId?: string) => void;
  onNewChat: () => void;
}) {
  return (
    <div style={{ ...rowStyle, justifyContent: "space-between" }}>
      <div style={{ display: "grid", gap: "4px", minWidth: "220px", flex: "1 1 260px" }}>
        <span style={mutedStyle}>Conversation</span>
        <select
          style={inputStyle}
          value={selectedThreadId ?? ""}
          onChange={(event) => onSelect(event.target.value || undefined)}
        >
          <option value="">New conversation</option>
          {threads.map((thread) => (
            <option key={thread.threadId} value={thread.threadId}>
              {thread.title}
            </option>
          ))}
        </select>
      </div>
      <button type="button" style={ghostButtonStyle} onClick={onNewChat}>New chat</button>
    </div>
  );
}

function RecipientPicker({
  bootstrap,
  selectedAgentIds,
  setSelectedAgentIds,
  disabled,
}: {
  bootstrap: BootstrapData;
  selectedAgentIds: string[];
  setSelectedAgentIds: (value: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ ...cardStyle, display: "grid", gap: "10px" }}>
      <div>
        <strong>Who to chat with</strong>
        <div style={mutedStyle}>Choose company-wide mode or target one or more managers.</div>
      </div>
      <div style={rowStyle}>
        <button
          type="button"
          disabled={disabled}
          style={selectedAgentIds.length === 0 ? activeChipStyle : chipStyle}
          onClick={() => setSelectedAgentIds([])}
        >
          Company-wide
        </button>
        {bootstrap.agents.map((agent) => {
          const active = selectedAgentIds.includes(agent.id);
          return (
            <button
              key={agent.id}
              type="button"
              disabled={disabled}
              style={active ? activeChipStyle : chipStyle}
              onClick={() => setSelectedAgentIds(active
                ? selectedAgentIds.filter((id) => id !== agent.id)
                : [...selectedAgentIds, agent.id])}
            >
              {agent.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MessageCard({ message }: { message: ChatMessage }) {
  const wrapperStyle = message.role === "user"
    ? { ...messageBaseStyle, justifySelf: "end" as const }
    : { ...messageBaseStyle, justifySelf: "start" as const };
  const bubbleStyle = message.status === "error"
    ? errorBubbleStyle
    : message.role === "user"
      ? userBubbleStyle
      : assistantBubbleStyle;

  return (
    <div style={wrapperStyle}>
      <div style={bubbleStyle}>
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <strong style={{ fontSize: "13px", textTransform: "capitalize" }}>
            {message.role === "assistant" ? "Hermes" : message.role}
          </strong>
          <span style={mutedStyle}>{new Date(message.createdAt).toLocaleString()}</span>
        </div>
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <div key={index} style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {part.text}
              </div>
            );
          }
          if (part.type === "image") {
            return <AttachmentPreview key={part.id} attachment={part} />;
          }
          if (part.type === "tool_call" || part.type === "tool_result") {
            return (
              <div key={`${part.type}-${index}`} style={{ ...cardStyle, padding: "10px" }}>
                <div style={{ ...mutedStyle, textTransform: "uppercase" }}>{part.type.replace("_", " ")}</div>
                <strong>{part.toolName}</strong>
                <div style={mutedStyle}>{part.summary}</div>
              </div>
            );
          }
          return (
            <div key={`${part.type}-${index}`} style={errorBubbleStyle}>
              <strong>{part.status}</strong>
              <div style={mutedStyle}>{part.detail ?? "No detail available."}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ ...cardStyle, display: "grid", gap: "6px", textAlign: "center", padding: "24px" }}>
      <strong>{title}</strong>
      <div style={mutedStyle}>{body}</div>
    </div>
  );
}

function ChatSurface({ forcedIssueId }: { forcedIssueId?: string }) {
  const host = useHostContext();
  const toast = usePluginToast();
  const companyId = host.companyId ?? "";
  const sendMessage = usePluginAction(ACTION_KEYS.sendMessage);
  const archiveThread = usePluginAction(ACTION_KEYS.archiveThread);
  const retryLastTurn = usePluginAction(ACTION_KEYS.retryLastTurn);

  const bootstrap = usePluginData<BootstrapData>(DATA_KEYS.bootstrap, companyId ? { companyId } : undefined);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [composer, setComposer] = useState(initialComposerState);
  const [isSending, setIsSending] = useState(false);
  const [composerError, setComposerError] = useState<string | undefined>();
  const [streamStatus, setStreamStatus] = useState<string[]>([]);
  const [streamText, setStreamText] = useState("");

  const detail = usePluginData<ThreadDetailData>(
    DATA_KEYS.threadDetail,
    selectedThreadId ? { companyId, threadId: selectedThreadId } : undefined,
  );
  const stream = usePluginStream(selectedThreadId ? `master-chat:${selectedThreadId}` : "master-chat:none", { companyId });

  const bootstrapData = bootstrap.data;
  const detailData = detail.data;

  useEffect(() => {
    if (!stream.lastEvent) return;
    const event = stream.lastEvent as HermesStreamEvent;
    if (event.type === "status") {
      setStreamStatus((current) => [...current.slice(-2), formatStreamStatus(event)]);
      if (event.stage === "completed") setIsSending(false);
      return;
    }
    setStreamText((current) => appendStreamDelta(current, event));
  }, [stream.lastEvent]);

  useEffect(() => {
    if (!detailData?.thread) return;
    setSelectedAgentIds(detailData.thread.scope.selectedAgentIds);
  }, [detailData?.thread?.threadId]);

  async function addFiles(files: FileList | null) {
    if (!files || !bootstrapData) return;
    const nextFiles = Array.from(files);
    const invalidType = nextFiles.find((file) => !SAFE_INLINE_IMAGE_MIME_TYPES.includes(file.type as (typeof SAFE_INLINE_IMAGE_MIME_TYPES)[number]));
    if (invalidType) {
      setComposerError(`Unsupported file type for '${invalidType.name}'.`);
      return;
    }
    if (composer.attachments.length + nextFiles.length > bootstrapData.config.maxAttachmentCount) {
      setComposerError(`Attach at most ${bootstrapData.config.maxAttachmentCount} images per turn.`);
      return;
    }
    const oversized = nextFiles.find((file) => file.size > bootstrapData.config.maxAttachmentBytesPerFile);
    if (oversized) {
      setComposerError(`'${oversized.name}' exceeds ${humanBytes(bootstrapData.config.maxAttachmentBytesPerFile)}.`);
      return;
    }
    const totalBytes = composer.attachments.reduce((sum, attachment) => sum + (attachment.byteSize ?? 0), 0)
      + nextFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > bootstrapData.config.maxTotalAttachmentBytes) {
      setComposerError(`Attachments exceed ${humanBytes(bootstrapData.config.maxTotalAttachmentBytes)} total.`);
      return;
    }
    const next = await Promise.all(nextFiles.map(fileToAttachment));
    setComposerError(undefined);
    setComposer((current) => ({ ...current, attachments: [...current.attachments, ...next] }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!companyId || !bootstrapData || isSending) return;
    setComposerError(undefined);
    setIsSending(true);
    setStreamStatus([]);
    setStreamText("");

    try {
      const result = await sendMessage({
        companyId,
        threadId: selectedThreadId,
        requestId: requestId(),
        text: String(composer.text ?? ""),
        attachments: composer.attachments,
        scope: {
          linkedIssueId: forcedIssueId,
          selectedAgentIds,
        },
        skills: {
          enabled: bootstrapData.defaults.skills.enabled ?? [],
          toolsets: bootstrapData.defaults.skills.toolsets ?? [],
        },
      }) as { threadId: string };

      setSelectedThreadId(result.threadId);
      setComposer(initialComposerState());
      await bootstrap.refresh();
      await detail.refresh();
    } catch (error) {
      const message = describeError(error);
      setComposerError(message);
      toast({ title: "Send failed", body: message });
    } finally {
      setIsSending(false);
    }
  }

  async function handleRetry() {
    if (!companyId || !selectedThreadId || isSending) return;
    setComposerError(undefined);
    setIsSending(true);
    setStreamStatus([]);
    setStreamText("");
    try {
      await retryLastTurn({ companyId, threadId: selectedThreadId, requestId: requestId() });
      await detail.refresh();
      await bootstrap.refresh();
    } catch (error) {
      const message = describeError(error);
      setComposerError(message);
      toast({ title: "Retry failed", body: message });
    } finally {
      setIsSending(false);
    }
  }

  if (!companyId) {
    return <EmptyState title="Master Chat needs a company" body="Open a company first, then start chatting." />;
  }

  const threadSummaries = bootstrapData?.threads ?? [];
  const messages = detailData?.messages ?? [];
  const scopeText = detailData?.thread
    ? scopeSummary(detailData.thread.scope)
    : selectedAgentIds.length > 0
      ? `${selectedAgentIds.length} selected`
      : "company-wide";

  return (
    <div style={pageStyle} onPaste={(event) => void addFiles(event.clipboardData.files)}>
      <div style={shellStyle}>
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <div style={{ display: "grid", gap: "4px" }}>
            <strong style={{ fontSize: "18px" }}>CEO Master Chat</strong>
            <span style={mutedStyle}>A clean operator chat for this company. Pick who should be in scope and send the message.</span>
          </div>
          <div style={rowStyle}>
            <span style={chipStyle}>{isSending ? "Thinking" : "Ready"}</span>
            <span style={chipStyle}>{scopeText}</span>
            {forcedIssueId ? <span style={chipStyle}>Issue linked</span> : null}
          </div>
        </div>

        {bootstrap.loading ? <div style={cardStyle}>Loading chat…</div> : null}
        {bootstrap.error ? <div style={errorBubbleStyle}>{describeError(bootstrap.error)}</div> : null}

        {bootstrapData ? (
          <>
            <ThreadSelect
              threads={threadSummaries}
              selectedThreadId={selectedThreadId}
              onSelect={(threadId) => setSelectedThreadId(threadId)}
              onNewChat={() => {
                setSelectedThreadId(undefined);
                setComposer(initialComposerState());
                setStreamStatus([]);
                setStreamText("");
              }}
            />

            <RecipientPicker
              bootstrap={bootstrapData}
              selectedAgentIds={selectedAgentIds}
              setSelectedAgentIds={setSelectedAgentIds}
              disabled={isSending}
            />

            <div style={{ ...cardStyle, display: "grid", gap: "12px", minHeight: "280px" }}>
              {selectedThreadId && detail.loading ? <div style={mutedStyle}>Loading messages…</div> : null}
              {selectedThreadId && detail.error ? <div style={errorBubbleStyle}>{describeError(detail.error)}</div> : null}
              {messages.length === 0 ? (
                <EmptyState
                  title="Start the conversation"
                  body="Type a message below. A new thread will be created automatically."
                />
              ) : (
                messages.map((message) => <MessageCard key={message.messageId} message={message} />)
              )}
              {streamText ? (
                <div style={{ ...assistantBubbleStyle, ...messageBaseStyle, justifySelf: "start" }}>
                  <strong style={{ fontSize: "13px" }}>Hermes</strong>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{streamText}</div>
                  {streamStatus.length > 0 ? <div style={mutedStyle}>{streamStatus[streamStatus.length - 1]}</div> : null}
                </div>
              ) : null}
            </div>

            <form onSubmit={(event) => void handleSubmit(event)} style={{ ...cardStyle, display: "grid", gap: "12px" }}>
              <textarea
                disabled={isSending}
                style={composerStyle}
                value={String(composer.text ?? "")}
                placeholder="Ask what should happen next, request analysis, or paste an image and ask for help."
                onChange={(event) => setComposer((current) => ({ ...current, text: event.target.value }))}
              />
              <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                <div style={mutedStyle}>
                  {String(composer.text ?? "").length}/{bootstrapData.config.maxMessageChars}
                </div>
                <div style={rowStyle}>
                  <label style={ghostButtonStyle}>
                    Add image
                    <input
                      disabled={isSending}
                      type="file"
                      accept={SAFE_INLINE_IMAGE_MIME_TYPES.join(",")}
                      multiple
                      hidden
                      onChange={(event: ChangeEvent<HTMLInputElement>) => void addFiles(event.target.files)}
                    />
                  </label>
                  {selectedThreadId ? (
                    <button type="button" style={ghostButtonStyle} disabled={isSending} onClick={() => void handleRetry()}>
                      Retry
                    </button>
                  ) : null}
                  {selectedThreadId ? (
                    <button
                      type="button"
                      style={ghostButtonStyle}
                      disabled={isSending}
                      onClick={() => void archiveThread({ companyId, threadId: selectedThreadId }).then(() => bootstrap.refresh())}
                    >
                      Archive
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    style={primaryButtonStyle}
                    disabled={isSending || String(composer.text ?? "").trim().length > bootstrapData.config.maxMessageChars}
                  >
                    {isSending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
              {composerError ? <div style={errorBubbleStyle}>{composerError}</div> : null}
              {composer.attachments.length > 0 ? (
                <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  {composer.attachments.map((attachment) => (
                    <AttachmentPreview
                      key={attachment.id}
                      attachment={attachment}
                      onRemove={(id) => setComposer((current) => ({
                        ...current,
                        attachments: current.attachments.filter((entry) => entry.id !== id),
                      }))}
                    />
                  ))}
                </div>
              ) : null}
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function MasterChatPage(_props: PluginPageProps) {
  return <ChatSurface />;
}

export function MasterChatIssueTab(_props: PluginDetailTabProps) {
  const host = useHostContext();
  return <ChatSurface forcedIssueId={host.entityId ?? undefined} />;
}

export function MasterChatSidebar(_props: PluginSidebarProps) {
  const host = useHostContext();
  const companyId = host.companyId ?? "";
  const bootstrap = usePluginData<BootstrapData>(DATA_KEYS.bootstrap, companyId ? { companyId } : undefined);
  return (
    <a href={pluginRoute(host.companyPrefix)} style={{ ...cardStyle, display: "grid", gap: "6px", textDecoration: "none", color: "inherit" }}>
      <strong>CEO Master Chat</strong>
      <span style={mutedStyle}>A clean operator chat for the current company.</span>
      <span style={mutedStyle}>{bootstrap.data?.threads.length ?? 0} conversation(s)</span>
    </a>
  );
}

export function MasterChatDashboardWidget(_props: PluginWidgetProps) {
  const host = useHostContext();
  const companyId = host.companyId ?? "";
  const bootstrap = usePluginData<BootstrapData>(DATA_KEYS.bootstrap, companyId ? { companyId } : undefined);

  if (!companyId) return <EmptyState title="Open a company first" body="Master Chat is scoped per company." />;
  if (bootstrap.loading) return <div style={cardStyle}>Loading Master Chat…</div>;
  if (bootstrap.error) return <div style={errorBubbleStyle}>{describeError(bootstrap.error)}</div>;

  return (
    <div style={{ ...cardStyle, display: "grid", gap: "10px" }}>
      <strong>CEO Master Chat</strong>
      <div style={mutedStyle}>Clean chat surface with agent selection and company-scoped context.</div>
      <div style={rowStyle}>
        <span style={chipStyle}>{bootstrap.data?.threads.length ?? 0} conversations</span>
        <span style={chipStyle}>{bootstrap.data?.agents.length ?? 0} selectable agents</span>
      </div>
      <a href={pluginRoute(host.companyPrefix)} style={{ ...primaryButtonStyle, textDecoration: "none", justifyContent: "center" }}>
        Open chat
      </a>
    </div>
  );
}

export function MasterChatToolbarButton() {
  const host = useHostContext();
  return (
    <a href={pluginRoute(host.companyPrefix)} style={{ ...primaryButtonStyle, textDecoration: "none", justifyContent: "center" }}>
      Master Chat
    </a>
  );
}

export function MasterChatLauncherModal() {
  const host = useHostContext();
  return <ChatSurface forcedIssueId={host.entityType === "issue" ? host.entityId ?? undefined : undefined} />;
}
