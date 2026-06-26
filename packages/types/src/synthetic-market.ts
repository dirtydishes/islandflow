import { z } from "zod";
import type { SmartFlowProfileId } from "./events";
import type { SyntheticMarketMode } from "./options-flow";
import { SP500_SYMBOLS } from "./sp500";

const SYNTHETIC_PROFILE_WEIGHT_VALUES = [0.6, 1.0, 1.6] as const;
const SYNTHETIC_COVERAGE_WINDOW_VALUES = [10, 20, 30] as const;
const SYNTHETIC_DEMO_PROFILE_IDS = [
  "market-command",
  "event-response",
  "quiet-range",
  "stress-tape"
] as const;
const SYNTHETIC_LOAD_PROFILE_IDS = ["steady", "active", "firehose"] as const;
const SYNTHETIC_SYMBOLS = ["SPY", ...(SP500_SYMBOLS as readonly string[])];
const EVENT_SYMBOL_POOL = [
  "AAPL",
  "MSFT",
  "NVDA",
  "META",
  "AMZN",
  "TSLA",
  "GOOGL",
  "NFLX",
  "AMD",
  "AVGO"
] as const;
const SMART_FLOW_PROFILE_IDS = [
  "institutional_directional",
  "retail_whale",
  "event_driven",
  "vol_seller",
  "arbitrage",
  "hedge_reactive"
] as const satisfies readonly SmartFlowProfileId[];
const SYNTHETIC_SCENARIO_FAMILY_IDS = [...SMART_FLOW_PROFILE_IDS, "neutral_noise"] as const;
const REGIME_IDS = [
  "trend_up",
  "trend_down",
  "mean_revert",
  "retail_chase",
  "event_ramp",
  "dealer_gamma",
  "arb_calm"
] as const;

export const SyntheticControlPresetIdSchema = z.enum([
  "balanced_demo",
  "event_day",
  "dealer_day",
  "retail_chase",
  "quiet_range"
]);
export type SyntheticControlPresetId = z.infer<typeof SyntheticControlPresetIdSchema>;

export const SyntheticDemoProfileIdSchema = z.enum(SYNTHETIC_DEMO_PROFILE_IDS);
export type SyntheticDemoProfileId = z.infer<typeof SyntheticDemoProfileIdSchema>;

export const SyntheticLoadProfileIdSchema = z.enum(SYNTHETIC_LOAD_PROFILE_IDS);
export type SyntheticLoadProfileId = z.infer<typeof SyntheticLoadProfileIdSchema>;

export const SyntheticCoverageWindowMinutesSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(30)
]);
export type SyntheticCoverageWindowMinutes = z.infer<typeof SyntheticCoverageWindowMinutesSchema>;

export const SyntheticProfileWeightValueSchema = z.union([
  z.literal(0.6),
  z.literal(1.0),
  z.literal(1.6)
]);
export type SyntheticProfileWeightValue = z.infer<typeof SyntheticProfileWeightValueSchema>;

export const SyntheticProfileWeightMapSchema = z
  .object({
    institutional_directional: SyntheticProfileWeightValueSchema,
    retail_whale: SyntheticProfileWeightValueSchema,
    event_driven: SyntheticProfileWeightValueSchema,
    vol_seller: SyntheticProfileWeightValueSchema,
    arbitrage: SyntheticProfileWeightValueSchema,
    hedge_reactive: SyntheticProfileWeightValueSchema
  })
  .strict();
export type SyntheticProfileWeightMap = z.infer<typeof SyntheticProfileWeightMapSchema>;

export const SyntheticControlStateSchema = z
  .object({
    demo_profile_id: SyntheticDemoProfileIdSchema,
    load_profile_id: SyntheticLoadProfileIdSchema,
    preset_id: SyntheticControlPresetIdSchema,
    coverage_assist: z.boolean(),
    coverage_window_minutes: SyntheticCoverageWindowMinutesSchema,
    shared_seed: z.number().int(),
    profile_weights: SyntheticProfileWeightMapSchema,
    updated_at: z.number().int().nonnegative(),
    updated_by: z.string().trim().min(1)
  })
  .strict();
