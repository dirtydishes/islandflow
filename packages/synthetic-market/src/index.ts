import type {
  EquityPrint,
  EquityQuote,
  OptionNBBO,
  OptionPrint,
  OptionType
} from "@islandflow/types";

export const SYNTHETIC_MARKET_GENERATOR_VERSION = "synthetic-market-spine-v1";
export const SYNTHETIC_SOURCE_KIND = "synthetic_market";

const DEFAULT_START_TS = Date.parse("2026-01-02T14:30:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SeedBundle = {
  seed: number;
  namespace?: string;
  partition?: string;
};

export type NormalizedSeedBundle = {
  seed: number;
  namespace: string;
  partition: string;
};

export type SymbolProfile = {
  id?: string;
  underlying_id: string;
  base_price: number;
  exchange?: string;
  option_root?: string;
};

export type LiquidityProfile = {
  id?: string;
  equity_spread_bps?: number;
  equity_quote_size?: number;
  equity_trade_size?: number;
  option_spread_bps?: number;
  option_quote_size?: number;
  option_trade_size?: number;
  off_exchange_ratio?: number;
  arrival_interval_ms?: number;
};

export type VolatilityRegime = {
  id?: string;
  drift_bps_per_step?: number;
  price_noise_bps?: number;
  option_iv?: number;
};

export type OptionChainProfile = {
  id?: string;
  expiries_days?: number[];
  strike_offsets_bps?: number[];
  option_types?: OptionType[];
  strike_step?: number;
  sparse_contract_ratio?: number;
};

export type SyntheticMarketProfile = {
  start_ts?: number;
  steps?: number;
  symbols: SymbolProfile[];
  liquidity?: LiquidityProfile;
  volatility?: VolatilityRegime;
  option_chain?: OptionChainProfile;
  scenario_id?: string;
};

export type NormalizedSymbolProfile = {
  id: string;
  underlying_id: string;
  base_price: number;
  exchange: string;
  option_root: string;
};

export type NormalizedLiquidityProfile = Required<LiquidityProfile>;
export type NormalizedVolatilityRegime = Required<VolatilityRegime>;
export type NormalizedOptionChainProfile = Required<OptionChainProfile>;

export type NormalizedSyntheticMarketProfile = {
  start_ts: number;
  steps: number;
  symbols: NormalizedSymbolProfile[];
  liquidity: NormalizedLiquidityProfile;
  volatility: NormalizedVolatilityRegime;
  option_chain: NormalizedOptionChainProfile;
  scenario_id?: string;
};

export type ParameterSnapshot = {
  generator_version: typeof SYNTHETIC_MARKET_GENERATOR_VERSION;
  seed_bundle: NormalizedSeedBundle;
  profile: NormalizedSyntheticMarketProfile;
};

export type SyntheticRun = {
  run_id: string;
  seed_bundle: NormalizedSeedBundle;
  start_ts: number;
  event_count: number;
  parameter_snapshot_hash: string;
};

export type GeneratedMarketEventKind =
  | "equity_quote"
  | "equity_print"
  | "option_nbbo"
  | "option_print";

export type GeneratedMarketEvent =
  | { kind: "equity_quote"; event: EquityQuote }
  | { kind: "equity_print"; event: EquityPrint }
  | { kind: "option_nbbo"; event: OptionNBBO }
  | { kind: "option_print"; event: OptionPrint };

export type EventProvenance = {
  source_kind: typeof SYNTHETIC_SOURCE_KIND;
  run_id: string;
  seed: number;
  seed_namespace: string;
  seed_partition: string;
  parameter_snapshot_hash: string;
  generator_version: typeof SYNTHETIC_MARKET_GENERATOR_VERSION;
  event_kind: GeneratedMarketEventKind;
  symbol_profile_id: string;
  underlying_id: string;
  liquidity_profile_id: string;
  volatility_regime_id: string;
  option_chain_profile_id: string;
  scenario_id?: string;
};

export type GeneratedEventBatch = {
  run: SyntheticRun;
  parameter_snapshot: ParameterSnapshot;
  parameter_snapshot_hash: string;
  events: GeneratedMarketEvent[];
  provenance_by_trace_id: Record<string, EventProvenance>;
};

export type GenerateSyntheticMarketBatchInput = {
  seed_bundle: SeedBundle;
  profile: SyntheticMarketProfile;
  run_id?: string;
};

