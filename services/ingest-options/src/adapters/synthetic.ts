import {
  SP500_SYMBOLS,
  type FlowPacket,
  type OptionNBBO,
  type OptionPrint,
  type SmartMoneyProfileId,
  type SyntheticMarketMode
} from "@islandflow/types";
import type { OptionIngestAdapter, OptionIngestHandlers } from "./types";

type SyntheticOptionsAdapterConfig = {
  emitIntervalMs: number;
  mode: SyntheticMarketMode;
};

type Burst = {
  contractId: string;
  underlying: number;
  expiryOffsetDays: number;
  strike: number;
  basePrice: number;
  baseSize: number;
  exchange: string;
  conditions?: string[];
  printCount: number;
  priceStep: number;
  scenarioId: string;
  label: SyntheticScenarioLabel;
  seed: number;
  flowFeatures: FlowPacket["features"];
};

export type SyntheticContractIvState = {
  iv: number;
  pressure: number;
  lastTs: number;
};

const OPTION_CONTRACT_MULTIPLIER = 100;
const IV_MIN = 0.05;
const IV_MAX = 2.5;
const IV_DECAY_HALF_LIFE_MS = 60_000;

const SYNTHETIC_SYMBOLS = ["SPY", ...(SP500_SYMBOLS as readonly string[])];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRY_OFFSETS = [0, 1, 7, 14, 28, 45, 60, 90];
const EXCHANGES = ["CBOE", "PHLX", "ISE", "ARCA", "BOX", "MIAX"];
const CONDITIONS = ["SWEEP", "ISO", "FILL", "TEST"];
type SyntheticOptionsProfile = {
  burstRunRange: [number, number];
  scenarios: Scenario[];
  pricePlacements: Record<string, WeightedValue<PricePlacement>[]>;
};

export type PricePlacement = "AA" | "A" | "MID" | "B" | "BB";

type WeightedValue<T> = {
  value: T;
  weight: number;
};

type Scenario = {
  id: string;
  weight: number;
  label: SyntheticScenarioLabel;
  right: "C" | "P" | "either";
  countRange: [number, number];
  sizeRange: [number, number];
  targetNotionalRange: [number, number];
  priceTrend: "up" | "down" | "flat";
  expiryOffsets?: number[];
  underlying?: number;
  strikeMoneyness?: number;
  flowFeatures: FlowPacket["features"];
  conditions?: string[];
};

export type SyntheticScenarioLabel = SmartMoneyProfileId | "neutral_noise";

export type SyntheticSmartMoneyScenario = {
  id: string;
  label: SyntheticScenarioLabel;
  hiddenLabel: SyntheticScenarioLabel;
};

const SMART_MONEY_SCENARIO_IDS = [
  "institutional_directional",
  "retail_whale",
  "event_driven",
  "vol_seller",
  "arbitrage",
  "hedge_reactive",
  "neutral_noise"
] as const;

