import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { configError, timeoutError, unavailableError, upstreamError } from "../errors.js";
import { armProcessTimeout } from "../process.js";
import type {
  ImageAnalysis,
  HermesImageAnalysisRequest,
  HermesImageAnalysisResult,
  MasterChatPluginConfig,
} from "../types.js";

function safeFileStem(name: string): string {
  const stem = basename(name, extname(name)).replace(/[^A-Za-z0-9._-]+/gu, "-");
  return stem || "attachment";
}

function safeExt(name: string, mimeType: string): string {
  const fromName = extname(name).toLowerCase();
  if (fromName) return fromName;
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/png":
    default:
      return ".png";
  }
}

function truncateText(value: string | undefined, limit: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeFallbackReason(error: unknown, limit: number): string | undefined {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  return truncateText(raw, limit);
}

function normalizeDetails(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const details = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => truncateText(entry, Math.min(280, limit)))
    .filter((entry): entry is string => Boolean(entry));
  return details.length > 0 ? details.slice(0, 8) : undefined;
}

function extractJsonObject(raw: string): string | undefined {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return undefined;
  return raw.slice(first, last + 1);
}

export function buildImageAnalysisPrompt(maxChars: number): string {
  return [
    "You are analyzing a single image for Paperclip Master Chat.",
    "Describe the image carefully and extract any visible text.",
    "Return strict JSON only with this shape:",
    "{\"summary\": string, \"extractedText\": string, \"notableDetails\": string[]}",
    `Keep the combined text concise and under approximately ${maxChars} characters.`,
    "Do not include markdown fences or any prose outside the JSON object.",
  ].join("\n");
}

export function parseImageAnalysisResponse(
  raw: string,
  maxChars: number,
): HermesImageAnalysisResult {
  const normalized = raw.trim();
  const jsonCandidate = extractJsonObject(normalized);

  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
      const summary = truncateText(typeof parsed.summary === "string" ? parsed.summary : normalized, Math.min(1_200, maxChars));
      const extractedText = truncateText(
        typeof parsed.extractedText === "string" ? parsed.extractedText : "",
        maxChars,
      );
      return {
        status: "complete",
        summary,
        extractedText,
        notableDetails: normalizeDetails(parsed.notableDetails, maxChars),
      };
    } catch {
      // fall through to best-effort text parsing
    }
  }

  return {
    status: "complete",
    summary: truncateText(normalized, Math.min(1_200, maxChars)),
    extractedText: undefined,
    notableDetails: undefined,
  };
}

