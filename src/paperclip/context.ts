import type { PluginContext } from "@paperclipai/plugin-sdk";
import { notFoundError } from "../errors.js";
import type {
  AvailableContextOption,
  CompanyScopedOptions,
  ContextCollectionMeta,
  MasterChatPluginConfig,
  ScopeContextSnapshot,
  ThreadScope,
  ToolPolicy,
} from "../types.js";

function toOption(entry: { id: string; name?: string | null; title?: string | null; status?: string | null; description?: string | null }): AvailableContextOption {
  return {
    id: entry.id,
    name: entry.name ?? entry.title ?? entry.id,
    status: entry.status ?? null,
    description: entry.description ?? null,
  };
}

async function loadPagedCollection<T>(input: {
  label: string;
  pageSize: number;
  maxRecords: number;
  fetchPage: (params: { limit: number; offset: number }) => Promise<T[]>;
  map: (entry: T) => AvailableContextOption;
}): Promise<{ items: AvailableContextOption[]; meta: ContextCollectionMeta; warning?: string }> {
  const { label, pageSize, maxRecords, fetchPage, map } = input;
  const items: AvailableContextOption[] = [];
  let offset = 0;
  let truncated = false;

  while (items.length < maxRecords) {
    const remaining = maxRecords - items.length;
    const limit = Math.min(pageSize, remaining);
    const page = await fetchPage({ limit, offset });
    items.push(...page.map(map));
    offset += page.length;

    if (page.length < limit) {
      break;
    }

    if (items.length >= maxRecords) {
      truncated = true;
      break;
    }
  }

  const meta: ContextCollectionMeta = {
    loaded: items.length,
    pageSize,
    truncated,
  };

  return {
    items,
    meta,
    warning: truncated ? `${label} list truncated at ${items.length} records. Refine scope or raise maxCatalogRecords for full coverage.` : undefined,
  };
}

export async function loadCompanyScopedOptions(
  ctx: PluginContext,
  companyId: string,
  config: MasterChatPluginConfig,
): Promise<CompanyScopedOptions> {
  const pageSize = Math.max(25, config.scopePageSize || 200);
  const maxRecords = Math.max(pageSize, config.maxCatalogRecords || 1000);

  const [companies, projects, issues, agents] = await Promise.all([
    loadPagedCollection({
      label: "Company",
      pageSize,
      maxRecords,
      fetchPage: ({ limit, offset }) => ctx.companies.list({ limit, offset }),
      map: (company) => toOption({ id: company.id, name: company.name, status: company.status }),
    }),
    loadPagedCollection({
      label: "Project",
      pageSize,
      maxRecords,
      fetchPage: ({ limit, offset }) => ctx.projects.list({ companyId, limit, offset }),
      map: (project) => toOption({ id: project.id, name: project.name, status: project.status }),
    }),
    loadPagedCollection({
      label: "Issue",
      pageSize,
      maxRecords,
      fetchPage: ({ limit, offset }) => ctx.issues.list({ companyId, limit, offset }),
      map: (issue) => toOption({ id: issue.id, title: issue.title, status: issue.status, description: issue.description ?? null }),
    }),
    loadPagedCollection({
      label: "Agent",
      pageSize,
      maxRecords,
      fetchPage: ({ limit, offset }) => ctx.agents.list({ companyId, limit, offset }),
      map: (agent) => toOption({ id: agent.id, name: agent.name, status: agent.status }),
    }),
  ]);

  const warnings = [companies.warning, projects.warning, issues.warning, agents.warning].filter((value): value is string => Boolean(value));

  return {
    companies: companies.items,
    projects: projects.items,
    issues: issues.items,
    agents: agents.items,
    catalog: {
      companies: companies.meta,
      projects: projects.meta,
      issues: issues.meta,
      agents: agents.meta,
    },
    warnings,
  };
}

export function buildScopeContextSnapshot(input: {
  scope: ThreadScope;
  options: CompanyScopedOptions;
}): ScopeContextSnapshot {
  const { scope, options } = input;
  return {
    company: options.companies.find((company) => company.id === scope.companyId),
    project: scope.projectId ? options.projects.find((project) => project.id === scope.projectId) : undefined,
    linkedIssue: scope.linkedIssueId ? options.issues.find((issue) => issue.id === scope.linkedIssueId) : undefined,
    selectedAgents: options.agents.filter((agent) => scope.selectedAgentIds.includes(agent.id)),
    issueCount: options.catalog.issues.loaded,
    agentCount: options.catalog.agents.loaded,
    projectCount: options.catalog.projects.loaded,
    catalog: options.catalog,
    warnings: options.warnings,
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

export function validateScopeAgainstOptions(scope: ThreadScope, options: CompanyScopedOptions): void {
  if (!options.companies.some((company) => company.id === scope.companyId)) {
    throw notFoundError(`Company '${scope.companyId}' was not found or is not accessible to this plugin context`);
  }

  if (scope.projectId && !options.projects.some((project) => project.id === scope.projectId)) {
    throw notFoundError(`Project '${scope.projectId}' was not found in company '${scope.companyId}'`);
  }

  if (scope.linkedIssueId && !options.issues.some((issue) => issue.id === scope.linkedIssueId)) {
    throw notFoundError(`Issue '${scope.linkedIssueId}' was not found in company '${scope.companyId}'`);
  }

  const missingAgents = scope.selectedAgentIds.filter((agentId) => !options.agents.some((agent) => agent.id === agentId));
  if (missingAgents.length > 0) {
    throw notFoundError(`Agent selection includes unknown agent ids: ${missingAgents.join(", ")}`);
  }
}

export function buildToolDescriptors(toolPolicy: ToolPolicy) {
  const pluginTools = toolPolicy.allowedPluginTools.map((toolName) => ({
    name: toolName,
    description: `Allowed Paperclip/plugin tool: ${toolName}`,
    kind: toolName.startsWith("paperclip.") ? "paperclip" as const : "plugin" as const,
  }));

  const hermesTools = toolPolicy.allowedHermesToolsets.map((toolset) => ({
    name: toolset,
    description: `Hermes toolset ${toolset}`,
    kind: "hermes" as const,
  }));

  return [...pluginTools, ...hermesTools];
}
