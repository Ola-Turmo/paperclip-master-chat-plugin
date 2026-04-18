import type { PluginContext } from "@paperclipai/plugin-sdk";
import type {
  AvailableContextOption,
  MasterChatPluginConfig,
  ScopeContextSnapshot,
  ThreadScope,
} from "../types.js";

function toOption(entry: { id: string; name?: string | null; title?: string | null; status?: string | null; description?: string | null }): AvailableContextOption {
  return {
    id: entry.id,
    name: entry.name ?? entry.title ?? entry.id,
    status: entry.status ?? null,
    description: entry.description ?? null,
  };
}

export async function loadCompanyScopedOptions(ctx: PluginContext, companyId: string) {
  const [companies, projects, issues, agents] = await Promise.all([
    ctx.companies.list({ limit: 200, offset: 0 }),
    ctx.projects.list({ companyId, limit: 200, offset: 0 }),
    ctx.issues.list({ companyId, limit: 200, offset: 0 }),
    ctx.agents.list({ companyId, limit: 200, offset: 0 }),
  ]);

  return {
    companies: companies.map((company) => toOption({ id: company.id, name: company.name, status: company.status })),
    projects: projects.map((project) => toOption({ id: project.id, name: project.name, status: project.status })),
    issues: issues.map((issue) => toOption({ id: issue.id, title: issue.title, status: issue.status, description: issue.description ?? null })),
    agents: agents.map((agent) => toOption({ id: agent.id, name: agent.name, status: agent.status })),
  };
}

export function buildScopeContextSnapshot(input: {
  scope: ThreadScope;
  companies: AvailableContextOption[];
  projects: AvailableContextOption[];
  issues: AvailableContextOption[];
  agents: AvailableContextOption[];
}): ScopeContextSnapshot {
  const { scope, companies, projects, issues, agents } = input;
  return {
    company: companies.find((company) => company.id === scope.companyId),
    project: scope.projectId ? projects.find((project) => project.id === scope.projectId) : undefined,
    linkedIssue: scope.linkedIssueId ? issues.find((issue) => issue.id === scope.linkedIssueId) : undefined,
    selectedAgents: agents.filter((agent) => scope.selectedAgentIds.includes(agent.id)),
    issueCount: issues.length,
    agentCount: agents.length,
    projectCount: projects.length,
  };
}

export function buildDefaultScope(_config: MasterChatPluginConfig, companyId: string): ThreadScope {
  return {
    companyId,
    projectId: undefined,
    linkedIssueId: undefined,
    selectedAgentIds: [],
    mode: "company_wide",
  };
}

export function buildToolDescriptors(config: MasterChatPluginConfig) {
  const pluginTools = config.availablePluginTools.map((toolName) => ({
    name: toolName,
    description: `Allowed Paperclip/plugin tool: ${toolName}`,
    kind: toolName.startsWith("paperclip.") ? "paperclip" as const : "plugin" as const,
  }));

  const hermesTools = config.defaultToolsets.map((toolset) => ({
    name: toolset,
    description: `Hermes toolset ${toolset}`,
    kind: "hermes" as const,
  }));

  return [...pluginTools, ...hermesTools];
}
