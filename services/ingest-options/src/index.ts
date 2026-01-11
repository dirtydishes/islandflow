import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_PRINTS,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_PRINTS,
  connectJetStreamWithRetry,
  ensureStream,
  publishJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureOptionNBBOTable,
  ensureOptionPrintsTable,
  insertOptionNBBO,
  insertOptionPrint
} from "@islandflow/storage";
import { OptionNBBOSchema, OptionPrintSchema, type OptionNBBO, type OptionPrint } from "@islandflow/types";
import { createAlpacaOptionsAdapter } from "./adapters/alpaca";
import { createDatabentoOptionsAdapter } from "./adapters/databento";
import { createIbkrOptionsAdapter } from "./adapters/ibkr";
import { createSyntheticOptionsAdapter } from "./adapters/synthetic";
import type { OptionIngestAdapter, StopHandler } from "./adapters/types";
import { z } from "zod";

const service = "ingest-options";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  OPTIONS_INGEST_ADAPTER: z.string().min(1).default("synthetic"),
  ALPACA_KEY_ID: z.string().default(""),
  ALPACA_SECRET_KEY: z.string().default(""),
  ALPACA_REST_URL: z.string().default("https://data.alpaca.markets"),
  ALPACA_WS_BASE_URL: z.string().default("wss://stream.data.alpaca.markets/v1beta1"),
  ALPACA_FEED: z.enum(["indicative", "opra"]).default("indicative"),
  ALPACA_UNDERLYINGS: z.string().default("SPY,NVDA,AAPL"),
  ALPACA_STRIKES_PER_SIDE: z.coerce.number().int().positive().default(8),
  ALPACA_MAX_DTE_DAYS: z.coerce.number().int().positive().default(30),
  ALPACA_MONEYNESS_PCT: z.coerce.number().positive().default(0.06),
  ALPACA_MONEYNESS_FALLBACK_PCT: z.coerce.number().positive().default(0.1),
  ALPACA_MAX_QUOTES: z.coerce.number().int().positive().default(200),
  DATABENTO_API_KEY: z.string().default(""),
  DATABENTO_DATASET: z.string().default("OPRA.PILLAR"),
  DATABENTO_SCHEMA: z.string().default("trades"),
  DATABENTO_NBBO_SCHEMA: z.string().default("tbbo"),
  DATABENTO_START: z.string().default(""),
  DATABENTO_END: z.string().default(""),
  DATABENTO_SYMBOLS: z.string().default("ALL"),
  DATABENTO_STYPE_IN: z.string().default("raw_symbol"),
  DATABENTO_STYPE_OUT: z.string().default("raw_symbol"),
  DATABENTO_LIMIT: z.coerce.number().int().nonnegative().default(0),
  DATABENTO_PRICE_SCALE: z.coerce.number().positive().default(1),
  DATABENTO_PYTHON_BIN: z.string().default("python3"),
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
  EMIT_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  TESTING_MODE: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) {
          return true;
        }
        if (["0", "false", "no", "off"].includes(normalized)) {
          return false;
        }
      }
      return value;
    }, z.boolean())
    .default(false),
  TESTING_THROTTLE_MS: z.coerce.number().int().nonnegative().default(200)
});

const env = readEnv(envSchema);

const state = {
  shuttingDown: false
};

const buildThrottle = (enabled: boolean, throttleMs: number) => {
  if (!enabled || throttleMs <= 0) {
    return () => true;
  }

  let lastEmit = 0;
  let dropped = 0;
  let lastLog = Date.now();

  return (now: number) => {
    if (now - lastEmit < throttleMs) {
      dropped += 1;
      if (now - lastLog > 5000) {
        logger.warn("testing mode throttling option prints", {
          dropped,
          throttle_ms: throttleMs
        });
        dropped = 0;
        lastLog = now;
      }
      return false;
    }

    lastEmit = now;
    return true;
  };
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
      logger.warn("alpaca credentials missing; set ALPACA_KEY_ID and ALPACA_SECRET_KEY");
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

  if (name === "databento") {
    if (!env.DATABENTO_API_KEY) {
      logger.warn("databento api key missing; set DATABENTO_API_KEY");
      throw new Error("DATABENTO_API_KEY is required for the databento adapter.");
    }

    if (!env.DATABENTO_START) {
      logger.warn("databento start missing; set DATABENTO_START");
      throw new Error("DATABENTO_START is required for the databento adapter.");
    }

    return createDatabentoOptionsAdapter({
      apiKey: env.DATABENTO_API_KEY,
      dataset: env.DATABENTO_DATASET,
      schema: env.DATABENTO_SCHEMA,
      nbboSchema: env.DATABENTO_NBBO_SCHEMA,
      start: env.DATABENTO_START,
      end: env.DATABENTO_END || undefined,
      symbols: env.DATABENTO_SYMBOLS,
      stypeIn: env.DATABENTO_STYPE_IN,
      stypeOut: env.DATABENTO_STYPE_OUT,
      limit: env.DATABENTO_LIMIT,
      priceScale: env.DATABENTO_PRICE_SCALE,
      pythonBin: env.DATABENTO_PYTHON_BIN
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
    { attempts: 120, delayMs: 500 }
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

  await ensureStream(jsm, {
    name: STREAM_OPTION_NBBO,
    subjects: [SUBJECT_OPTION_NBBO],
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
    await ensureOptionNBBOTable(clickhouse);
  });

  const adapter = selectAdapter(env.OPTIONS_INGEST_ADAPTER);
  logger.info("ingest adapter selected", { adapter: adapter.name });
  const allowPublish = buildThrottle(env.TESTING_MODE, env.TESTING_THROTTLE_MS);
  const allowNbboPublish = buildThrottle(env.TESTING_MODE, env.TESTING_THROTTLE_MS);

  const stopAdapter: StopHandler = await adapter.start({
    onTrade: async (candidate: OptionPrint) => {
      if (state.shuttingDown) {
        return;
      }

      const now = Date.now();
      if (!allowPublish(now)) {
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
    },
    onNBBO: async (candidate: OptionNBBO) => {
      if (state.shuttingDown) {
        return;
      }

      const now = Date.now();
      if (!allowNbboPublish(now)) {
        return;
      }

      const nbbo = OptionNBBOSchema.parse(candidate);

      try {
        await insertOptionNBBO(clickhouse, nbbo);
        await publishJson(js, SUBJECT_OPTION_NBBO, nbbo);
      } catch (error) {
        logger.error("failed to publish option nbbo", {
          error: error instanceof Error ? error.message : String(error),
          trace_id: nbbo.trace_id
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
