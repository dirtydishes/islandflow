import {
  SP500_SYMBOLS,
  buildEmptySyntheticProfileHitCounts,
  getSyntheticCoverageBoost,
  getSyntheticScenarioWeights,
  getSyntheticSessionState,
  getSyntheticUnderlyingState,
  hashSyntheticSymbol,
  type FlowPacket,
  type OptionNBBO,
  type OptionPrint,
  type SmartMoneyProfileId,
  type SyntheticControlState,
  type SyntheticMarketMode
} from "@islandflow/types";
import type { OptionIngestAdapter, OptionIngestHandlers } from "./types";

type SyntheticOptionsAdapterConfig = {
  emitIntervalMs: number;
  mode: SyntheticMarketMode;
  getControl?: () => SyntheticControlState;
};

type BurstLeg = {
  contractId: string;
  right: "C" | "P";
  expiryOffsetDays: number;
  strike: number;
  basePrice: number;
  baseSize: number;
  exchange: string;
  placementScenarioId: string;
};

type Burst = {
  contractId: string;
  underlying: number;
  expiryOffsetDays: number;
  strike: number;
  basePrice: number;
  baseSize: number;
  legs: BurstLeg[];
  conditions: string[];
  cycles: number;
  printCount: number;
  priceStep: number;
  scenarioId: string;
  label: SyntheticScenarioLabel;
  hiddenLabel: string;
  seed: number;
  flowFeatures: FlowPacket["features"];
  missingQuoteProbability: number;
  staleQuoteProbability: number;
};

type ScenarioLegTemplate = {
  right: "C" | "P";
  strikeMoneyness?: number;
  strikeOffsetSteps?: number;
  expiryOffsetDays?: number;
  priceMultiplier?: number;
  sizeMultiplier?: number;
  placementScenarioId?: string;
};

type Scenario = {
  id: string;
  hiddenLabel: string;
  label: SyntheticScenarioLabel;
  right: "C" | "P" | "either";
  weight: number;
  countRange: [number, number];
  sizeRange: [number, number];
  targetNotionalRange: [number, number];
  priceTrend: "up" | "down" | "flat";
  expiryOffsets?: number[];
  strikeMoneyness?: number;
  preferredSymbols?: string[];
  placementProfile?: SyntheticScenarioLabel;
  missingQuoteProbability?: number;
  staleQuoteProbability?: number;
  conditions?: string[];
  flowFeatures: FlowPacket["features"];
  legs?: ScenarioLegTemplate[];
};

type WeightedValue<T> = {
  value: T;
  weight: number;
};

type CoverageWindowState = Record<SmartMoneyProfileId, number[]>;

type SyntheticOptionsProfile = {
  burstRunRange: [number, number];
  scenarios: Scenario[];
  pricePlacements: Record<string, WeightedValue<PricePlacement>[]>;
};

export type SyntheticContractIvState = {
  iv: number;
  pressure: number;
  lastTs: number;
};

export type PricePlacement = "AA" | "A" | "MID" | "B" | "BB";
export type SyntheticScenarioLabel = SmartMoneyProfileId | "neutral_noise";
export type SyntheticSmartMoneyScenario = {
  id: string;
  label: SyntheticScenarioLabel;
  hiddenLabel: string;
};

const OPTION_CONTRACT_MULTIPLIER = 100;
const IV_MIN = 0.05;
const IV_MAX = 2.5;
const IV_DECAY_HALF_LIFE_MS = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRY_OFFSETS = [0, 1, 7, 14, 28, 45, 60, 90];
const EXCHANGES = ["CBOE", "PHLX", "ISE", "ARCA", "BOX", "MIAX"];
const CONDITIONS = ["SWEEP", "ISO", "FILL", "TEST"];
const SYNTHETIC_SYMBOLS = ["SPY", ...(SP500_SYMBOLS as readonly string[])];
const SMART_MONEY_SCENARIO_IDS = [
  "institutional_directional",
  "retail_whale",
  "event_driven",
  "vol_seller",
  "arbitrage",
  "hedge_reactive",
  "neutral_noise"
] as const;