export type SyntheticControlState = z.infer<typeof SyntheticControlStateSchema>;

export const SyntheticSessionPhaseSchema = z.enum(["open", "midday", "power_hour", "after_event"]);
export type SyntheticSessionPhase = z.infer<typeof SyntheticSessionPhaseSchema>;

export const SyntheticRegimeSchema = z.enum(REGIME_IDS);
export type SyntheticRegime = z.infer<typeof SyntheticRegimeSchema>;

export const SyntheticScenarioFamilyIdSchema = z.enum(SYNTHETIC_SCENARIO_FAMILY_IDS);
export type SyntheticScenarioFamilyId = z.infer<typeof SyntheticScenarioFamilyIdSchema>;

export const SyntheticCoverageConfigSchema = z
  .object({
    coverage_assist: z.boolean(),
    coverage_window_minutes: SyntheticCoverageWindowMinutesSchema
  })
  .strict();
export type SyntheticCoverageConfig = z.infer<typeof SyntheticCoverageConfigSchema>;

export const SyntheticDerivedStatusSchema = z
  .object({
    session_phase: SyntheticSessionPhaseSchema,
    regime: SyntheticRegimeSchema,
    focus_symbols: z.array(z.string()),
    profile_hit_counts: z.record(z.number().int().nonnegative()),
    coverage_window_minutes: SyntheticCoverageWindowMinutesSchema
  })
  .strict();
export type SyntheticDerivedStatus = z.infer<typeof SyntheticDerivedStatusSchema>;

export type SyntheticSessionState = {
  session_phase: SyntheticSessionPhase;
  regime: SyntheticRegime;
  volatility_level: number;
  liquidity_level: number;
  quote_cleanliness: number;
  focus_symbols: string[];
  event_symbols: string[];
  seed_bucket: number;
};

export type SyntheticUnderlyingState = {
  mid: number;
  bid: number;
  ask: number;
  spread: number;
  driftBps: number;
  shockBps: number;
  sessionVolatility: number;
  liquiditySkew: number;
  quoteCleanliness: number;
  clusteringScore: number;
  offExchangeBias: number;
};

export type SyntheticScenarioWeightMap = Record<SyntheticScenarioFamilyId, number>;

export type SyntheticCoverageState = {
  profile_hit_counts: Record<SmartFlowProfileId, number>;
};

export type SyntheticBurstPulse = {
  active: boolean;
  intensity: number;
  focusSymbols: string[];
  bucket: number;
};

const DEFAULT_PROFILE_WEIGHTS: SyntheticProfileWeightMap = {
  institutional_directional: 1.0,
  retail_whale: 1.0,
  event_driven: 1.0,
  vol_seller: 1.0,
  arbitrage: 1.0,
  hedge_reactive: 1.0
};

export const DEFAULT_SYNTHETIC_CONTROL_STATE: SyntheticControlState = {
  demo_profile_id: "market-command",
  load_profile_id: "steady",
  preset_id: "balanced_demo",
  coverage_assist: true,
  coverage_window_minutes: 20,
  shared_seed: 11,
  profile_weights: DEFAULT_PROFILE_WEIGHTS,
  updated_at: 0,
  updated_by: "system"
};

const PRESET_REGIME_BIAS: Record<SyntheticControlPresetId, Record<SyntheticRegime, number>> = {
  balanced_demo: {
    trend_up: 1.0,
    trend_down: 0.95,
    mean_revert: 1.05,
    retail_chase: 0.95,
    event_ramp: 0.85,
    dealer_gamma: 0.95,
    arb_calm: 0.95
  },
  event_day: {
    trend_up: 0.9,
    trend_down: 0.9,
    mean_revert: 0.75,
    retail_chase: 0.95,
    event_ramp: 1.9,
    dealer_gamma: 1.0,
    arb_calm: 0.55
  },
  dealer_day: {
    trend_up: 0.85,
    trend_down: 0.85,
    mean_revert: 0.9,
    retail_chase: 0.85,
    event_ramp: 0.7,
    dealer_gamma: 1.95,
    arb_calm: 0.8
  },
  retail_chase: {
    trend_up: 1.1,
    trend_down: 0.7,
    mean_revert: 0.6,
    retail_chase: 2.0,
    event_ramp: 0.95,
    dealer_gamma: 0.95,
    arb_calm: 0.45
  },
  quiet_range: {
    trend_up: 0.7,
    trend_down: 0.7,
    mean_revert: 1.35,
    retail_chase: 0.45,
    event_ramp: 0.5,
    dealer_gamma: 0.75,
    arb_calm: 1.8
  }
};

