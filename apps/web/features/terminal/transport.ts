import { buildBrowserApiUrl, buildBrowserWsUrl } from "../api-transport";

export type MessageType =
  | "option-print"
  | "option-nbbo"
  | "equity-print"
  | "equity-candle"
  | "equity-join"
  | "flow-packet"
  | "smart-flow"
  | "smart-money"
  | "inferred-dark"
  | "classifier-hit"
  | "alert";

export type StreamMessage<T> = {
  type: MessageType;
  payload: T;
};

export type ReplayCursor = {
  ts: number;
  seq: number;
};

export type ReplayResponse<T> = {
  data: T[];
  next: ReplayCursor | null;
};

export const readErrorDetail = async (response: Response): Promise<string> => {
  const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const text = await response.text();
  if (!text) {
    return statusLabel;
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const trimmed = text.trimStart();
  const truncated = text.length > 600 ? `${text.slice(0, 600)}...` : text;

  if (!contentType.includes("application/json")) {
    if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      return `${statusLabel}: received HTML response instead of JSON`;
    }
    return `${statusLabel}: ${truncated}`;
  }

  try {
    const payload = JSON.parse(text) as {
      detail?: string;
      error?: string;
      message?: string;
    };
    return payload.detail ?? payload.error ?? payload.message ?? `${statusLabel}: ${truncated}`;
  } catch {
    return `${statusLabel}: ${truncated}`;
  }
};

export const inferTracePrefix = (traceId: string): string => {
  const match = traceId.match(/^(.*)-\d+$/);
  return match ? match[1] : traceId;
};

export const extractTracePrefix = <T>(item: T): string | null => {
  const traceId = (item as { trace_id?: string }).trace_id;
  if (!traceId) {
    return null;
  }
  return inferTracePrefix(traceId);
};

export const extractReplaySource = <T>(item: T): string | null => {
  const prefix = extractTracePrefix(item);
  if (!prefix) {
    return null;
  }

  const normalized = prefix.toLowerCase();
  if (normalized.startsWith("synthetic")) {
    return "synthetic";
  }
  if (normalized.startsWith("databento")) {
    return "databento";
  }
  if (normalized.startsWith("alpaca")) {
    return "alpaca";
  }
  if (normalized.startsWith("ibkr")) {
    return "ibkr";
  }

  return prefix;
};

export const buildWsUrl = (path: string): string => {
  return buildBrowserWsUrl(path);
};

export const buildApiUrl = (path: string): string => {
  return buildBrowserApiUrl(path);
};