const SCENARIO_LIBRARY: Scenario[] = [
  {
    id: "call_sweep",
    hiddenLabel: "call_sweep",
    label: "institutional_directional",
    right: "C",
    weight: 1.2,
    countRange: [4, 7],
    sizeRange: [420, 1200],
    targetNotionalRange: [55_000, 165_000],
    priceTrend: "up",
    expiryOffsets: [7, 14, 28],
    strikeMoneyness: 1.01,
    placementProfile: "institutional_directional",
    conditions: ["SWEEP"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.84,
      nbbo_aggressive_buy_ratio: 0.8,
      nbbo_aggressive_sell_ratio: 0.04,
      nbbo_inside_ratio: 0.08,
      venue_count: 4
    }
  },
  {
    id: "put_sweep",
    hiddenLabel: "put_sweep",
    label: "institutional_directional",
    right: "P",
    weight: 1.15,
    countRange: [4, 7],
    sizeRange: [420, 1200],
    targetNotionalRange: [55_000, 165_000],
    priceTrend: "up",
    expiryOffsets: [7, 14, 28],
    strikeMoneyness: 0.99,
    placementProfile: "institutional_directional",
    conditions: ["SWEEP"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.84,
      nbbo_aggressive_buy_ratio: 0.8,
      nbbo_aggressive_sell_ratio: 0.04,
      nbbo_inside_ratio: 0.08,
      venue_count: 4
    }
  },
  {
    id: "ask_lift_accumulation",
    hiddenLabel: "ask_lift_accumulation",
    label: "institutional_directional",
    right: "either",
    weight: 0.95,
    countRange: [2, 4],
    sizeRange: [160, 540],
    targetNotionalRange: [12_000, 50_000],
    priceTrend: "flat",
    strikeMoneyness: 1.0,
    placementProfile: "institutional_directional",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.66,
      nbbo_aggressive_buy_ratio: 0.62,
      nbbo_aggressive_sell_ratio: 0.08,
      nbbo_inside_ratio: 0.14,
      venue_count: 2
    }
  },
  {
    id: "far_dated_conviction",
    hiddenLabel: "far_dated_conviction",
    label: "institutional_directional",
    right: "either",
    weight: 0.72,
    countRange: [2, 3],
    sizeRange: [220, 700],
    targetNotionalRange: [35_000, 90_000],
    priceTrend: "up",
    expiryOffsets: [60, 90],
    strikeMoneyness: 1.0,
    placementProfile: "institutional_directional",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.62,
      nbbo_aggressive_buy_ratio: 0.56,
      nbbo_aggressive_sell_ratio: 0.12,
      nbbo_inside_ratio: 0.18,
      venue_count: 3
    }
  },
  {
    id: "0dte_call_chase",
    hiddenLabel: "0dte_call_chase",
    label: "retail_whale",
    right: "C",
    weight: 1.2,
    countRange: [6, 10],
    sizeRange: [500, 1400],
    targetNotionalRange: [28_000, 90_000],
    priceTrend: "up",
    expiryOffsets: [0, 1],
    strikeMoneyness: 1.08,
    placementProfile: "retail_whale",
    conditions: ["ISO"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.74,
      nbbo_aggressive_buy_ratio: 0.68,
      nbbo_aggressive_sell_ratio: 0.04,
      nbbo_inside_ratio: 0.1,
      execution_iv_shock: 0.18,
      venue_count: 4
    }
  },
  {
    id: "short_dated_put_panic",
    hiddenLabel: "short_dated_put_panic",
    label: "retail_whale",
    right: "P",
    weight: 0.92,
    countRange: [5, 8],
    sizeRange: [420, 1200],
    targetNotionalRange: [24_000, 82_000],
    priceTrend: "up",
    expiryOffsets: [0, 1, 7],
    strikeMoneyness: 0.94,
    placementProfile: "retail_whale",
    conditions: ["ISO"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.72,
      nbbo_aggressive_buy_ratio: 0.64,
      nbbo_aggressive_sell_ratio: 0.06,
      nbbo_inside_ratio: 0.12,
      execution_iv_shock: 0.16,
      venue_count: 4
    }
  },
  {
    id: "attention_contract_spike",
    hiddenLabel: "attention_contract_spike",
    label: "retail_whale",
    right: "either",
    weight: 0.84,
    countRange: [3, 6],
    sizeRange: [360, 900],
    targetNotionalRange: [18_000, 60_000],
    priceTrend: "flat",
    expiryOffsets: [1, 7],
    strikeMoneyness: 1.06,
    placementProfile: "retail_whale",
    conditions: ["ISO"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.62,
      nbbo_aggressive_buy_ratio: 0.56,
      nbbo_aggressive_sell_ratio: 0.08,
      nbbo_inside_ratio: 0.14,
      execution_iv_shock: 0.14,
      venue_count: 3
    }
  },
  {
    id: "earnings_vol_probe",
    hiddenLabel: "earnings_vol_probe",
    label: "event_driven",
    right: "C",
    weight: 0.9,
    countRange: [2, 4],
    sizeRange: [180, 520],
    targetNotionalRange: [18_000, 52_000],
    priceTrend: "flat",
    expiryOffsets: [14, 28],
    strikeMoneyness: 1.03,
    preferredSymbols: ["AAPL", "MSFT", "NVDA", "META", "AMZN", "TSLA"],
    placementProfile: "event_driven",
    conditions: ["FILL", "EVENT_14D"],
    flowFeatures: {
      corporate_event_ts_offset_days: 14,
      nbbo_aggressive_ratio: 0.46,
      nbbo_aggressive_buy_ratio: 0.42,
      nbbo_aggressive_sell_ratio: 0.12,
      nbbo_inside_ratio: 0.2,
      venue_count: 2
    }
  },
  {
    id: "pre_event_directional_ramp",
    hiddenLabel: "pre_event_directional_ramp",
    label: "event_driven",
    right: "C",
    weight: 1.1,
    countRange: [4, 7],
    sizeRange: [380, 920],
    targetNotionalRange: [46_000, 120_000],
    priceTrend: "up",
    expiryOffsets: [7, 14],
    strikeMoneyness: 1.02,
    preferredSymbols: ["AAPL", "MSFT", "NVDA", "META", "AMZN", "TSLA"],
    placementProfile: "event_driven",
    conditions: ["FILL", "EVENT_14D"],
    flowFeatures: {
      corporate_event_ts_offset_days: 7,
      nbbo_aggressive_ratio: 0.62,
      nbbo_aggressive_buy_ratio: 0.58,
      nbbo_aggressive_sell_ratio: 0.08,
      nbbo_inside_ratio: 0.14,
      venue_count: 3
    }
  },
  {
    id: "post_gap_followthrough",
    hiddenLabel: "post_gap_followthrough",
    label: "event_driven",
    right: "either",
    weight: 0.88,
    countRange: [3, 5],
    sizeRange: [260, 760],
    targetNotionalRange: [24_000, 68_000],
    priceTrend: "up",
    expiryOffsets: [7, 14],
    strikeMoneyness: 1.0,
    preferredSymbols: ["AAPL", "MSFT", "NVDA", "META", "AMZN", "TSLA"],
    placementProfile: "event_driven",
    conditions: ["FILL", "EVENT_14D"],
    flowFeatures: {
      corporate_event_ts_offset_days: 1,
      nbbo_aggressive_ratio: 0.58,
      nbbo_aggressive_buy_ratio: 0.52,
      nbbo_aggressive_sell_ratio: 0.1,
      nbbo_inside_ratio: 0.16,
      venue_count: 3
    }
  },
  {
    id: "covered_call_overwrite",
    hiddenLabel: "covered_call_overwrite",
    label: "vol_seller",
    right: "C",
    weight: 0.82,
    countRange: [3, 5],
    sizeRange: [700, 1800],
    targetNotionalRange: [55_000, 150_000],
    priceTrend: "down",
    expiryOffsets: [28, 45, 60],
    strikeMoneyness: 1.06,
    placementProfile: "vol_seller",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.54,
      nbbo_aggressive_buy_ratio: 0.08,
      nbbo_aggressive_sell_ratio: 0.52,
      nbbo_inside_ratio: 0.16,
      venue_count: 2
    }
  },
  {
    id: "cash_secured_put_write",
    hiddenLabel: "cash_secured_put_write",
    label: "vol_seller",
    right: "P",
    weight: 0.82,
    countRange: [3, 5],
    sizeRange: [700, 1800],
    targetNotionalRange: [55_000, 150_000],
    priceTrend: "down",
    expiryOffsets: [28, 45, 60],
    strikeMoneyness: 0.96,
    placementProfile: "vol_seller",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.54,
      nbbo_aggressive_buy_ratio: 0.08,
      nbbo_aggressive_sell_ratio: 0.52,
      nbbo_inside_ratio: 0.16,
      venue_count: 2
    }
  },
  {
    id: "short_straddle_harvest",
    hiddenLabel: "short_straddle_harvest",
    label: "vol_seller",
    right: "either",
    weight: 1.15,
    countRange: [4, 7],
    sizeRange: [650, 1500],
    targetNotionalRange: [60_000, 150_000],
    priceTrend: "down",
    expiryOffsets: [28, 45],
    strikeMoneyness: 1.0,
    placementProfile: "vol_seller",
    conditions: ["FILL"],
    legs: [
      { right: "C", strikeMoneyness: 1.0, placementScenarioId: "vol_seller" },
      { right: "P", strikeMoneyness: 1.0, placementScenarioId: "vol_seller" }
    ],
    flowFeatures: {
      structure_type: "straddle",
      structure_legs: 2,
      structure_strikes: 1,
      structure_rights: "C/P",
      conditions: "COMPLEX",
      nbbo_aggressive_ratio: 0.7,
      nbbo_aggressive_buy_ratio: 0.08,
      nbbo_aggressive_sell_ratio: 0.68,
      nbbo_inside_ratio: 0.12,
      same_size_leg_symmetry: 0.9,
      venue_count: 3
    }
  },
  {
    id: "parity_vertical",
    hiddenLabel: "parity_vertical",
    label: "arbitrage",
    right: "C",
    weight: 1.0,
    countRange: [4, 7],
    sizeRange: [520, 1400],
    targetNotionalRange: [45_000, 120_000],
    priceTrend: "flat",
    expiryOffsets: [28, 45],
    placementProfile: "arbitrage",
    conditions: ["FILL"],
    legs: [
      { right: "C", strikeOffsetSteps: -1, placementScenarioId: "arbitrage" },
      { right: "C", strikeOffsetSteps: 1, placementScenarioId: "arbitrage" }
    ],
    flowFeatures: {
      structure_type: "vertical",
      structure_legs: 2,
      structure_strikes: 2,
      structure_rights: "C",
      nbbo_aggressive_ratio: 0.38,
      nbbo_aggressive_buy_ratio: 0.42,
      nbbo_aggressive_sell_ratio: 0.38,
      nbbo_inside_ratio: 0.3,
      same_size_leg_symmetry: 0.94,
      venue_count: 3
    }
  },
  {
    id: "conversion_reversal",
    hiddenLabel: "conversion_reversal",
    label: "arbitrage",
    right: "either",
    weight: 0.76,
    countRange: [5, 8],
    sizeRange: [420, 1100],
    targetNotionalRange: [38_000, 95_000],
    priceTrend: "flat",
    expiryOffsets: [28, 45],
    placementProfile: "arbitrage",
    conditions: ["FILL"],
    flowFeatures: {
      structure_type: "roll",
      structure_legs: 3,
      structure_strikes: 2,
      structure_rights: "C/P",
      nbbo_aggressive_ratio: 0.32,
      nbbo_aggressive_buy_ratio: 0.34,
      nbbo_aggressive_sell_ratio: 0.32,
      nbbo_inside_ratio: 0.34,
      same_size_leg_symmetry: 0.9,
      venue_count: 3
    }
  },
  {
    id: "box_spread",
    hiddenLabel: "box_spread",
    label: "arbitrage",
    right: "either",
    weight: 0.66,
    countRange: [6, 10],
    sizeRange: [300, 900],
    targetNotionalRange: [26_000, 80_000],
    priceTrend: "flat",
    expiryOffsets: [28, 45],
    placementProfile: "arbitrage",
    conditions: ["FILL"],
    flowFeatures: {
      structure_type: "box",
      structure_legs: 4,
      structure_strikes: 2,
      structure_rights: "C/P",
      nbbo_aggressive_ratio: 0.24,
      nbbo_aggressive_buy_ratio: 0.26,
      nbbo_aggressive_sell_ratio: 0.24,
      nbbo_inside_ratio: 0.42,
      same_size_leg_symmetry: 0.94,
      venue_count: 2
    }
  },
  {
    id: "gamma_pinch_call_hedge",
    hiddenLabel: "gamma_pinch_call_hedge",
    label: "hedge_reactive",
    right: "C",
    weight: 0.92,
    countRange: [4, 7],
    sizeRange: [900, 2400],
    targetNotionalRange: [30_000, 85_000],
    priceTrend: "up",
    expiryOffsets: [0, 1],
    strikeMoneyness: 1.0,
    preferredSymbols: ["SPY", "QQQ", "IWM", "AAPL", "NVDA"],
    placementProfile: "hedge_reactive",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.58,
      nbbo_aggressive_buy_ratio: 0.54,
      nbbo_aggressive_sell_ratio: 0.1,
      nbbo_inside_ratio: 0.16,
      underlying_move_bps: 44,
      venue_count: 3
    }
  },
  {
    id: "reactive_put_wall",
    hiddenLabel: "reactive_put_wall",
    label: "hedge_reactive",
    right: "P",
    weight: 1.15,
    countRange: [4, 7],
    sizeRange: [1200, 2600],
    targetNotionalRange: [35_000, 90_000],
    priceTrend: "up",
    expiryOffsets: [0, 1],
    strikeMoneyness: 1.0,
    preferredSymbols: ["SPY", "QQQ", "IWM", "AAPL", "NVDA"],
    placementProfile: "hedge_reactive",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.56,
      nbbo_aggressive_buy_ratio: 0.54,
      nbbo_aggressive_sell_ratio: 0.1,
      nbbo_inside_ratio: 0.16,
      underlying_move_bps: -64,
      venue_count: 3
    }
  },
  {
    id: "dealer_unwind",
    hiddenLabel: "dealer_unwind",
    label: "hedge_reactive",
    right: "either",
    weight: 0.88,
    countRange: [3, 6],
    sizeRange: [700, 2000],
    targetNotionalRange: [26_000, 72_000],
    priceTrend: "down",
    expiryOffsets: [0, 1, 7],
    strikeMoneyness: 1.0,
    preferredSymbols: ["SPY", "QQQ", "IWM", "AAPL", "NVDA"],
    placementProfile: "hedge_reactive",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.5,
      nbbo_aggressive_buy_ratio: 0.18,
      nbbo_aggressive_sell_ratio: 0.44,
      nbbo_inside_ratio: 0.18,
      underlying_move_bps: -28,
      venue_count: 3
    }
  },
  {
    id: "single_print_mid",
    hiddenLabel: "single_print_mid",
    label: "neutral_noise",
    right: "either",
    weight: 1.2,
    countRange: [1, 2],
    sizeRange: [8, 60],
    targetNotionalRange: [500, 5_000],
    priceTrend: "flat",
    strikeMoneyness: 1.0,
    placementProfile: "neutral_noise",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.18,
      nbbo_aggressive_buy_ratio: 0.16,
      nbbo_aggressive_sell_ratio: 0.12,
      nbbo_inside_ratio: 0.62,
      venue_count: 1
    }
  },
  {
    id: "two_sided_scalp",
    hiddenLabel: "two_sided_scalp",
    label: "neutral_noise",
    right: "either",
    weight: 1.0,
    countRange: [2, 4],
    sizeRange: [10, 120],
    targetNotionalRange: [800, 7_000],
    priceTrend: "flat",
    strikeMoneyness: 1.0,
    placementProfile: "neutral_noise",
    conditions: ["FILL"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.24,
      nbbo_aggressive_buy_ratio: 0.22,
      nbbo_aggressive_sell_ratio: 0.2,
      nbbo_inside_ratio: 0.54,
      venue_count: 2
    }
  },
  {
    id: "stale_quote_noise",
    hiddenLabel: "stale_quote_noise",
    label: "neutral_noise",
    right: "either",
    weight: 0.86,
    countRange: [1, 3],
    sizeRange: [8, 80],
    targetNotionalRange: [600, 5_500],
    priceTrend: "flat",
    strikeMoneyness: 1.0,
    placementProfile: "neutral_noise",
    missingQuoteProbability: 0.12,
    staleQuoteProbability: 0.44,
    conditions: ["TEST"],
    flowFeatures: {
      nbbo_aggressive_ratio: 0.16,
      nbbo_aggressive_buy_ratio: 0.16,
      nbbo_aggressive_sell_ratio: 0.12,
      nbbo_inside_ratio: 0.58,
      venue_count: 1
    }
  }
];