export type PrngSnapshot = {
  initial_seed: number;
  state: number;
  calls: number;
};

export type DeterministicPrng = {
  readonly initial_seed: number;
  nextFloat: () => number;
  nextInt: (min: number, max: number) => number;
  fork: (partition: string) => DeterministicPrng;
  snapshot: () => PrngSnapshot;
};

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

export const stableHash = (value: unknown): string => {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const hashGeneratedEventBatch = (batch: GeneratedEventBatch): string => {
  return stableHash({
    run: batch.run,
    events: batch.events,
    provenance_by_trace_id: batch.provenance_by_trace_id
  });
};

export const normalizeSeedBundle = (seedBundle: SeedBundle): NormalizedSeedBundle => {
  return {
    seed: toInteger(seedBundle.seed, 1),
    namespace: normalizeId(seedBundle.namespace, "default"),
    partition: normalizeId(seedBundle.partition, "market")
  };
};

export const createDeterministicPrng = (seedBundle: SeedBundle): DeterministicPrng => {
  const normalized = normalizeSeedBundle(seedBundle);
  const initial_seed = seedFromString(
    `${normalized.namespace}:${normalized.partition}:${normalized.seed}`
  );
  let state = initial_seed;
  let calls = 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    calls += 1;
    return (value ^ (value >>> 14)) >>> 0;
  };

  return {
    initial_seed,
    nextFloat: () => nextUint32() / 4_294_967_296,
    nextInt: (min: number, max: number) => {
      const lower = Math.ceil(Math.min(min, max));
      const upper = Math.floor(Math.max(min, max));
      return lower + Math.floor((nextUint32() / 4_294_967_296) * (upper - lower + 1));
    },
    fork: (partition: string) =>
      createDeterministicPrng({
        ...normalized,
        partition: `${normalized.partition}:${partition}:${state}:${calls}`
      }),
    snapshot: () => ({
      initial_seed,
      state,
      calls
    })
  };
};

export const normalizeSyntheticProfile = (
  profile: SyntheticMarketProfile
): NormalizedSyntheticMarketProfile => {
  const symbols = profile.symbols.map((symbol, index) => normalizeSymbolProfile(symbol, index));

  return {
    start_ts: toTimestamp(profile.start_ts, DEFAULT_START_TS),
    steps: Math.max(1, toInteger(profile.steps ?? 4, 4)),
    symbols:
      symbols.length > 0
        ? symbols
        : [normalizeSymbolProfile({ underlying_id: "SPY", base_price: 500 }, 0)],
    liquidity: normalizeLiquidityProfile(profile.liquidity),
    volatility: normalizeVolatilityRegime(profile.volatility),
    option_chain: normalizeOptionChainProfile(profile.option_chain),
    scenario_id: normalizeOptionalId(profile.scenario_id)
  };
};

export const buildParameterSnapshot = (
  seedBundle: SeedBundle,
  profile: SyntheticMarketProfile
): ParameterSnapshot => {
  return {
    generator_version: SYNTHETIC_MARKET_GENERATOR_VERSION,
    seed_bundle: normalizeSeedBundle(seedBundle),
    profile: normalizeSyntheticProfile(profile)
  };
};

