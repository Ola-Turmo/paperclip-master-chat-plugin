import type { MasterChatErrorCode } from "./types.js";

export class MasterChatError extends Error {
  readonly code: MasterChatErrorCode;
  readonly retryable: boolean;

  constructor(code: MasterChatErrorCode, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "MasterChatError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export function validationError(message: string): MasterChatError {
  return new MasterChatError("validation", message, { retryable: false });
}

export function authorizationError(message: string): MasterChatError {
  return new MasterChatError("authorization", message, { retryable: false });
}

export function notFoundError(message: string): MasterChatError {
  return new MasterChatError("not_found", message, { retryable: false });
}

export function configError(message: string): MasterChatError {
  return new MasterChatError("config", message, { retryable: false });
}

export function concurrencyError(message: string): MasterChatError {
  return new MasterChatError("concurrency", message, { retryable: true });
}

export function timeoutError(message: string, cause?: unknown): MasterChatError {
  return new MasterChatError("timeout", message, { retryable: true, cause });
}

export function unavailableError(message: string, cause?: unknown): MasterChatError {
  return new MasterChatError("unavailable", message, { retryable: true, cause });
}

export function upstreamError(message: string, cause?: unknown): MasterChatError {
  return new MasterChatError("upstream", message, { retryable: true, cause });
}

export function normalizeMasterChatError(error: unknown): MasterChatError {
  if (error instanceof MasterChatError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) return timeoutError(message, error);
  if (/not found/i.test(message)) return notFoundError(message);
  if (/forbidden|denied|unauthorized/i.test(message)) return authorizationError(message);
  if (/invalid|required|attachment|companyId|threadId/i.test(message)) return validationError(message);
  return new MasterChatError("unknown", message, { retryable: true, cause: error });
}
