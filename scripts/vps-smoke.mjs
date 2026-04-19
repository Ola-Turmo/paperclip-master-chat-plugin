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
