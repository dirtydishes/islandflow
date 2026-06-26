import type {
  FlowHypothesisType,
  OptionFlowFilters,
  OptionNbboSide,
  OptionPrint,
  SmartFlowAlertEvent,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { parseOptionContractId } from "@islandflow/types";
import { formatEasternDateTime, formatEasternTime, isSameEasternDay } from "../time-format";
import type { OptionContractDisplay, TapeMode, WsStatus } from "./types";

const formatPrice = (price: number): string => {
  if (!Number.isFinite(price)) {
    return "0.00";
  }
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatSize = (size: number): string => {
  return size.toLocaleString();
};

const formatPct = (value: number): string => `${Math.round(value * 100)}%`;

const formatUsd = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export const formatCompactUsd = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0.00";
  }

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs < 1_000) {
    return formatUsd(value);
  }
  if (abs < 1_000_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}K`;
  }
  if (abs < 1_000_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  }
  return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
};

const normalizeContractId = (value: string): string => value.trim();

const formatStrike = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
};

const formatExpiryShort = (value: string): string | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return `${month}-${day}-${year.slice(2)}`;
};

export const formatOptionContractLabel = (value: string): OptionContractDisplay | null => {
  const normalized = normalizeContractId(value);
  if (!normalized) {
    return null;
  }

  const parsed = parseOptionContractId(normalized);
  if (!parsed) {
    return null;
  }

  const expiration = formatExpiryShort(parsed.expiry);
  if (!expiration) {
    return null;
  }

  return {
    ticker: parsed.root.toUpperCase(),
    strike: `${formatStrike(parsed.strike)}${parsed.right}`,
    expiration
  };
};

export const formatNewsTimestamp = (ts: number, now = Date.now()): string => {
  return isSameEasternDay(ts, now)
    ? formatEasternTime(ts, { hour: "numeric", minute: "2-digit" })
    : formatEasternDateTime(ts, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: undefined,
        year: undefined
      });
};

const NEWS_TEXT_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
};

export const decodeNewsText = (value: string): string =>
  value.replace(/&(#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
      const rawCodePoint = radix === 16 ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(rawCodePoint, radix);
      if (!Number.isFinite(codePoint)) {
        return match;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }

    return NEWS_TEXT_ENTITIES[entity.toLowerCase()] ?? match;
  });

const humanizeClassifierId = (value: string): string => {
  if (!value) {
    return "Classifier";
  }

  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
};

const normalizeDirection = (value: string): "bullish" | "bearish" | "neutral" => {
  const normalized = value.toLowerCase();
  if (normalized === "bullish" || normalized === "bearish" || normalized === "neutral") {
    return normalized;
  }
  return "neutral";
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

const SMART_FLOW_HYPOTHESIS_LABELS: Record<FlowHypothesisType, string> = {
  directional_accumulation: "Directional accumulation",
  retail_attention_flow: "Retail attention flow",
  event_positioning: "Event positioning",
  volatility_supply: "Volatility supply",
  structure_arbitrage: "Structure arbitrage",
  hedge_rebalance: "Hedge rebalance",
  unclear: "No clear flow hypothesis"
};

export const smartFlowHypothesisLabel = (value: FlowHypothesisType): string =>
  SMART_FLOW_HYPOTHESIS_LABELS[value] ?? humanizeClassifierId(value);

const smartFlowReasonLabel = (value: string): string => humanizeClassifierId(value);

export const smartFlowEvidenceQualityLabel = (value: number): string => {
  if (value >= 0.82) {
    return "strong";
  }
  if (value >= 0.55) {
    return "usable";
  }
  if (value > 0) {
    return "thin";
  }
  return "poor";
};

export const smartFlowWhyNotLabel = (
  projection: Pick<SmartFlowExplainabilityProjection, "abstention" | "evidence" | "alternatives">
): string => {
  if (projection.abstention.abstained) {
    const reason =
      projection.abstention.source_reasons[0] ??
      projection.abstention.reasons.find((item) => item !== "not_abstained");
    return reason ? `Abstained: ${smartFlowReasonLabel(reason)}` : "Abstained by policy";
  }

  const penalty = projection.evidence.penalties[0];
  if (penalty) {
    return `Watch: ${penalty.reason}`;
  }

  const alternative = projection.alternatives[0];
  if (alternative) {
    return `Alternative considered: ${smartFlowHypothesisLabel(alternative.hypothesis_type)}`;
  }

  return "No active why-not guard";
};

export const smartFlowDirectionLabel = (
  projection: Pick<SmartFlowExplainabilityProjection, "abstention" | "hypothesis">
): "bullish" | "bearish" | "neutral" | "abstained" =>
  projection.abstention.abstained
    ? "abstained"
    : normalizeDirection(projection.hypothesis.direction);

export const smartFlowDirectionTone = (
  projection: Pick<SmartFlowExplainabilityProjection, "abstention" | "hypothesis">
): "bullish" | "bearish" | "neutral" =>
  projection.abstention.abstained ? "neutral" : normalizeDirection(projection.hypothesis.direction);

export const getOptionTableSnapshot = (
  print: Pick<
    OptionPrint,
    | "price"
    | "size"
    | "notional"
    | "nbbo_side"
    | "execution_nbbo_side"
    | "execution_underlying_spot"
    | "execution_iv"
  >,
  fallbackSide: OptionNbboSide | null = null
): { spot: string; iv: string; side: string; details: string; value: string } => {
  const side = print.execution_nbbo_side ?? print.nbbo_side ?? fallbackSide ?? "--";
  return {
    spot:
      typeof print.execution_underlying_spot === "number"
        ? formatPrice(print.execution_underlying_spot)
        : "--",
    iv: typeof print.execution_iv === "number" ? formatPct(print.execution_iv) : "--",
    side,
    details: `${formatSize(print.size)}@${formatPrice(print.price)}_${side}`,
    value: formatCompactUsd(print.notional ?? print.price * print.size * 100)
  };
};

export const statusLabel = (status: WsStatus, paused: boolean, mode: TapeMode): string => {
  if (paused) {
    if (mode === "replay") {
      return "Paused";
    }
    return status === "connected" ? "Held" : statusLabel(status, false, mode);
  }

  if (mode === "replay") {
    return status === "disconnected" ? "Replay Down" : "Replay";
  }

  switch (status) {
    case "connected":
      return "Connected";
    case "stale":
      return "Feed behind";
    case "connecting":
      return "Connecting";
    case "disconnected":
    default:
      return "Disconnected";
  }
};

export type { OptionFlowFilters };
