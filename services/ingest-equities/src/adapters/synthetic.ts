import {
  createSyntheticDemoProfileFixture,
  getSyntheticLoadProfileRunCount,
  loadProfileIdForSyntheticMarketMode,
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

type DemoProjectedEvent = {
  source_ts: number;
  ingest_ts: number;
  ts: number;
  seq: number;
  trace_id: string;
};

const projectDemoEvent = <T extends DemoProjectedEvent>(
  event: T,
  input: {
    firstTs: number;
    baseTs: number;
    seq: number;
    runId: string;
    runSerial: number;
  }
): T => {
  const traceSuffix = event.trace_id.split(":").slice(1).join(":") || event.trace_id;
  return {
    ...event,
    source_ts: input.baseTs + (event.source_ts - input.firstTs),
    ingest_ts: input.baseTs + (event.ingest_ts - input.firstTs),
    ts: input.baseTs + (event.ts - input.firstTs),
    seq: input.seq,
    trace_id: `${input.runId}:live:${input.runSerial}:${traceSuffix}`
  };
};

export const createSyntheticEquitiesAdapter = (
  config: SyntheticEquitiesAdapterConfig
): EquityIngestAdapter => {
  return {
    name: "synthetic",
    start: (handlers: EquityIngestHandlers) => {
      let seq = 0;
      let quoteSeq = 0;
      let demoRunOrdinal = 0;
      let demoRunSerial = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
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

      const emit = () => {
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

      const schedule = () => {
        if (stopped) {
          return;
        }
        const control = getEffectiveControl();
        const intervalMs = scaleSyntheticEmitIntervalMs(
          config.emitIntervalMs,
          control.load_profile_id
        );
        timer = setTimeout(() => {
          emit();
          schedule();
        }, intervalMs);
      };

      schedule();

      return () => {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
        }
      };
    }
  };
};
