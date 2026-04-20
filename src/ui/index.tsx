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

const layoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "280px 1fr",
  gap: "16px",
  alignItems: "start",
};

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "14px",
  padding: "14px",
  background: "color-mix(in srgb, var(--card, transparent) 82%, transparent)",
};

const mutedStyle: CSSProperties = { fontSize: "12px", opacity: 0.72, lineHeight: 1.45 };
const buttonStyle: CSSProperties = { borderRadius: "999px", border: "1px solid var(--border)", background: "transparent", color: "inherit", padding: "7px 12px", cursor: "pointer" };
const primaryButtonStyle: CSSProperties = { ...buttonStyle, background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" };
const inputStyle: CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: "10px", border: "1px solid var(--border)", background: "transparent", color: "inherit" };
const textAreaStyle: CSSProperties = { ...inputStyle, minHeight: "110px", resize: "vertical" };
const chipStyle: CSSProperties = { display: "inline-flex", gap: "6px", alignItems: "center", borderRadius: "999px", border: "1px solid var(--border)", padding: "4px 10px", fontSize: "12px" };
const warningStyle: CSSProperties = { ...cardStyle, borderColor: "#f59e0b", background: "color-mix(in srgb, #f59e0b 10%, transparent)" };
const errorStyle: CSSProperties = { ...cardStyle, borderColor: "#dc2626", background: "color-mix(in srgb, #dc2626 10%, transparent)" };
const accentCardStyle: CSSProperties = {
  ...cardStyle,
  borderColor: "color-mix(in srgb, #2563eb 45%, var(--border))",
  background: "linear-gradient(135deg, color-mix(in srgb, #2563eb 18%, transparent), color-mix(in srgb, #0f172a 4%, transparent))",
};

function hostPath(companyPrefix: string | null | undefined, suffix: string): string {
  return companyPrefix ? `/${companyPrefix}${suffix}` : suffix;
}