export const generateSyntheticMarketBatch = (
  input: GenerateSyntheticMarketBatchInput
): GeneratedEventBatch => {
  const parameter_snapshot = buildParameterSnapshot(input.seed_bundle, input.profile);
  const parameter_snapshot_hash = stableHash(parameter_snapshot);
  const profile = parameter_snapshot.profile;
  const seed_bundle = parameter_snapshot.seed_bundle;
  const run_id = normalizeOptionalId(input.run_id) ?? `syn-${parameter_snapshot_hash.slice(-12)}`;
  const prng = createDeterministicPrng({
    ...seed_bundle,
    partition: `${seed_bundle.partition}:${parameter_snapshot_hash}`
  });
  const events: GeneratedMarketEvent[] = [];
  const provenance_by_trace_id: Record<string, EventProvenance> = {};
  let seq = 0;

  for (let step = 0; step < profile.steps; step += 1) {
    for (let symbolIndex = 0; symbolIndex < profile.symbols.length; symbolIndex += 1) {
      const symbol = profile.symbols[symbolIndex]!;
      const baseTs =
        profile.start_ts +
        step * profile.liquidity.arrival_interval_ms +
        symbolIndex * Math.max(4, Math.round(profile.liquidity.arrival_interval_ms / 10));
      const equity = buildEquityPair({
        symbol,
        profile,
        prng,
        step,
        baseTs,
        nextSeq: () => {
          seq += 1;
          return seq;
        },
        run_id
      });

      pushGeneratedEvent(events, provenance_by_trace_id, equity.quote, {
        event_kind: "equity_quote",
        seed_bundle,
        parameter_snapshot_hash,
        run_id,
        symbol,
        profile
      });
      pushGeneratedEvent(events, provenance_by_trace_id, equity.print, {
        event_kind: "equity_print",
        seed_bundle,
        parameter_snapshot_hash,
        run_id,
        symbol,
        profile
      });

      if (shouldEmitOptionContract(profile.option_chain, prng)) {
        const option = buildOptionPair({
          symbol,
          profile,
          prng,
          step,
          baseTs: baseTs + 2,
          underlying_mid: equity.mid,
          nextSeq: () => {
            seq += 1;
            return seq;
          },
          run_id
        });

        pushGeneratedEvent(events, provenance_by_trace_id, option.nbbo, {
          event_kind: "option_nbbo",
          seed_bundle,
          parameter_snapshot_hash,
          run_id,
          symbol,
          profile
        });
        pushGeneratedEvent(events, provenance_by_trace_id, option.print, {
          event_kind: "option_print",
          seed_bundle,
          parameter_snapshot_hash,
          run_id,
          symbol,
          profile
        });
      }
    }
  }

  const orderedEvents = orderGeneratedEvents(events);

  return {
    run: {
      run_id,
      seed_bundle,
      start_ts: profile.start_ts,
      event_count: orderedEvents.length,
      parameter_snapshot_hash
    },
    parameter_snapshot,
    parameter_snapshot_hash,
    events: orderedEvents,
    provenance_by_trace_id
  };
};

const orderGeneratedEvents = (events: GeneratedMarketEvent[]): GeneratedMarketEvent[] => {
  return [...events].sort((a, b) => {
    return (
      a.event.ts - b.event.ts ||
      a.event.ingest_ts - b.event.ingest_ts ||
      a.event.seq - b.event.seq ||
      a.event.trace_id.localeCompare(b.event.trace_id)
    );
  });
};

const pushGeneratedEvent = (
  events: GeneratedMarketEvent[],
  provenanceByTraceId: Record<string, EventProvenance>,
  generatedEvent: GeneratedMarketEvent,
  context: ProvenanceContext
) => {
  events.push(generatedEvent);
  provenanceByTraceId[generatedEvent.event.trace_id] = buildProvenance(context);
};

type ProvenanceContext = {
  event_kind: GeneratedMarketEventKind;
  seed_bundle: NormalizedSeedBundle;
  parameter_snapshot_hash: string;
  run_id: string;
  symbol: NormalizedSymbolProfile;
  profile: NormalizedSyntheticMarketProfile;
};

const buildProvenance = (context: ProvenanceContext): EventProvenance => ({
  source_kind: SYNTHETIC_SOURCE_KIND,
  run_id: context.run_id,
  seed: context.seed_bundle.seed,
  seed_namespace: context.seed_bundle.namespace,
  seed_partition: context.seed_bundle.partition,
  parameter_snapshot_hash: context.parameter_snapshot_hash,
  generator_version: SYNTHETIC_MARKET_GENERATOR_VERSION,
  event_kind: context.event_kind,
  symbol_profile_id: context.symbol.id,
  underlying_id: context.symbol.underlying_id,
  liquidity_profile_id: context.profile.liquidity.id,
  volatility_regime_id: context.profile.volatility.id,
  option_chain_profile_id: context.profile.option_chain.id,
  scenario_id: context.profile.scenario_id
});

type BuildEquityPairInput = {
  symbol: NormalizedSymbolProfile;
  profile: NormalizedSyntheticMarketProfile;
  prng: DeterministicPrng;
  step: number;
  baseTs: number;
  nextSeq: () => number;
  run_id: string;
};