const REALISTIC_SCENARIOS: Scenario[] = [
  {
    id: "ask_lift",
    weight: 18,
    label: "institutional_directional",
    right: "either",
    countRange: [1, 2],
    sizeRange: [30, 180],
    targetNotionalRange: [9_000, 35_000],
    priceTrend: "flat",
    flowFeatures: {
      nbbo_coverage_ratio: 0.88,
      nbbo_aggressive_ratio: 0.7,
      nbbo_aggressive_buy_ratio: 0.66,
      nbbo_aggressive_sell_ratio: 0.08,
      nbbo_inside_ratio: 0.12,
      venue_count: 2
    },
    conditions: ["FILL"]
  },
  {
    id: "mid_block",
    weight: 14,
    label: "arbitrage",
    right: "either",
    countRange: [1, 2],
    sizeRange: [120, 480],
    targetNotionalRange: [12_000, 45_000],
    priceTrend: "flat",
    flowFeatures: {
      structure_type: "vertical",
      structure_legs: 2,
      structure_strikes: 2,
      same_size_leg_symmetry: 0.74,
      nbbo_coverage_ratio: 0.82,
      nbbo_aggressive_ratio: 0.26,
      nbbo_aggressive_buy_ratio: 0.3,
      nbbo_aggressive_sell_ratio: 0.24,
      nbbo_inside_ratio: 0.42,
      venue_count: 2
    },
    conditions: ["FILL"]
  },
  {
    id: "bullish_sweep",
    weight: 8,
    label: "institutional_directional",
    right: "C",
    countRange: [2, 3],
    sizeRange: [180, 520],
    targetNotionalRange: [25_000, 90_000],
    priceTrend: "up",
    flowFeatures: {
      nbbo_coverage_ratio: 0.9,
      nbbo_aggressive_ratio: 0.82,
      nbbo_aggressive_buy_ratio: 0.78,
      nbbo_aggressive_sell_ratio: 0.04,
      nbbo_inside_ratio: 0.08,
      venue_count: 4
    },
    conditions: ["SWEEP"]
  },
  {
    id: "bearish_sweep",
    weight: 8,
    label: "institutional_directional",
    right: "P",
    countRange: [2, 3],
    sizeRange: [180, 520],
    targetNotionalRange: [25_000, 90_000],
    priceTrend: "up",
    flowFeatures: {
      nbbo_coverage_ratio: 0.9,
      nbbo_aggressive_ratio: 0.82,
      nbbo_aggressive_buy_ratio: 0.78,
      nbbo_aggressive_sell_ratio: 0.04,
      nbbo_inside_ratio: 0.08,
      venue_count: 4
    },
    conditions: ["SWEEP"]
  },
  {
    id: "contract_spike",
    weight: 6,
    label: "retail_whale",
    right: "either",
    countRange: [2, 3],
    sizeRange: [500, 900],
    targetNotionalRange: [18_000, 70_000],
    priceTrend: "flat",
    expiryOffsets: [0, 1, 7],
    strikeMoneyness: 1.08,
    flowFeatures: {
      nbbo_coverage_ratio: 0.76,
      nbbo_aggressive_ratio: 0.68,
      nbbo_aggressive_buy_ratio: 0.62,
      nbbo_aggressive_sell_ratio: 0.08,
      nbbo_inside_ratio: 0.12,
      execution_iv_shock: 0.16,
      venue_count: 3
    },
    conditions: ["ISO"]
  },
  {
    id: "noise",
    weight: 46,
    label: "neutral_noise",
    right: "either",
    countRange: [1, 2],
    sizeRange: [5, 60],
    targetNotionalRange: [500, 6_000],
    priceTrend: "flat",
    flowFeatures: {
      nbbo_coverage_ratio: 0.76,
      nbbo_aggressive_ratio: 0.24,
      nbbo_aggressive_buy_ratio: 0.24,
      nbbo_aggressive_sell_ratio: 0.18,
      nbbo_inside_ratio: 0.52,
      venue_count: 1
    },
    conditions: ["FILL"]
  }
];

const ACTIVE_SCENARIOS: Scenario[] = [
  {
    id: "bullish_sweep",
    weight: 35,
    label: "institutional_directional",
    right: "C",
    countRange: [7, 10],
    sizeRange: [600, 1800],
    targetNotionalRange: [120_000, 240_000],
    priceTrend: "up",
    flowFeatures: {
      nbbo_coverage_ratio: 0.94,
      nbbo_aggressive_ratio: 0.86,
      nbbo_aggressive_buy_ratio: 0.82,
      nbbo_aggressive_sell_ratio: 0.03,
      nbbo_inside_ratio: 0.06,
      venue_count: 5
    },
    conditions: ["SWEEP"]
  },
  {
    id: "bearish_sweep",
    weight: 35,
    label: "institutional_directional",
    right: "P",
    countRange: [7, 10],
    sizeRange: [600, 1800],
    targetNotionalRange: [120_000, 240_000],
    priceTrend: "up",
    flowFeatures: {
      nbbo_coverage_ratio: 0.94,
      nbbo_aggressive_ratio: 0.86,
      nbbo_aggressive_buy_ratio: 0.82,
      nbbo_aggressive_sell_ratio: 0.03,
      nbbo_inside_ratio: 0.06,
      venue_count: 5
    },
    conditions: ["SWEEP"]
  },
  {
    id: "contract_spike",
    weight: 20,
    label: "retail_whale",
    right: "either",
    countRange: [5, 8],
    sizeRange: [1200, 3200],
    targetNotionalRange: [60_000, 140_000],
    priceTrend: "flat",
    expiryOffsets: [0, 1, 7],
    strikeMoneyness: 1.08,
    flowFeatures: {
      nbbo_coverage_ratio: 0.78,
      nbbo_aggressive_ratio: 0.72,
      nbbo_aggressive_buy_ratio: 0.66,
      nbbo_aggressive_sell_ratio: 0.06,
      nbbo_inside_ratio: 0.1,
      execution_iv_shock: 0.19,
      venue_count: 4
    },
    conditions: ["ISO"]
  },
  {
    id: "noise",
    weight: 10,
    label: "neutral_noise",
    right: "either",
    countRange: [2, 4],
    sizeRange: [10, 200],
    targetNotionalRange: [500, 5000],
    priceTrend: "flat",
    flowFeatures: {
      nbbo_coverage_ratio: 0.72,
      nbbo_aggressive_ratio: 0.24,
      nbbo_aggressive_buy_ratio: 0.24,
      nbbo_aggressive_sell_ratio: 0.2,
      nbbo_inside_ratio: 0.52,
      venue_count: 1
    },
    conditions: ["FILL"]
  }
];

