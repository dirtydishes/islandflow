import {
  createSyntheticDemoProfileFixture,
  getLoadProfile,
  getSyntheticLoadProfileRunCount,
  loadProfileIdForSyntheticMarketMode,
  projectSyntheticDemoLiveEvent as projectDemoEvent,
  scaleSyntheticDemoRunIntervalMs,
  SYNTHETIC_DEMO_RUN_INTERVAL_MS,
  scaleSyntheticEmitIntervalMs
} from "@islandflow/synthetic-market/profiles";
import {
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  type EquityPrint,
  type EquityQuote,
  getSyntheticSessionState,
  getSyntheticUnderlyingState,
  SP500_SYMBOLS,
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

type EquitiesThroughput = {
  batchSize: number;
  litSizeBase: number;
  litSizeRange: number;
  darkSizeBase: number;
};

const THROUGHPUT_BY_MODE: Record<SyntheticMarketMode, EquitiesThroughput> = {
  realistic: { batchSize: 2, litSizeBase: 12, litSizeRange: 340, darkSizeBase: 900 },
  active: { batchSize: 5, litSizeBase: 22, litSizeRange: 980, darkSizeBase: 1800 },
  firehose: { batchSize: 10, litSizeBase: 48, litSizeRange: 1800, darkSizeBase: 2800 }
};

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

const buildQuoteContext = (symbol: string, now: number, control: SyntheticControlState) => {
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

const uniqueSymbols = (symbols: readonly string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const symbol of symbols) {
    const normalized = symbol.trim().toUpperCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      unique.push(normalized);
    }
  }
  return unique;
};

