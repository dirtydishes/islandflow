import type { EquityCandle, EquityPrint } from "@islandflow/types";

export type CandleAggregationConfig = {
  intervalsMs: number[];
  maxLateMs: number;
};

export type CandleAggregationResult = {
  emitted: EquityCandle[];
  droppedLate: number;
};

type CandleBuilder = {
  windowStart: number;
  intervalMs: number;
  underlyingId: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
  openTs: number;
  openSeq: number;
  openSourceTs: number;
  closeTs: number;
  closeSeq: number;
  closeIngestTs: number;
};

type IntervalState = {
  intervalMs: number;
  underlyingId: string;
  lastTsSeen: number;
  windows: Map<number, CandleBuilder>;
};

const toPositiveInt = (value: number): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return null;
  }
  return normalized;
};

export const normalizeIntervals = (intervals: number[]): number[] => {
  const unique = new Set<number>();
  for (const interval of intervals) {
    const normalized = toPositiveInt(interval);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique).sort((a, b) => a - b);
};

export const parseIntervals = (value: string | undefined, fallback: number[]): number[] => {
  if (!value) {
    return normalizeIntervals(fallback);
  }

  const parsed = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));

  const normalized = normalizeIntervals(parsed);
  return normalized.length > 0 ? normalized : normalizeIntervals(fallback);
};

const buildStateKey = (underlyingId: string, intervalMs: number): string => {
  return `${underlyingId}:${intervalMs}`;
};

const getWindowStart = (ts: number, intervalMs: number): number => {
  return Math.floor(ts / intervalMs) * intervalMs;
};

const isEarlier = (ts: number, seq: number, otherTs: number, otherSeq: number): boolean => {
  if (ts !== otherTs) {
    return ts < otherTs;
  }
  return seq < otherSeq;
};

const isLater = (ts: number, seq: number, otherTs: number, otherSeq: number): boolean => {
  if (ts !== otherTs) {
    return ts > otherTs;
  }
  return seq > otherSeq;
};

const createBuilder = (
  print: EquityPrint,
  intervalMs: number,
  windowStart: number
): CandleBuilder => {
  return {
    windowStart,
    intervalMs,
    underlyingId: print.underlying_id,
    open: print.price,
    high: print.price,
    low: print.price,
    close: print.price,
    volume: print.size,
    tradeCount: 1,
    openTs: print.ts,
    openSeq: print.seq,
    openSourceTs: print.source_ts,
    closeTs: print.ts,
    closeSeq: print.seq,
    closeIngestTs: print.ingest_ts
  };
};

const updateBuilder = (builder: CandleBuilder, print: EquityPrint): CandleBuilder => {
  builder.volume += print.size;
  builder.tradeCount += 1;
  builder.high = Math.max(builder.high, print.price);
  builder.low = Math.min(builder.low, print.price);

  if (isEarlier(print.ts, print.seq, builder.openTs, builder.openSeq)) {
    builder.open = print.price;
    builder.openTs = print.ts;
    builder.openSeq = print.seq;
    builder.openSourceTs = print.source_ts;
  }

  if (isLater(print.ts, print.seq, builder.closeTs, builder.closeSeq)) {
    builder.close = print.price;
    builder.closeTs = print.ts;
    builder.closeSeq = print.seq;
    builder.closeIngestTs = print.ingest_ts;
  }

  return builder;
};

const toEquityCandle = (builder: CandleBuilder): EquityCandle => {
  return {
    source_ts: builder.openSourceTs,
    ingest_ts: builder.closeIngestTs,
    seq: builder.closeSeq,
    trace_id: `candle:${builder.underlyingId}:${builder.intervalMs}:${builder.windowStart}`,
    ts: builder.windowStart,
    interval_ms: builder.intervalMs,
    underlying_id: builder.underlyingId,
    open: builder.open,
    high: builder.high,
    low: builder.low,
    close: builder.close,
    volume: builder.volume,
    trade_count: builder.tradeCount
  };
};

const flushState = (state: IntervalState, watermark: number): EquityCandle[] => {
  const eligibleStarts: number[] = [];
  for (const start of state.windows.keys()) {
    if (start + state.intervalMs <= watermark) {
      eligibleStarts.push(start);
    }
  }

  if (eligibleStarts.length === 0) {
    return [];
  }

  eligibleStarts.sort((a, b) => a - b);
  const emitted: EquityCandle[] = [];
  for (const start of eligibleStarts) {
    const builder = state.windows.get(start);
    if (!builder) {
      continue;
    }
    state.windows.delete(start);
    emitted.push(toEquityCandle(builder));
  }

  return emitted;
};

export class CandleAggregator {
  private readonly intervalsMs: number[];
  private readonly maxLateMs: number;
  private readonly stateByKey = new Map<string, IntervalState>();

  constructor(config: CandleAggregationConfig) {
    this.intervalsMs = normalizeIntervals(config.intervalsMs);
    this.maxLateMs = Math.max(0, Math.floor(config.maxLateMs));
  }

  ingest(print: EquityPrint): CandleAggregationResult {
    const emitted: EquityCandle[] = [];
    let droppedLate = 0;

    for (const intervalMs of this.intervalsMs) {
      const key = buildStateKey(print.underlying_id, intervalMs);
      const state =
        this.stateByKey.get(key) ??
        ({
          intervalMs,
          underlyingId: print.underlying_id,
          lastTsSeen: 0,
          windows: new Map()
        } satisfies IntervalState);

      state.lastTsSeen = Math.max(state.lastTsSeen, print.ts);
      this.stateByKey.set(key, state);

      const windowStart = getWindowStart(print.ts, intervalMs);
      const windowEnd = windowStart + intervalMs;
      const watermark = Math.max(0, state.lastTsSeen - this.maxLateMs);

      if (windowEnd <= watermark && !state.windows.has(windowStart)) {
        droppedLate += 1;
      } else {
        const existing = state.windows.get(windowStart);
        if (existing) {
          updateBuilder(existing, print);
        } else {
          state.windows.set(windowStart, createBuilder(print, intervalMs, windowStart));
        }
      }

      emitted.push(...flushState(state, watermark));
    }

    return { emitted, droppedLate };
  }

  drain(): EquityCandle[] {
    const emitted: EquityCandle[] = [];

    for (const state of this.stateByKey.values()) {
      const starts = Array.from(state.windows.keys()).sort((a, b) => a - b);
      for (const start of starts) {
        const builder = state.windows.get(start);
        if (!builder) {
          continue;
        }
        state.windows.delete(start);
        emitted.push(toEquityCandle(builder));
      }
    }

    return emitted;
  }
}