const buildEquityPair = (input: BuildEquityPairInput) => {
  const { symbol, profile, prng, step, baseTs, nextSeq, run_id } = input;
  const mid = roundToTick(
    symbol.base_price *
      (1 +
        (profile.volatility.drift_bps_per_step * step +
          centered(prng.nextFloat()) * profile.volatility.price_noise_bps) /
          10_000)
  );
  const spread = roundSpread(mid, profile.liquidity.equity_spread_bps);
  const quote = buildQuote(mid, spread);
  const offExchangeFlag = prng.nextFloat() < profile.liquidity.off_exchange_ratio;
  const tradePlacement = offExchangeFlag ? "mid" : prng.nextFloat() < 0.5 ? "ask" : "bid";
  const tradePrice = priceForPlacement(quote, tradePlacement);
  const size = jitteredSize(profile.liquidity.equity_trade_size, prng);
  const quoteSeq = nextSeq();
  const printSeq = nextSeq();

  return {
    mid,
    quote: {
      kind: "equity_quote",
      event: {
        source_ts: baseTs,
        ingest_ts: baseTs,
        seq: quoteSeq,
        trace_id: traceId(run_id, "equity-quote", quoteSeq),
        ts: baseTs,
        underlying_id: symbol.underlying_id,
        bid: quote.bid,
        ask: quote.ask
      }
    } satisfies GeneratedMarketEvent,
    print: {
      kind: "equity_print",
      event: {
        source_ts: baseTs + 1,
        ingest_ts: baseTs + 1,
        seq: printSeq,
        trace_id: traceId(run_id, "equity-print", printSeq),
        ts: baseTs + 1,
        underlying_id: symbol.underlying_id,
        price: tradePrice,
        size,
        exchange: offExchangeFlag ? "OTC" : symbol.exchange,
        offExchangeFlag
      }
    } satisfies GeneratedMarketEvent
  };
};

type BuildOptionPairInput = {
  symbol: NormalizedSymbolProfile;
  profile: NormalizedSyntheticMarketProfile;
  prng: DeterministicPrng;
  step: number;
  baseTs: number;
  underlying_mid: number;
  nextSeq: () => number;
  run_id: string;
};

const buildOptionPair = (input: BuildOptionPairInput) => {
  const { symbol, profile, prng, step, baseTs, underlying_mid, nextSeq, run_id } = input;
  const chain = profile.option_chain;
  const expiryDays = pickByIndex(
    chain.expiries_days,
    step + prng.nextInt(0, chain.expiries_days.length - 1)
  );
  const strikeOffset = pickByIndex(
    chain.strike_offsets_bps,
    step + prng.nextInt(0, chain.strike_offsets_bps.length - 1)
  );
  const option_type = pickByIndex(
    chain.option_types,
    step + prng.nextInt(0, chain.option_types.length - 1)
  );
  const right = option_type === "call" ? "C" : "P";
  const expiry = expiryFromOffset(profile.start_ts, expiryDays);
  const strike = roundToStep(underlying_mid * (1 + strikeOffset / 10_000), chain.strike_step);
  const option_contract_id = `${symbol.option_root}-${expiry}-${strike.toFixed(2)}-${right}`;
  const optionMid = optionMidPrice({
    underlying_mid,
    strike,
    option_type,
    expiryDays,
    volatility: profile.volatility
  });
  const spread = roundSpread(optionMid, profile.liquidity.option_spread_bps);
  const quote = buildQuote(optionMid, spread);
  const placement = prng.nextFloat() < 0.56 ? "ask" : prng.nextFloat() < 0.72 ? "mid" : "bid";
  const price = priceForPlacement(quote, placement);
  const nbboSeq = nextSeq();
  const printSeq = nextSeq();
  const bidSize = jitteredSize(profile.liquidity.option_quote_size, prng);
  const askSize = jitteredSize(profile.liquidity.option_quote_size, prng);
  const size = jitteredSize(profile.liquidity.option_trade_size, prng);

  return {
    nbbo: {
      kind: "option_nbbo",
      event: {
        source_ts: baseTs,
        ingest_ts: baseTs,
        seq: nbboSeq,
        trace_id: traceId(run_id, "option-nbbo", nbboSeq),
        ts: baseTs,
        option_contract_id,
        bid: quote.bid,
        ask: quote.ask,
        bidSize,
        askSize
      }
    } satisfies GeneratedMarketEvent,
    print: {
      kind: "option_print",
      event: {
        source_ts: baseTs + 1,
        ingest_ts: baseTs + 1,
        seq: printSeq,
        trace_id: traceId(run_id, "option-print", printSeq),
        ts: baseTs + 1,
        option_contract_id,
        price,
        size,
        exchange: symbol.exchange,
        conditions: ["FILL"],
        underlying_id: symbol.underlying_id,
        option_type,
        notional: roundToTick(price * size * 100),
        execution_nbbo_bid: quote.bid,
        execution_nbbo_ask: quote.ask,
        execution_nbbo_mid: roundToTick((quote.bid + quote.ask) / 2),
        execution_nbbo_spread: roundToTick(quote.ask - quote.bid),
        execution_nbbo_bid_size: bidSize,
        execution_nbbo_ask_size: askSize,
        execution_nbbo_ts: baseTs,
        execution_nbbo_age_ms: 1,
        execution_nbbo_side: placement === "ask" ? "A" : placement === "bid" ? "B" : "MID",
        execution_underlying_mid: underlying_mid,
        execution_underlying_ts: baseTs - 1,
        execution_underlying_age_ms: 2,
        execution_underlying_source: "equity_quote_mid",
        execution_iv: profile.volatility.option_iv,
        execution_iv_source: "synthetic_pressure_model"
      }
    } satisfies GeneratedMarketEvent
  };
};