const PRESET_ACTIVITY_BIAS: Record<
  SyntheticControlPresetId,
  { focusCount: number; eventCount: number; amplitude: number }
> = {
  balanced_demo: { focusCount: 3, eventCount: 2, amplitude: 1.0 },
  event_day: { focusCount: 4, eventCount: 3, amplitude: 1.28 },
  dealer_day: { focusCount: 3, eventCount: 1, amplitude: 1.12 },
  retail_chase: { focusCount: 4, eventCount: 1, amplitude: 1.25 },
  quiet_range: { focusCount: 2, eventCount: 1, amplitude: 0.72 }
};

const REGIME_PROFILE_BIAS: Record<SyntheticRegime, SyntheticScenarioWeightMap> = {
  trend_up: {
    institutional_directional: 1.35,
    retail_whale: 1.05,
    event_driven: 0.9,
    vol_seller: 0.78,
    arbitrage: 0.72,
    hedge_reactive: 0.82,
    neutral_noise: 0.82
  },
  trend_down: {
    institutional_directional: 1.2,
    retail_whale: 0.82,
    event_driven: 0.88,
    vol_seller: 0.8,
    arbitrage: 0.78,
    hedge_reactive: 1.22,
    neutral_noise: 0.85
  },
  mean_revert: {
    institutional_directional: 0.92,
    retail_whale: 0.78,
    event_driven: 0.8,
    vol_seller: 1.18,
    arbitrage: 1.28,
    hedge_reactive: 0.92,
    neutral_noise: 1.2
  },
  retail_chase: {
    institutional_directional: 1.04,
    retail_whale: 1.72,
    event_driven: 0.9,
    vol_seller: 0.7,
    arbitrage: 0.58,
    hedge_reactive: 0.98,
    neutral_noise: 0.72
  },
  event_ramp: {
    institutional_directional: 1.08,
    retail_whale: 0.96,
    event_driven: 1.95,
    vol_seller: 0.74,
    arbitrage: 0.62,
    hedge_reactive: 1.04,
    neutral_noise: 0.58
  },
  dealer_gamma: {
    institutional_directional: 0.94,
    retail_whale: 1.02,
    event_driven: 0.78,
    vol_seller: 0.84,
    arbitrage: 0.92,
    hedge_reactive: 1.74,
    neutral_noise: 0.76
  },
  arb_calm: {
    institutional_directional: 0.68,
    retail_whale: 0.58,
    event_driven: 0.62,
    vol_seller: 1.28,
    arbitrage: 1.78,
    hedge_reactive: 0.72,
    neutral_noise: 1.34
  }
};

const REGIME_STATE_BASE: Record<
  SyntheticRegime,
  {
    volatility: number;
    liquidity: number;
    quoteCleanliness: number;
    offExchangeBias: number;
  }
> = {
  trend_up: {
    volatility: 0.72,
    liquidity: 0.72,
    quoteCleanliness: 0.64,
    offExchangeBias: 0.46
  },
  trend_down: {
    volatility: 0.78,
    liquidity: 0.66,
    quoteCleanliness: 0.58,
    offExchangeBias: 0.52
  },
  mean_revert: {
    volatility: 0.5,
    liquidity: 0.84,
    quoteCleanliness: 0.8,
    offExchangeBias: 0.34
  },
  retail_chase: {
    volatility: 0.88,
    liquidity: 0.62,
    quoteCleanliness: 0.5,
    offExchangeBias: 0.58
  },
  event_ramp: {
    volatility: 0.92,
    liquidity: 0.56,
    quoteCleanliness: 0.42,
    offExchangeBias: 0.54
  },
  dealer_gamma: {
    volatility: 0.82,
    liquidity: 0.66,
    quoteCleanliness: 0.48,
    offExchangeBias: 0.5
  },
  arb_calm: {
    volatility: 0.34,
    liquidity: 0.9,
    quoteCleanliness: 0.88,
    offExchangeBias: 0.3
  }
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const roundTo = (value: number, digits = 4): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
};