const SMART_MONEY_TEMPLATE_SCENARIOS: Scenario[] = [
  {
    id: "institutional_directional",
    weight: 18,
    label: "institutional_directional",
    right: "C",
    countRange: [8, 10],
    sizeRange: [1600, 2400],
    targetNotionalRange: [170_000, 230_000],
    priceTrend: "up",
    expiryOffsets: [28, 45],
    strikeMoneyness: 1.01,
    flowFeatures: {
      nbbo_coverage_ratio: 0.94,
      nbbo_aggressive_ratio: 0.86,
      nbbo_aggressive_buy_ratio: 0.82,
      nbbo_aggressive_sell_ratio: 0.04,
      nbbo_inside_ratio: 0.06,
      venue_count: 5
    },
    conditions: ["SWEEP"]
  },
  {
    id: "retail_whale",
    weight: 14,
    label: "retail_whale",
    right: "C",
    countRange: [9, 12],
    sizeRange: [450, 850],
    targetNotionalRange: [35_000, 75_000],
    priceTrend: "up",
    expiryOffsets: [1, 7],
    strikeMoneyness: 1.1,
    flowFeatures: {
      nbbo_coverage_ratio: 0.82,
      nbbo_aggressive_ratio: 0.74,
      nbbo_aggressive_buy_ratio: 0.68,
      nbbo_aggressive_sell_ratio: 0.04,
      nbbo_inside_ratio: 0.08,
      execution_iv_shock: 0.19,
      venue_count: 4
    },
    conditions: ["ISO"]
  },
  {
    id: "event_driven",
    weight: 12,
    label: "event_driven",
    right: "C",
    countRange: [1, 2],
    sizeRange: [700, 1100],
    targetNotionalRange: [72_000, 88_000],
    priceTrend: "flat",
    expiryOffsets: [28, 45],
    strikeMoneyness: 1.0,
    flowFeatures: {
      corporate_event_ts_offset_days: 14,
      nbbo_coverage_ratio: 0.38,
      nbbo_aggressive_ratio: 0.32,
      nbbo_aggressive_buy_ratio: 0.3,
      nbbo_aggressive_sell_ratio: 0.08,
      nbbo_inside_ratio: 0.28,
      nbbo_spread_z: 0.12,
      venue_count: 2
    },
    conditions: ["FILL"]
  },
  {
    id: "vol_seller",
    weight: 12,
    label: "vol_seller",
    right: "either",
    countRange: [4, 6],
    sizeRange: [1300, 2100],
    targetNotionalRange: [150_000, 210_000],
    priceTrend: "down",
    expiryOffsets: [28, 45],
    strikeMoneyness: 1.0,
    flowFeatures: {
      structure_type: "straddle",
      structure_legs: 2,
      structure_strikes: 1,
      structure_rights: "CP",
      conditions: "COMPLEX",
      nbbo_coverage_ratio: 0.9,
      nbbo_aggressive_ratio: 0.72,
      nbbo_aggressive_buy_ratio: 0.08,
      nbbo_aggressive_sell_ratio: 0.7,
      nbbo_inside_ratio: 0.1,
      same_size_leg_symmetry: 0.66,
      venue_count: 3
    },
    conditions: ["FILL"]
  },
  {
    id: "arbitrage",
    weight: 12,
    label: "arbitrage",
    right: "either",
    countRange: [4, 6],
    sizeRange: [900, 1400],
    targetNotionalRange: [70_000, 115_000],
    priceTrend: "flat",
    expiryOffsets: [28, 45],
    strikeMoneyness: 1.0,
    flowFeatures: {
      structure_type: "vertical",
      structure_legs: 2,
      structure_strikes: 2,
      structure_rights: "CP",
      conditions: "COMPLEX",
      nbbo_coverage_ratio: 0.86,
      nbbo_aggressive_ratio: 0.4,
      nbbo_aggressive_buy_ratio: 0.42,
      nbbo_aggressive_sell_ratio: 0.38,
      nbbo_inside_ratio: 0.32,
      same_size_leg_symmetry: 0.92,
      venue_count: 3
    },
    conditions: ["FILL"]
  },
  {
    id: "hedge_reactive",
    weight: 12,
    label: "hedge_reactive",
    right: "P",
    countRange: [1, 2],
    sizeRange: [2600, 3400],
    targetNotionalRange: [35_000, 50_000],
    priceTrend: "up",
    expiryOffsets: [0, 1],
    strikeMoneyness: 1.0,
    flowFeatures: {
      nbbo_coverage_ratio: 0.86,
      nbbo_aggressive_ratio: 0.58,
      nbbo_aggressive_buy_ratio: 0.54,
      nbbo_aggressive_sell_ratio: 0.12,
      nbbo_inside_ratio: 0.16,
      underlying_move_bps: -72,
      venue_count: 3
    },
    conditions: ["FILL"]
  },
  {
    id: "neutral_noise",
    weight: 20,
    label: "neutral_noise",
    right: "either",
    countRange: [1, 2],
    sizeRange: [10, 70],
    targetNotionalRange: [800, 7_000],
    priceTrend: "flat",
    expiryOffsets: [14, 28, 45, 60],
    strikeMoneyness: 1.02,
    flowFeatures: {
      nbbo_coverage_ratio: 0.78,
      nbbo_aggressive_ratio: 0.22,
      nbbo_aggressive_buy_ratio: 0.22,
      nbbo_aggressive_sell_ratio: 0.18,
      nbbo_inside_ratio: 0.58,
      venue_count: 1
    },
    conditions: ["FILL"]
  }
];