const getBackgroundSymbols = (
  session: ReturnType<typeof getSyntheticSessionState>,
  minimumCount: number,
  symbolCursor: number
): string[] => {
  const symbols = uniqueSymbols(["SPY", ...session.focus_symbols]);
  let fillOffset = 0;
  while (symbols.length < minimumCount && fillOffset < SYNTHETIC_SYMBOLS.length * 2) {
    const candidate = SYNTHETIC_SYMBOLS[(symbolCursor + fillOffset) % SYNTHETIC_SYMBOLS.length]!;
    if (!symbols.includes(candidate)) {
      symbols.push(candidate);
    }
    fillOffset += 1;
  }
  return symbols;
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

const pickBackgroundPlacement = (
  symbol: string,
  driftBps: number,
  regime: ReturnType<typeof getSyntheticSessionState>["regime"],
  seq: number,
  tick: number
): PricePlacement => {
  if (symbol === "SPY") {
    const cycle = tick % 3;
    if (cycle === 0) {
      return driftBps >= 0 ? "A" : "B";
    }
    if (cycle === 2) {
      return driftBps >= 0 ? "B" : "A";
    }
    return "MID";
  }
  return pickPrimaryPlacement(driftBps, regime, seq);
};

export const createSyntheticEquitiesAdapter = (
  config: SyntheticEquitiesAdapterConfig
): EquityIngestAdapter => {
  return {
    name: "synthetic",
    start: (handlers: EquityIngestHandlers) => {
      let seq = 0;
      let quoteSeq = 0;
      let symbolCursor = 0;
      let backgroundTick = 0;
      let demoRunOrdinal = 0;
      let demoRunSerial = 0;
      let regularTimer: ReturnType<typeof setTimeout> | null = null;
      let demoTimer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const getEffectiveControl = (): SyntheticControlState => {
        const control = config.getControl() ?? DEFAULT_SYNTHETIC_CONTROL_STATE;
        if (
          control.updated_at === 0 &&
          control.load_profile_id === DEFAULT_SYNTHETIC_CONTROL_STATE.load_profile_id
        ) {
          return {
            ...control,
            load_profile_id: loadProfileIdForSyntheticMarketMode(config.mode)
          };
        }
        return control;
      };

      const emitBackground = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        const control = getEffectiveControl();
        const mode = getLoadProfile(control.load_profile_id).mode;
        const throughput = THROUGHPUT_BY_MODE[mode];
        const session = getSyntheticSessionState(now, control);
        const tick = backgroundTick;
        const backgroundSymbols = getBackgroundSymbols(session, throughput.batchSize, symbolCursor);
        const focusSet = new Set(["SPY", ...session.focus_symbols]);
        const allowDark =
          mode !== "realistic" ||
          session.regime === "event_ramp" ||
          session.regime === "dealer_gamma" ||
          session.regime === "retail_chase";

        if (allowDark) {
          const darkSymbol =
            session.focus_symbols[seq % Math.max(1, session.focus_symbols.length)] ?? "SPY";
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
              buildSyntheticQuote(quoteSeq, now - 2, darkSymbol, darkQuote.bid, darkQuote.ask)
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

        for (let i = 0; i < backgroundSymbols.length; i += 1) {
          const symbol = backgroundSymbols[i]!;
          const eventTs = now + i * 4;
          const quote = buildQuoteContext(symbol, eventTs, control);
          const clustered = focusSet.has(symbol);
          const eventSeq = seq + 1;
          const placement = pickBackgroundPlacement(
            symbol,
            quote.state.driftBps,
            session.regime,
            eventSeq,
            tick + i
          );
          const exchange = EXCHANGES[(eventSeq + symbol.charCodeAt(0) + i) % EXCHANGES.length]!;
          const baseSize =
            throughput.litSizeBase +
            ((eventSeq + i) % throughput.litSizeRange) +
            Math.round(quote.state.sessionVolatility * 140);
          const size = clustered
            ? Math.round(baseSize * (1 + quote.state.clusteringScore * 0.35))
            : baseSize;
          const offExchangeFlag =
            ((eventSeq + i * 3) % 10) / 10 <
            quote.state.offExchangeBias * (clustered ? 1.12 : 0.86);

          if (handlers.onQuote) {
            quoteSeq += 1;
            void handlers.onQuote(
              buildSyntheticQuote(quoteSeq, eventTs - 2, symbol, quote.bid, quote.ask)
            );
          }

          seq = eventSeq;
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

        symbolCursor = (symbolCursor + backgroundSymbols.length) % SYNTHETIC_SYMBOLS.length;
        backgroundTick += 1;
      };

      const emitDemoRuns = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        const control = getEffectiveControl();
        const runCount = getSyntheticLoadProfileRunCount(control.load_profile_id);

        for (let runOffset = 0; runOffset < runCount; runOffset += 1) {
          const fixture = createSyntheticDemoProfileFixture(
            control.demo_profile_id,
            demoRunOrdinal
          );
          const firstTs = fixture.manifest.replay_plan.first_event_ts ?? fixture.batch.run.start_ts;
          const baseTs = now + runOffset * 10;

          demoRunOrdinal += 1;
          demoRunSerial += 1;

          for (const generated of fixture.batch.events) {
            if (generated.kind === "equity_quote" && handlers.onQuote) {
              quoteSeq += 1;
              void handlers.onQuote(
                projectDemoEvent(generated.event, {
                  firstTs,
                  baseTs,
                  seq: quoteSeq,
                  runId: fixture.manifest.run.run_id,
                  runSerial: demoRunSerial
                })
              );
            }

            if (generated.kind === "equity_print") {
              seq += 1;
              void handlers.onTrade(
                projectDemoEvent(generated.event, {
                  firstTs,
                  baseTs,
                  seq,
                  runId: fixture.manifest.run.run_id,
                  runSerial: demoRunSerial
                })
              );
            }
          }
        }
      };

      const scheduleRegular = () => {
        if (stopped) {
          return;
        }
        const control = getEffectiveControl();
        const intervalMs = scaleSyntheticEmitIntervalMs(
          config.emitIntervalMs,
          control.load_profile_id
        );
        regularTimer = setTimeout(() => {
          emitBackground();
          scheduleRegular();
        }, intervalMs);
      };

      const scheduleDemoRuns = () => {
        if (stopped) {
          return;
        }
        const control = getEffectiveControl();
        const intervalMs = scaleSyntheticDemoRunIntervalMs(
          SYNTHETIC_DEMO_RUN_INTERVAL_MS,
          control.load_profile_id
        );
        demoTimer = setTimeout(() => {
          emitDemoRuns();
          scheduleDemoRuns();
        }, intervalMs);
      };

      emitBackground();
      emitDemoRuns();
      scheduleRegular();
      scheduleDemoRuns();

      return () => {
        stopped = true;
        if (regularTimer) {
          clearTimeout(regularTimer);
        }
        if (demoTimer) {
          clearTimeout(demoTimer);
        }
      };
    }
  };
};