const signedNoise = (seed: number): number => {
  const raw = Math.sin(seed * 12.9898) * 43_758.5453;
  return (raw - Math.floor(raw)) * 2 - 1;
};

const positiveNoise = (seed: number): number => {
  return (signedNoise(seed) + 1) / 2;
};

const mixSeed = (...parts: number[]): number => {
  let seed = 0x811c9dc5;
  for (const part of parts) {
    seed ^= Math.floor(part) >>> 0;
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return seed >>> 0;
};

const pick = <T>(items: readonly T[], seed: number): T => {
  const index = Math.abs(seed) % items.length;
  return items[index]!;
};

const pickManyUnique = <T>(items: readonly T[], count: number, seed: number): T[] => {
  const pool = [...items];
  const output: T[] = [];
  let cursor = seed;
  while (pool.length > 0 && output.length < count) {
    const index = Math.abs(cursor) % pool.length;
    output.push(pool.splice(index, 1)[0]!);
    cursor = mixSeed(cursor, output.length * 17 + 3);
  }
  return output;
};

const weightedPick = <T extends string>(weights: Record<T, number>, seed: number): T => {
  const entries = Object.entries(weights) as Array<[T, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0.0001, weight), 0);
  let target = positiveNoise(seed) * total;
  for (const [value, weight] of entries) {
    target -= Math.max(0.0001, weight);
    if (target <= 0) {
      return value;
    }
  }
  return entries[entries.length - 1]![0];
};

const getSessionMinute = (ts: number): number => {
  const minute = Math.floor(ts / 60_000);
  return ((minute % 390) + 390) % 390;
};

export const hashSyntheticSymbol = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

export const buildEmptySyntheticProfileHitCounts = (): Record<SmartFlowProfileId, number> => ({
  institutional_directional: 0,
  retail_whale: 0,
  event_driven: 0,
  vol_seller: 0,
  arbitrage: 0,
  hedge_reactive: 0
});

export const normalizeSyntheticControlState = (
  control: Partial<SyntheticControlState> | null | undefined
): SyntheticControlState => {
  const merged: SyntheticControlState = {
    ...DEFAULT_SYNTHETIC_CONTROL_STATE,
    ...control,
    profile_weights: {
      ...DEFAULT_SYNTHETIC_CONTROL_STATE.profile_weights,
      ...(control?.profile_weights ?? {})
    }
  };
  return SyntheticControlStateSchema.parse(merged);
};

const resolvePhaseBias = (phase: SyntheticSessionPhase, regime: SyntheticRegime): number => {
  if (phase === "open") {
    return regime === "event_ramp" ? 1.08 : 1.02;
  }
  if (phase === "power_hour") {
    return regime === "retail_chase" || regime === "dealer_gamma" ? 1.08 : 1.03;
  }
  if (phase === "after_event") {
    return regime === "event_ramp" ? 1.24 : 1.0;
  }
  return 1.0;
};

const resolveSessionPhase = (
  minuteOfSession: number,
  eventActive: boolean,
  eventOffset: number
): SyntheticSessionPhase => {
  if (eventActive && eventOffset > 0.58) {
    return "after_event";
  }
  if (minuteOfSession < 60) {
    return "open";
  }
  if (minuteOfSession >= 300) {
    return "power_hour";
  }
  return "midday";
};

