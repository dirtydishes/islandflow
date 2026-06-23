import type { FlowPacket, OptionFlowFilters } from "@islandflow/types";
import { matchesFlowPacketFilters } from "@islandflow/types";

import type { FlowPacketsTapeScope, NormalizedFlowPacketsTapeScope } from "./types";

type FeatureValue = FlowPacket["features"][string] | undefined;

const unique = (values: string[]): string[] => Array.from(new Set(values));

export const parseFlowPacketNumber = (value: FeatureValue, fallback: number): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return fallback;
};

const normalizeUpperList = (items: readonly string[] | null | undefined): string[] =>
  unique(
    (items ?? [])
      .flatMap((item) => item.split(","))
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
  );

export const normalizeFlowPacketsTapeScope = (
  scope: FlowPacketsTapeScope | undefined
): NormalizedFlowPacketsTapeScope => {
  const underlyingIds = normalizeUpperList([
    ...(scope?.ticker ? [scope.ticker] : []),
    ...(scope?.tickers ?? []),
    ...(scope?.underlyingIds ?? [])
  ]);
  const optionContractId = scope?.optionContractId?.trim();
  return {
    ...(underlyingIds.length > 0 ? { underlyingIds } : {}),
    ...(optionContractId ? { optionContractId } : {})
  };
};

export const getFlowPacketKey = (packet: FlowPacket): string =>
  packet.id || packet.trace_id || `${packet.source_ts}:${packet.seq}`;

export const getFlowPacketCursor = (packet: FlowPacket): { ts: number; seq: number } => ({
  ts: packet.source_ts,
  seq: packet.seq
});

export const getFlowPacketContractId = (packet: FlowPacket): string => {
  const value = packet.features.option_contract_id;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : packet.id;
};

export const getFlowPacketUnderlying = (packet: FlowPacket): string => {
  const explicit = packet.features.underlying_id;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim().toUpperCase();
  }
  const contractId = getFlowPacketContractId(packet);
  const match = contractId.match(/^(.+)-\d{4}-\d{2}-\d{2}-/);
  return (match?.[1] ?? contractId.split("-")[0] ?? contractId).toUpperCase();
};

export const getFlowPacketPrintCount = (packet: FlowPacket): number =>
  Math.round(parseFlowPacketNumber(packet.features.count, packet.members.length));

export const getFlowPacketTotalSize = (packet: FlowPacket): number =>
  parseFlowPacketNumber(packet.features.total_size, 0);

export const getFlowPacketTotalPremium = (packet: FlowPacket): number =>
  parseFlowPacketNumber(packet.features.total_premium, 0);

export const getFlowPacketNotional = (packet: FlowPacket): number => {
  const notional = parseFlowPacketNumber(packet.features.total_notional, Number.NaN);
  return Number.isFinite(notional) ? notional : getFlowPacketTotalPremium(packet) * 100;
};

export const getFlowPacketWindow = (packet: FlowPacket) => {
  const startTs = parseFlowPacketNumber(packet.features.start_ts, packet.source_ts);
  const endTs = parseFlowPacketNumber(packet.features.end_ts, startTs);
  const windowMs = parseFlowPacketNumber(packet.features.window_ms, Math.max(0, endTs - startTs));
  return { startTs, endTs, windowMs };
};

export const getFlowPacketSideLabel = (packet: FlowPacket): string => {
  const buy = parseFlowPacketNumber(packet.features.nbbo_aggressive_buy_ratio, Number.NaN);
  const sell = parseFlowPacketNumber(packet.features.nbbo_aggressive_sell_ratio, Number.NaN);
  if (!Number.isFinite(buy) && !Number.isFinite(sell)) {
    return "--";
  }
  if ((buy || 0) >= (sell || 0) + 0.15) {
    return "Buy-led";
  }
  if ((sell || 0) >= (buy || 0) + 0.15) {
    return "Sell-led";
  }
  return "Mixed";
};

