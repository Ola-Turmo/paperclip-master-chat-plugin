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

const VISION_FAILURE_PATTERNS = [
  /vision analysis failed/iu,
  /vision api credits/iu,
  /credits are low/iu,
  /402 error/iu,
  /could(?:n't| not) be processed/iu,
  /unable to visually analy[sz]e/iu,
  /model.*does not support images/iu,
  /insufficient credits/iu,
  /no image understanding/iu,
];

export function looksLikeVisionFailure(raw: string): boolean {
  const normalized = raw.trim();
  if (!normalized) return true;
  return VISION_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
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

async function runTesseractOcr(
  filePath: string,
  timeoutMs: number,
): Promise<string | undefined> {
  return await new Promise((resolve, reject) => {
    const child = spawn("tesseract", [filePath, "stdout", "--psm", "6"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const clearTimeouts = armProcessTimeout(child, Math.max(5_000, timeoutMs), () => {
      reject(timeoutError(`Local OCR fallback timed out after ${Math.max(5_000, timeoutMs)}ms`));
    });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeouts();
      reject(unavailableError("Failed to launch local OCR fallback 'tesseract'", error));
    });

    child.on("close", (code) => {
      clearTimeouts();
      if (code === 0 || (code === 1 && stdout.trim())) {
        resolve(truncateText(stdout.replace(/\r/g, "").trim(), 8_000));
        return;
      }
      reject(upstreamError(`Local OCR fallback exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function buildLocalOcrFallback(
  filePath: string,
  input: {
    name: string;
    mimeType: string;
    altText?: string;
    maxChars: number;
    timeoutMs: number;
    reason?: unknown;
  },
): Promise<HermesImageAnalysisResult | undefined> {
  const extractedText = await runTesseractOcr(filePath, input.timeoutMs).catch(() => undefined);
  const normalizedText = truncateText(extractedText, input.maxChars);
  const fallbackReason = normalizeFallbackReason(input.reason, Math.min(400, input.maxChars));
  const altText = truncateText(input.altText, Math.min(1_200, input.maxChars));

  if (!normalizedText && !altText) {
    return undefined;
  }

  const summaryBase = normalizedText
    ? `Local OCR fallback extracted text from ${input.name} after Hermes vision analysis was unavailable.`
    : `Local OCR fallback could not extract text from ${input.name}, but metadata was retained for later re-analysis.`;

  return {
    status: "complete",
    summary: truncateText(summaryBase, Math.min(1_200, input.maxChars)),
    extractedText: normalizedText ?? altText,
    notableDetails: [
      `mime=${input.mimeType}`,
      normalizedText ? "analysis=tesseract-fallback" : "analysis=metadata-fallback",
      fallbackReason ? `reason=${fallbackReason}` : undefined,
    ].filter((entry): entry is string => Boolean(entry)),
    errorMessage: fallbackReason,
    provider: normalizedText ? "tesseract-fallback" : "metadata-fallback",
    model: normalizedText ? "tesseract" : "metadata-fallback",
  };
}

async function analyzeImageFileWithFallback(
  filePath: string,
  input: {
    hermesCommand: string;
    hermesWorkingDirectory?: string;
    profileId: string;
    timeoutMs: number;
    maxChars: number;
    name: string;
    mimeType: string;
    altText?: string;
  },
): Promise<HermesImageAnalysisResult> {
  const args = [
    "-p",
    input.profileId || "default",
    "chat",
    "-Q",
    "--source",
    "tool",
    "--image",
    filePath,
    "-q",
    buildImageAnalysisPrompt(input.maxChars),
  ];

  try {
    const output = await runHermesImageCommand(
      input.hermesCommand,
      args,
      input.hermesWorkingDirectory || undefined,
      input.timeoutMs,
    );

    if (!looksLikeVisionFailure(output)) {
      return parseImageAnalysisResponse(output, input.maxChars);
    }

    const ocrFallback = await buildLocalOcrFallback(filePath, {
      name: input.name,
      mimeType: input.mimeType,
      altText: input.altText,
      maxChars: input.maxChars,
      timeoutMs: Math.min(30_000, input.timeoutMs),
      reason: output,
    });
    if (ocrFallback) return ocrFallback;

    return buildMetadataFallbackAnalysis({
      name: input.name,
      mimeType: input.mimeType,
      altText: input.altText,
      maxChars: input.maxChars,
      error: output,
    });
  } catch (error) {
    const ocrFallback = await buildLocalOcrFallback(filePath, {
      name: input.name,
      mimeType: input.mimeType,
      altText: input.altText,
      maxChars: input.maxChars,
      timeoutMs: Math.min(30_000, input.timeoutMs),
      reason: error,
    });
    if (ocrFallback) return ocrFallback;

    return buildMetadataFallbackAnalysis({
      name: input.name,
      mimeType: input.mimeType,
      altText: input.altText,
      maxChars: input.maxChars,
      error,
    });
  }
}

export async function analyzeImageViaCli(
  config: MasterChatPluginConfig,
  request: HermesImageAnalysisRequest,
): Promise<HermesImageAnalysisResult> {
  if (!config.hermesCommand.trim()) {
    return buildMetadataFallbackAnalysis({
      name: request.attachment.name,
      mimeType: request.attachment.mimeType,
      altText: request.attachment.altText,
      maxChars: config.imageAnalysisMaxChars,
      error: configError("Hermes CLI image analysis requires hermesCommand"),
    });
  }

  return await withTempImageFile(request, async (filePath) => await analyzeImageFileWithFallback(filePath, {
    hermesCommand: config.hermesCommand,
    hermesWorkingDirectory: config.hermesWorkingDirectory || undefined,
    profileId: request.session.profileId || config.defaultProfileId || "default",
    timeoutMs: Math.max(10_000, config.gatewayRequestTimeoutMs),
    maxChars: config.imageAnalysisMaxChars,
    name: request.attachment.name,
    mimeType: request.attachment.mimeType,
    altText: request.attachment.altText,
  }));
}

function inferMimeTypeFromPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".png":
    default:
      return "image/png";
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
  return await analyzeImageFileWithFallback(filePath, {
    hermesCommand: config.hermesCommand,
    hermesWorkingDirectory: config.hermesWorkingDirectory || undefined,
    profileId: config.profileId,
    timeoutMs: config.timeoutMs,
    maxChars: config.maxChars,
    name: basename(filePath),
    mimeType: inferMimeTypeFromPath(filePath),
  });
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