const REALISTIC_PRICE_PLACEMENTS: Record<string, WeightedValue<PricePlacement>[]> = {
  ask_lift: [
    { value: "A", weight: 45 },
    { value: "AA", weight: 20 },
    { value: "MID", weight: 25 },
    { value: "B", weight: 8 },
    { value: "BB", weight: 2 }
  ],
  mid_block: [
    { value: "MID", weight: 60 },
    { value: "A", weight: 20 },
    { value: "B", weight: 20 }
  ],
  bullish_sweep: [
    { value: "AA", weight: 20 },
    { value: "A", weight: 50 },
    { value: "MID", weight: 15 },
    { value: "B", weight: 10 },
    { value: "BB", weight: 5 }
  ],
  bearish_sweep: [
    { value: "AA", weight: 10 },
    { value: "A", weight: 20 },
    { value: "MID", weight: 15 },
    { value: "B", weight: 35 },
    { value: "BB", weight: 20 }
  ],
  contract_spike: [
    { value: "A", weight: 25 },
    { value: "MID", weight: 40 },
    { value: "B", weight: 25 },
    { value: "AA", weight: 5 },
    { value: "BB", weight: 5 }
  ],
  noise: [
    { value: "MID", weight: 40 },
    { value: "A", weight: 20 },
    { value: "B", weight: 20 },
    { value: "AA", weight: 10 },
    { value: "BB", weight: 10 }
  ]
};

const ACTIVE_PRICE_PLACEMENTS: Record<string, WeightedValue<PricePlacement>[]> = {
  bullish_sweep: [
    { value: "AA", weight: 25 },
    { value: "A", weight: 40 },
    { value: "B", weight: 20 },
    { value: "BB", weight: 15 }
  ],
  bearish_sweep: [
    { value: "AA", weight: 15 },
    { value: "A", weight: 20 },
    { value: "B", weight: 40 },
    { value: "BB", weight: 25 }
  ],
  contract_spike: [
    { value: "AA", weight: 25 },
    { value: "A", weight: 25 },
    { value: "B", weight: 25 },
    { value: "BB", weight: 25 }
  ],
  noise: [
    { value: "AA", weight: 25 },
    { value: "A", weight: 25 },
    { value: "B", weight: 25 },
    { value: "BB", weight: 25 }
  ]
};

