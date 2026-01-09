import { SP500_SYMBOLS, type OptionNBBO, type OptionPrint } from "@islandflow/types";
import type { OptionIngestAdapter, OptionIngestHandlers } from "./types";

type SyntheticOptionsAdapterConfig = {
  emitIntervalMs: number;
};

type Burst = {
  contractId: string;
  basePrice: number;
  baseSize: number;
  exchange: string;
  conditions?: string[];
  printCount: number;
  priceStep: number;
  scenarioId: string;
  seed: number;
};

const SYNTHETIC_SYMBOLS = [
  "SPY",
  ...SP500_SYMBOLS.filter((symbol) => symbol !== "SPY")
];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRY_OFFSETS = [0, 1, 7, 14, 28, 45, 60, 90];
const EXCHANGES = ["CBOE", "PHLX", "ISE", "ARCA", "BOX", "MIAX"];
const CONDITIONS = ["SWEEP", "ISO", "FILL", "TEST"];
const BURST_RUN_RANGE: [number, number] = [2, 4];

type PricePlacement = "AA" | "A" | "B" | "BB";

type WeightedValue<T> = {
  value: T;
  weight: number;
};

type Scenario = {
  id: string;
  weight: number;
  right: "C" | "P" | "either";
  countRange: [number, number];
  sizeRange: [number, number];
  premiumRange: [number, number];
  priceTrend: "up" | "down" | "flat";
  conditions?: string[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "bullish_sweep",
    weight: 35,
    right: "C",
    countRange: [7, 10],
    sizeRange: [600, 1800],
    premiumRange: [120_000, 240_000],
    priceTrend: "up",
    conditions: ["SWEEP"]
  },
  {
    id: "bearish_sweep",
    weight: 35,
    right: "P",
    countRange: [7, 10],
    sizeRange: [600, 1800],
    premiumRange: [120_000, 240_000],
    priceTrend: "up",
    conditions: ["SWEEP"]
  },
  {
    id: "contract_spike",
    weight: 20,
    right: "either",
    countRange: [5, 8],
    sizeRange: [1200, 3200],
    premiumRange: [60_000, 140_000],
    priceTrend: "flat",
    conditions: ["ISO"]
  },
  {
    id: "noise",
    weight: 10,
    right: "either",
    countRange: [2, 4],
    sizeRange: [10, 200],
    premiumRange: [500, 5000],
    priceTrend: "flat",
    conditions: ["FILL"]
  }
];

const PRICE_PLACEMENTS: Record<string, WeightedValue<PricePlacement>[]> = {
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

const PLACEMENT_PATTERN: PricePlacement[] = ["A", "AA", "B", "BB"];

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

const pickPlacement = (burst: Burst, index: number): PricePlacement => {
  const placementOptions = PRICE_PLACEMENTS[burst.scenarioId] ?? PRICE_PLACEMENTS.noise;
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

const buildBurst = (burstIndex: number, now: number): Burst => {
  const symbol = SYNTHETIC_SYMBOLS[burstIndex % SYNTHETIC_SYMBOLS.length];
  const symbolHash = hashSymbol(symbol);
  const seed = symbolHash + burstIndex * 7;
  const scenario = pickWeighted(SCENARIOS, seed);
  const baseUnderlying = 30 + (symbolHash % 470);
  const expiryOffset = pick(EXPIRY_OFFSETS, symbolHash + burstIndex);
  const expiry = formatExpiry(now, expiryOffset);
  const strikeStep = baseUnderlying >= 200 ? 10 : baseUnderlying >= 100 ? 5 : 2.5;
  const moneynessSteps = scenario.id === "noise" ? 5 : 2;
  const strikeOffset = pickInt(-moneynessSteps, moneynessSteps, symbolHash + burstIndex * 11);
  const strike = Math.max(
    1,
    Math.round(baseUnderlying / strikeStep) * strikeStep + strikeOffset * strikeStep
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
  const premiumTarget = pickFloat(
    scenario.premiumRange[0],
    scenario.premiumRange[1],
    symbolHash + burstIndex * 19
  );
  const basePricePer = Math.max(0.05, Number((premiumTarget / (baseSize * printCount)).toFixed(2)));
  const conditions = scenario.conditions?.length ? scenario.conditions : [pick(CONDITIONS, burstIndex)];
  const priceStep =
    scenario.priceTrend === "up" ? 0.01 : scenario.priceTrend === "down" ? -0.01 : 0;

  return {
    contractId,
    basePrice: basePricePer,
    baseSize,
    exchange,
    conditions,
    printCount,
    priceStep,
    scenarioId: scenario.id,
    seed
  };
};

export const createSyntheticOptionsAdapter = (
  config: SyntheticOptionsAdapterConfig
): OptionIngestAdapter => {
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

      const emit = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        if (!currentBurst || remainingRuns <= 0) {
          burstIndex += 1;
          currentBurst = buildBurst(burstIndex, now);
          remainingRuns = pickInt(BURST_RUN_RANGE[0], BURST_RUN_RANGE[1], burstIndex * 23);
        }

        const burst = currentBurst;
        const printsToEmit = burst.printCount;

        for (let i = 0; i < printsToEmit; i += 1) {
          seq += 1;
          const priceJitter = ((i % 3) - 1) * 0.004;
          const sizeJitter = ((i % 3) - 1) * 0.08;
          const priceMultiplier = 1 + burst.priceStep * i + priceJitter;
          const mid = Math.max(0.05, Number((burst.basePrice * priceMultiplier).toFixed(2)));
          const spread = Math.max(0.02, Number((mid * 0.02).toFixed(2)));
          const bid = Math.max(0.01, Number((mid - spread / 2).toFixed(2)));
          const ask = Math.max(bid + 0.01, Number((mid + spread / 2).toFixed(2)));
          const tick = Math.max(0.01, Number((spread * 0.25).toFixed(2)));
          const placement = pickPlacement(burst, i);
          let tradePrice = mid;

          if (placement === "AA") {
            tradePrice = ask + tick;
          } else if (placement === "A") {
            tradePrice = ask;
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
            size: Math.max(1, Math.round(burst.baseSize * (1 + sizeJitter))),
            exchange: burst.exchange,
            conditions: burst.conditions
          };

          void handlers.onTrade(print);

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