const normalizeSymbolProfile = (symbol: SymbolProfile, index: number): NormalizedSymbolProfile => {
  const underlying_id = normalizeSymbol(symbol.underlying_id, `SYM${index + 1}`);

  return {
    id: normalizeId(symbol.id, underlying_id.toLowerCase()),
    underlying_id,
    base_price: roundToTick(Math.max(1, toFiniteNumber(symbol.base_price, 100))),
    exchange: normalizeExchange(symbol.exchange),
    option_root: normalizeSymbol(symbol.option_root ?? underlying_id, underlying_id)
  };
};

const normalizeLiquidityProfile = (
  liquidity: LiquidityProfile | undefined
): NormalizedLiquidityProfile => ({
  id: normalizeId(liquidity?.id, "baseline-liquidity"),
  equity_spread_bps: clamp(toFiniteNumber(liquidity?.equity_spread_bps, 8), 1, 250),
  equity_quote_size: Math.max(1, toInteger(liquidity?.equity_quote_size ?? 600, 600)),
  equity_trade_size: Math.max(1, toInteger(liquidity?.equity_trade_size ?? 120, 120)),
  option_spread_bps: clamp(toFiniteNumber(liquidity?.option_spread_bps, 180), 5, 2_500),
  option_quote_size: Math.max(1, toInteger(liquidity?.option_quote_size ?? 80, 80)),
  option_trade_size: Math.max(1, toInteger(liquidity?.option_trade_size ?? 24, 24)),
  off_exchange_ratio: clamp(toFiniteNumber(liquidity?.off_exchange_ratio, 0.18), 0, 1),
  arrival_interval_ms: Math.max(1, toInteger(liquidity?.arrival_interval_ms ?? 250, 250))
});

const normalizeVolatilityRegime = (
  volatility: VolatilityRegime | undefined
): NormalizedVolatilityRegime => ({
  id: normalizeId(volatility?.id, "normal-volatility"),
  drift_bps_per_step: clamp(toFiniteNumber(volatility?.drift_bps_per_step, 1.5), -250, 250),
  price_noise_bps: clamp(toFiniteNumber(volatility?.price_noise_bps, 8), 0, 500),
  option_iv: clamp(toFiniteNumber(volatility?.option_iv, 0.32), 0.01, 3)
});

const normalizeOptionChainProfile = (
  optionChain: OptionChainProfile | undefined
): NormalizedOptionChainProfile => ({
  id: normalizeId(optionChain?.id, "sparse-weekly-chain"),
  expiries_days: normalizePositiveIntegerList(optionChain?.expiries_days, [7, 14, 30]),
  strike_offsets_bps: normalizeNumberList(optionChain?.strike_offsets_bps, [-500, 0, 500]),
  option_types: normalizeOptionTypes(optionChain?.option_types),
  strike_step: clamp(toFiniteNumber(optionChain?.strike_step, 5), 0.5, 25),
  sparse_contract_ratio: clamp(toFiniteNumber(optionChain?.sparse_contract_ratio, 0.25), 0, 0.95)
});

