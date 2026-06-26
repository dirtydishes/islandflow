import type { EquityPrintJoin, OptionNBBO } from "@islandflow/types";
import type {
  ChartTimeLike,
  MarketChartCandlestickData,
  MarketChartPriceSeries
} from "../../market-chart";
import {
  chartTimeToMs,
  formatChartTickTime,
  formatIntervalLabel,
  toChartCandle,
  toChartTime
} from "../../market-chart";
import { EASTERN_TIME_LABEL, formatEasternDateTime, formatEasternTime } from "../../time-format";
import { decodeNewsText, formatOptionContractLabel } from "../format";
import { normalizeContractId } from "../state-helpers";

export type CandlestickSeries = MarketChartPriceSeries;

export type EquityOverlayPoint = {
  ts: number;
  price: number;
  size: number;
  offExchangeFlag: boolean;
};

export type ChartCandle = MarketChartCandlestickData;
export {
  type ChartTimeLike,
  chartTimeToMs,
  formatChartTickTime,
  formatIntervalLabel,
  toChartCandle,
  toChartTime
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

export const formatTime = (ts: number): string =>
  formatEasternTime(ts, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

export const formatTimeWithZone = (ts: number): string => `${formatTime(ts)} ${EASTERN_TIME_LABEL}`;

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

export const formatDateTime = (ts: number): string =>
  formatEasternDateTime(ts, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

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
