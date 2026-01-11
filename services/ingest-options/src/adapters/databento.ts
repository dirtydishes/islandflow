import { createLogger } from "@islandflow/observability";
import type { OptionIngestAdapter, OptionIngestHandlers } from "./types";

type DatabentoOptionsAdapterConfig = {
  apiKey: string;
  dataset: string;
  schema: string;
  nbboSchema: string;
  start: string;
  end?: string;
  symbols: string;
  stypeIn: string;
  stypeOut: string;
  limit: number;
  priceScale: number;
  pythonBin: string;
};

type DatabentoTradeMessage = {
  type: "trade";
  ts: number;
  price: number;
  size: number;
  symbol: string;
  exchange?: string;
  conditions?: string[] | string;
};

type DatabentoNbboMessage = {
  type: "nbbo";
  ts: number;
  bid: number;
  ask: number;
  bidSize?: number;
  askSize?: number;
  symbol: string;
  exchange?: string;
};

type DatabentoReplayMessage = DatabentoTradeMessage | DatabentoNbboMessage;

type OptionContract = {
  root: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
};

const logger = createLogger({ service: "ingest-options" });

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const parseOccSymbol = (symbol: string): OptionContract | null => {
  if (symbol.length < 15) {
    return null;
  }

  const tail = symbol.slice(-15);
  const rootRaw = symbol.slice(0, -15).trim();
  const expiryRaw = tail.slice(0, 6);
  const right = tail.slice(6, 7);
  const strikeRaw = tail.slice(7);

  if (!/^\d{6}$/.test(expiryRaw) || !/^\d{8}$/.test(strikeRaw)) {
    return null;
  }

  if (right !== "C" && right !== "P") {
    return null;
  }

  const year = 2000 + Number(expiryRaw.slice(0, 2));
  const month = Number(expiryRaw.slice(2, 4)) - 1;
  const day = Number(expiryRaw.slice(4, 6));
  const expiryDate = new Date(Date.UTC(year, month, day));
  const expiry = formatDate(expiryDate);
  const strike = Number(strikeRaw) / 1000;

  if (!rootRaw || !Number.isFinite(strike)) {
    return null;
  }

  return {
    root: rootRaw,
    expiry,
    strike,
    right
  };
};

const formatStrike = (strike: number): string => {
  const fixed = strike.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
};

const formatContractId = (contract: OptionContract): string =>
  `${contract.root}-${contract.expiry}-${formatStrike(contract.strike)}-${contract.right}`;

const normalizeTimestamp = (value: number): number => {
  if (!Number.isFinite(value)) {
    return Date.now();
  }

  if (value > 1_000_000_000_000_000) {
    return Math.floor(value / 1_000_000);
  }

  return value;
};

const readLines = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        onLine(trimmed);
      }
    }
  }

  if (buffer.trim().length > 0) {
    onLine(buffer.trim());
  }
};

