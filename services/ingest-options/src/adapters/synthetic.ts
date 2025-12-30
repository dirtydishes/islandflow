import { SP500_SYMBOLS, type OptionPrint } from "@islandflow/types";
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
  burstSize: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRY_OFFSETS = [7, 14, 28, 45, 60, 90];
const EXCHANGES = ["CBOE", "PHLX", "ISE", "ARCA", "BOX", "MIAX"];
const CONDITIONS = ["SWEEP", "ISO", "FILL", "TEST"];

const pick = <T,>(items: T[], seed: number): T => {
  return items[Math.abs(seed) % items.length];
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
  const symbol = SP500_SYMBOLS[burstIndex % SP500_SYMBOLS.length];
  const symbolHash = hashSymbol(symbol);
  const basePrice = 30 + (symbolHash % 470);
  const expiryOffset = pick(EXPIRY_OFFSETS, symbolHash + burstIndex);
  const expiry = formatExpiry(now, expiryOffset);
  const strikeStep = basePrice >= 200 ? 10 : 5;
  const strikeOffset = ((burstIndex % 7) - 3) * strikeStep;
  const strike = Math.max(1, Math.round(basePrice / strikeStep) * strikeStep + strikeOffset);
  const right = burstIndex % 2 === 0 ? "C" : "P";
  const contractId = `${symbol}-${expiry}-${formatStrike(strike)}-${right}`;
  const exchange = pick(EXCHANGES, burstIndex + symbolHash);
  const isBlock = burstIndex % 4 === 0;
  const burstSize = isBlock ? 4 : burstIndex % 3 === 0 ? 2 : 1;
  const baseSize = isBlock ? 1200 + (symbolHash % 1800) : 5 + (symbolHash % 180);
  const distance = Math.abs(strike - basePrice);
  const basePricePer = isBlock ? 12 + distance / strikeStep : 0.5 + distance / 30;
  const conditions = isBlock ? [pick(CONDITIONS, burstIndex)] : undefined;

  return {
    contractId,
    basePrice: basePricePer,
    baseSize,
    exchange,
    conditions,
    burstSize
  };
};

export const createSyntheticOptionsAdapter = (
  config: SyntheticOptionsAdapterConfig
): OptionIngestAdapter => {
  return {
    name: "synthetic",
    start: (handlers: OptionIngestHandlers) => {
      let seq = 0;
      let burstIndex = 0;
      let currentBurst: Burst | null = null;
      let remaining = 0;
      let timer: ReturnType<typeof setInterval> | null = null;
      let stopped = false;

      const emit = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        if (!currentBurst || remaining <= 0) {
          burstIndex += 1;
          currentBurst = buildBurst(burstIndex, now);
          remaining = currentBurst.burstSize;
        }

        const burst = currentBurst;
        const printsToEmit = remaining;

        for (let i = 0; i < printsToEmit; i += 1) {
          seq += 1;
          const priceJitter = (i % 3) - 1;
          const sizeJitter = (i % 4) - 1;
          const print: OptionPrint = {
            source_ts: now + i * 5,
            ingest_ts: now + i * 5,
            seq,
            trace_id: `synthetic-options-${seq}`,
            ts: now + i * 5,
            option_contract_id: burst.contractId,
            price: Math.max(0.05, Number((burst.basePrice * (1 + priceJitter * 0.02)).toFixed(2))),
            size: Math.max(1, Math.round(burst.baseSize * (1 + sizeJitter * 0.05))),
            exchange: burst.exchange,
            conditions: burst.conditions
          };

          void handlers.onTrade(print);
        }

        remaining = 0;
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
