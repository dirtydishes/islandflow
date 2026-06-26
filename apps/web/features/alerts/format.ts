import type { FlowPacket, OptionPrint, SmartFlowAlertEvent } from "@islandflow/types";
import { parseOptionContractId } from "@islandflow/types";

import {
  getSmartFlowEvidenceQualityBand,
  getSmartFlowHypothesisLabel,
  humanizeSmartFlowToken,
  normalizeSmartFlowDirection
} from "../smart-flow";
import { formatEasternTime, formatEasternTimestampWithMs } from "../time-format";

export const normalizeAlertDirection = (
  value: string | null | undefined
): "bullish" | "bearish" | "neutral" | "mixed" | "unknown" => {
  const normalized = normalizeSmartFlowDirection(value);
  return normalized === "abstained" ? "unknown" : normalized;
};

export const getAlertWindowAnchorTs = (
  alerts: SmartFlowAlertEvent[],
  fallbackNow = Date.now()
): number => {
  if (alerts.length === 0) {
    return fallbackNow;
  }
  return alerts.reduce(
    (max, alert) => Math.max(max, alert.source_ts),
    alerts[0]?.source_ts ?? fallbackNow
  );
};

export const formatAlertTime = (ts: number): string =>
  formatEasternTime(ts, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

export const formatAlertDateTime = (ts: number): string =>
  formatEasternTimestampWithMs(ts, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

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

export const getAlertKey = (alert: SmartFlowAlertEvent): string =>
  alert.alert_id ? `${alert.alert_id}:${alert.seq}` : `${alert.trace_id}:${alert.seq}`;

export const getAlertCursor = (alert: SmartFlowAlertEvent) => ({
  ts: alert.source_ts,
  seq: alert.seq
});

export const getAlertName = (alert: SmartFlowAlertEvent): string =>
  getSmartFlowHypothesisLabel(alert.hypothesis_type);

export const getAlertSymbol = (alert: SmartFlowAlertEvent): string =>
  alert.underlying_id.trim().toUpperCase() || "FLOW";

export const getAlertDirectionLabel = (alert: SmartFlowAlertEvent): string =>
  humanizeSmartFlowToken(normalizeAlertDirection(alert.direction));

export const getAlertEvidenceQualityLabel = (alert: SmartFlowAlertEvent): string => {
  const band = getSmartFlowEvidenceQualityBand(alert.evidence_quality);
  return `${formatAlertConfidence(alert.evidence_quality)} ${band}`;
};

export const getAlertConfidenceEvidenceLabel = (alert: SmartFlowAlertEvent): string =>
  `${formatAlertConfidence(alert.policy_confidence)} / ${getAlertEvidenceQualityLabel(alert)}`;

export const getAlertTriggerReason = (alert: SmartFlowAlertEvent): string => {
  if (alert.trigger.kind === "non_abstained_hypothesis") {
    return "Non-abstained flow hypothesis met alert policy.";
  }
  return humanizeSmartFlowToken(alert.trigger.kind);
};

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
  alert: Pick<SmartFlowAlertEvent, "underlying_id" | "evidence_refs">,
  packet?: FlowPacket | null,
  prints: readonly OptionPrint[] = []
): string | null => {
  if (alert.underlying_id.trim()) {
    return alert.underlying_id.toUpperCase();
  }

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

  for (const ref of alert.evidence_refs) {
    const match = ref.match(/flowpacket:([^:]+):/);
    if (match?.[1]) {
      return extractAlertUnderlyingFromContract(match[1]);
    }
  }

  return null;
};

export const getAlertPrimaryPacketRef = (
  alert: Pick<SmartFlowAlertEvent, "evidence_refs">
): string | null => alert.evidence_refs.find((ref) => ref.startsWith("flowpacket:")) ?? null;

export const getAlertPrimaryOptionRef = (
  alert: Pick<SmartFlowAlertEvent, "evidence_refs">
): string | null => alert.evidence_refs.find((ref) => !ref.startsWith("flowpacket:")) ?? null;
