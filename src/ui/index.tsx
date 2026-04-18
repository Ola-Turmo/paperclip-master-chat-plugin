import { useMemo, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
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
import { ACTION_KEYS, DATA_KEYS, PAGE_ROUTE } from "../constants.js";
import type {
  BootstrapData,
  ChatMessage,
  InlineImageAttachment,
  ThreadDetailData,
  ThreadSummary,
} from "../types.js";
import { scopeSummary } from "./view-model.js";

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
    source: "inline",
  };
}

function AttachmentPreview({ attachment, onRemove }: { attachment: InlineImageAttachment; onRemove?: (id: string) => void }) {
  return (
    <div style={{ ...cardStyle, display: "grid", gap: "8px", padding: "10px" }}>
      <img src={attachment.dataUrl} alt={attachment.altText ?? attachment.name} style={{ width: "100%", maxHeight: "160px", objectFit: "cover", borderRadius: "10px" }} />
      <div style={mutedStyle}>{attachment.name} · {attachment.mimeType}</div>
      {onRemove ? <button style={buttonStyle} onClick={() => onRemove(attachment.id)}>Remove</button> : null}
    </div>
  );
}

function ThreadRail({
  threads,
  selectedThreadId,
  onSelect,
  onCreate,
}: {
  threads: ThreadSummary[];
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
}) {
  return (
    <div style={{ ...cardStyle, display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Threads</strong>
        <button style={buttonStyle} onClick={onCreate}>New</button>
      </div>
      {threads.length === 0 ? <div style={mutedStyle}>No threads yet. Start a scoped chat from the composer.</div> : null}
      {threads.map((thread) => (
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
        return <div key={`${part.type}-${index}`} style={mutedStyle}>{part.status}{part.detail ? `: ${part.detail}` : ""}</div>;
      })}
    </div>
  );
}

function ScopePanel({
  bootstrap,
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
        <select style={inputStyle} value={selectedProjectId ?? ""} onChange={(event) => setSelectedProjectId(event.target.value || undefined)}>
          <option value="">All projects</option>
          {bootstrap.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label style={{ display: "grid", gap: "6px" }}>
        <span style={mutedStyle}>Linked issue</span>
        <select style={inputStyle} value={selectedIssueId ?? ""} onChange={(event) => setSelectedIssueId(event.target.value || undefined)}>
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
                style={{
                  ...buttonStyle,
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
                style={{
                  ...buttonStyle,
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
  const detail = usePluginData<ThreadDetailData>(DATA_KEYS.threadDetail, selectedThreadId ? { companyId, threadId: selectedThreadId } : undefined);
  const stream = usePluginStream(selectedThreadId ? `master-chat:${selectedThreadId}` : "master-chat:none", { companyId });

  const bootstrapData = bootstrap.data;
  const detailData = detail.data;

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
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next = await Promise.all(Array.from(files).filter((file) => file.type.startsWith("image/")).map(fileToAttachment));
    setComposer((current) => ({
      ...current,
      attachments: [...current.attachments, ...next],
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    const result = await sendMessage({
      companyId,
      threadId: selectedThreadId,
      text: composer.text,
      attachments: composer.attachments,
      scope: {
        projectId: selectedProjectId,
        linkedIssueId: forcedIssueId ?? selectedIssueId,
        selectedAgentIds,
      },
      skills: {
        enabled: effectiveSkills,
        toolsets: bootstrapData?.defaults.skills.toolsets ?? [],
      },
    }) as { threadId: string };
    setSelectedThreadId(result.threadId);
    setComposer(initialComposerState());
    await bootstrap.refresh();
    await detail.refresh();
    toast({ title: "Message sent", body: "Hermes completed the turn." });
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
        </div>
      </div>

      {bootstrap.loading ? <div style={cardStyle}>Loading bootstrap data…</div> : null}
      {bootstrap.error ? <div style={cardStyle}>Bootstrap error: {bootstrap.error.message}</div> : null}

      {bootstrapData ? (
        <div style={layoutStyle}>
          <ThreadRail
            threads={bootstrapData.threads}
            selectedThreadId={selectedThreadId}
            onSelect={setSelectedThreadId}
            onCreate={() => void handleCreateThread()}
          />

          <div style={{ display: "grid", gap: "16px" }}>
            <ScopePanel
              bootstrap={bootstrapData}
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
                style={textAreaStyle}
                value={composer.text}
                placeholder="Ask Hermes to compare delivery risk, summarize project state, or reason over attached images…"
                onChange={(event) => setComposer((current) => ({ ...current, text: event.target.value }))}
              />
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <label style={buttonStyle}>
                  + Add image
                  <input type="file" accept="image/*" multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => void addFiles(event.target.files)} />
                </label>
                <button type="submit" style={primaryButtonStyle}>Send</button>
                {selectedThreadId ? (
                  <button type="button" style={buttonStyle} onClick={() => void retryLastTurn({ companyId, threadId: selectedThreadId }).then(() => detail.refresh())}>Retry last turn</button>
                ) : null}
                {selectedThreadId ? (
                  <button type="button" style={buttonStyle} onClick={() => void archiveThread({ companyId, threadId: selectedThreadId }).then(() => bootstrap.refresh())}>Archive</button>
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

            {stream.lastEvent ? (
              <div style={cardStyle}>
                <strong>Live stream</strong>
                <div style={mutedStyle}>{JSON.stringify(stream.lastEvent)}</div>
              </div>
            ) : null}

            {selectedThreadId && detail.loading ? <div style={cardStyle}>Loading thread…</div> : null}
            {selectedThreadId && detail.error ? <div style={cardStyle}>Thread error: {detail.error.message}</div> : null}

            {detailData ? (
              <div style={{ display: "grid", gap: "12px" }}>
                <div style={{ ...cardStyle, display: "grid", gap: "8px" }}>
                  <strong>{detailData.thread.title}</strong>
                  <div style={mutedStyle}>Hermes profile {detailData.thread.hermes.profileId} · {detailData.thread.hermes.provider} / {detailData.thread.hermes.model}</div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <span style={chipStyle}>{scopeSummary(detailData.thread.scope)}</span>
                    {detailData.context.selectedAgents.map((agent) => <span key={agent.id} style={chipStyle}>{agent.name}</span>)}
                  </div>
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
  return (
    <a href={pluginRoute(host.companyPrefix)} style={{ ...cardStyle, display: "grid", gap: "6px", textDecoration: "none", color: "inherit" }}>
      <strong>Master Chat</strong>
      <span style={mutedStyle}>Open the Hermes-mediated chat surface for this company.</span>
    </a>
  );
}

export function MasterChatDashboardWidget(_props: PluginWidgetProps) {
  const host = useHostContext();
  const companyId = host.companyId ?? "";
  const bootstrap = usePluginData<BootstrapData>(DATA_KEYS.bootstrap, { companyId });

  if (!companyId) return <div style={cardStyle}>Open a company to use Master Chat.</div>;
  if (bootstrap.loading) return <div style={cardStyle}>Loading Master Chat overview…</div>;
  if (bootstrap.error) return <div style={cardStyle}>Master Chat error: {bootstrap.error.message}</div>;

  return (
    <div style={{ ...cardStyle, display: "grid", gap: "10px" }}>
      <strong>Master Chat</strong>
      <div style={mutedStyle}>Active threads: {bootstrap.data?.threads.length ?? 0}</div>
      <div style={mutedStyle}>Default skills: {(bootstrap.data?.defaults.skills.enabled ?? []).join(", ")}</div>
      <a href={pluginRoute(host.companyPrefix)} style={{ ...primaryButtonStyle, textAlign: "center", textDecoration: "none" }}>
        Open Master Chat
      </a>
    </div>
  );
}
