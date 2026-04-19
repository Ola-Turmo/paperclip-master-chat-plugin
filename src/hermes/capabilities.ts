import { spawn } from "node:child_process";
import type { MasterChatPluginConfig, SkillPolicy } from "../types.js";
import { armProcessTimeout } from "../process.js";

export interface HermesCapabilityInventory {
  availableSkills: string[];
  enabledToolsets: string[];
}

export interface SanitizedHermesCapabilities {
  skillPolicy: SkillPolicy;
  warnings: string[];
}

type CacheEntry = {
  expiresAt: number;
  inventory: HermesCapabilityInventory;
};

const CACHE_TTL_MS = 60_000;
const capabilityCache = new Map<string, CacheEntry>();

function cacheKey(config: MasterChatPluginConfig | { hermesCommand: string; hermesWorkingDirectory?: string }): string {
  return `${config.hermesCommand}::${config.hermesWorkingDirectory ?? ""}`;
}

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;]*m/g, "").replace(/\r/g, "");
}

async function runHermesCommand(
  config: MasterChatPluginConfig | { hermesCommand: string; hermesWorkingDirectory?: string },
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(config.hermesCommand, args, {
      cwd: config.hermesWorkingDirectory || undefined,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const clearTimeouts = armProcessTimeout(child, timeoutMs, () => {
      reject(new Error(`Hermes capability probe timed out after ${timeoutMs}ms`));
    });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeouts();
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeouts();
      if (code === 0) {
        resolve(stripAnsi(`${stdout}\n${stderr}`));
        return;
      }
      reject(new Error(`Hermes capability probe exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

export function parseHermesSkillsList(output: string): string[] {
  const skills = new Set<string>();
  for (const line of stripAnsi(output).split("\n")) {
    const match = line.match(/^\s*│\s*([^│]+?)\s*│/u);
    if (!match) continue;
    const name = match[1]?.trim();
    if (!name || name === "Name" || /^Installed Skills$/i.test(name)) continue;
    skills.add(name);
  }
  return [...skills];
}

export function parseHermesToolsList(output: string): string[] {
  const toolsets = new Set<string>();
  for (const line of stripAnsi(output).split("\n")) {
    const match = line.match(/^\s*[✓✔]\s+enabled\s+([a-zA-Z0-9:_-]+)/u);
    if (match?.[1]) {
      toolsets.add(match[1]);
    }
  }
  return [...toolsets];
}

export async function loadHermesCapabilityInventory(
  config: MasterChatPluginConfig | { hermesCommand: string; hermesWorkingDirectory?: string; gatewayRequestTimeoutMs?: number },
): Promise<HermesCapabilityInventory> {
  const key = cacheKey(config);
  const now = Date.now();
  const cached = capabilityCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.inventory;
  }

  const timeoutMs = Math.max(2_000, Math.min(config.gatewayRequestTimeoutMs ?? 10_000, 10_000));
  const [skillsOutput, toolsOutput] = await Promise.all([
    runHermesCommand(config, ["skills", "list"], timeoutMs),
    runHermesCommand(config, ["tools", "list"], timeoutMs),
  ]);

  const inventory = {
    availableSkills: parseHermesSkillsList(skillsOutput),
    enabledToolsets: parseHermesToolsList(toolsOutput),
  } satisfies HermesCapabilityInventory;
  capabilityCache.set(key, { inventory, expiresAt: now + CACHE_TTL_MS });
  return inventory;
}

export function sanitizeSkillPolicy(
  requested: SkillPolicy,
  inventory?: HermesCapabilityInventory,
): SanitizedHermesCapabilities {
  if (!inventory) {
    const strippedSkills = requested.enabled.length;
    const strippedToolsets = requested.toolsets.length;
    return {
      skillPolicy: {
        enabled: [],
        disabled: [...requested.disabled],
        toolsets: [],
      },
      warnings: [
        ...(strippedSkills > 0 ? [`Skipped ${strippedSkills} Hermes skill preference(s) because host capabilities could not be probed.`] : []),
        ...(strippedToolsets > 0 ? [`Skipped ${strippedToolsets} Hermes toolset preference(s) because host capabilities could not be probed.`] : []),
      ],
    };
  }

  const availableSkills = new Set(inventory.availableSkills);
  const enabledToolsets = new Set(inventory.enabledToolsets);

  const supportedSkills = requested.enabled.filter((skill) => availableSkills.has(skill));
  const supportedToolsets = requested.toolsets.filter((toolset) => enabledToolsets.has(toolset));

  return {
    skillPolicy: {
      enabled: supportedSkills,
      disabled: [...requested.disabled],
      toolsets: supportedToolsets,
    },
    warnings: [
      ...(requested.enabled.length > supportedSkills.length
        ? [`Skipped ${requested.enabled.length - supportedSkills.length} unavailable Hermes skill preference(s).`]
        : []),
      ...(requested.toolsets.length > supportedToolsets.length
        ? [`Skipped ${requested.toolsets.length - supportedToolsets.length} unavailable Hermes toolset preference(s).`]
        : []),
    ],
  };
}