export const getSyntheticSessionState = (
  ts: number,
  control: Partial<SyntheticControlState> | null | undefined = DEFAULT_SYNTHETIC_CONTROL_STATE
): SyntheticSessionState => {
  const normalized = normalizeSyntheticControlState(control);
  const minuteOfSession = getSessionMinute(ts);
  const bucketMs = 5 * 60_000;
  const seedBucket = Math.floor(ts / bucketMs);
  const presetBias = PRESET_REGIME_BIAS[normalized.preset_id];
  const eventSeed = mixSeed(normalized.shared_seed, seedBucket, normalized.updated_at);
  const eventBucketOffset = positiveNoise(eventSeed + 41);
  const eventActive =
    normalized.preset_id === "event_day" ||
    eventBucketOffset > (normalized.preset_id === "balanced_demo" ? 0.72 : 0.6);
  const prePhase = resolveSessionPhase(minuteOfSession, eventActive, eventBucketOffset);
  const regimeWeights = REGIME_IDS.reduce(
    (acc, regime) => {
      const drift = 0.82 + positiveNoise(mixSeed(eventSeed, regime.length * 29)) * 0.38;
      acc[regime] = presetBias[regime] * drift * resolvePhaseBias(prePhase, regime);
      return acc;
    },
    {} as Record<SyntheticRegime, number>
  );
  const regime = weightedPick(regimeWeights, mixSeed(eventSeed, 97));
  const phase = resolveSessionPhase(
    minuteOfSession,
    eventActive || regime === "event_ramp",
    eventBucketOffset
  );
  const presetActivity = PRESET_ACTIVITY_BIAS[normalized.preset_id];
  const stateBase = REGIME_STATE_BASE[regime];
  const activitySeed = mixSeed(eventSeed, minuteOfSession, regime.length * 13);
  const eventCount =
    regime === "event_ramp" || phase === "after_event"
      ? Math.max(2, presetActivity.eventCount)
      : presetActivity.eventCount;
  const focusCount =
    regime === "retail_chase" || regime === "event_ramp"
      ? presetActivity.focusCount + 1
      : presetActivity.focusCount;
  const event_symbols: string[] = pickManyUnique(
    EVENT_SYMBOL_POOL,
    eventCount,
    mixSeed(activitySeed, 211)
  );
  const focus_symbols: string[] = pickManyUnique(
    [...event_symbols, ...SYNTHETIC_SYMBOLS.filter((symbol) => !event_symbols.includes(symbol))],
    focusCount,
    mixSeed(activitySeed, 389)
  );
  const amplitude = presetActivity.amplitude;

  return {
    session_phase: phase,
    regime,
    volatility_level: roundTo(
      clamp(stateBase.volatility * amplitude + signedNoise(activitySeed + 3) * 0.08, 0.18, 1.2)
    ),
    liquidity_level: roundTo(
      clamp(
        stateBase.liquidity - (amplitude - 1) * 0.08 + signedNoise(activitySeed + 5) * 0.06,
        0.2,
        1.1
      )
    ),
    quote_cleanliness: roundTo(
      clamp(
        stateBase.quoteCleanliness - (amplitude - 1) * 0.1 + signedNoise(activitySeed + 7) * 0.06,
        0.18,
        0.96
      )
    ),
    focus_symbols,
    event_symbols,
    seed_bucket: seedBucket
  };
};

const isModeString = (
  value: Partial<SyntheticControlState> | SyntheticMarketMode | null | undefined
): value is SyntheticMarketMode => {
  return value === "realistic" || value === "active" || value === "firehose";
};