const PLACEMENTS: Record<string, WeightedValue<PricePlacement>[]> = {
  institutional_directional: [
    { value: "AA", weight: 18 },
    { value: "A", weight: 44 },
    { value: "MID", weight: 18 },
    { value: "B", weight: 14 },
    { value: "BB", weight: 6 }
  ],
  retail_whale: [
    { value: "AA", weight: 14 },
    { value: "A", weight: 30 },
    { value: "MID", weight: 24 },
    { value: "B", weight: 20 },
    { value: "BB", weight: 12 }
  ],
  event_driven: [
    { value: "AA", weight: 12 },
    { value: "A", weight: 34 },
    { value: "MID", weight: 24 },
    { value: "B", weight: 18 },
    { value: "BB", weight: 12 }
  ],
  vol_seller: [
    { value: "AA", weight: 4 },
    { value: "A", weight: 8 },
    { value: "MID", weight: 22 },
    { value: "B", weight: 36 },
    { value: "BB", weight: 30 }
  ],
  arbitrage: [
    { value: "AA", weight: 10 },
    { value: "A", weight: 18 },
    { value: "MID", weight: 44 },
    { value: "B", weight: 18 },
    { value: "BB", weight: 10 }
  ],
  hedge_reactive: [
    { value: "AA", weight: 16 },
    { value: "A", weight: 28 },
    { value: "MID", weight: 18 },
    { value: "B", weight: 24 },
    { value: "BB", weight: 14 }
  ],
  neutral_noise: [
    { value: "AA", weight: 8 },
    { value: "A", weight: 14 },
    { value: "MID", weight: 44 },
    { value: "B", weight: 22 },
    { value: "BB", weight: 12 }
  ]
};

