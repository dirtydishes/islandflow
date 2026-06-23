import type { AlertEvent, FlowPacket, OptionPrint } from "@islandflow/types";
import { parseOptionContractId } from "@islandflow/types";

export const normalizeAlertDirection = (
  value: string | null | undefined
): "bullish" | "bearish" | "neutral" => {
  const normalized = value?.toLowerCase();
  if (normalized === "bullish" || normalized === "bearish" || normalized === "neutral") {
    return normalized;
  }
  return "neutral";
};

const normalizeAlertSeverityValue = (value: string): "high" | "medium" | "low" | null => {
  const normalized = value.trim().toLowerCase();
  if (["high", "critical", "severe", "sev1", "p0", "p1"].includes(normalized)) {
    return "high";
  }
  if (["medium", "med", "moderate", "sev2", "p2"].includes(normalized)) {
    return "medium";
  }
  if (["low", "minor", "info", "informational", "sev3", "p3", "p4"].includes(normalized)) {
    return "low";
  }
  return null;
};

export const normalizeAlertSeverity = (alert: AlertEvent): "high" | "medium" | "low" => {
  const normalized = normalizeAlertSeverityValue(alert.severity);
  if (normalized) {
    return normalized;
  }
  if (alert.score >= 80) {
    return "high";
  }
  if (alert.score >= 45) {
    return "medium";
  }
  return "low";
};

export const deriveAlertDirection = (alert: AlertEvent): "bullish" | "bearish" | "neutral" => {
  const totals = {
    bullish: { count: 0, confidence: 0 },
    bearish: { count: 0, confidence: 0 },
    neutral: { count: 0, confidence: 0 }
  };

  for (const hit of alert.hits) {
    const direction = normalizeAlertDirection(hit.direction);
    totals[direction].count += 1;
    totals[direction].confidence += Number.isFinite(hit.confidence) ? hit.confidence : 0;
  }

  const ranked = (
    Object.entries(totals) as Array<
      ["bullish" | "bearish" | "neutral", { count: number; confidence: number }]
    >
  ).sort((a, b) => {
    if (b[1].count !== a[1].count) {
      return b[1].count - a[1].count;
    }
    return b[1].confidence - a[1].confidence;
  });

  return ranked[0] && ranked[0][1].count > 0 ? ranked[0][0] : "neutral";
};

export const getAlertWindowAnchorTs = (alerts: AlertEvent[], fallbackNow = Date.now()): number => {
  if (alerts.length === 0) {
    return fallbackNow;
  }
  return alerts.reduce(
    (max, alert) => Math.max(max, alert.source_ts),
    alerts[0]?.source_ts ?? fallbackNow
  );
};

export const humanizeAlertClassifierId = (value: string | null | undefined): string => {
  if (!value) {
    return "Classifier alert";
  }

  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
};

export const formatAlertTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

export const formatAlertDateTime = (ts: number): string => {
  const date = new Date(ts);
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}.${ms}`;
};

export const formatAlertScore = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value)) : "--";

export const formatAlertConfidence = (value: number): string =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";

export const formatAlertPrice = (value: number): string =>
  Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "--";

export const formatAlertSize = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : "--";

export const formatAlertMoney = (value: number): string => {
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

export const getAlertKey = (alert: AlertEvent): string =>
  alert.trace_id ? `${alert.trace_id}:${alert.seq}` : `${alert.source_ts}:${alert.seq}`;

export const getAlertCursor = (alert: AlertEvent) => ({
  ts: alert.source_ts,
  seq: alert.seq
});

export const getAlertName = (alert: AlertEvent): string =>
  humanizeAlertClassifierId(alert.hits[0]?.classifier_id);

export const getAlertKind = (alert: AlertEvent): string =>
  humanizeAlertClassifierId(alert.hits[0]?.classifier_id ?? alert.primary_profile_id);

export const extractAlertUnderlyingFromContract = (contractId: string): string | null => {
  const parsed = parseOptionContractId(contractId);
  if (parsed?.root) {
    return parsed.root.toUpperCase();
  }
  const fallback = contractId.split("-")[0]?.trim();
  return fallback ? fallback.toUpperCase() : null;
};

export const getFlowPacketContractId = (packet: FlowPacket): string | null => {
  const value = packet.features.option_contract_id;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const match = packet.id.match(/^flowpacket:([^:]+):/);
  return match?.[1] ?? null;
};

export const inferAlertUnderlying = (
  alert: AlertEvent,
  packet?: FlowPacket | null,
  prints: readonly OptionPrint[] = []
): string | null => {
  const contract = packet ? getFlowPacketContractId(packet) : null;
  if (contract) {
    return extractAlertUnderlyingFromContract(contract);
  }

  for (const print of prints) {
    if (print.underlying_id) {
      return print.underlying_id.toUpperCase();
    }
    const underlying = extractAlertUnderlyingFromContract(print.option_contract_id);
    if (underlying) {
      return underlying;
    }
  }

  const traceMatch = alert.trace_id.match(/flowpacket:([^:]+):/);
  if (traceMatch?.[1]) {
    return extractAlertUnderlyingFromContract(traceMatch[1]);
  }

  return null;
};
