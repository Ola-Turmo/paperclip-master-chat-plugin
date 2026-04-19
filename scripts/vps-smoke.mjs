import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paperclipRepo = process.env.PAPERCLIP_REPO || "/root/work/paperclip";
const paperclipBaseUrl = process.env.PAPERCLIP_BASE_URL || "http://127.0.0.1:3100";
const pluginKey = process.env.PAPERCLIP_PLUGIN_KEY || "paperclip-master-chat-plugin";
const hermesCommand = process.env.MASTER_CHAT_HERMES_COMMAND || "/usr/local/bin/hermes";
const hermesCwd = process.env.MASTER_CHAT_HERMES_CWD || "/root/hermes-agent";
const adapterPort = Number(process.env.MASTER_CHAT_ADAPTER_PORT || (8800 + Math.floor(Math.random() * 200)));
const adapterHost = process.env.MASTER_CHAT_ADAPTER_HOST || "127.0.0.1";
const adapterToken = process.env.MASTER_CHAT_ADAPTER_TOKEN || `smoke-${Date.now()}`;

function log(step, detail) {
  console.log(`[vps:smoke] ${step}${detail ? `: ${detail}` : ""}`);
}

function fail(message) {
  throw new Error(message);
}

function isTransientSmokeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("\"TIMEOUT\"")
    || message.includes("502 Bad Gateway")
    || message.includes("503 Service Unavailable")
    || message.includes("404 Not Found: {\"error\":\"Plugin not found\"}")
  );
}

function assertRepoExists(repoPath, label) {
  if (!existsSync(repoPath)) fail(`${label} not found at ${repoPath}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return data;
}

async function ensurePaperclipHealthy() {
  const health = await fetchJson(`${paperclipBaseUrl}/api/health`, { method: "GET", headers: {} });
  if (health.status !== "ok") fail(`Paperclip health check returned unexpected payload: ${JSON.stringify(health)}`);
  return health;
}

async function listPlugins() {
  return await fetchJson(`${paperclipBaseUrl}/api/plugins`, { method: "GET", headers: {} });
}

async function ensurePluginInstalled() {
  assertRepoExists(paperclipRepo, "Paperclip repo");
  log("install", `Refreshing ${pluginKey} in ${paperclipRepo}`);
  execFileSync("pnpm", ["paperclipai", "plugin", "uninstall", pluginKey, "--force"], { cwd: paperclipRepo, stdio: "inherit" });
  execFileSync("pnpm", ["paperclipai", "plugin", "install", repoRoot], { cwd: paperclipRepo, stdio: "inherit" });
  const plugins = await listPlugins();
  const plugin = plugins.find((entry) => entry.pluginKey === pluginKey);
  if (!plugin) fail(`Plugin ${pluginKey} was not found after install`);
  return plugin;
}

async function waitForPluginReady(attempts = 40) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const plugins = await listPlugins();
      const plugin = plugins.find((entry) => entry.pluginKey === pluginKey);
      if (plugin?.status === "ready") return plugin;
    } catch {}
    await delay(500);
  }
  fail(`Timed out waiting for plugin ${pluginKey} to become ready`);
}

async function getPluginConfig() {
  try {
    return await fetchJson(`${paperclipBaseUrl}/api/plugins/${pluginKey}/config`, { method: "GET", headers: {} });
  } catch (error) {
    if (String(error).includes("404")) return null;
    throw error;
  }
}

async function setPluginConfig(configJson) {
  return await fetchJson(`${paperclipBaseUrl}/api/plugins/${pluginKey}/config`, {
    method: "POST",
    body: JSON.stringify({ configJson }),
  });
}

async function firstCompanyId() {
  const companies = await fetchJson(`${paperclipBaseUrl}/api/companies`, { method: "GET", headers: {} });
  const company = companies.find((entry) => entry.status === "active") ?? companies[0];
  if (!company?.id) fail("No company found for smoke test");
  return company.id;
}

const baseVerifiedConfig = {
  gatewayMode: "cli",
  hermesCommand,
  hermesWorkingDirectory: hermesCwd,
  defaultProfileId: "default",
  defaultProvider: "auto",
  defaultModel: "MiniMax-M2.7",
  defaultEnabledSkills: [],
  defaultToolsets: ["web", "file", "vision"],
  enableActivityLogging: true,
};

async function sendSmokeTurn(mode, companyId) {
  const requestId = `vps-smoke-${mode}-${Date.now()}`;
  const sendResult = await fetchJson(`${paperclipBaseUrl}/api/plugins/${pluginKey}/actions/send-message`, {
    method: "POST",
    body: JSON.stringify({
      companyId,
      params: {
        companyId,
        requestId,
        text: "Reply with the single word READY.",
      },
    }),
  });

  const threadId = sendResult?.data?.threadId;
  if (!threadId) fail(`Smoke turn for ${mode} returned no threadId`);

  const detail = await fetchJson(`${paperclipBaseUrl}/api/plugins/${pluginKey}/data/thread-detail`, {
    method: "POST",
    body: JSON.stringify({
      companyId,
      params: {
        companyId,
        threadId,
      },
    }),
  });

  const messages = detail?.data?.messages ?? [];
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const replyText = (assistant?.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (!replyText.includes("READY")) {
    fail(`Smoke turn for ${mode} did not return READY. Reply was: ${JSON.stringify(replyText)}`);
  }

  if (mode === "http" && sendResult?.data?.gatewayMode !== "http") {
    fail(`Smoke turn for http used unexpected gateway ${JSON.stringify(sendResult?.data?.gatewayMode)}`);
  }

  return {
    mode,
    threadId,
    messageId: sendResult?.data?.messageId,
    replyText,
    gatewayMode: sendResult?.data?.gatewayMode,
    continuationMode: sendResult?.data?.continuationMode,
  };
}

async function sendSmokeTurnWithRetry(mode, companyId, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await waitForPluginReady();
      return await sendSmokeTurn(mode, companyId);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientSmokeError(error)) {
        throw error;
      }
      log("retry", `${mode} smoke turn attempt ${attempt} failed transiently; retrying`);
      await delay(1_500 * attempt);
    }
  }
  throw lastError;
}

async function waitForHealth(url, attempts = 20) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  fail(`Timed out waiting for ${url}`);
}

async function startAdapter() {
  const child = spawn("node", ["./dist/adapter-service.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MASTER_CHAT_ADAPTER_TOKEN: adapterToken,
      MASTER_CHAT_HERMES_COMMAND: hermesCommand,
      MASTER_CHAT_HERMES_CWD: hermesCwd,
      MASTER_CHAT_ADAPTER_DEFAULT_PROFILE: "default",
      MASTER_CHAT_ADAPTER_DEFAULT_PROVIDER: "auto",
      MASTER_CHAT_ADAPTER_DEFAULT_MODEL: "MiniMax-M2.7",
      MASTER_CHAT_ADAPTER_PORT: String(adapterPort),
      MASTER_CHAT_ADAPTER_HOST: adapterHost,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  await waitForHealth(`http://${adapterHost}:${adapterPort}/health`);
  return {
    child,
    getLogs() {
      return { stdout, stderr };
    },
  };
}

async function stopAdapter(handle) {
  if (!handle) return;
  handle.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => handle.child.once("exit", resolve)),
    delay(2_000),
  ]);
}

