import {
  SP500_SYMBOLS,
  getSyntheticSessionState,
  getSyntheticUnderlyingState,
  type EquityPrint,
  type EquityQuote,
  type SyntheticControlState,
  type SyntheticMarketMode
} from "@islandflow/types";
import type { EquityIngestAdapter, EquityIngestHandlers } from "./types";

type SyntheticEquitiesAdapterConfig = {
  emitIntervalMs: number;
  mode: SyntheticMarketMode;
  getControl: () => SyntheticControlState;
};

const EXCHANGES = ["NYSE", "NASDAQ", "ARCA", "BATS", "IEX", "MEMX"];
const DARK_EXCHANGE = "OTC";
const SYNTHETIC_SYMBOLS = ["SPY", ...(SP500_SYMBOLS as readonly string[])];

type PricePlacement = "MID" | "A" | "AA" | "B" | "BB";

const buildSyntheticPrint = (
  seq: number,
  now: number,
  symbol: string,
  price: number,
  size: number,
  exchange: string,
  offExchangeFlag: boolean
): EquityPrint => ({
  source_ts: now,
  ingest_ts: now,
  seq,
  trace_id: `synthetic-equities-${seq}`,
  ts: now,
  underlying_id: symbol,
  price,
  size,
  exchange,
  offExchangeFlag
});

const buildSyntheticQuote = (
  seq: number,
  now: number,
  symbol: string,
  bid: number,
  ask: number
): EquityQuote => ({
  source_ts: now,
  ingest_ts: now,
  seq,
  trace_id: `synthetic-equity-quote-${seq}`,
  ts: now,
  underlying_id: symbol,
  bid,
  ask
});

const formatPrice = (value: number): number => Number(value.toFixed(2));

const priceForPlacement = (
  mid: number,
  quote: { bid: number; ask: number; epsilon: number },
  placement: PricePlacement
): number => {
  const { bid, ask, epsilon } = quote;
  let price = mid;
  switch (placement) {
    case "AA":
      price = ask + epsilon * 1.5;
      break;
    case "A":
      price = ask;
      break;
    case "BB":
      price = bid - epsilon * 1.5;
      break;
    case "B":
      price = bid;
      break;
    case "MID":
    default:
      price = mid;
      break;
  }
  return formatPrice(Math.max(0.01, price));
};

const buildQuoteContext = (
  symbol: string,
  now: number,
  control: SyntheticControlState
) => {
  const session = getSyntheticSessionState(now, control);
  const state = getSyntheticUnderlyingState(symbol, now, control, session);
  return {
    session,
    state,
    mid: state.mid,
    bid: formatPrice(state.bid),
    ask: formatPrice(state.ask),
    spread: state.spread,
    epsilon: Math.max(0.01, state.spread * 0.08)
  };
};

const pickPrimaryPlacement = (
  driftBps: number,
  regime: ReturnType<typeof getSyntheticSessionState>["regime"],
  seq: number
): PricePlacement => {
  if (regime === "dealer_gamma") {
    return seq % 4 === 0 ? "A" : seq % 3 === 0 ? "B" : "MID";
  }
  if (regime === "arb_calm" || regime === "mean_revert") {
    return seq % 11 === 0 ? "A" : seq % 13 === 0 ? "B" : "MID";
  }
  if (regime === "event_ramp" || regime === "retail_chase") {
    if (driftBps >= 0) {
      return seq % 3 === 0 ? "AA" : "A";
    }
    return seq % 3 === 0 ? "BB" : "B";
  }
  if (driftBps >= 0) {
    return seq % 5 === 0 ? "A" : "MID";
  }
  return seq % 5 === 0 ? "B" : "MID";
};

const pickDarkPlacement = (
  driftBps: number,
  regime: ReturnType<typeof getSyntheticSessionState>["regime"],
  seq: number
): PricePlacement => {
  if (regime === "dealer_gamma") {
    return seq % 2 === 0 ? "A" : "B";
  }
  if (regime === "arb_calm" || regime === "mean_revert") {
    return "MID";
  }
  if (regime === "event_ramp" || regime === "retail_chase") {
    return driftBps >= 0 ? (seq % 2 === 0 ? "A" : "AA") : seq % 2 === 0 ? "B" : "BB";
  }
  return driftBps >= 0 ? "A" : "B";
};