const FIREHOSE_PRICE_PLACEMENTS: Record<string, WeightedValue<PricePlacement>[]> = {
  ...ACTIVE_PRICE_PLACEMENTS,
  noise: [
    { value: "A", weight: 20 },
    { value: "AA", weight: 20 },
    { value: "MID", weight: 20 },
    { value: "B", weight: 20 },
    { value: "BB", weight: 20 }
  ]
};

const PLACEMENT_PATTERN: PricePlacement[] = ["A", "AA", "MID", "B", "BB"];

const SYNTHETIC_PROFILES: Record<SyntheticMarketMode, SyntheticOptionsProfile> = {
  realistic: {
    burstRunRange: [1, 2],
    scenarios: REALISTIC_SCENARIOS,
    pricePlacements: REALISTIC_PRICE_PLACEMENTS
  },
  active: {
    burstRunRange: [2, 4],
    scenarios: ACTIVE_SCENARIOS,
    pricePlacements: ACTIVE_PRICE_PLACEMENTS
  },
  firehose: {
    burstRunRange: [4, 7],
    scenarios: ACTIVE_SCENARIOS.map((scenario): Scenario =>
      scenario.id === "noise"
        ? {
            ...scenario,
            weight: 20,
            countRange: [5, 8],
            sizeRange: [20, 300],
            targetNotionalRange: [800, 12_000]
          }
        : {
            ...scenario,
            weight: scenario.weight + 10,
            countRange: [scenario.countRange[0] + 2, scenario.countRange[1] + 3],
            sizeRange: [scenario.sizeRange[0], scenario.sizeRange[1] * 2],
            targetNotionalRange: [
              scenario.targetNotionalRange[0],
              scenario.targetNotionalRange[1] * 1.5
            ]
          }
    ),
    pricePlacements: FIREHOSE_PRICE_PLACEMENTS
  }
};

const SMART_MONEY_TEMPLATE_PROFILE: SyntheticOptionsProfile = {
  burstRunRange: [1, 1],
  scenarios: SMART_MONEY_TEMPLATE_SCENARIOS,
  pricePlacements: {
    ...ACTIVE_PRICE_PLACEMENTS,
    institutional_directional: ACTIVE_PRICE_PLACEMENTS.bullish_sweep,
    retail_whale: ACTIVE_PRICE_PLACEMENTS.contract_spike,
    event_driven: REALISTIC_PRICE_PLACEMENTS.ask_lift,
    vol_seller: [
      { value: "B", weight: 45 },
      { value: "BB", weight: 35 },
      { value: "MID", weight: 20 }
    ],
    arbitrage: REALISTIC_PRICE_PLACEMENTS.mid_block,
    hedge_reactive: ACTIVE_PRICE_PLACEMENTS.bullish_sweep,
    neutral_noise: REALISTIC_PRICE_PLACEMENTS.noise
  }
};

const pick = <T,>(items: T[], seed: number): T => {
  return items[Math.abs(seed) % items.length];
};

const pickInt = (min: number, max: number, seed: number): number => {
  if (max <= min) {
    return min;
  }
  const span = max - min + 1;
  return min + (Math.abs(seed) % span);
};

const pickFloat = (min: number, max: number, seed: number): number => {
  if (max <= min) {
    return min;
  }
  const offset = (Math.abs(seed) % 1000) / 1000;
  return min + (max - min) * offset;
};

const pickWeighted = <T extends { weight: number }>(items: T[], seed: number): T => {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let target = Math.abs(seed) % totalWeight;
  for (const item of items) {
    if (target < item.weight) {
      return item;
    }
    target -= item.weight;
  }
  return items[0];
};

const pickWeightedValue = <T>(items: WeightedValue<T>[], seed: number): T => {
  return pickWeighted(items, seed).value;
};

const pickPlacement = (
  burst: Burst,
  index: number,
  profile: SyntheticOptionsProfile
): PricePlacement => {
  const placementOptions = profile.pricePlacements[burst.scenarioId] ?? profile.pricePlacements.noise;
  const offset = Math.abs(burst.seed) % PLACEMENT_PATTERN.length;
  if (index < PLACEMENT_PATTERN.length) {
    return PLACEMENT_PATTERN[(offset + index) % PLACEMENT_PATTERN.length];
  }
  return pickWeightedValue(placementOptions, burst.seed + index * 11);
};