async function main() {
  assertRepoExists(repoRoot, "Plugin repo");
  assertRepoExists(hermesCwd, "Hermes repo");
  assertRepoExists(paperclipRepo, "Paperclip repo");

  log("build", "Building plugin artifacts");
  execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" });

  log("health", "Checking Paperclip health");
  await ensurePaperclipHealthy();

  log("plugin", "Ensuring plugin is installed");
  const plugin = await ensurePluginInstalled();
  await waitForPluginReady();
  if (plugin.status !== "ready") fail(`Plugin ${pluginKey} is not ready (status=${plugin.status})`);

  const companyId = await firstCompanyId();
  const originalConfig = await getPluginConfig();
  const summary = { companyId, pluginId: plugin.id, runs: [] };
  let adapterHandle;

  try {
    log("cli", "Running CLI gateway smoke turn");
    await setPluginConfig({ ...baseVerifiedConfig, gatewayMode: "cli" });
    await waitForPluginReady();
    const cliConfig = await getPluginConfig();
    if (cliConfig?.configJson?.gatewayMode !== "cli") fail(`Expected cli config to persist, received ${JSON.stringify(cliConfig?.configJson)}`);
    await delay(1_000);
    summary.runs.push(await sendSmokeTurnWithRetry("cli", companyId));

    log("adapter", "Starting bundled HTTP adapter");
    adapterHandle = await startAdapter();

    log("http", "Running HTTP gateway smoke turn");
    await setPluginConfig({
      ...baseVerifiedConfig,
      gatewayMode: "http",
      hermesBaseUrl: `http://${adapterHost}:${adapterPort}`,
      hermesAuthToken: adapterToken,
      hermesAuthHeaderName: "authorization",
    });
    await waitForPluginReady();
    const httpConfig = await getPluginConfig();
    if (httpConfig?.configJson?.gatewayMode !== "http") fail(`Expected http config to persist, received ${JSON.stringify(httpConfig?.configJson)}`);
    await delay(1_000);
    summary.runs.push(await sendSmokeTurnWithRetry("http", companyId));

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await stopAdapter(adapterHandle);
    if (originalConfig?.configJson) {
      log("restore", "Restoring original plugin config");
      await setPluginConfig(originalConfig.configJson);
    } else {
      log("restore", "Restoring safe CLI config");
      await setPluginConfig({ ...baseVerifiedConfig, gatewayMode: "cli" });
    }
  }
}

main().catch((error) => {
  console.error(`[vps:smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