function pluginRoute(companyPrefix: string | null | undefined): string {
  return hostPath(companyPrefix, `/${PAGE_ROUTE}`);
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
    <div style={{ ...cardStyle, display: "grid", gap: "8px", padding: "10px" }}>
      {attachment.dataUrl ? (
        <img src={attachment.dataUrl} alt={attachment.altText ?? attachment.name} style={{ width: "100%", maxHeight: "160px", objectFit: "cover", borderRadius: "10px" }} />
      ) : (
        <div style={{ ...warningStyle, margin: 0 }}>
          <strong>Stored on filesystem</strong>
          <div style={mutedStyle}>Image bytes are retained on the Paperclip host and hydrated lazily for safe rendering.</div>
        </div>
      )}
      <div style={mutedStyle}>{attachment.name} · {attachment.mimeType} · {humanBytes(attachment.byteSize ?? 0)}</div>
      {attachment.analysis?.status === "complete" ? (
        <div style={{ ...cardStyle, padding: "10px", background: "color-mix(in srgb, #16a34a 10%, transparent)" }}>
          <strong>Vision analysis</strong>
          {attachment.analysis.summary ? <div style={{ ...mutedStyle, marginTop: "6px" }}>{attachment.analysis.summary}</div> : null}
          {attachment.analysis.extractedText ? (
            <div style={{ ...mutedStyle, marginTop: "6px", whiteSpace: "pre-wrap" }}>
              <strong>Extracted text:</strong>{"\n"}{attachment.analysis.extractedText}
            </div>
          ) : null}
          {attachment.analysis.notableDetails?.length ? (
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              {attachment.analysis.notableDetails.map((detail) => <li key={detail} style={mutedStyle}>{detail}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {attachment.analysis?.status === "error" ? (
        <div style={warningStyle}>
          <strong>Vision analysis unavailable</strong>
          <div style={mutedStyle}>{attachment.analysis.errorMessage ?? "The image was kept, but no OCR/description could be generated."}</div>
        </div>
      ) : null}
      {onRemove ? <button style={buttonStyle} onClick={() => onRemove(attachment.id)}>Remove</button> : null}
    </div>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div style={warningStyle}>
      <strong>Warnings</strong>
      <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
        {warnings.map((warning) => <li key={warning} style={mutedStyle}>{warning}</li>)}
      </ul>
    </div>
  );
}

function ThreadRail({
  threads,
  selectedThreadId,
  filter,
  onFilterChange,
  onSelect,
  onCreate,
}: {
  threads: ThreadSummary[];
  selectedThreadId?: string;
  filter: string;
  onFilterChange: (value: string) => void;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
}) {
  const filtered = threads.filter((thread) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return [thread.title, thread.scopeLabel, thread.lastAssistantPreview].join(" ").toLowerCase().includes(needle);
  });

  return (
    <div style={{ ...cardStyle, display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Threads</strong>
        <button style={buttonStyle} onClick={onCreate}>New</button>
      </div>
      <input style={inputStyle} value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="Filter threads" aria-label="Filter threads" />
      {filtered.length === 0 ? <div style={mutedStyle}>No threads yet. Start a scoped chat from the composer.</div> : null}
      {filtered.map((thread) => (
        <button
          key={thread.threadId}
          style={{
            ...cardStyle,
            textAlign: "left",
            padding: "10px",
            borderColor: thread.threadId === selectedThreadId ? "var(--foreground)" : "var(--border)",
            cursor: "pointer",
          }}
          onClick={() => onSelect(thread.threadId)}
        >
          <div style={{ fontWeight: 600 }}>{thread.title}</div>
          <div style={mutedStyle}>{thread.scopeLabel}</div>
          {thread.lastAssistantPreview ? <div style={{ ...mutedStyle, marginTop: "4px" }}>{thread.lastAssistantPreview}</div> : null}
        </button>
      ))}
    </div>
  );
}

function MessageCard({ message }: { message: ChatMessage }) {
  return (
    <div style={{ ...cardStyle, display: "grid", gap: "8px", background: message.role === "assistant" ? "color-mix(in srgb, #2563eb 8%, transparent)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
        <strong style={{ textTransform: "capitalize" }}>{message.role}</strong>
        <span style={mutedStyle}>{new Date(message.createdAt).toLocaleString()}</span>
      </div>
      {message.parts.map((part, index) => {
        if (part.type === "text") return <div key={index} style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{part.text}</div>;
        if (part.type === "image") return <AttachmentPreview key={part.id} attachment={part} />;
        if (part.type === "tool_call" || part.type === "tool_result") {
          return (
            <div key={`${part.type}-${index}`} style={{ ...cardStyle, padding: "10px", background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
              <div style={{ fontSize: "12px", textTransform: "uppercase", opacity: 0.7 }}>{part.type.replace("_", " ")}</div>
              <strong>{part.toolName}</strong>
              <div style={mutedStyle}>{part.summary}</div>
            </div>
          );
        }
        return (
          <div key={`${part.type}-${index}`} style={part.status === "error" ? errorStyle : warningStyle}>
            <strong>{part.status}</strong>
            <div style={mutedStyle}>{part.detail ?? "No detail"}</div>
            {part.code ? <div style={mutedStyle}>Code: {part.code}</div> : null}
            {typeof part.retryable === "boolean" ? <div style={mutedStyle}>Retryable: {part.retryable ? "yes" : "no"}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function ScopePanel({
  bootstrap,
  disabled,
  selectedProjectId,
  selectedIssueId,
  selectedAgentIds,
  setSelectedProjectId,
  setSelectedIssueId,
  setSelectedAgentIds,
  enabledSkills,
  setEnabledSkills,
}: {
  bootstrap: BootstrapData;
  disabled: boolean;
  selectedProjectId?: string;
  selectedIssueId?: string;
  selectedAgentIds: string[];
  setSelectedProjectId: (value?: string) => void;
  setSelectedIssueId: (value?: string) => void;
  setSelectedAgentIds: (value: string[]) => void;
  enabledSkills: string[];
  setEnabledSkills: (value: string[]) => void;
}) {
  return (
    <div style={{ ...cardStyle, display: "grid", gap: "12px" }}>
      <div>
        <strong>Context</strong>
        <div style={mutedStyle}>Scope the thread before sending to Hermes.</div>
      </div>
      <label style={{ display: "grid", gap: "6px" }}>
        <span style={mutedStyle}>Project</span>
        <select disabled={disabled} style={inputStyle} value={selectedProjectId ?? ""} onChange={(event) => setSelectedProjectId(event.target.value || undefined)}>
          <option value="">All projects</option>
          {bootstrap.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label style={{ display: "grid", gap: "6px" }}>
        <span style={mutedStyle}>Linked issue</span>
        <select disabled={disabled} style={inputStyle} value={selectedIssueId ?? ""} onChange={(event) => setSelectedIssueId(event.target.value || undefined)}>
          <option value="">No linked issue</option>
          {bootstrap.issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.name}</option>)}
        </select>
      </label>
      <div style={{ display: "grid", gap: "6px" }}>
        <span style={mutedStyle}>Selected agents</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {bootstrap.agents.map((agent) => {
            const active = selectedAgentIds.includes(agent.id);
            return (
              <button
                key={agent.id}
                disabled={disabled}
                style={{
                  ...buttonStyle,
                  opacity: disabled ? 0.6 : 1,
                  background: active ? "color-mix(in srgb, #2563eb 18%, transparent)" : "transparent",
                  borderColor: active ? "#2563eb" : "var(--border)",
                }}
                onClick={() => {
                  setSelectedAgentIds(active
                    ? selectedAgentIds.filter((id) => id !== agent.id)
                    : [...selectedAgentIds, agent.id]);
                }}
              >
                {agent.name}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "grid", gap: "6px" }}>
        <span style={mutedStyle}>Skills</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {bootstrap.availableSkills.map((skill) => {
            const active = enabledSkills.includes(skill);
            return (
              <button
                key={skill}
                disabled={disabled}
                style={{
                  ...buttonStyle,
                  opacity: disabled ? 0.6 : 1,
                  background: active ? "color-mix(in srgb, #16a34a 16%, transparent)" : "transparent",
                  borderColor: active ? "#16a34a" : "var(--border)",
                }}
                onClick={() => {
                  setEnabledSkills(active
                    ? enabledSkills.filter((entry) => entry !== skill)
                    : [...enabledSkills, skill]);
                }}
              >
                {skill}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChatSurface({ forcedIssueId }: { forcedIssueId?: string }) {
  const host = useHostContext();
  const toast = usePluginToast();
  const companyId = host.companyId ?? "";
  const createThread = usePluginAction(ACTION_KEYS.createThread);
  const sendMessage = usePluginAction(ACTION_KEYS.sendMessage);
  const archiveThread = usePluginAction(ACTION_KEYS.archiveThread);
  const retryLastTurn = usePluginAction(ACTION_KEYS.retryLastTurn);

  const bootstrap = usePluginData<BootstrapData>(DATA_KEYS.bootstrap, { companyId });
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>(forcedIssueId);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [composer, setComposer] = useState(initialComposerState);
  const [threadFilter, setThreadFilter] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [composerError, setComposerError] = useState<string | undefined>();
  const [streamStatus, setStreamStatus] = useState<string[]>([]);
  const [streamText, setStreamText] = useState("");

  const detail = usePluginData<ThreadDetailData>(DATA_KEYS.threadDetail, selectedThreadId ? { companyId, threadId: selectedThreadId } : undefined);
  const stream = usePluginStream(selectedThreadId ? `master-chat:${selectedThreadId}` : "master-chat:none", { companyId });

  const bootstrapData = bootstrap.data;
  const detailData = detail.data;

  useEffect(() => {
    if (!stream.lastEvent) return;
    const event = stream.lastEvent as HermesStreamEvent;
    if (event.type === "status") {
      setStreamStatus((current) => [...current.slice(-4), formatStreamStatus(event)]);
      if (event.stage === "completed") {
        setIsSending(false);
      }
      return;
    }
    setStreamText((current) => appendStreamDelta(current, event));
  }, [stream.lastEvent]);

  useEffect(() => {
    if (!detailData?.thread) return;
    setSelectedProjectId(detailData.thread.scope.projectId);
    setSelectedIssueId(detailData.thread.scope.linkedIssueId);
    setSelectedAgentIds(detailData.thread.scope.selectedAgentIds);
    setEnabledSkills(detailData.thread.skills.enabled);
  }, [detailData?.thread?.threadId]);

  const effectiveSkills = enabledSkills.length > 0
    ? enabledSkills
    : (bootstrapData?.defaults.skills.enabled ?? []);

  const effectiveScopeSummary = useMemo(() => scopeSummary({
    companyId,
    projectId: selectedProjectId,
    linkedIssueId: forcedIssueId ?? selectedIssueId,
    selectedAgentIds,
    mode: selectedAgentIds.length > 1 ? "multi_agent" : selectedAgentIds.length === 1 ? "single_agent" : "company_wide",
  }), [companyId, selectedProjectId, selectedIssueId, forcedIssueId, selectedAgentIds]);

  async function handleCreateThread() {
    if (!companyId) return;
    try {
      const result = await createThread({
        companyId,
        projectId: selectedProjectId,
        linkedIssueId: forcedIssueId ?? selectedIssueId,
        selectedAgentIds,
        enabledSkills: effectiveSkills,
        toolsets: bootstrapData?.defaults.skills.toolsets ?? [],
      }) as { threadId: string };
      setSelectedThreadId(result.threadId);
      await bootstrap.refresh();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      toast({ title: "Failed to create thread", body: detail });
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files || !bootstrapData) return;
    const nextFiles = Array.from(files);
    const allowedTypes = new Set(SAFE_INLINE_IMAGE_MIME_TYPES);
    const invalidType = nextFiles.find((file) => !allowedTypes.has(file.type as (typeof SAFE_INLINE_IMAGE_MIME_TYPES)[number]));
    if (invalidType) {
      setComposerError(`Unsupported file type for '${invalidType.name}'. Allowed types: ${SAFE_INLINE_IMAGE_MIME_TYPES.join(", ")}`);
      return;
    }
    if ((composer.attachments.length + nextFiles.length) > bootstrapData.config.maxAttachmentCount) {
      setComposerError(`Attach at most ${bootstrapData.config.maxAttachmentCount} images per turn.`);
      return;
    }
    const oversized = nextFiles.find((file) => file.size > bootstrapData.config.maxAttachmentBytesPerFile);
    if (oversized) {
      setComposerError(`'${oversized.name}' exceeds ${humanBytes(bootstrapData.config.maxAttachmentBytesPerFile)}.`);
      return;
    }
    const totalBytes = composer.attachments.reduce((sum, attachment) => sum + (attachment.byteSize ?? 0), 0) + nextFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > bootstrapData.config.maxTotalAttachmentBytes) {
      setComposerError(`Attachments exceed ${humanBytes(bootstrapData.config.maxTotalAttachmentBytes)} total.`);
      return;
    }

    const next = await Promise.all(nextFiles.map(fileToAttachment));
    setComposerError(undefined);
    setComposer((current) => ({
      ...current,
      attachments: [...current.attachments, ...next],
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!companyId || !bootstrapData || isSending) return;
    setComposerError(undefined);
    setIsSending(true);
    setStreamStatus([]);
    setStreamText("");
    const currentRequestId = requestId();

    try {
      if (composer.text.trim().length > bootstrapData.config.maxMessageChars) {
        throw new Error(`Message text exceeds the ${bootstrapData.config.maxMessageChars} character limit`);
      }

      const result = await sendMessage({
        companyId,
        threadId: selectedThreadId,
        requestId: currentRequestId,
        text: composer.text,
        attachments: composer.attachments,
        scope: {
          projectId: selectedProjectId,
          linkedIssueId: forcedIssueId ?? selectedIssueId,
          selectedAgentIds,
        },
        skills: {
          enabled: effectiveSkills,
          toolsets: bootstrapData.defaults.skills.toolsets ?? [],
        },
      }) as { threadId: string };

      setSelectedThreadId(result.threadId);
      setComposer(initialComposerState());
      await bootstrap.refresh();
      await detail.refresh();
      toast({ title: "Message sent", body: "Hermes completed the turn." });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setComposerError(detail);
      toast({ title: "Send failed", body: detail });
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
      const detail = error instanceof Error ? error.message : String(error);
      setComposerError(detail);
      toast({ title: "Retry failed", body: detail });
    } finally {
      setIsSending(false);
    }
  }

  if (!companyId) {
    return <div style={cardStyle}>Master Chat requires a company context.</div>;
  }

  return (
    <div style={{ display: "grid", gap: "16px" }} onPaste={(event) => void addFiles(event.clipboardData.files)}>
      <div style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <div>
          <strong>Master Chat</strong>
          <div style={mutedStyle}>Scope: {effectiveScopeSummary}</div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <span style={chipStyle}>Company {companyId}</span>
          {selectedThreadId ? <span style={chipStyle}>Thread {selectedThreadId.slice(0, 8)}</span> : null}
          <span style={chipStyle}>Skills {effectiveSkills.length}</span>
          <span style={chipStyle}>{isSending ? "Streaming" : "Idle"}</span>
        </div>
      </div>

      {bootstrap.loading ? <div style={cardStyle}>Loading bootstrap data…</div> : null}
      {bootstrap.error ? <div style={errorStyle}>Bootstrap error: {bootstrap.error.message}</div> : null}
      <WarningList warnings={bootstrapData?.warnings ?? []} />

      {bootstrapData ? (
        <div style={layoutStyle}>
          <ThreadRail
            threads={bootstrapData.threads}
            selectedThreadId={selectedThreadId}
            filter={threadFilter}
            onFilterChange={setThreadFilter}
            onSelect={setSelectedThreadId}
            onCreate={() => void handleCreateThread()}
          />

          <div style={{ display: "grid", gap: "16px" }}>
            <ScopePanel
              bootstrap={bootstrapData}
              disabled={isSending}
              selectedProjectId={selectedProjectId}
              selectedIssueId={forcedIssueId ?? selectedIssueId}
              selectedAgentIds={selectedAgentIds}
              setSelectedProjectId={setSelectedProjectId}
              setSelectedIssueId={setSelectedIssueId}
              setSelectedAgentIds={setSelectedAgentIds}
              enabledSkills={effectiveSkills}
              setEnabledSkills={setEnabledSkills}
            />

            <form onSubmit={(event) => void handleSubmit(event)} style={{ ...cardStyle, display: "grid", gap: "12px" }}>
              <div>
                <strong>Compose</strong>
                <div style={mutedStyle}>Paste or upload images, then ask Hermes to mediate across the selected Paperclip context.</div>
              </div>
              <textarea
                disabled={isSending}
                style={textAreaStyle}
                value={composer.text}
                placeholder="Ask Hermes to compare delivery risk, summarize project state, or reason over attached images…"
                onChange={(event) => setComposer((current) => ({ ...current, text: event.target.value }))}
              />
              <div style={mutedStyle}>
                {composer.text.length}/{bootstrapData.config.maxMessageChars} characters
              </div>
              {composerError ? <div style={errorStyle}>{composerError}</div> : null}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <label style={{ ...buttonStyle, opacity: isSending ? 0.6 : 1 }}>
                  + Add image
                  <input disabled={isSending} type="file" accept={SAFE_INLINE_IMAGE_MIME_TYPES.join(",")} multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => void addFiles(event.target.files)} />
                </label>
                <button
                  type="submit"
                  style={{ ...primaryButtonStyle, opacity: isSending || composer.text.trim().length > bootstrapData.config.maxMessageChars ? 0.7 : 1 }}
                  disabled={isSending || composer.text.trim().length > bootstrapData.config.maxMessageChars}
                >
                  {isSending ? "Sending…" : "Send"}
                </button>
                {selectedThreadId ? (
                  <button type="button" style={{ ...buttonStyle, opacity: isSending ? 0.6 : 1 }} disabled={isSending} onClick={() => void handleRetry()}>Retry last failed turn</button>
                ) : null}
                {selectedThreadId ? (
                  <button type="button" style={{ ...buttonStyle, opacity: isSending ? 0.6 : 1 }} disabled={isSending} onClick={() => void archiveThread({ companyId, threadId: selectedThreadId }).then(() => bootstrap.refresh())}>Archive</button>
                ) : null}
              </div>
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

            {(streamStatus.length > 0 || streamText) ? (
              <div style={cardStyle} aria-live="polite">
                <strong>Live stream</strong>
                {streamText ? <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, marginTop: "8px" }}>{streamText}</div> : null}
                {streamStatus.length > 0 ? (
                  <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                    {streamStatus.map((item) => <li key={item} style={mutedStyle}>{item}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {selectedThreadId && detail.loading ? <div style={cardStyle}>Loading thread…</div> : null}
            {selectedThreadId && detail.error ? <div style={errorStyle}>Thread error: {detail.error.message}</div> : null}
            <WarningList warnings={detailData?.warnings ?? []} />

            {detailData ? (
              <div style={{ display: "grid", gap: "12px" }}>
                <div style={{ ...cardStyle, display: "grid", gap: "8px" }}>
                  <strong>{detailData.thread.title}</strong>
                  <div style={mutedStyle}>Hermes profile {detailData.thread.hermes.profileId} · {detailData.thread.hermes.provider} / {detailData.thread.hermes.model}</div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <span style={chipStyle}>{scopeSummary(detailData.thread.scope)}</span>
                    {detailData.thread.metadata.gatewayMode ? <span style={chipStyle}>Gateway {detailData.thread.metadata.gatewayMode}</span> : null}
                    {detailData.thread.metadata.continuityStrategy ? <span style={chipStyle}>Continuity {detailData.thread.metadata.continuityStrategy}</span> : null}
                    {detailData.thread.metadata.lastErrorCode ? <span style={chipStyle}>Last error {detailData.thread.metadata.lastErrorCode}</span> : null}
                    {detailData.context.selectedAgents.map((agent) => <span key={agent.id} style={chipStyle}>{agent.name}</span>)}
                  </div>
                  <div style={mutedStyle}>Catalog coverage: projects {detailData.context.catalog.projects.loaded}, issues {detailData.context.catalog.issues.loaded}, agents {detailData.context.catalog.agents.loaded}</div>
                  {detailData.thread.metadata.continuitySummary ? <div style={mutedStyle}>Older context: {detailData.thread.metadata.continuitySummary}</div> : null}
                </div>
                {detailData.messages.map((message) => <MessageCard key={message.messageId} message={message} />)}
              </div>
            ) : (
              <div style={cardStyle}>
                <strong>Start a thread</strong>
                <div style={mutedStyle}>Create a thread or send a scoped message to initialize one.</div>
              </div>
            )}
          </div>
        </div>
      ) : null}
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
  const threadCount = bootstrap.data?.threads.length ?? 0;
  return (
    <a href={pluginRoute(host.companyPrefix)} style={{ ...accentCardStyle, display: "grid", gap: "8px", textDecoration: "none", color: "inherit" }}>
      <strong>CEO Master Chat</strong>
      <span style={mutedStyle}>Primary operator console for this company. Open Hermes chat, review active threads, and steer execution fast.</span>
      {companyId ? <span style={chipStyle}>{threadCount} active threads</span> : <span style={chipStyle}>Open from a company</span>}
    </a>
  );
}

export function MasterChatDashboardWidget(_props: PluginWidgetProps) {
  const host = useHostContext();
  const companyId = host.companyId ?? "";
  const bootstrap = usePluginData<BootstrapData>(DATA_KEYS.bootstrap, { companyId });

  if (!companyId) return <div style={cardStyle}>Open a company to use Master Chat.</div>;
  if (bootstrap.loading) return <div style={cardStyle}>Loading Master Chat overview…</div>;
  if (bootstrap.error) return <div style={errorStyle}>Master Chat error: {bootstrap.error.message}</div>;

  return (
    <div style={{ ...accentCardStyle, display: "grid", gap: "12px" }}>
      <strong>CEO Master Chat</strong>
      <div style={mutedStyle}>Fastest way to talk to the company control plane, scope the discussion, and move from question to action.</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <span style={chipStyle}>{bootstrap.data?.threads.length ?? 0} active threads</span>
        <span style={chipStyle}>{bootstrap.data?.agents.length ?? 0} available agents</span>
      </div>
      {bootstrap.data?.threads?.length ? (
        <div style={{ display: "grid", gap: "6px" }}>
          {bootstrap.data.threads.slice(0, 3).map((thread) => (
            <div key={thread.threadId} style={{ ...cardStyle, padding: "10px" }}>
              <strong style={{ fontSize: "13px" }}>{thread.title}</strong>
              <div style={mutedStyle}>{thread.scopeLabel}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div style={mutedStyle}>Default skills: {(bootstrap.data?.defaults.skills.enabled ?? []).join(", ") || "none"}</div>
      {bootstrap.data?.warnings?.length ? <div style={mutedStyle}>Warnings: {bootstrap.data.warnings.length}</div> : null}
      <a href={pluginRoute(host.companyPrefix)} style={{ ...primaryButtonStyle, textAlign: "center", textDecoration: "none" }}>
        Open CEO Master Chat
      </a>
    </div>
  );
}

export function MasterChatToolbarButton() {
  const host = useHostContext();
  return (
    <a
      href={pluginRoute(host.companyPrefix)}
      style={{ ...primaryButtonStyle, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      Master Chat
    </a>
  );
}

export function MasterChatLauncherModal() {
  const host = useHostContext();
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <div style={accentCardStyle}>
        <strong>CEO Master Chat</strong>
        <div style={{ ...mutedStyle, marginTop: "8px" }}>
          This is the fastest way into the Hermes-mediated operator surface. Open the full chat to scope work across company, project, issue, and agent context.
        </div>
      </div>
      <a
        href={pluginRoute(host.companyPrefix)}
        style={{ ...primaryButtonStyle, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        Open full Master Chat
      </a>
      <ChatSurface forcedIssueId={host.entityType === "issue" ? host.entityId ?? undefined : undefined} />
    </div>
  );
}