export const createDatabentoOptionsAdapter = (
  config: DatabentoOptionsAdapterConfig
): OptionIngestAdapter => {
  return {
    name: "databento",
    start: (handlers: OptionIngestHandlers) => {
      if (!config.apiKey) {
        throw new Error("DATABENTO_API_KEY is required for the Databento adapter.");
      }

      if (!config.start) {
        throw new Error("DATABENTO_START is required for the Databento adapter.");
      }

      const scriptPath = new URL("../../py/databento_replay.py", import.meta.url).pathname;

      const buildArgs = (schema: string): string[] => {
        const args = [
          config.pythonBin,
          scriptPath,
          "--dataset",
          config.dataset,
          "--schema",
          schema,
          "--start",
          config.start,
          "--symbols",
          config.symbols,
          "--stype-in",
          config.stypeIn,
          "--stype-out",
          config.stypeOut
        ];

        if (config.end) {
          args.push("--end", config.end);
        }

        if (config.limit > 0) {
          args.push("--limit", String(config.limit));
        }

        return args;
      };

      const children: Bun.Subprocess[] = [];
      let tradeSeq = 0;
      let nbboSeq = 0;
      const contractIdCache = new Map<string, string>();
      const warnedSymbols = new Set<string>();

      const resolveContractId = (symbol: string): string => {
        const cached = contractIdCache.get(symbol);
        if (cached) {
          return cached;
        }

        const parsed = parseOccSymbol(symbol);
        const contractId = parsed ? formatContractId(parsed) : symbol.trim() || symbol;
        contractIdCache.set(symbol, contractId);

        if (!parsed && !warnedSymbols.has(symbol)) {
          warnedSymbols.add(symbol);
          logger.warn("databento symbol parse failed; using raw symbol", { symbol });
        }

        return contractId;
      };

      const handleLine = (line: string) => {
        try {
          const payload = JSON.parse(line) as DatabentoReplayMessage;
          if (!payload || typeof payload !== "object") {
            return;
          }

          const symbol = String((payload as { symbol?: unknown }).symbol ?? "").trim();
          if (!symbol) {
            return;
          }

          const sourceTs = normalizeTimestamp(Number((payload as { ts?: unknown }).ts));
          if (!Number.isFinite(sourceTs)) {
            return;
          }

          const ingestTs = Date.now();
          const contractId = resolveContractId(symbol);

          if (payload.type === "trade") {
            const price = Number(payload.price);
            const size = Number(payload.size);
            if (!Number.isFinite(price) || !Number.isFinite(size)) {
              return;
            }

            const scaledPrice =
              config.priceScale === 1 ? price : price / config.priceScale;

            const conditions = Array.isArray(payload.conditions)
              ? payload.conditions.map((entry) => String(entry))
              : typeof payload.conditions === "string"
                ? [payload.conditions]
                : undefined;

            tradeSeq += 1;
            void handlers.onTrade({
              source_ts: sourceTs,
              ingest_ts: ingestTs,
              seq: tradeSeq,
              trace_id: `databento-${tradeSeq}`,
              ts: sourceTs,
              option_contract_id: contractId,
              price: scaledPrice,
              size,
              exchange: payload.exchange ? String(payload.exchange) : "OPRA",
              conditions
            });
            return;
          }

          if (payload.type === "nbbo") {
            if (!handlers.onNBBO) {
              return;
            }

            const bid = Number(payload.bid);
            const ask = Number(payload.ask);
            if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
              return;
            }

            const scaledBid = config.priceScale === 1 ? bid : bid / config.priceScale;
            const scaledAsk = config.priceScale === 1 ? ask : ask / config.priceScale;

            const bidSize = Math.max(0, Math.floor(Number(payload.bidSize ?? 0)));
            const askSize = Math.max(0, Math.floor(Number(payload.askSize ?? 0)));

            nbboSeq += 1;
            void handlers.onNBBO({
              source_ts: sourceTs,
              ingest_ts: ingestTs,
              seq: nbboSeq,
              trace_id: `databento-${nbboSeq}`,
              ts: sourceTs,
              option_contract_id: contractId,
              bid: scaledBid,
              ask: scaledAsk,
              bidSize,
              askSize
            });
          }
        } catch {
          // Ignore malformed lines to keep replay streaming.
        }
      };

      const spawnStream = (schema: string): void => {
        const trimmed = schema.trim();
        if (!trimmed) {
          return;
        }

        const child = Bun.spawn(buildArgs(trimmed), {
          stdout: "pipe",
          stderr: "inherit",
          env: {
            ...Bun.env,
            DATABENTO_API_KEY: config.apiKey
          }
        });

        if (!child.stdout) {
          throw new Error("Databento adapter failed to attach stdout.");
        }

        children.push(child);
        void readLines(child.stdout, handleLine);
      };

      spawnStream(config.schema);
      spawnStream(config.nbboSchema);

      return () => {
        for (const child of children) {
          child.kill();
        }
      };
    }
  };
};