const hashSymbol = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const formatStrike = (strike: number): string => {
  const fixed = strike.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
};

const formatExpiry = (now: number, offsetDays: number): string => {
  const expiryDate = new Date(now + offsetDays * MS_PER_DAY);
  return expiryDate.toISOString().slice(0, 10);
};

const clampValue = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const initializeSyntheticIv = (dteDays: number, moneyness: number): number => {
  const dteBoost = dteDays <= 0 ? 0.22 : dteDays <= 7 ? 0.14 : dteDays <= 30 ? 0.06 : 0;
  const moneynessBoost = clampValue(Math.abs(moneyness - 1) * 0.8, 0, 0.2);
  return clampValue(0.24 + dteBoost + moneynessBoost, 0.18, 0.65);
};

export const updateSyntheticIvForTest = (
  state: SyntheticContractIvState | undefined,
  input: {
    ts: number;
    placement: PricePlacement;
    size: number;
    notional: number;
    dteDays: number;
    moneyness: number;
  }
): SyntheticContractIvState => {
  const previous = state ?? {
    iv: initializeSyntheticIv(input.dteDays, input.moneyness),
    pressure: 0,
    lastTs: input.ts
  };
  const elapsed = Math.max(0, input.ts - previous.lastTs);
  const decay = Math.pow(0.5, elapsed / IV_DECAY_HALF_LIFE_MS);
  let pressure = previous.pressure * decay;

  if (input.placement === "AA" || input.placement === "A") {
    const sizeImpact = Math.log10(Math.max(10, input.size)) * 0.012;
    const notionalImpact = Math.log10(Math.max(1_000, input.notional)) * 0.01;
    pressure += input.placement === "AA" ? sizeImpact + notionalImpact : (sizeImpact + notionalImpact) * 0.65;
  } else if (input.placement === "MID") {
    pressure += 0.001;
  } else {
    pressure -= input.placement === "BB" ? 0.018 : 0.01;
  }

  pressure = clampValue(pressure, -0.25, 1.85);
  const baseline = initializeSyntheticIv(input.dteDays, input.moneyness);
  const iv = clampValue(baseline + pressure * 0.42, IV_MIN, IV_MAX);
  return { iv: Number(iv.toFixed(4)), pressure, lastTs: input.ts };
};

const buildBurst = (burstIndex: number, now: number, profile: SyntheticOptionsProfile): Burst => {
  const symbol = SYNTHETIC_SYMBOLS[burstIndex % SYNTHETIC_SYMBOLS.length];
  const symbolHash = hashSymbol(symbol);
  const seed = symbolHash + burstIndex * 7;
  const scenario = pickWeighted(profile.scenarios, seed);
  const baseUnderlying = 30 + (symbolHash % 470);
  const expiryOffset = pick(scenario.expiryOffsets ?? EXPIRY_OFFSETS, symbolHash + burstIndex);
  const expiry = formatExpiry(now, expiryOffset);
  const strikeStep = baseUnderlying >= 200 ? 10 : baseUnderlying >= 100 ? 5 : 2.5;
  const moneynessSteps = scenario.id === "noise" ? 5 : 2;
  const strikeOffset = pickInt(-moneynessSteps, moneynessSteps, symbolHash + burstIndex * 11);
  const templateStrike =
    scenario.strikeMoneyness !== undefined
      ? Math.round((baseUnderlying * scenario.strikeMoneyness) / strikeStep) * strikeStep
      : null;
  const strike = Math.max(
    1,
    templateStrike ?? Math.round(baseUnderlying / strikeStep) * strikeStep + strikeOffset * strikeStep
  );
  const right =
    scenario.right === "either"
      ? (symbolHash + burstIndex) % 2 === 0
        ? "C"
        : "P"
      : scenario.right;
  const contractId = `${symbol}-${expiry}-${formatStrike(strike)}-${right}`;
  const exchange = pick(EXCHANGES, burstIndex + symbolHash);
  const printCount = pickInt(scenario.countRange[0], scenario.countRange[1], symbolHash + burstIndex * 13);
  const baseSize = pickInt(scenario.sizeRange[0], scenario.sizeRange[1], symbolHash + burstIndex * 17);
  const targetNotional = pickFloat(
    scenario.targetNotionalRange[0],
    scenario.targetNotionalRange[1],
    symbolHash + burstIndex * 19
  );
  const basePricePer = Math.max(
    0.05,
    Number(
      (
        targetNotional /
        (baseSize * printCount * OPTION_CONTRACT_MULTIPLIER)
      ).toFixed(2)
    )
  );
  const conditions = scenario.conditions?.length ? scenario.conditions : [pick(CONDITIONS, burstIndex)];
  const priceStep =
    scenario.priceTrend === "up" ? 0.01 : scenario.priceTrend === "down" ? -0.01 : 0;

  return {
    contractId,
    underlying: baseUnderlying,
    expiryOffsetDays: expiryOffset,
    strike,
    basePrice: basePricePer,
    baseSize,
    exchange,
    conditions,
    printCount,
    priceStep,
    scenarioId: scenario.id,
    label: scenario.label,
    flowFeatures: scenario.flowFeatures,
    seed
  };
};

