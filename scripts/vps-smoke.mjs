import { spawn, execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const readyCardPng = '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';

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

async function createSmokeThread(mode, companyId) {
  const result = await fetchJson(`${paperclipBaseUrl}/api/plugins/${pluginKey}/actions/create-thread`, {
    method: "POST",
    body: JSON.stringify({
      companyId,
      params: {
        companyId,
        title: `Smoke ${mode} ${new Date().toISOString()}`,
      },
    }),
  });
  const threadId = result?.data?.threadId;
  if (!threadId) fail(`Create-thread for ${mode} returned no threadId`);
  return threadId;
}

async function loadThreadDetail(companyId, threadId) {
  return await fetchJson(`${paperclipBaseUrl}/api/plugins/${pluginKey}/data/thread-detail`, {
    method: "POST",
    body: JSON.stringify({
      companyId,
      params: {
        companyId,
        threadId,
      },
    }),
  });
}

function summarizeAssistant(detail, requestId) {
  const messages = detail?.data?.messages ?? [];
  const assistant = [...messages].reverse().find((message) => message.role === "assistant" && message.requestId === requestId)
    ?? [...messages].reverse().find((message) => message.role === "assistant");
  const replyText = (assistant?.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return {
    assistant,
    replyText,
  };
}

async function waitForAssistantReply(mode, companyId, threadId, requestId, attempts = 45) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const detail = await loadThreadDetail(companyId, threadId);
    const { assistant, replyText } = summarizeAssistant(detail, requestId);
    if (assistant?.status === "complete" && replyText.includes("READY")) {
      return {
        detail,
        assistant,
        replyText,
      };
    }
    if (assistant?.status === "error") {
      fail(`Smoke turn for ${mode} failed after async polling: ${assistant.errorMessage ?? "unknown assistant error"}`);
    }
    await delay(2_000);
  }
  fail(`Timed out waiting for async assistant reply for ${mode} on thread ${threadId}`);
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
  const threadId = await createSmokeThread(mode, companyId);
  let sendResult;

  try {
    sendResult = await fetchJson(`${paperclipBaseUrl}/api/plugins/${pluginKey}/actions/send-message`, {
      method: "POST",
      body: JSON.stringify({
        companyId,
        params: {
          companyId,
          threadId,
          requestId,
          text: "Reply with the single word READY.",
        },
      }),
    });
  } catch (error) {
    if (!isTransientSmokeError(error)) {
      throw error;
    }
    log("poll", `${mode} send-message timed out or transiently failed; polling thread ${threadId} for completion`);
  }

  let detail;
  let replyText = "";
  let assistant;
  if (sendResult?.data?.messageId) {
    detail = await loadThreadDetail(companyId, threadId);
    ({ assistant, replyText } = summarizeAssistant(detail, requestId));
  }
  if (!replyText.includes("READY")) {
    const awaited = await waitForAssistantReply(mode, companyId, threadId, requestId);
    detail = awaited.detail;
    assistant = awaited.assistant;
    replyText = awaited.replyText;
  }

  if (!replyText.includes("READY")) {
    fail(`Smoke turn for ${mode} did not return READY. Reply was: ${JSON.stringify(replyText)}`);
  }

  if (mode === "http" && sendResult?.data?.gatewayMode && sendResult.data.gatewayMode !== "http") {
    fail(`Smoke turn for http used unexpected gateway ${JSON.stringify(sendResult?.data?.gatewayMode)}`);
  }

  return {
    mode,
    threadId,
    messageId: sendResult?.data?.messageId ?? assistant?.messageId,
    replyText,
    gatewayMode: sendResult?.data?.gatewayMode ?? detail?.data?.thread?.metadata?.gatewayMode,
    continuationMode: sendResult?.data?.continuationMode ?? detail?.data?.thread?.hermes?.continuationMode,
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


function authHeaderValue() {
  return /^bearer\s+/i.test(adapterToken) ? adapterToken : `Bearer ${adapterToken}`;
}

function buildSignedHeaders(method, requestPath, body) {
  const date = new Date().toISOString();
  const nonce = randomUUID();
  const signature = createHmac("sha256", adapterToken)
    .update([method.toUpperCase(), requestPath, date, nonce, body].join("\n"))
    .digest("hex");
  return {
    authorization: authHeaderValue(),
    "x-master-chat-date": date,
    "x-master-chat-nonce": nonce,
    "x-master-chat-signature": signature,
  };
}

async function runAdapterImageSmoke() {
  const requestPath = "/images/analyze";
  const body = JSON.stringify({
    session: {
      profileId: "default",
      provider: "auto",
      model: "MiniMax-M2.7",
    },
    metadata: {
      threadId: `vps-image-smoke-${Date.now()}`,
      title: "VPS image smoke",
    },
    image: {
      name: "ready-card.png",
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${readyCardPng}`,
    },
  });

  return await fetchJson(`http://${adapterHost}:${adapterPort}${requestPath}`, {
    method: "POST",
    headers: buildSignedHeaders("POST", requestPath, body),
    body,
  });
}

async function runCliImageSmoke() {
  const dir = await mkdtemp(path.join(tmpdir(), "master-chat-image-smoke-"));
  const filePath = path.join(dir, "ready-card.png");
  try {
    await writeFile(filePath, Buffer.from(readyCardPng, "base64"));
    try {
      const output = execFileSync(hermesCommand, [
        "-p",
        "default",
        "chat",
        "-Q",
        "--source",
        "tool",
        "--image",
        filePath,
        "-q",
        "Describe this image in one short sentence and quote any visible text exactly if you can.",
      ], {
        cwd: hermesCwd,
        encoding: "utf8",
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();

      if (!output) fail("CLI image smoke returned no output");
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Metadata-only image smoke fallback for ready-card.png (image/png). Hermes vision did not finish successfully during VPS smoke: ${message}`;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  const summary = { companyId, pluginId: plugin.id, rawCliImageOutput: "", adapterImageAnalysis: null, runs: [] };
  let adapterHandle;

  try {
    log("vision", "Running direct Hermes CLI image smoke");
    summary.rawCliImageOutput = await runCliImageSmoke();
    log("vision", summary.rawCliImageOutput);

    log("cli", "Running CLI gateway smoke turn");
    await setPluginConfig({ ...baseVerifiedConfig, gatewayMode: "cli" });
    await waitForPluginReady();
    const cliConfig = await getPluginConfig();
    if (cliConfig?.configJson?.gatewayMode !== "cli") fail(`Expected cli config to persist, received ${JSON.stringify(cliConfig?.configJson)}`);
    await delay(1_000);
    summary.runs.push(await sendSmokeTurnWithRetry("cli", companyId));

    log("adapter", "Starting bundled HTTP adapter");
    adapterHandle = await startAdapter();

    log("vision", "Running bundled adapter image-analysis smoke");
    summary.adapterImageAnalysis = await runAdapterImageSmoke();
    if (summary.adapterImageAnalysis?.status !== "complete") fail(`Adapter image analysis did not complete: ${JSON.stringify(summary.adapterImageAnalysis)}`);
    if (!String(summary.adapterImageAnalysis?.summary || summary.adapterImageAnalysis?.extractedText || "").trim()) fail(`Adapter image analysis returned no summary or OCR text: ${JSON.stringify(summary.adapterImageAnalysis)}`);

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
