import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_OPTION_PRINTS,
  STREAM_OPTION_PRINTS,
  connectJetStreamWithRetry,
  ensureStream,
  publishJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureOptionPrintsTable,
  insertOptionPrint
} from "@islandflow/storage";
import { OptionPrintSchema, type OptionPrint } from "@islandflow/types";
import { createAlpacaOptionsAdapter } from "./adapters/alpaca";
import { createIbkrOptionsAdapter } from "./adapters/ibkr";
import { createSyntheticOptionsAdapter } from "./adapters/synthetic";
import type { OptionIngestAdapter, StopHandler } from "./adapters/types";
import { z } from "zod";

const service = "ingest-options";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://localhost:4222"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  INGEST_ADAPTER: z.string().min(1).default("alpaca"),
  ALPACA_KEY_ID: z.string().default("PKQDUYKNHDYCPONSMWIXZHT6QV"),
  ALPACA_SECRET_KEY: z.string().default("5ktmszfCiWg125GtPguuFpSeTB2zHNewScncAaY4hnKo"),
  ALPACA_REST_URL: z.string().default("https://data.alpaca.markets"),
  ALPACA_WS_BASE_URL: z.string().default("wss://stream.data.alpaca.markets/v1beta1"),
  ALPACA_FEED: z.enum(["indicative", "opra"]).default("indicative"),
  ALPACA_UNDERLYINGS: z.string().default("SPY"),
  ALPACA_STRIKES_PER_SIDE: z.coerce.number().int().positive().default(8),
  ALPACA_MAX_DTE_DAYS: z.coerce.number().int().positive().default(30),
  ALPACA_MONEYNESS_PCT: z.coerce.number().positive().default(0.06),
  ALPACA_MONEYNESS_FALLBACK_PCT: z.coerce.number().positive().default(0.1),
  ALPACA_MAX_QUOTES: z.coerce.number().int().positive().default(200),
  IBKR_HOST: z.string().default("127.0.0.1"),
  IBKR_PORT: z.coerce.number().int().positive().default(7497),
  IBKR_CLIENT_ID: z.coerce.number().int().nonnegative().default(0),
  IBKR_SYMBOL: z.string().min(1).default("SPY"),
  IBKR_EXPIRY: z.string().min(1).default("20250117"),
  IBKR_STRIKE: z.coerce.number().positive().default(450),
  IBKR_RIGHT: z
    .preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), z.enum(["C", "P"]))
    .default("C"),
  IBKR_EXCHANGE: z.string().min(1).default("SMART"),
  IBKR_CURRENCY: z.string().min(1).default("USD"),
  IBKR_PYTHON_BIN: z.string().min(1).default("python3"),
  EMIT_INTERVAL_MS: z.coerce.number().int().positive().default(1000)
});

const env = readEnv(envSchema);

const state = {
  shuttingDown: false
};

const retry = async <T>(
  label: string,
  attempts: number,
  delayMs: number,
  task: () => Promise<T>
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      logger.warn(`${label} attempt failed`, {
        attempt,
        error: error instanceof Error ? error.message : String(error)
      });

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError ?? new Error(`${label} failed after retries`);
};

const selectAdapter = (name: string): OptionIngestAdapter => {
  if (name === "synthetic") {
    return createSyntheticOptionsAdapter({ emitIntervalMs: env.EMIT_INTERVAL_MS });
  }

  if (name === "alpaca") {
    if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) {
      throw new Error("ALPACA_KEY_ID and ALPACA_SECRET_KEY are required for the alpaca adapter.");
    }

    const underlyings = env.ALPACA_UNDERLYINGS.split(",").map((symbol) => symbol.trim());

    return createAlpacaOptionsAdapter({
      keyId: env.ALPACA_KEY_ID,
      secretKey: env.ALPACA_SECRET_KEY,
      restUrl: env.ALPACA_REST_URL,
      wsBaseUrl: env.ALPACA_WS_BASE_URL,
      feed: env.ALPACA_FEED,
      underlyings,
      strikesPerSide: env.ALPACA_STRIKES_PER_SIDE,
      maxDteDays: env.ALPACA_MAX_DTE_DAYS,
      moneynessPct: env.ALPACA_MONEYNESS_PCT,
      moneynessFallbackPct: env.ALPACA_MONEYNESS_FALLBACK_PCT,
      maxQuotes: env.ALPACA_MAX_QUOTES
    });
  }

  if (name === "ibkr") {
    return createIbkrOptionsAdapter({
      host: env.IBKR_HOST,
      port: env.IBKR_PORT,
      clientId: env.IBKR_CLIENT_ID,
      symbol: env.IBKR_SYMBOL,
      expiry: env.IBKR_EXPIRY,
      strike: env.IBKR_STRIKE,
      right: env.IBKR_RIGHT,
      exchange: env.IBKR_EXCHANGE,
      currency: env.IBKR_CURRENCY,
      pythonBin: env.IBKR_PYTHON_BIN
    });
  }

  throw new Error(`Unknown ingest adapter: ${name}`);
};

const run = async () => {
  logger.info("service starting");

  const { nc, js, jsm } = await connectJetStreamWithRetry(
    {
      servers: env.NATS_URL,
      name: service
    },
    { attempts: 20, delayMs: 500 }
  );

  await ensureStream(jsm, {
    name: STREAM_OPTION_PRINTS,
    subjects: [SUBJECT_OPTION_PRINTS],
    retention: "limits",
    storage: "file",
    discard: "old",
    max_msgs_per_subject: -1,
    max_msgs: -1,
    max_bytes: -1,
    max_age: 0,
    num_replicas: 1
  });

  const clickhouse = createClickHouseClient({
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DATABASE
  });

  await retry("clickhouse table init", 20, 500, async () => {
    await ensureOptionPrintsTable(clickhouse);
  });

  const adapter = selectAdapter(env.INGEST_ADAPTER);
  logger.info("ingest adapter selected", { adapter: adapter.name });

  const stopAdapter: StopHandler = await adapter.start({
    onTrade: async (candidate: OptionPrint) => {
      if (state.shuttingDown) {
        return;
      }

      const print = OptionPrintSchema.parse(candidate);

      try {
        await insertOptionPrint(clickhouse, print);
        await publishJson(js, SUBJECT_OPTION_PRINTS, print);
        logger.info("published option print", {
          trace_id: print.trace_id,
          seq: print.seq,
          option_contract_id: print.option_contract_id
        });
      } catch (error) {
        logger.error("failed to publish option print", {
          error: error instanceof Error ? error.message : String(error),
          trace_id: print.trace_id
        });
      }
    }
  });

  const shutdown = async (signal: string) => {
    if (state.shuttingDown) {
      return;
    }

    state.shuttingDown = true;
    await stopAdapter();

    logger.info("service stopping", { signal });

    await nc.drain();
    await clickhouse.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

await run();