export const buildSyntheticBurstForTest = (
  burstIndex: number,
  now: number,
  mode: SyntheticMarketMode
): Burst => buildBurst(burstIndex, now, SYNTHETIC_PROFILES[mode]);

export const listSyntheticSmartMoneyScenariosForTest = (): SyntheticSmartMoneyScenario[] =>
  SMART_MONEY_SCENARIO_IDS.map((id) => ({
    id,
    label: id,
    hiddenLabel: id
  }));

export const buildSyntheticSmartMoneyBurstForTest = (
  scenarioId: (typeof SMART_MONEY_SCENARIO_IDS)[number],
  now: number
): Burst => {
  const scenarioIndex = SMART_MONEY_TEMPLATE_SCENARIOS.findIndex((scenario) => scenario.id === scenarioId);
  if (scenarioIndex < 0) {
    throw new Error(`Unknown synthetic smart-money scenario: ${scenarioId}`);
  }
  return buildBurst(scenarioIndex, now, {
    ...SMART_MONEY_TEMPLATE_PROFILE,
    scenarios: [SMART_MONEY_TEMPLATE_SCENARIOS[scenarioIndex]]
  });
};

export const buildSyntheticFlowPacketForTest = (
  scenarioId: (typeof SMART_MONEY_SCENARIO_IDS)[number],
  now: number
): { packet: FlowPacket; hiddenLabel: SyntheticScenarioLabel } => {
  const burst = buildSyntheticSmartMoneyBurstForTest(scenarioId, now);
  const corporateEventOffset = Number(burst.flowFeatures.corporate_event_ts_offset_days ?? 0);
  const flowFeatures: FlowPacket["features"] = {
    option_contract_id: burst.contractId,
    underlying_id: burst.contractId.split("-")[0],
    underlying_mid: burst.underlying,
    count: burst.printCount,
    window_ms: Math.max(0, (burst.printCount - 1) * 45),
    total_size: burst.baseSize * burst.printCount,
    total_premium: Number((burst.basePrice * burst.baseSize * burst.printCount * OPTION_CONTRACT_MULTIPLIER).toFixed(2)),
    total_notional: Number((burst.underlying * burst.baseSize * burst.printCount * OPTION_CONTRACT_MULTIPLIER).toFixed(2)),
    first_price: burst.basePrice,
    last_price: Number((burst.basePrice * (1 + burst.priceStep * Math.max(0, burst.printCount - 1))).toFixed(2)),
    nbbo_missing_count: 0,
    nbbo_stale_count: 0,
    ...burst.flowFeatures
  };
  delete flowFeatures.corporate_event_ts_offset_days;
  if (corporateEventOffset > 0) {
    flowFeatures.corporate_event_ts = now + corporateEventOffset * MS_PER_DAY;
  }

  return {
    hiddenLabel: burst.label,
    packet: {
      source_ts: now,
      ingest_ts: now,
      seq: SMART_MONEY_SCENARIO_IDS.indexOf(scenarioId) + 1,
      trace_id: `synthetic-smart-money:${scenarioId}`,
      id: `synthetic-smart-money:${scenarioId}:${now}`,
      members: Array.from({ length: burst.printCount }, (_, index) => `${burst.contractId}:${index + 1}`),
      features: flowFeatures,
      join_quality: {}
    }
  };
};

