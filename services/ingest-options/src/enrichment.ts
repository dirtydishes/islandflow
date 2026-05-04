import {
  OptionPrintSchema,
  classifyOptionNbboSide,
  deriveOptionPrintMetadata,
  evaluateOptionSignal,
  type EquityQuote,
  type OptionNBBO,
  type OptionPrint,
  type OptionsSignalConfig
} from "@islandflow/types";

export const MAX_CONTEXT_HISTORY = 64;

export type ContextHistory<T extends { ts: number; seq: number }> = Map<string, T[]>;

export const rememberContext = <T extends { ts: number; seq: number }>(
  history: ContextHistory<T>,
  key: string,
  value: T
): void => {
  const bucket = history.get(key) ?? [];
  const existingIndex = bucket.findIndex((item) => item.ts === value.ts && item.seq === value.seq);
  if (existingIndex >= 0) {
    bucket[existingIndex] = value;
  } else {
    bucket.push(value);
  }
  bucket.sort((a, b) => {
    const delta = a.ts - b.ts;
    return delta !== 0 ? delta : a.seq - b.seq;
  });
  if (bucket.length > MAX_CONTEXT_HISTORY) {
    bucket.splice(0, bucket.length - MAX_CONTEXT_HISTORY);
  }
  history.set(key, bucket);
};

export const selectAtOrBefore = <T extends { ts: number; seq: number }>(
  items: readonly T[] | undefined,
  ts: number
): T | null => {
  if (!items?.length) {
    return null;
  }

  let selected: T | null = null;
  for (const item of items) {
    if (item.ts > ts) {
      continue;
    }
    if (!selected || item.ts > selected.ts || (item.ts === selected.ts && item.seq >= selected.seq)) {
      selected = item;
    }
  }
  return selected;
};

export const enrichOptionPrint = (
  rawPrint: OptionPrint,
  optionQuote: OptionNBBO | null | undefined,
  equityQuote: EquityQuote | null | undefined,
  config: OptionsSignalConfig
): OptionPrint => {
  const derived = deriveOptionPrintMetadata(rawPrint, optionQuote, config);
  const executionNbboSide = optionQuote
    ? classifyOptionNbboSide(rawPrint.price, optionQuote, rawPrint.ts, config.nbboMaxAgeMs)
    : undefined;
  const nbboMid =
    optionQuote && Number.isFinite(optionQuote.bid) && Number.isFinite(optionQuote.ask)
      ? Number(((optionQuote.bid + optionQuote.ask) / 2).toFixed(4))
      : undefined;
  const nbboSpread =
    optionQuote && Number.isFinite(optionQuote.bid) && Number.isFinite(optionQuote.ask)
      ? Number(Math.max(0, optionQuote.ask - optionQuote.bid).toFixed(4))
      : undefined;
  const underlyingMid =
    equityQuote && Number.isFinite(equityQuote.bid) && Number.isFinite(equityQuote.ask)
      ? Number(((equityQuote.bid + equityQuote.ask) / 2).toFixed(4))
      : undefined;
  const underlyingSpread =
    equityQuote && Number.isFinite(equityQuote.bid) && Number.isFinite(equityQuote.ask)
      ? Number(Math.max(0, equityQuote.ask - equityQuote.bid).toFixed(4))
      : undefined;

  const enrichedForSignal: OptionPrint = {
    ...rawPrint,
    ...derived,
    nbbo_side: executionNbboSide ?? derived.nbbo_side,
    ...(optionQuote
      ? {
          execution_nbbo_bid: optionQuote.bid,
          execution_nbbo_ask: optionQuote.ask,
          execution_nbbo_mid: nbboMid,
          execution_nbbo_spread: nbboSpread,
          execution_nbbo_bid_size: optionQuote.bidSize,
          execution_nbbo_ask_size: optionQuote.askSize,
          execution_nbbo_ts: optionQuote.ts,
          execution_nbbo_age_ms: rawPrint.ts - optionQuote.ts,
          execution_nbbo_side: executionNbboSide,
          nbbo_side: executionNbboSide
        }
      : {}),
    ...(equityQuote && underlyingMid !== undefined
      ? {
          execution_underlying_spot: underlyingMid,
          execution_underlying_bid: equityQuote.bid,
          execution_underlying_ask: equityQuote.ask,
          execution_underlying_mid: underlyingMid,
          execution_underlying_spread: underlyingSpread,
          execution_underlying_ts: equityQuote.ts,
          execution_underlying_age_ms: rawPrint.ts - equityQuote.ts,
          execution_underlying_source: "equity_quote_mid" as const
        }
      : {}),
    signal_profile: config.mode
  };

  const signalDecision = evaluateOptionSignal(enrichedForSignal, config);
  return OptionPrintSchema.parse({
    ...enrichedForSignal,
    signal_pass: signalDecision.signalPass,
    signal_reasons: signalDecision.signalReasons,
    signal_profile: signalDecision.signalProfile
  });
};