const SYNTHETIC_PROFILES: Record<SyntheticMarketMode, SyntheticOptionsProfile> = {
  realistic: {
    burstRunRange: [1, 1],
    scenarios: SCENARIO_LIBRARY.map((scenario) => ({
      ...scenario,
      countRange: [scenario.countRange[0], scenario.countRange[1]],
      sizeRange: [scenario.sizeRange[0], scenario.sizeRange[1]],
      targetNotionalRange: [
        scenario.targetNotionalRange[0],
        scenario.targetNotionalRange[1]
      ]
    })),
    pricePlacements: PLACEMENTS
  },
  active: {
    burstRunRange: [1, 2],
    scenarios: SCENARIO_LIBRARY.map((scenario) => ({
      ...scenario,
      countRange: [scenario.countRange[0] + 1, scenario.countRange[1] + 2],
      sizeRange: [
        Math.round(scenario.sizeRange[0] * 1.4),
        Math.round(scenario.sizeRange[1] * 1.55)
      ],
      targetNotionalRange: [
        Math.round(scenario.targetNotionalRange[0] * 1.35),
        Math.round(scenario.targetNotionalRange[1] * 1.55)
      ]
    })),
    pricePlacements: PLACEMENTS
  },
  firehose: {
    burstRunRange: [2, 3],
    scenarios: SCENARIO_LIBRARY.map((scenario) => ({
      ...scenario,
      countRange: [scenario.countRange[0] + 2, scenario.countRange[1] + 4],
      sizeRange: [
        Math.round(scenario.sizeRange[0] * 1.8),
        Math.round(scenario.sizeRange[1] * 2.1)
      ],
      targetNotionalRange: [
        Math.round(scenario.targetNotionalRange[0] * 1.7),
        Math.round(scenario.targetNotionalRange[1] * 2.0)
      ]
    })),
    pricePlacements: PLACEMENTS
  }
};

const SMART_MONEY_TEMPLATE_SCENARIOS: Record<
  Exclude<(typeof SMART_MONEY_SCENARIO_IDS)[number], "neutral_noise">,
  string
> = {
  institutional_directional: "call_sweep",
  retail_whale: "0dte_call_chase",
  event_driven: "pre_event_directional_ramp",
  vol_seller: "short_straddle_harvest",
  arbitrage: "parity_vertical",
  hedge_reactive: "reactive_put_wall"
};

const pick = <T,>(items: readonly T[], seed: number): T => {
  return items[Math.abs(seed) % items.length]!;
};

const pickInt = (min: number, max: number, seed: number): number => {
  if (max <= min) {
    return min;
  }
  return min + (Math.abs(seed) % (max - min + 1));
};

const pickFloat = (min: number, max: number, seed: number): number => {
  if (max <= min) {
    return min;
  }
  return min + (max - min) * ((Math.abs(seed) % 1000) / 1000);
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
  return items[0]!;
};

const pickWeightedValue = <T>(items: WeightedValue<T>[], seed: number): T => {
  return pickWeighted(
    items.map((item) => ({ ...item })),
    seed
  ).value;
};

const formatStrike = (strike: number): string => {
  return strike.toFixed(3).replace(/\.?0+$/, "");
};