export function buildImageAnalysisFallbackText(analysis: ImageAnalysis | undefined, maxChars: number): string | undefined {
  if (!analysis || analysis.status !== "complete") return undefined;
  const lines = [
    analysis.summary ? `Vision summary: ${analysis.summary}` : undefined,
    analysis.extractedText ? `Extracted text:\n${analysis.extractedText}` : undefined,
    analysis.notableDetails && analysis.notableDetails.length > 0
      ? `Notable details: ${analysis.notableDetails.join("; ")}`
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  const combined = lines.join("\n");
  return truncateText(combined, maxChars);
}

export function buildMetadataFallbackAnalysis(input: {
  name: string;
  mimeType: string;
  altText?: string;
  maxChars: number;
  error?: unknown;
}): HermesImageAnalysisResult {
  const extractedText = truncateText(input.altText, Math.min(1_200, input.maxChars));
  const fallbackReason = normalizeFallbackReason(input.error, Math.min(400, input.maxChars));
  const summary = extractedText
    ? `Metadata-only image summary for ${input.name}: ${extractedText}`
    : `Metadata-only image summary for ${input.name} (${input.mimeType}). Detailed OCR/vision output was unavailable, so Paperclip retained the image for later hydration or re-analysis.`;
  const notableDetails = [
    `mime=${input.mimeType}`,
    "analysis=fallback-metadata",
    fallbackReason ? `reason=${fallbackReason}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    status: "complete",
    summary: truncateText(summary, Math.min(1_200, input.maxChars)),
    extractedText,
    notableDetails,
    errorMessage: fallbackReason,
    provider: "metadata-fallback",
    model: "metadata-fallback",
  };
}

function requireImageDataUrl(name: string, mimeType: string, dataUrl: string | undefined): RegExpMatchArray {
  if (!dataUrl) {
    throw configError(`Attachment '${name}' must include inline data for image analysis`);
  }
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/u);
  if (!match) {
    throw configError(`Attachment '${name}' must be a base64 data URL for image analysis`);
  }
  const mediaType = match[1];
  if (mediaType?.toLowerCase() !== mimeType.toLowerCase()) {
    throw configError(`Attachment '${name}' data URL type does not match '${mimeType}'`);
  }
  return match;
}

async function withTempImageFile<T>(
  request: HermesImageAnalysisRequest,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const match = requireImageDataUrl(
    request.attachment.name,
    request.attachment.mimeType,
    request.attachment.dataUrl,
  );
  const [, , encoded] = match;

  const dir = await mkdtemp(join(tmpdir(), "paperclip-master-chat-image-"));
  const filePath = join(
    dir,
    `${safeFileStem(request.attachment.name)}${safeExt(request.attachment.name, request.attachment.mimeType)}`,
  );

  try {
    await writeFile(filePath, Buffer.from(encoded.replace(/\s+/gu, ""), "base64"));
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runHermesImageCommand(
  command: string,
  args: string[],
  cwd: string | undefined,
  timeoutMs: number,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const clearTimeouts = armProcessTimeout(child, timeoutMs, () => {
      reject(timeoutError(`Hermes image analysis timed out after ${timeoutMs}ms`));
    });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeouts();
      reject(unavailableError(`Failed to launch Hermes CLI command '${command}'`, error));
    });

    child.on("close", (code) => {
      clearTimeouts();
      if (code === 0) {
        resolve(`${stdout}\n${stderr}`.trim());
        return;
      }
      reject(upstreamError(`Hermes image analysis exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

export async function analyzeImageViaCli(
  config: MasterChatPluginConfig,
  request: HermesImageAnalysisRequest,
): Promise<HermesImageAnalysisResult> {
  try {
    if (!config.hermesCommand.trim()) {
      throw configError("Hermes CLI image analysis requires hermesCommand");
    }

    return await withTempImageFile(request, async (filePath) => {
      const args = [
        "-p",
        request.session.profileId || config.defaultProfileId || "default",
        "chat",
        "-Q",
        "--source",
        "tool",
        "--image",
        filePath,
        "-q",
        buildImageAnalysisPrompt(config.imageAnalysisMaxChars),
      ];

      const output = await runHermesImageCommand(
        config.hermesCommand,
        args,
        config.hermesWorkingDirectory || undefined,
        Math.max(10_000, config.gatewayRequestTimeoutMs),
      );

      return parseImageAnalysisResponse(output, config.imageAnalysisMaxChars);
    });
  } catch (error) {
    return buildMetadataFallbackAnalysis({
      name: request.attachment.name,
      mimeType: request.attachment.mimeType,
      altText: request.attachment.altText,
      maxChars: config.imageAnalysisMaxChars,
      error,
    });
  }
}

export async function buildImageAnalysisFromPath(
  filePath: string,
  config: {
    hermesCommand: string;
    hermesWorkingDirectory?: string;
    profileId: string;
    timeoutMs: number;
    maxChars: number;
  },
): Promise<HermesImageAnalysisResult> {
  const args = [
    "-p",
    config.profileId || "default",
    "chat",
    "-Q",
    "--source",
    "tool",
    "--image",
    filePath,
    "-q",
    buildImageAnalysisPrompt(config.maxChars),
  ];

  const output = await runHermesImageCommand(
    config.hermesCommand,
    args,
    config.hermesWorkingDirectory || undefined,
    config.timeoutMs,
  );
  return parseImageAnalysisResponse(output, config.maxChars);
}

export async function dataUrlToTempFile(
  attachment: HermesImageAnalysisRequest["attachment"],
): Promise<{ dir: string; filePath: string }> {
  const match = requireImageDataUrl(attachment.name, attachment.mimeType, attachment.dataUrl);
  const [, , encoded] = match;

  const dir = await mkdtemp(join(tmpdir(), "paperclip-master-chat-image-"));
  const filePath = join(
    dir,
    `${safeFileStem(attachment.name)}${safeExt(attachment.name, attachment.mimeType)}`,
  );
  await writeFile(filePath, Buffer.from(encoded.replace(/\s+/gu, ""), "base64"));
  return { dir, filePath };
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