export const getSyntheticUnderlyingState = (
  symbol: string,
  ts: number,
  controlOrMode:
    | Partial<SyntheticControlState>
    | SyntheticMarketMode
    | null
    | undefined = DEFAULT_SYNTHETIC_CONTROL_STATE,
  sessionState?: SyntheticSessionState
): SyntheticUnderlyingState => {
  const control = isModeString(controlOrMode)
    ? DEFAULT_SYNTHETIC_CONTROL_STATE
    : normalizeSyntheticControlState(controlOrMode);
  const session = sessionState ?? getSyntheticSessionState(ts, control);
  const hash = hashSyntheticSymbol(symbol);
  const minuteOfSession = getSessionMinute(ts);
  const base = 25 + (hash % 475);
  const isFocus = session.focus_symbols.includes(symbol);
  const isEvent = session.event_symbols.includes(symbol);
  const regimeDirection =
    session.regime === "trend_up" || session.regime === "retail_chase"
      ? 1
      : session.regime === "trend_down"
        ? -1
        : 0;
  const trendWave =
    Math.sin((minuteOfSession + (hash % 71) + session.seed_bucket) / 29) * 0.55 +
    Math.cos((minuteOfSession + (hash % 37) + session.seed_bucket) / 17) * 0.28;
  const meanRevertWave =
    Math.sin((minuteOfSession + (hash % 19)) / 6) * 0.42 -
    Math.sin((minuteOfSession + (hash % 13)) / 19) * 0.24;
  const eventDrift =
    isEvent && (session.regime === "event_ramp" || session.session_phase === "after_event")
      ? 1.25
      : 0;
  const focusBoost = isFocus ? 1.18 : 0.92;
  const directionBps =
    regimeDirection * (14 + session.volatility_level * 36) * focusBoost +
    trendWave * 22 * focusBoost +
    eventDrift * 18;
  const reversionBps =
    session.regime === "mean_revert" || session.regime === "arb_calm"
      ? -meanRevertWave * (12 + session.liquidity_level * 10)
      : meanRevertWave * 6;
  const gammaChop =
    session.regime === "dealer_gamma" ? Math.sin((minuteOfSession + (hash % 11)) / 2.8) * 16 : 0;
  const noiseBps =
    signedNoise(mixSeed(hash, session.seed_bucket, control.shared_seed)) *
    (6 + session.volatility_level * 18);
  const driftBps = directionBps + reversionBps + gammaChop;
  const shockBps = noiseBps + (isFocus ? signedNoise(hash + minuteOfSession) * 6 : 0);
  const totalBps = driftBps + shockBps;
  const mid = Math.max(0.01, Number((base * (1 + totalBps / 10_000)).toFixed(2)));
  const spreadBps =
    4 +
    session.volatility_level * 14 +
    (1 - session.liquidity_level) * 10 +
    (1 - session.quote_cleanliness) * 12 +
    (session.session_phase === "open" ? 3 : 0) +
    (session.session_phase === "power_hour" ? 2 : 0);
  const spread = Math.max(0.01, Number((mid * (spreadBps / 10_000)).toFixed(2)));
  const halfSpread = spread / 2;
  const bid = Number(Math.max(0.01, mid - halfSpread).toFixed(2));
  const ask = Number(Math.max(bid + 0.01, mid + halfSpread).toFixed(2));
  const clusteringScore = clamp(
    (isFocus ? 0.34 : 0.12) +
      (session.regime === "dealer_gamma" ? 0.28 : 0) +
      (session.regime === "retail_chase" ? 0.16 : 0),
    0,
    1
  );

  return {
    mid,
    bid,
    ask,
    spread: Number((ask - bid).toFixed(2)),
    driftBps: roundTo(driftBps),
    shockBps: roundTo(shockBps),
    sessionVolatility: roundTo(session.volatility_level),
    liquiditySkew: roundTo(session.liquidity_level),
    quoteCleanliness: roundTo(session.quote_cleanliness),
    clusteringScore: roundTo(clusteringScore),
    offExchangeBias: roundTo(
      clamp(
        REGIME_STATE_BASE[session.regime].offExchangeBias +
          (isFocus ? 0.08 : 0) +
          (isEvent ? 0.05 : 0),
        0.08,
        0.92
      )
    )
  };
};