export const getFlowPacketStructureLabel = (packet: FlowPacket): string => {
  const type =
    typeof packet.features.structure_type === "string" ? packet.features.structure_type : "";
  const rights =
    typeof packet.features.structure_rights === "string" ? packet.features.structure_rights : "";
  const legs = parseFlowPacketNumber(packet.features.structure_legs, 0);
  const strikes = parseFlowPacketNumber(packet.features.structure_strikes, 0);
  if (!type) {
    return "--";
  }
  return [
    type.replace(/_/g, " "),
    rights,
    legs > 0 ? `${legs}L` : "",
    strikes > 0 ? `${strikes}K` : ""
  ]
    .filter(Boolean)
    .join(" ");
};

export const formatFlowPacketTime = (ts: number): string => {
  const date = new Date(ts);
  return date.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
};

export const formatFlowPacketTimestamp = (ts: number): string => {
  const date = new Date(ts);
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${date.toLocaleDateString()} ${formatFlowPacketTime(ts)}.${ms}`;
};

export const formatFlowPacketNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return Math.round(value).toLocaleString();
};

export const formatFlowPacketMoney = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}m`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}k`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

export const formatFlowPacketPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export const formatFlowPacketPercent = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
};

export const formatFlowPacketWindow = (packet: FlowPacket): string => {
  const { windowMs } = getFlowPacketWindow(packet);
  return windowMs > 0 ? `${formatFlowPacketNumber(windowMs)}ms` : "--";
};

export const getFlowPacketQuoteState = (packet: FlowPacket): "clean" | "stale" | "missing" => {
  const stale =
    parseFlowPacketNumber(packet.join_quality.nbbo_stale, 0) > 0 ||
    parseFlowPacketNumber(packet.features.nbbo_stale_count, 0) > 0;
  const missing =
    parseFlowPacketNumber(packet.join_quality.nbbo_missing, 0) > 0 ||
    parseFlowPacketNumber(packet.features.nbbo_missing_count, 0) > 0;
  if (missing) {
    return "missing";
  }
  if (stale) {
    return "stale";
  }
  return "clean";
};

export const getFlowPacketQualityLabel = (packet: FlowPacket): string => {
  const coverage = parseFlowPacketNumber(packet.features.nbbo_coverage_ratio, Number.NaN);
  const inside = parseFlowPacketNumber(packet.features.nbbo_inside_ratio, Number.NaN);
  const spread = parseFlowPacketNumber(packet.features.nbbo_spread, Number.NaN);
  const age = parseFlowPacketNumber(packet.join_quality.nbbo_age_ms, Number.NaN);
  const state = getFlowPacketQuoteState(packet);
  const parts = [
    Number.isFinite(coverage) ? `Quote ${formatFlowPacketPercent(coverage)}` : null,
    Number.isFinite(inside) ? `Inside ${formatFlowPacketPercent(inside)}` : null,
    Number.isFinite(spread) ? `Spr ${formatFlowPacketPrice(spread)}` : null,
    Number.isFinite(age) ? `${Math.round(age)}ms` : null,
    state === "stale" ? "Stale quote" : null,
    state === "missing" ? "Missing quote" : null
  ].filter(Boolean);
  return parts.join(" | ") || "--";
};

export const filterFlowPackets = (
  packets: readonly FlowPacket[],
  scope?: NormalizedFlowPacketsTapeScope,
  filters?: OptionFlowFilters
): FlowPacket[] => {
  const underlyingIds = new Set(scope?.underlyingIds ?? []);
  const optionContractId = scope?.optionContractId;
  return packets.filter((packet) => {
    if (optionContractId && getFlowPacketContractId(packet) !== optionContractId) {
      return false;
    }
    if (underlyingIds.size > 0 && !underlyingIds.has(getFlowPacketUnderlying(packet))) {
      return false;
    }
    return matchesFlowPacketFilters(packet, filters);
  });
};