export const createSyntheticEquitiesAdapter = (
  config: SyntheticEquitiesAdapterConfig
): EquityIngestAdapter => {
  const throughput =
    config.mode === "firehose"
      ? { batchSize: 10, litSizeBase: 48, litSizeRange: 1800, darkSizeBase: 2800 }
      : config.mode === "active"
        ? { batchSize: 5, litSizeBase: 22, litSizeRange: 980, darkSizeBase: 1800 }
        : { batchSize: 2, litSizeBase: 12, litSizeRange: 340, darkSizeBase: 900 };

  return {
    name: "synthetic",
    start: (handlers: EquityIngestHandlers) => {
      let seq = 0;
      let quoteSeq = 0;
      let symbolCursor = 0;
      let timer: ReturnType<typeof setInterval> | null = null;
      let stopped = false;

      const emit = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        const control = config.getControl();
        const session = getSyntheticSessionState(now, control);
        const focusSymbols =
          session.focus_symbols.length > 0 ? session.focus_symbols : SYNTHETIC_SYMBOLS.slice(0, 3);
        const focusSet = new Set(focusSymbols);
        const allowDark =
          config.mode !== "realistic" ||
          session.regime === "event_ramp" ||
          session.regime === "dealer_gamma" ||
          session.regime === "retail_chase";

        if (allowDark) {
          const darkSymbol = focusSymbols[seq % focusSymbols.length] ?? SYNTHETIC_SYMBOLS[symbolCursor % SYNTHETIC_SYMBOLS.length]!;
          const darkQuote = buildQuoteContext(darkSymbol, now, control);
          const darkPlacement = pickDarkPlacement(
            darkQuote.state.driftBps,
            session.regime,
            seq + 1
          );
          const darkBias = darkQuote.state.offExchangeBias;
          const darkSize = Math.max(
            250,
            Math.round(
              throughput.darkSizeBase *
                (0.65 + darkBias * 0.9 + darkQuote.state.sessionVolatility * 0.2)
            )
          );

          if (handlers.onQuote) {
            quoteSeq += 1;
            void handlers.onQuote(
              buildSyntheticQuote(
                quoteSeq,
                now - 2,
                darkSymbol,
                darkQuote.bid,
                darkQuote.ask
              )
            );
          }

          seq += 1;
          void handlers.onTrade(
            buildSyntheticPrint(
              seq,
              now,
              darkSymbol,
              priceForPlacement(darkQuote.mid, darkQuote, darkPlacement),
              darkSize,
              DARK_EXCHANGE,
              true
            )
          );
        }

        for (let i = 0; i < throughput.batchSize; i += 1) {
          seq += 1;
          const symbol =
            i < focusSymbols.length
              ? focusSymbols[i]!
              : SYNTHETIC_SYMBOLS[(symbolCursor + i) % SYNTHETIC_SYMBOLS.length]!;
          const eventTs = now + i * 4;
          const quote = buildQuoteContext(symbol, eventTs, control);
          const clustered = focusSet.has(symbol);
          const placement = pickPrimaryPlacement(
            quote.state.driftBps,
            session.regime,
            seq + i
          );
          const exchange = EXCHANGES[(seq + symbol.charCodeAt(0) + i) % EXCHANGES.length]!;
          const baseSize =
            throughput.litSizeBase +
            ((seq + i) % throughput.litSizeRange) +
            Math.round(quote.state.sessionVolatility * 140);
          const size = clustered
            ? Math.round(baseSize * (1 + quote.state.clusteringScore * 0.35))
            : baseSize;
          const offExchangeFlag =
            ((seq + i * 3) % 10) / 10 < quote.state.offExchangeBias * (clustered ? 1.12 : 0.86);

          if (handlers.onQuote) {
            quoteSeq += 1;
            void handlers.onQuote(
              buildSyntheticQuote(
                quoteSeq,
                eventTs - 2,
                symbol,
                quote.bid,
                quote.ask
              )
            );
          }

          void handlers.onTrade(
            buildSyntheticPrint(
              seq,
              eventTs,
              symbol,
              priceForPlacement(quote.mid, quote, placement),
              size,
              exchange,
              offExchangeFlag
            )
          );
        }

        symbolCursor = (symbolCursor + throughput.batchSize) % SYNTHETIC_SYMBOLS.length;
      };

      timer = setInterval(emit, config.emitIntervalMs);

      return () => {
        stopped = true;
        if (timer) {
          clearInterval(timer);
        }
      };
    }
  };
};
