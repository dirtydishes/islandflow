import type { EquityPrintJoin, InferredDarkEvent } from "@islandflow/types";

export type DarkInferenceConfig = {
  windowMs: number;
  cooldownMs: number;
  minBlockSize: number;
  minAccumulationSize: number;
  minAccumulationCount: number;
  minPrintSize: number;
  maxEvidence: number;
  maxSpreadPct: number;
  maxQuoteAgeMs: number;
};

type Evidence = {
  id: string;
  ts: number;
  size: number;
  placement: string;
  offExchange: boolean;
};

export type DarkInferenceState = {
  evidenceByUnderlying: Map<string, Evidence[]>;
  lastEmittedByUnderlying: Map<string, Record<string, number>>;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
};

const getNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const getString = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }
  return null;
};

const getBoolean = (value: unknown): boolean | null => {
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
  return null;
};

const isBuyPlacement = (placement: string): boolean => {
  return placement === "A" || placement === "AA";
};

const isSellPlacement = (placement: string): boolean => {
  return placement === "B" || placement === "BB";
};

const getSpreadPct = (features: Record<string, unknown>): number | null => {
  const spread = getNumber(features.quote_spread);
  const mid = getNumber(features.quote_mid);
  if (spread === null || mid === null || mid <= 0) {
    return null;
  }
  return spread / mid;
};

export const createDarkInferenceState = (): DarkInferenceState => {
  return {
    evidenceByUnderlying: new Map(),
    lastEmittedByUnderlying: new Map()
  };
};

const shouldEmit = (
  state: DarkInferenceState,
  underlyingId: string,
  type: string,
  ts: number,
  cooldownMs: number
): boolean => {
  const record = state.lastEmittedByUnderlying.get(underlyingId) ?? {};
  const last = record[type] ?? -Infinity;
  if (ts - last < cooldownMs) {
    return false;
  }
  record[type] = ts;
  state.lastEmittedByUnderlying.set(underlyingId, record);
  return true;
};

export const evaluateDarkInferences = (
  join: EquityPrintJoin,
  config: DarkInferenceConfig,
  state: DarkInferenceState
): InferredDarkEvent[] => {
  const features = join.features ?? {};
  const joinQuality = join.join_quality ?? {};

  const underlyingId = getString(features.underlying_id);
  if (!underlyingId) {
    return [];
  }

  const size = getNumber(features.size);
  if (size === null) {
    return [];
  }

  const placement = getString(features.quote_placement) ?? "MISSING";
  const offExchange = getBoolean(features.off_exchange_flag) ?? false;
  const ts = Number.isFinite(join.source_ts) ? join.source_ts : 0;

  const quoteAgeMs = getNumber(joinQuality.quote_age_ms) ?? config.maxQuoteAgeMs + 1;
  const quoteMissing = getNumber(joinQuality.quote_missing) === 1;
  const quoteStale = getNumber(joinQuality.quote_stale) === 1;
  const spreadPct = getSpreadPct(features);

  const goodQuality =
    !quoteMissing &&
    !quoteStale &&
    quoteAgeMs <= config.maxQuoteAgeMs &&
    (spreadPct === null || spreadPct <= config.maxSpreadPct);

  const events: InferredDarkEvent[] = [];

  if (
    offExchange &&
    goodQuality &&
    placement === "MID" &&
    size >= config.minBlockSize &&
    shouldEmit(state, underlyingId, "absorbed_block", ts, config.cooldownMs)
  ) {
    const sizeRatio = Math.min(1, size / (config.minBlockSize * 2));
    const spreadScore =
      spreadPct === null || spreadPct <= 0 ? 0.5 : Math.max(0, 1 - spreadPct / config.maxSpreadPct);
    const confidence = clamp01(0.35 + sizeRatio * 0.45 + spreadScore * 0.2);

    events.push({
      source_ts: join.source_ts,
      ingest_ts: join.ingest_ts,
      seq: join.seq,
      trace_id: `dark:absorbed_block:${join.id}`,
      type: "absorbed_block",
      confidence,
      evidence_refs: [join.id]
    });
  }

  if (
    offExchange &&
    goodQuality &&
    size >= config.minPrintSize &&
    (isBuyPlacement(placement) || isSellPlacement(placement))
  ) {
    const existing = state.evidenceByUnderlying.get(underlyingId) ?? [];
    const nextEvidence = [
      ...existing,
      {
        id: join.id,
        ts,
        size,
        placement,
        offExchange
      }
    ].filter((entry) => ts - entry.ts <= config.windowMs);

    state.evidenceByUnderlying.set(underlyingId, nextEvidence);

    const buys = nextEvidence.filter((entry) => isBuyPlacement(entry.placement));
    const sells = nextEvidence.filter((entry) => isSellPlacement(entry.placement));

    const buySize = buys.reduce((sum, entry) => sum + entry.size, 0);
    const sellSize = sells.reduce((sum, entry) => sum + entry.size, 0);

    if (
      buys.length >= config.minAccumulationCount &&
      buySize >= config.minAccumulationSize &&
      shouldEmit(state, underlyingId, "stealth_accumulation", ts, config.cooldownMs)
    ) {
      const sizeRatio = Math.min(1, buySize / (config.minAccumulationSize * 2));
      const countRatio = Math.min(1, buys.length / (config.minAccumulationCount * 2));
      const confidence = clamp01(0.3 + sizeRatio * 0.4 + countRatio * 0.3);
      const evidence = buys.slice(-config.maxEvidence).map((entry) => entry.id);

      events.push({
        source_ts: join.source_ts,
        ingest_ts: join.ingest_ts,
        seq: join.seq,
        trace_id: `dark:stealth_accumulation:${underlyingId}:${ts}`,
        type: "stealth_accumulation",
        confidence,
        evidence_refs: evidence
      });
    }

    if (
      sells.length >= config.minAccumulationCount &&
      sellSize >= config.minAccumulationSize &&
      shouldEmit(state, underlyingId, "distribution", ts, config.cooldownMs)
    ) {
      const sizeRatio = Math.min(1, sellSize / (config.minAccumulationSize * 2));
      const countRatio = Math.min(1, sells.length / (config.minAccumulationCount * 2));
      const confidence = clamp01(0.3 + sizeRatio * 0.4 + countRatio * 0.3);
      const evidence = sells.slice(-config.maxEvidence).map((entry) => entry.id);

      events.push({
        source_ts: join.source_ts,
        ingest_ts: join.ingest_ts,
        seq: join.seq,
        trace_id: `dark:distribution:${underlyingId}:${ts}`,
        type: "distribution",
        confidence,
        evidence_refs: evidence
      });
    }
  }

  return events;
};