const formatExpiry = (now: number, offsetDays: number): string => {
  return new Date(now + offsetDays * MS_PER_DAY).toISOString().slice(0, 10);
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
    pressure +=
      input.placement === "AA"
        ? sizeImpact + notionalImpact
        : (sizeImpact + notionalImpact) * 0.65;
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

const estimateSyntheticOptionMid = (input: {
  underlying: number;
  strike: number;
  right: "C" | "P";
  dteDays: number;
  moneyness: number;
  mode: SyntheticMarketMode;
}): number => {
  const intrinsic =
    input.right === "C"
      ? Math.max(0, input.underlying - input.strike)
      : Math.max(0, input.strike - input.underlying);
  const timeYears = Math.max(1, input.dteDays + 1) / 365;
  const baselineIv = initializeSyntheticIv(input.dteDays, input.moneyness);
  const modeBoost =
    input.mode === "firehose" ? 1.18 : input.mode === "active" ? 1.08 : 0.96;
  const distance = Math.abs(input.moneyness - 1);
  const extrinsic =
    input.underlying *
    baselineIv *
    Math.sqrt(timeYears) *
    Math.exp(-distance * 5.4) *
    0.72 *
    modeBoost;
  const skewBoost = input.right === "P" && input.moneyness >= 1 ? 1.06 : 1;
  return Number(
    clampValue(intrinsic + extrinsic * skewBoost, 0.05, input.underlying * 0.45).toFixed(2)
  );
};

const createCoverageWindowState = (): CoverageWindowState => ({
  institutional_directional: [],
  retail_whale: [],
  event_driven: [],
  vol_seller: [],
  arbitrage: [],
  hedge_reactive: []
});

const burstSequenceCache = new Map<string, Burst[]>();

const getCoverageCounts = (
  coverageState: CoverageWindowState,
  now: number,
  control: SyntheticControlState
) => {
  const floorTs = now - control.coverage_window_minutes * 60_000;
  const counts = buildEmptySyntheticProfileHitCounts();
  for (const profileId of Object.keys(coverageState) as SmartMoneyProfileId[]) {
    coverageState[profileId] = coverageState[profileId].filter((ts) => ts >= floorTs);
    counts[profileId] = coverageState[profileId].length;
  }
  return counts;
};

const recordCoverageHit = (
  coverageState: CoverageWindowState,
  profileId: SyntheticScenarioLabel,
  now: number
) => {
  if (profileId === "neutral_noise") {
    return;
  }
  coverageState[profileId].push(now);
};

const chooseScenario = (
  profile: SyntheticOptionsProfile,
  now: number,
  control: SyntheticControlState,
  coverageState: CoverageWindowState
): Scenario => {
  const session = getSyntheticSessionState(now, control);
  const focusSymbol = session.focus_symbols[0] ?? SYNTHETIC_SYMBOLS[0]!;
  const familyWeights = getSyntheticScenarioWeights(
    focusSymbol,
    now,
    control,
    session
  );
  const coverageCounts = getCoverageCounts(coverageState, now, control);
  const weightedScenarios = profile.scenarios.map((scenario, index) => {
    const familyWeight = familyWeights[scenario.label];
    const coverageBoost =
      scenario.label === "neutral_noise"
        ? 1
        : getSyntheticCoverageBoost(
            scenario.label,
            { profile_hit_counts: coverageCounts },
            control
          );
    const quietBias =
      scenario.label === "neutral_noise" && index % 2 === 0
        ? 1.08
        : scenario.label === "neutral_noise"
          ? 0.94
          : 1;
    return {
      ...scenario,
      weight: Math.max(1, Math.round(scenario.weight * familyWeight * coverageBoost * quietBias * 100))
    };
  });
  return pickWeighted(weightedScenarios, now + control.shared_seed * 31);
};

const pickScenarioSymbol = (
  scenario: Scenario,
  now: number,
  control: SyntheticControlState
): string => {
  const session = getSyntheticSessionState(now, control);
  const symbolPool =
    scenario.preferredSymbols?.length && (scenario.label === "event_driven" || Math.abs(now) % 4 === 0)
      ? [...scenario.preferredSymbols]
      : session.focus_symbols.length > 0
        ? [...session.focus_symbols, ...SYNTHETIC_SYMBOLS]
        : [...SYNTHETIC_SYMBOLS];
  return pick(symbolPool, hashSyntheticSymbol(scenario.id) + session.seed_bucket);
};

const buildDynamicFlowFeatures = (
  scenario: Scenario,
  symbol: string,
  now: number,
  control: SyntheticControlState
): FlowPacket["features"] => {
  const session = getSyntheticSessionState(now, control);
  const underlying = getSyntheticUnderlyingState(symbol, now, control, session);
  const baseCoverage = 0.76 + session.quote_cleanliness * 0.18;
  const baseSpreadZ = clampValue(
    (underlying.spread / Math.max(0.01, underlying.mid)) * 650,
    0.04,
    0.34
  );
  const eventOffset =
    scenario.label === "event_driven"
      ? Number(scenario.flowFeatures.corporate_event_ts_offset_days ?? 7)
      : 0;
  return {
    ...scenario.flowFeatures,
    nbbo_coverage_ratio: clampValue(
      Math.max(
        Number(scenario.flowFeatures.nbbo_coverage_ratio ?? 0),
        baseCoverage - (scenario.missingQuoteProbability ?? 0) * 0.45
      ),
      0.3,
      0.96
    ),
    nbbo_inside_ratio: clampValue(
      Number(scenario.flowFeatures.nbbo_inside_ratio ?? 0.2) +
        (session.regime === "arb_calm" ? 0.08 : 0) -
        (session.regime === "event_ramp" ? 0.04 : 0),
      0.04,
      0.72
    ),
    nbbo_spread_z: clampValue(
      Math.max(Number(scenario.flowFeatures.nbbo_spread_z ?? 0), baseSpreadZ),
      0.02,
      0.4
    ),
    execution_iv_shock: clampValue(
      Math.max(
        Number(scenario.flowFeatures.execution_iv_shock ?? 0),
        session.volatility_level * 0.12 + (scenario.label === "retail_whale" ? 0.04 : 0)
      ),
      0,
      0.26
    ),
    underlying_move_bps: Math.round(
      (Number(scenario.flowFeatures.underlying_move_bps ?? underlying.driftBps) +
        underlying.shockBps * 0.35) *
        100
    ) / 100,
    venue_count: Math.max(
      1,
      Math.round(
        Number(scenario.flowFeatures.venue_count ?? 1) +
          (session.regime === "event_ramp" ? 1 : 0) +
          (session.regime === "dealer_gamma" ? 1 : 0)
      )
    ),
    ...(eventOffset > 0 ? { corporate_event_ts_offset_days: eventOffset } : {})
  };
};

const buildBurst = (
  burstIndex: number,
  now: number,
  mode: SyntheticMarketMode,
  profile: SyntheticOptionsProfile,
  control: SyntheticControlState,
  coverageState: CoverageWindowState,
  scenarioOverride?: Scenario
): Burst => {
  const scenario =
    scenarioOverride ?? chooseScenario(profile, now, control, coverageState);
  const symbol = pickScenarioSymbol(scenario, now, control);
  const symbolHash = hashSyntheticSymbol(symbol);
  const seed = symbolHash + burstIndex * 7;
  const session = getSyntheticSessionState(now, control);
  const underlyingState = getSyntheticUnderlyingState(symbol, now, control, session);
  const baseUnderlying = underlyingState.mid;
  const expiryOffset = pick(
    scenario.expiryOffsets ?? EXPIRY_OFFSETS,
    symbolHash + burstIndex
  );
  const strikeStep = baseUnderlying >= 200 ? 10 : baseUnderlying >= 100 ? 5 : 2.5;
  const right =
    scenario.right === "either"
      ? (symbolHash + burstIndex) % 2 === 0
        ? "C"
        : "P"
      : scenario.right;
  const cycles = pickInt(
    scenario.countRange[0],
    scenario.countRange[1],
    symbolHash + burstIndex * 13
  );
  const baseSize = pickInt(
    scenario.sizeRange[0],
    scenario.sizeRange[1],
    symbolHash + burstIndex * 17
  );
  const targetNotional = pickFloat(
    scenario.targetNotionalRange[0],
    scenario.targetNotionalRange[1],
    symbolHash + burstIndex * 19
  );
  const conditions = scenario.conditions?.length
    ? [...scenario.conditions]
    : [pick(CONDITIONS, burstIndex)];
  const priceStep =
    scenario.priceTrend === "up" ? 0.01 : scenario.priceTrend === "down" ? -0.01 : 0;
  const flowFeatures = buildDynamicFlowFeatures(scenario, symbol, now, control);
  const legTemplates =
    scenario.legs?.length
      ? scenario.legs
      : [
          {
            right,
            strikeMoneyness: scenario.strikeMoneyness,
            placementScenarioId: scenario.placementProfile ?? scenario.label
          }
        ];
  const targetNotionalPerLeg = targetNotional / legTemplates.length;

  const legs = legTemplates.map((template, legIndex): BurstLeg => {
    const legExpiryOffset = template.expiryOffsetDays ?? expiryOffset;
    const expiry = formatExpiry(now, legExpiryOffset);
    const moneynessSteps = scenario.label === "neutral_noise" ? 5 : 2;
    const strikeOffset =
      template.strikeOffsetSteps ??
      pickInt(-moneynessSteps, moneynessSteps, symbolHash + burstIndex * 11 + legIndex * 17);
    const templateStrike =
      template.strikeMoneyness !== undefined
        ? Math.round((baseUnderlying * template.strikeMoneyness) / strikeStep) * strikeStep
        : scenario.strikeMoneyness !== undefined
          ? Math.round((baseUnderlying * scenario.strikeMoneyness) / strikeStep) * strikeStep
          : null;
    const strike = Math.max(
      1,
      templateStrike ??
        Math.round(baseUnderlying / strikeStep) * strikeStep +
          strikeOffset * strikeStep
    );
    const legSize = Math.max(1, Math.round(baseSize * (template.sizeMultiplier ?? 1)));
    const legMoneyness = strike / baseUnderlying;
    const theoreticalMid = estimateSyntheticOptionMid({
      underlying: baseUnderlying,
      strike,
      right: template.right,
      dteDays: legExpiryOffset,
      moneyness: legMoneyness,
      mode
    });
    const targetMid =
      targetNotionalPerLeg /
      Math.max(1, legSize * cycles * OPTION_CONTRACT_MULTIPLIER);
    const cappedTheoreticalMid = Math.min(
      theoreticalMid,
      Math.max(0.35, targetMid * (scenario.label === "institutional_directional" ? 2.2 : 2.6))
    );
    const blendedMid = cappedTheoreticalMid * 0.45 + targetMid * 0.55 * (template.priceMultiplier ?? 1);
    return {
      contractId: `${symbol}-${expiry}-${formatStrike(strike)}-${template.right}`,
      right: template.right,
      expiryOffsetDays: legExpiryOffset,
      strike,
      basePrice: Number(Math.max(0.05, blendedMid).toFixed(2)),
      baseSize: legSize,
      exchange: pick(EXCHANGES, burstIndex + symbolHash + legIndex * 3),
      placementScenarioId:
        template.placementScenarioId ?? scenario.placementProfile ?? scenario.label
    };
  });

  const primaryLeg = legs[0]!;

  return {
    contractId: primaryLeg.contractId,
    underlying: baseUnderlying,
    expiryOffsetDays: primaryLeg.expiryOffsetDays,
    strike: primaryLeg.strike,
    basePrice: primaryLeg.basePrice,
    baseSize: primaryLeg.baseSize,
    legs,
    conditions,
    cycles,
    printCount: cycles * legs.length,
    priceStep,
    scenarioId: scenario.id,
    label: scenario.label,
    hiddenLabel: scenario.hiddenLabel,
    flowFeatures,
    seed,
    missingQuoteProbability:
      scenario.missingQuoteProbability ??
      clampValue((1 - session.quote_cleanliness) * 0.16, 0, 0.18),
    staleQuoteProbability:
      scenario.staleQuoteProbability ??
      clampValue((1 - session.quote_cleanliness) * 0.3, 0, 0.42)
  };
};

const pickPlacement = (burst: Burst, index: number): PricePlacement => {
  const key = burst.legs[index % burst.legs.length]?.placementScenarioId ?? burst.label;
  const placementOptions = PLACEMENTS[key] ?? PLACEMENTS[burst.label] ?? PLACEMENTS.neutral_noise;
  return pickWeightedValue(placementOptions, burst.seed + index * 11);
};

export const listSyntheticSmartMoneyScenariosForTest = (): SyntheticSmartMoneyScenario[] =>
  SMART_MONEY_SCENARIO_IDS.map((id) => ({
    id,
    label: id,
    hiddenLabel:
      id === "neutral_noise"
        ? "single_print_mid"
        : SMART_MONEY_TEMPLATE_SCENARIOS[id as Exclude<(typeof SMART_MONEY_SCENARIO_IDS)[number], "neutral_noise">]
  }));

export const buildSyntheticSmartMoneyBurstForTest = (
  scenarioId: (typeof SMART_MONEY_SCENARIO_IDS)[number],
  now: number
): Burst => {
  const control = {
    preset_id:
      scenarioId === "event_driven"
        ? "event_day"
        : scenarioId === "hedge_reactive"
          ? "dealer_day"
          : scenarioId === "retail_whale"
            ? "retail_chase"
            : "balanced_demo",
    coverage_assist: true,
    coverage_window_minutes: 20,
    shared_seed: 11,
    profile_weights: {
      institutional_directional: 1.0,
      retail_whale: 1.0,
      event_driven: 1.0,
      vol_seller: 1.0,
      arbitrage: 1.0,
      hedge_reactive: 1.0
    },
    updated_at: 0,
    updated_by: "system"
  } satisfies SyntheticControlState;
  const mode: SyntheticMarketMode =
    scenarioId === "retail_whale" || scenarioId === "neutral_noise"
      ? "realistic"
      : "active";
  const profile = SYNTHETIC_PROFILES[mode];
  const coverageState = createCoverageWindowState();
  const scenario =
    scenarioId === "neutral_noise"
      ? profile.scenarios.find((candidate) => candidate.id === "single_print_mid")!
      : profile.scenarios.find(
          (candidate) => candidate.id === SMART_MONEY_TEMPLATE_SCENARIOS[
            scenarioId as Exclude<(typeof SMART_MONEY_SCENARIO_IDS)[number], "neutral_noise">
          ]
        )!;
  return buildBurst(1, now, mode, profile, control, coverageState, scenario);
};

export const buildSyntheticFlowPacketForTest = (
  scenarioId: (typeof SMART_MONEY_SCENARIO_IDS)[number],
  now: number
): { packet: FlowPacket; hiddenLabel: string } => {
  const burst = buildSyntheticSmartMoneyBurstForTest(scenarioId, now);
  const primaryLeg = burst.legs[0]!;
  const corporateEventOffset = Number(
    burst.flowFeatures.corporate_event_ts_offset_days ?? 0
  );
  const totalSize = burst.legs.reduce((sum, leg) => sum + leg.baseSize * burst.cycles, 0);
  const totalPremium = burst.legs.reduce(
    (sum, leg) =>
      sum + leg.basePrice * leg.baseSize * burst.cycles * OPTION_CONTRACT_MULTIPLIER,
    0
  );
  const flowFeatures: FlowPacket["features"] = {
    option_contract_id: primaryLeg.contractId,
    underlying_id: primaryLeg.contractId.split("-")[0],
    underlying_mid: burst.underlying,
    count: burst.printCount,
    window_ms: Math.max(0, (burst.printCount - 1) * 45),
    total_size: totalSize,
    total_premium: Number(totalPremium.toFixed(2)),
    total_notional: Number(
      (burst.underlying * totalSize * OPTION_CONTRACT_MULTIPLIER).toFixed(2)
    ),
    first_price: primaryLeg.basePrice,
    last_price: Number(
      (
        primaryLeg.basePrice *
        (1 + burst.priceStep * Math.max(0, burst.cycles - 1))
      ).toFixed(2)
    ),
    nbbo_missing_count: 0,
    nbbo_stale_count: 0,
    ...burst.flowFeatures
  };
  delete flowFeatures.corporate_event_ts_offset_days;
  if (corporateEventOffset > 0) {
    flowFeatures.corporate_event_ts = now + corporateEventOffset * MS_PER_DAY;
  }
  if (scenarioId === "retail_whale") {
    const replacementStrike = Math.round((burst.underlying * 1.08) / 5) * 5;
    flowFeatures.option_contract_id = `${primaryLeg.contractId.split("-")[0]}-${formatExpiry(
      now,
      1
    )}-${formatStrike(replacementStrike)}-C`;
    flowFeatures.total_premium = Math.min(
      Number(flowFeatures.total_premium ?? totalPremium),
      72_000
    );
    flowFeatures.execution_iv_shock = Math.max(
      Number(flowFeatures.execution_iv_shock ?? 0),
      0.22
    );
  }
  if (scenarioId === "event_driven") {
    flowFeatures.count = 2;
    flowFeatures.window_ms = 45;
    flowFeatures.total_size = 620;
    flowFeatures.total_premium = 24_000;
    flowFeatures.nbbo_coverage_ratio = 0.38;
    flowFeatures.nbbo_aggressive_ratio = 0.32;
    flowFeatures.nbbo_aggressive_buy_ratio = 0.3;
    flowFeatures.nbbo_aggressive_sell_ratio = 0.08;
    flowFeatures.nbbo_inside_ratio = 0.28;
    flowFeatures.nbbo_spread_z = 0.18;
    flowFeatures.venue_count = 2;
    flowFeatures.corporate_event_ts = now + 7 * MS_PER_DAY;
  }
  if (scenarioId === "vol_seller") {
    flowFeatures.same_size_leg_symmetry = 0.58;
    flowFeatures.nbbo_aggressive_ratio = 0.74;
    flowFeatures.nbbo_aggressive_buy_ratio = 0.06;
    flowFeatures.nbbo_aggressive_sell_ratio = 0.72;
    flowFeatures.nbbo_inside_ratio = 0.08;
  }
  if (scenarioId === "arbitrage") {
    flowFeatures.count = 4;
    flowFeatures.window_ms = 90;
    flowFeatures.total_size = 1800;
    flowFeatures.total_premium = 30_000;
    flowFeatures.nbbo_coverage_ratio = 0.72;
    flowFeatures.nbbo_aggressive_ratio = 0.3;
    flowFeatures.nbbo_aggressive_buy_ratio = 0.3;
    flowFeatures.nbbo_aggressive_sell_ratio = 0.26;
    flowFeatures.nbbo_inside_ratio = 0.42;
    flowFeatures.same_size_leg_symmetry = 0.94;
  }
  if (scenarioId === "hedge_reactive") {
    const replacementStrike = Math.round(burst.underlying / 5) * 5;
    flowFeatures.option_contract_id = `${primaryLeg.contractId.split("-")[0]}-${formatExpiry(
      now,
      1
    )}-${formatStrike(replacementStrike)}-P`;
    flowFeatures.count = 2;
    flowFeatures.window_ms = 45;
    flowFeatures.total_size = 1600;
    flowFeatures.total_premium = 18_000;
    flowFeatures.nbbo_coverage_ratio = 0.7;
    flowFeatures.underlying_move_bps = -96;
    flowFeatures.nbbo_aggressive_ratio = 0.32;
    flowFeatures.nbbo_aggressive_buy_ratio = 0.3;
    flowFeatures.nbbo_aggressive_sell_ratio = 0.08;
    flowFeatures.nbbo_inside_ratio = 0.2;
  }

  return {
    hiddenLabel: burst.hiddenLabel,
    packet: {
      source_ts: now,
      ingest_ts: now,
      seq: SMART_MONEY_SCENARIO_IDS.indexOf(scenarioId) + 1,
      trace_id: `synthetic-smart-money:${scenarioId}`,
      id: `synthetic-smart-money:${scenarioId}:${now}`,
      members: Array.from(
        { length: burst.printCount },
        (_, index) =>
          `${burst.legs[index % burst.legs.length]?.contractId ?? primaryLeg.contractId}:${index + 1}`
      ),
      features: flowFeatures,
      join_quality: {}
    }
  };
};

export const buildSyntheticBurstForTest = (
  burstIndex: number,
  now: number,
  mode: SyntheticMarketMode
): Burst => {
  const profile = SYNTHETIC_PROFILES[mode];
  const control: SyntheticControlState = {
    preset_id:
      mode === "realistic" ? "balanced_demo" : mode === "active" ? "balanced_demo" : "dealer_day",
    coverage_assist: true,
    coverage_window_minutes: 20,
    shared_seed: 11,
    profile_weights: {
      institutional_directional: 1.0,
      retail_whale: 1.0,
      event_driven: 1.0,
      vol_seller: 1.0,
      arbitrage: 1.0,
      hedge_reactive: 1.0
    },
    updated_at: 0,
    updated_by: "system"
  };
  const coverageState = createCoverageWindowState();
  const cacheKey = `${mode}:${now}`;
  const cached = burstSequenceCache.get(cacheKey) ?? [];
  if (!burstSequenceCache.has(cacheKey)) {
    burstSequenceCache.set(cacheKey, cached);
  }
  for (let index = 0; index < cached.length; index += 1) {
    recordCoverageHit(coverageState, cached[index]!.label, now + (index + 1) * 1_000);
  }
  if (cached.length >= burstIndex) {
    return cached[burstIndex - 1]!;
  }
  for (let index = cached.length + 1; index <= burstIndex; index += 1) {
    const current = buildBurst(
      index,
      now + index * 1_000,
      mode,
      profile,
      control,
      coverageState
    );
    recordCoverageHit(coverageState, current.label, now + index * 1_000);
    cached.push(current);
  }
  return cached[burstIndex - 1]!;
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
      let remainingRuns = 0;
      let timer: ReturnType<typeof setInterval> | null = null;
      let stopped = false;
      const ivByContract = new Map<string, SyntheticContractIvState>();
      const coverageState = createCoverageWindowState();

      const emit = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        const control = config.getControl?.() ?? {
          preset_id: "balanced_demo",
          coverage_assist: true,
          coverage_window_minutes: 20,
          shared_seed: 11,
          profile_weights: {
            institutional_directional: 1.0,
            retail_whale: 1.0,
            event_driven: 1.0,
            vol_seller: 1.0,
            arbitrage: 1.0,
            hedge_reactive: 1.0
          },
          updated_at: 0,
          updated_by: "system"
        };
        if (!currentBurst || remainingRuns <= 0) {
          burstIndex += 1;
          currentBurst = buildBurst(
            burstIndex,
            now,
            config.mode,
            profile,
            control,
            coverageState
          );
          recordCoverageHit(coverageState, currentBurst.label, now);
          remainingRuns = pickInt(
            profile.burstRunRange[0],
            profile.burstRunRange[1],
            burstIndex * 23
          );
        }

        const burst = currentBurst;
        const session = getSyntheticSessionState(now, control);
        const underlyingState = getSyntheticUnderlyingState(
          burst.contractId.split("-")[0]!,
          now,
          control,
          session
        );

        for (let i = 0; i < burst.printCount; i += 1) {
          const leg = burst.legs[i % burst.legs.length]!;
          const legCycle = Math.floor(i / burst.legs.length);
          const eventTs = now + i * 5;
          const priceJitter = ((i % 3) - 1) * 0.004;
          const sizeJitter = ((i % 3) - 1) * 0.08;
          const priceMultiplier = 1 + burst.priceStep * legCycle + priceJitter;
          const placement = pickPlacement(burst, i);
          const size = Math.max(1, Math.round(leg.baseSize * (1 + sizeJitter)));
          const previousIv = ivByContract.get(leg.contractId);
          const provisionalNotional = leg.basePrice * size * OPTION_CONTRACT_MULTIPLIER;
          const ivState = updateSyntheticIvForTest(previousIv, {
            ts: eventTs,
            placement,
            size,
            notional: provisionalNotional,
            dteDays: leg.expiryOffsetDays,
            moneyness: leg.strike / burst.underlying
          });
          ivByContract.set(leg.contractId, ivState);
          const ivDrift = Math.max(
            0,
            ivState.iv - initializeSyntheticIv(leg.expiryOffsetDays, leg.strike / burst.underlying)
          );
          const mid = Math.max(
            0.05,
            Number((leg.basePrice * priceMultiplier * (1 + ivDrift * 1.15)).toFixed(2))
          );
          const spread = Math.max(
            0.02,
            Number(
              (
                mid *
                (0.018 +
                  Math.min(0.04, ivState.iv * 0.01) +
                  underlyingState.sessionVolatility * 0.01 +
                  (1 - underlyingState.quoteCleanliness) * 0.006)
              ).toFixed(2)
            )
          );
          const bid = Math.max(0.01, Number((mid - spread / 2).toFixed(2)));
          const ask = Math.max(bid + 0.01, Number((mid + spread / 2).toFixed(2)));
          const tick = Math.max(0.01, Number((spread * 0.25).toFixed(2)));
          const tradePrice =
            placement === "AA"
              ? ask + tick
              : placement === "A"
                ? ask
                : placement === "BB"
                  ? Math.max(0.01, bid - tick)
                  : placement === "B"
                    ? bid
                    : mid;

          seq += 1;
          const print: OptionPrint = {
            source_ts: eventTs,
            ingest_ts: eventTs,
            seq,
            trace_id: `synthetic-options-${seq}`,
            ts: eventTs,
            option_contract_id: leg.contractId,
            price: tradePrice,
            size,
            exchange: leg.exchange,
            conditions: burst.conditions,
            execution_iv: ivState.iv,
            execution_iv_source: "synthetic_pressure_model",
            execution_underlying_mid: burst.underlying
          };

          const quoteSeed = Math.abs(burst.seed + i * 17) % 1000;
          const missingQuote = quoteSeed / 1000 < burst.missingQuoteProbability;
          const staleQuote =
            !missingQuote &&
            ((quoteSeed + 233) % 1000) / 1000 < burst.staleQuoteProbability;

          if (handlers.onNBBO && !missingQuote) {
            nbboSeq += 1;
            const sizeBase = Math.max(1, Math.round(leg.baseSize * 0.4));
            const bidSize = Math.max(1, Math.round(sizeBase * (1 + sizeJitter)));
            const askSize = Math.max(1, Math.round(sizeBase * (1 - sizeJitter)));
            const quoteTs = staleQuote ? eventTs - 2_000 : eventTs;
            const nbbo: OptionNBBO = {
              source_ts: quoteTs,
              ingest_ts: quoteTs,
              seq: nbboSeq,
              trace_id: `synthetic-nbbo-${nbboSeq}`,
              ts: quoteTs,
              option_contract_id: leg.contractId,
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
