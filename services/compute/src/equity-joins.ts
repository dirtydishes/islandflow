import type { EquityPrint, EquityPrintJoin, EquityQuote } from "@islandflow/types";

export type EquityQuoteJoin = {
  quote: EquityQuote | null;
  ageMs: number;
  stale: boolean;
};

export type QuotePlacement = "AA" | "A" | "B" | "BB" | "MID" | "MISSING" | "STALE";

const roundTo = (value: number, digits = 4): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
};

export const classifyQuotePlacement = (
  price: number,
  join: EquityQuoteJoin
): QuotePlacement => {
  if (!Number.isFinite(price)) {
    return "MISSING";
  }
  if (!join.quote) {
    return "MISSING";
  }
  if (join.stale) {
    return "STALE";
  }

  const bid = join.quote.bid;
  const ask = join.quote.ask;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask <= 0) {
    return "MISSING";
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

  return "MID";
};

export const buildEquityPrintJoin = (
  print: EquityPrint,
  join: EquityQuoteJoin
): EquityPrintJoin => {
  const joinQuality: Record<string, number> = {};
  const placement = classifyQuotePlacement(print.price, join);
  const features: Record<string, string | number | boolean> = {
    underlying_id: print.underlying_id,
    price: print.price,
    size: print.size,
    off_exchange_flag: print.offExchangeFlag,
    print_ts: print.ts,
    quote_placement: placement
  };

  if (!join.quote) {
    joinQuality.quote_missing = 1;
  } else {
    joinQuality.quote_age_ms = join.ageMs;
    if (join.stale) {
      joinQuality.quote_stale = 1;
    } else {
      const bid = join.quote.bid;
      const ask = join.quote.ask;
      const mid = (bid + ask) / 2;
      const spread = ask - bid;
      features.quote_ts = join.quote.ts;
      features.quote_bid = bid;
      features.quote_ask = ask;
      features.quote_mid = roundTo(mid);
      features.quote_spread = roundTo(spread);
    }
  }

  const joinId = `equityjoin:${print.trace_id}`;

  return {
    source_ts: print.source_ts,
    ingest_ts: print.ingest_ts,
    seq: print.seq,
    trace_id: joinId,
    id: joinId,
    print_trace_id: print.trace_id,
    quote_trace_id: join.quote?.trace_id ?? "",
    features,
    join_quality: joinQuality
  };
};
