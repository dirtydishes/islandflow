import type { EquityCandle, EquityPrintJoin, OptionNBBO } from "@islandflow/types";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

import { CANDLE_INTERVALS } from "../config";
import { decodeNewsText, formatOptionContractLabel } from "../format";
import { normalizeContractId } from "../state-helpers";

export type CandlestickSeries = ReturnType<IChartApi["addCandlestickSeries"]>;

export type EquityOverlayPoint = {
  ts: number;
  price: number;
  size: number;
  offExchangeFlag: boolean;
};

export type ChartCandle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

export const formatIntervalLabel = (intervalMs: number): string => {
  const match = CANDLE_INTERVALS.find((interval) => interval.ms === intervalMs);
  if (match) {
    return match.label;
  }
  if (intervalMs >= 60000) {
    return `${Math.round(intervalMs / 60000)}m`;
  }
  if (intervalMs >= 1000) {
    return `${Math.round(intervalMs / 1000)}s`;
  }
  return `${intervalMs}ms`;
};

export const toChartTime = (ts: number): UTCTimestamp => {
  return Math.floor(ts / 1000) as UTCTimestamp;
};

export type ChartTimeLike = number | string | { year: number; month: number; day: number };

export const chartTimeToMs = (value: ChartTimeLike): number | null => {
  if (typeof value === "number") {
    return Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object") {
    const { year, month, day } = value;
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      year >= 1970 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return Date.UTC(year, month - 1, day);
    }
  }

  return null;
};

export const toChartCandle = (candle: EquityCandle): ChartCandle => {
  return {
    time: toChartTime(candle.ts),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close
  };
};

export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

export const sampleToLimit = <T>(items: T[], limit: number): T[] => {
  if (items.length <= limit) {
    return items;
  }

  const safeLimit = Math.max(1, Math.floor(limit));
  const step = Math.ceil(items.length / safeLimit);
  const sampled: T[] = [];
  for (let idx = 0; idx < items.length; idx += step) {
    sampled.push(items[idx]);
  }

  return sampled;
};

export const formatPrice = (price: number): string => {
  if (!Number.isFinite(price)) {
    return "0.00";
  }
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export const formatSize = (size: number): string => {
  return size.toLocaleString();
};

export const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString();
};

export const formatConfidence = (value: number): string => `${Math.round(value * 100)}%`;

export const formatPct = (value: number): string => `${Math.round(value * 100)}%`;

export const formatUsd = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export const formatStrike = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
};

export const formatExpiryShort = (value: string): string | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return `${month}-${day}-${year.slice(2)}`;
};

export const formatContractLabel = (value: string): string => {
  const parsed = formatOptionContractLabel(value);
  if (parsed) {
    return `${parsed.ticker} ${parsed.strike} ${parsed.expiration}`;
  }
  const normalized = normalizeContractId(value);
  if (!normalized) {
    return "Unknown contract";
  }
  if (/^\d+$/.test(normalized)) {
    return `Instrument ${normalized}`;
  }
  return normalized;
};

export const formatDateTime = (ts: number): string => {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

export const sanitizeNewsHtml = (
  value: string
): { html: string; fallbackText: string; sanitized: boolean } => {
  const fallbackText = decodeNewsText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  try {
    const sanitized = value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\shref=(["'])javascript:[\s\S]*?\1/gi, ' href="#"')
      .replace(
        /<(?!\/?(p|div|section|article|span|strong|em|b|i|ul|ol|li|br|a|h1|h2|h3|h4|blockquote)\b)[^>]*>/gi,
        ""
      );
    return { html: sanitized, fallbackText, sanitized: true };
  } catch {
    return { html: "", fallbackText, sanitized: false };
  }
};

export const humanizeClassifierId = (value: string): string => {
  if (!value) {
    return "Classifier";
  }

  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
};

export const normalizeDirection = (value: string): "bullish" | "bearish" | "neutral" => {
  const normalized = value.toLowerCase();
  if (normalized === "bullish" || normalized === "bearish" || normalized === "neutral") {
    return normalized;
  }
  return "neutral";
};

export const parseNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

export const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

export const getJoinString = (join: EquityPrintJoin, key: string): string | null => {
  const value = join.features[key];
  return typeof value === "string" ? value : null;
};

export const getJoinNumber = (
  join: EquityPrintJoin,
  key: string,
  fallback = Number.NaN
): number => {
  return parseNumber(join.features[key], fallback);
};

export const getJoinBoolean = (join: EquityPrintJoin, key: string): boolean => {
  return parseBoolean(join.features[key], false);
};

export type NbboSide = "AA" | "A" | "B" | "BB";

export const classifyNbboSide = (
  price: number,
  quote: OptionNBBO | null | undefined
): NbboSide | null => {
  if (!quote || !Number.isFinite(price)) {
    return null;
  }

  const bid = quote.bid;
  const ask = quote.ask;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask <= 0) {
    return null;
  }

  const spread = Math.max(0, ask - bid);
  const epsilon = Math.max(0.01, spread * 0.05);

  if (price > ask + epsilon) {
    return "AA";
  }
  if (price >= ask - epsilon) {
    return "A";
  }
  if (price < bid - epsilon) {
    return "BB";
  }
  if (price <= bid + epsilon) {
    return "B";
  }

  const mid = (bid + ask) / 2;
  return price >= mid ? "A" : "B";
};

export const smartFlowReasonLabel = (value: string): string => humanizeClassifierId(value);

export const formatFlowMetric = (value: number, suffix?: string): string => {
  if (suffix) {
    return `${value}${suffix}`;
  }

  return value.toLocaleString();
};