const normalizeOptionTypes = (types: OptionType[] | undefined): OptionType[] => {
  const normalized = [
    ...new Set((types ?? ["call", "put"]).filter((value) => value === "call" || value === "put"))
  ];
  return normalized.length > 0 ? normalized : ["call", "put"];
};

const normalizePositiveIntegerList = (
  values: number[] | undefined,
  fallback: number[]
): number[] => {
  const normalized = normalizeNumberList(values, fallback)
    .map((value) => Math.max(1, Math.round(value)))
    .filter((value, index, entries) => entries.indexOf(value) === index)
    .sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : fallback;
};

const normalizeNumberList = (values: number[] | undefined, fallback: number[]): number[] => {
  const normalized = (values?.length ? values : fallback)
    .map((value) => toFiniteNumber(value, Number.NaN))
    .filter((value) => Number.isFinite(value));
  return normalized.length > 0 ? normalized : fallback;
};

const shouldEmitOptionContract = (
  optionChain: NormalizedOptionChainProfile,
  prng: DeterministicPrng
): boolean => prng.nextFloat() >= optionChain.sparse_contract_ratio;

const buildQuote = (mid: number, spread: number): { bid: number; ask: number } => {
  const bid = Math.max(0.01, roundToTick(mid - spread / 2));
  const ask = Math.max(roundToTick(bid + 0.01), roundToTick(mid + spread / 2));
  return {
    bid,
    ask
  };
};

const roundSpread = (mid: number, spreadBps: number): number => {
  return Math.max(0.01, roundToTick(mid * (spreadBps / 10_000)));
};

const priceForPlacement = (
  quote: { bid: number; ask: number },
  placement: "bid" | "mid" | "ask"
): number => {
  if (placement === "ask") {
    return quote.ask;
  }
  if (placement === "bid") {
    return quote.bid;
  }
  return roundToTick((quote.bid + quote.ask) / 2);
};

const optionMidPrice = (input: {
  underlying_mid: number;
  strike: number;
  option_type: OptionType;
  expiryDays: number;
  volatility: NormalizedVolatilityRegime;
}): number => {
  const intrinsic =
    input.option_type === "call"
      ? Math.max(0, input.underlying_mid - input.strike)
      : Math.max(0, input.strike - input.underlying_mid);
  const timeValue =
    input.underlying_mid *
    input.volatility.option_iv *
    Math.sqrt(Math.max(1, input.expiryDays) / 365) *
    0.08;
  return Math.max(0.05, roundToTick(intrinsic + timeValue));
};

const jitteredSize = (base: number, prng: DeterministicPrng): number => {
  return Math.max(1, Math.round(base * (0.75 + prng.nextFloat() * 0.55)));
};

const expiryFromOffset = (startTs: number, expiryDays: number): string => {
  return new Date(startTs + expiryDays * MS_PER_DAY).toISOString().slice(0, 10);
};

const traceId = (runId: string, stream: string, seq: number): string => {
  return `${runId}:${stream}:${seq}`;
};

const pickByIndex = <T>(values: T[], index: number): T => {
  return values[Math.abs(index) % values.length]!;
};

const centered = (value: number): number => value * 2 - 1;

const roundToTick = (value: number, tick = 0.01): number => {
  return Number((Math.round(value / tick) * tick).toFixed(6));
};

const roundToStep = (value: number, step: number): number => {
  return Number((Math.round(value / step) * step).toFixed(2));
};

const normalizeSymbol = (value: string | undefined, fallback: string): string => {
  const normalized = value
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "");
  return normalized && normalized.length > 0 ? normalized : fallback;
};

const normalizeExchange = (value: string | undefined): string => {
  return normalizeSymbol(value, "TEST");
};

const normalizeOptionalId = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const normalizeId = (value: string | undefined, fallback: string): string => {
  return normalizeOptionalId(value) ?? fallback;
};

const toTimestamp = (value: number | undefined, fallback: number): number => {
  return Math.max(0, toInteger(value ?? fallback, fallback));
};

const toInteger = (value: number, fallback: number): number => {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
};

const toFiniteNumber = (value: number | undefined, fallback: number): number => {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const seedFromString = (value: string): number => {
  const hex = stableHash(value).slice(-8);
  const seed = Number.parseInt(hex, 16) >>> 0;
  return seed === 0 ? 0x9e3779b9 : seed;
};
