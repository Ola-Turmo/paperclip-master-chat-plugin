import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function shellOutput(command, args = []) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

const hermesCommand = shellOutput("bash", ["-lc", "command -v hermes || true"]);
const hermesVersion = hermesCommand ? shellOutput(hermesCommand, ["--version"]) : "";
const hermesProfiles = hermesCommand ? shellOutput(hermesCommand, ["profile", "list"]) : "";
const activeProfileLine = hermesProfiles
  .split("\n")
  .map((line) => line.trim())
  .find((line) => line.startsWith("◆"));
const activeProfile = activeProfileLine ? activeProfileLine.replace(/^◆\s*/, "").split(/\s{2,}/)[0] : "";
const activeModel = activeProfileLine ? activeProfileLine.replace(/^◆\s*/, "").split(/\s{2,}/)[1] ?? "" : "";
const hermesRepo = existsSync("/root/hermes-agent") ? "/root/hermes-agent" : null;
const paperclipRepo = existsSync("/root/work/paperclip") ? "/root/work/paperclip" : null;
const pluginInstallCommand = paperclipRepo
  ? `cd ${paperclipRepo} && pnpm paperclipai plugin install ${repoRoot}`
  : null;

const status = {
  repoRoot,
  hermesCommand: hermesCommand || null,
  hermesVersion: hermesVersion || null,
  hermesActiveProfile: activeProfile || null,
  hermesActiveModel: activeModel || null,
  hermesRepo,
  paperclipRepo,
  hermesWebUi8787: await checkPort(8787),
  hermesApi8642: await checkPort(8642),
  recommendedConfig: {
    gatewayMode: "auto",
    hermesCommand: hermesCommand || "hermes",
    hermesWorkingDirectory: hermesRepo || "",
    hermesBaseUrl: "",
    defaultProfileId: activeProfile || "paperclip-master",
    defaultProvider: activeProfile ? "auto" : "openrouter",
    defaultModel: activeModel || "anthropic/claude-sonnet-4",
    defaultEnabledSkills: [],
    defaultToolsets: ["web", "file", "vision"],
  },
  pluginInstallCommand,
};

console.log("Paperclip Master Chat VPS reuse check\n");
console.log(JSON.stringify(status, null, 2));

if (pluginInstallCommand) {
  console.log("\nRecommended local Paperclip install command:");
  console.log(pluginInstallCommand);
}