export const getSyntheticScenarioWeights = (
  symbol: string,
  ts: number,
  control: Partial<SyntheticControlState> | null | undefined = DEFAULT_SYNTHETIC_CONTROL_STATE,
  sessionState?: SyntheticSessionState
): SyntheticScenarioWeightMap => {
  const normalized = normalizeSyntheticControlState(control);
  const session = sessionState ?? getSyntheticSessionState(ts, normalized);
  const base = REGIME_PROFILE_BIAS[session.regime];
  const isFocus = session.focus_symbols.includes(symbol);
  const isEvent = session.event_symbols.includes(symbol);
  const isPower = session.session_phase === "open" || session.session_phase === "power_hour";
  const weights: SyntheticScenarioWeightMap = {
    institutional_directional: base.institutional_directional,
    retail_whale: base.retail_whale,
    event_driven: base.event_driven,
    vol_seller: base.vol_seller,
    arbitrage: base.arbitrage,
    hedge_reactive: base.hedge_reactive,
    neutral_noise: base.neutral_noise
  };

  for (const profileId of SMART_FLOW_PROFILE_IDS) {
    weights[profileId] = roundTo(weights[profileId] * normalized.profile_weights[profileId], 4);
  }

  if (isFocus) {
    weights.institutional_directional = roundTo(weights.institutional_directional * 1.08, 4);
    weights.retail_whale = roundTo(weights.retail_whale * 1.14, 4);
    weights.hedge_reactive = roundTo(weights.hedge_reactive * 1.08, 4);
    weights.neutral_noise = roundTo(weights.neutral_noise * 0.92, 4);
  }
  if (isEvent) {
    weights.event_driven = roundTo(weights.event_driven * 1.36, 4);
    weights.institutional_directional = roundTo(weights.institutional_directional * 1.04, 4);
    weights.neutral_noise = roundTo(weights.neutral_noise * 0.8, 4);
  }
  if (isPower) {
    weights.retail_whale = roundTo(weights.retail_whale * 1.08, 4);
    weights.hedge_reactive = roundTo(weights.hedge_reactive * 1.06, 4);
  }
  if (normalized.preset_id === "quiet_range") {
    weights.neutral_noise = roundTo(weights.neutral_noise * 1.18, 4);
  }

  return weights;
};

export const getSyntheticCoverageBoost = (
  profileId: SmartFlowProfileId,
  coverageState: SyntheticCoverageState,
  control: Pick<SyntheticControlState, "coverage_assist" | "coverage_window_minutes">
): number => {
  if (!control.coverage_assist) {
    return 1;
  }

  const counts = SMART_FLOW_PROFILE_IDS.map(
    (candidate) => coverageState.profile_hit_counts[candidate] ?? 0
  );
  const targetCount = coverageState.profile_hit_counts[profileId] ?? 0;
  const maxCount = Math.max(...counts);
  const averageCount =
    counts.reduce((sum, value) => sum + value, 0) / SMART_FLOW_PROFILE_IDS.length;
  if (maxCount <= 0) {
    return 1;
  }

  const imbalance = clamp((maxCount - targetCount) / Math.max(1, maxCount), 0, 1);
  const averageDebt = clamp(averageCount - targetCount, 0, 3);
  const zeroBoost = targetCount === 0 ? 0.22 : 0;
  const windowFactor =
    control.coverage_window_minutes === 10
      ? 1.12
      : control.coverage_window_minutes === 30
        ? 0.94
        : 1.0;
  return roundTo(
    clamp(1 + (imbalance * 0.56 + averageDebt * 0.14 + zeroBoost) * windowFactor, 1, 1.86)
  );
};

export const getSyntheticBurstPulse = (
  ts: number,
  controlOrMode:
    | Partial<SyntheticControlState>
    | SyntheticMarketMode
    | null
    | undefined = DEFAULT_SYNTHETIC_CONTROL_STATE
): SyntheticBurstPulse => {
  const control = isModeString(controlOrMode)
    ? DEFAULT_SYNTHETIC_CONTROL_STATE
    : normalizeSyntheticControlState(controlOrMode);
  const session = getSyntheticSessionState(ts, control);
  return {
    active: session.regime !== "arb_calm" || session.focus_symbols.length > 1,
    intensity: roundTo(
      clamp(
        session.volatility_level * 0.72 +
          session.focus_symbols.length * 0.06 -
          session.quote_cleanliness * 0.08,
        0.12,
        1
      )
    ),
    focusSymbols: [...session.focus_symbols],
    bucket: session.seed_bucket
  };
};

export const SYNTHETIC_CONTROL_METADATA = {
  demoProfileIds: SYNTHETIC_DEMO_PROFILE_IDS,
  loadProfileIds: SYNTHETIC_LOAD_PROFILE_IDS,
  profileWeightValues: SYNTHETIC_PROFILE_WEIGHT_VALUES,
  coverageWindowValues: SYNTHETIC_COVERAGE_WINDOW_VALUES,
  smartFlowProfileIds: SMART_FLOW_PROFILE_IDS
} as const;