export const createSyntheticOptionsAdapter = (
  config: SyntheticOptionsAdapterConfig
): OptionIngestAdapter => {
  const profile = SYNTHETIC_PROFILES[config.mode];
  return {
    name: "synthetic",
    start: (handlers: OptionIngestHandlers) => {
      let seq = 0;
      let nbboSeq = 0;
      let burstIndex = 0;
      let currentBurst: Burst | null = null;
      const ivByContract = new Map<string, SyntheticContractIvState>();
      let remainingRuns = 0;
      let timer: ReturnType<typeof setInterval> | null = null;
      let stopped = false;

      const emit = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        if (!currentBurst || remainingRuns <= 0) {
          burstIndex += 1;
          currentBurst = buildBurst(burstIndex, now, profile);
          remainingRuns = pickInt(
            profile.burstRunRange[0],
            profile.burstRunRange[1],
            burstIndex * 23
          );
        }

        const burst = currentBurst;
        const printsToEmit = burst.printCount;

        for (let i = 0; i < printsToEmit; i += 1) {
          seq += 1;
          const priceJitter = ((i % 3) - 1) * 0.004;
          const sizeJitter = ((i % 3) - 1) * 0.08;
          const priceMultiplier = 1 + burst.priceStep * i + priceJitter;
          const placement = pickPlacement(burst, i, profile);
          const size = Math.max(1, Math.round(burst.baseSize * (1 + sizeJitter)));
          const previousIv = ivByContract.get(burst.contractId);
          const provisionalNotional = burst.basePrice * size * OPTION_CONTRACT_MULTIPLIER;
          const ivState = updateSyntheticIvForTest(previousIv, {
            ts: now + i * 5,
            placement,
            size,
            notional: provisionalNotional,
            dteDays: burst.expiryOffsetDays,
            moneyness: burst.strike / burst.underlying
          });
          ivByContract.set(burst.contractId, ivState);
          const ivDrift = Math.max(0, ivState.iv - initializeSyntheticIv(burst.expiryOffsetDays, burst.strike / burst.underlying));
          const mid = Math.max(
            0.05,
            Number((burst.basePrice * priceMultiplier * (1 + ivDrift * 1.15)).toFixed(2))
          );
          const spread = Math.max(0.02, Number((mid * (0.02 + Math.min(0.035, ivState.iv * 0.01))).toFixed(2)));
          const bid = Math.max(0.01, Number((mid - spread / 2).toFixed(2)));
          const ask = Math.max(bid + 0.01, Number((mid + spread / 2).toFixed(2)));
          const tick = Math.max(0.01, Number((spread * 0.25).toFixed(2)));
          let tradePrice = mid;

          if (placement === "AA") {
            tradePrice = ask + tick;
          } else if (placement === "A") {
            tradePrice = ask;
          } else if (placement === "MID") {
            tradePrice = mid;
          } else if (placement === "BB") {
            tradePrice = Math.max(0.01, bid - tick);
          } else {
            tradePrice = bid;
          }

          const print: OptionPrint = {
            source_ts: now + i * 5,
            ingest_ts: now + i * 5,
            seq,
            trace_id: `synthetic-options-${seq}`,
            ts: now + i * 5,
            option_contract_id: burst.contractId,
            price: tradePrice,
            size,
            exchange: burst.exchange,
            conditions: burst.conditions,
            execution_iv: ivState.iv,
            execution_iv_source: "synthetic_pressure_model"
          };

          if (handlers.onNBBO) {
            nbboSeq += 1;
            const sizeBase = Math.max(1, Math.round(burst.baseSize * 0.4));
            const bidSize = Math.max(1, Math.round(sizeBase * (1 + sizeJitter)));
            const askSize = Math.max(1, Math.round(sizeBase * (1 - sizeJitter)));
            const nbbo: OptionNBBO = {
              source_ts: print.ts,
              ingest_ts: print.ingest_ts,
              seq: nbboSeq,
              trace_id: `synthetic-nbbo-${nbboSeq}`,
              ts: print.ts,
              option_contract_id: burst.contractId,
              bid,
              ask,
              bidSize,
              askSize
            };

            void handlers.onNBBO(nbbo);
          }

          void handlers.onTrade(print);
        }

        remainingRuns -= 1;
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
