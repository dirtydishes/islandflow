import { hasAlpacaCredentials, readEnv, resolveAlpacaCredentials } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_EQUITY_PRINTS,
  SUBJECT_EQUITY_QUOTES,
  STREAM_EQUITY_PRINTS,
  STREAM_EQUITY_QUOTES,
  connectJetStreamWithRetry,
  ensureSyntheticControlState,
  ensureKnownStreams,
  openSyntheticControlKv,
  watchSyntheticControlState,
  publishJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureEquityPrintsTable,
  ensureEquityQuotesTable,
  insertEquityPrint,
  insertEquityQuote
} from "@islandflow/storage";
import {
  EquityPrintSchema,
  EquityQuoteSchema,
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  resolveSyntheticMarketModes,
  type EquityPrint,
  type EquityQuote,
  type SyntheticControlState
} from "@islandflow/types";
import { createAlpacaEquitiesAdapter } from "./adapters/alpaca";
import { createSyntheticEquitiesAdapter } from "./adapters/synthetic";
import type { EquityIngestAdapter, StopHandler } from "./adapters/types";
import { z } from "zod";

const service = "ingest-equities";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  EQUITIES_INGEST_ADAPTER: z.string().min(1).default("synthetic"),
  EMIT_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  SYNTHETIC_MARKET_MODE: z.string().default("realistic"),
  SYNTHETIC_EQUITIES_MODE: z.string().default(""),

  // Alpaca (equities)
  ALPACA_API_KEY: z.string().default(""),
  ALPACA_API_KEY_ID: z.string().default(""),
  ALPACA_KEY_ID: z.string().default(""),
  ALPACA_API_SECRET_KEY: z.string().default(""),
  ALPACA_SECRET_KEY: z.string().default(""),
  ALPACA_REST_URL: z.string().default("https://data.alpaca.markets"),
  ALPACA_WS_BASE_URL: z.string().default("wss://stream.data.alpaca.markets"),
  ALPACA_UNDERLYINGS: z.string().default("SPY,NVDA,AAPL"),
  ALPACA_EQUITIES_FEED: z.enum(["iex", "sip"]).default("iex"),

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
const alpacaCredentials = resolveAlpacaCredentials(env);
const syntheticModes = resolveSyntheticMarketModes({
  syntheticMarketMode: env.SYNTHETIC_MARKET_MODE,
  syntheticEquitiesMode: env.SYNTHETIC_EQUITIES_MODE
});

const state = {
  shuttingDown: false,
  shutdownPromise: null as Promise<void> | null
};

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const isExpectedShutdownError = (error: unknown): boolean => {
  if (!state.shuttingDown) {
    return false;
  }

  const message = getErrorMessage(error).toUpperCase();
  return [
    "SOCKET CONNECTION WAS CLOSED UNEXPECTEDLY",
    "SOCKET CLOSED UNEXPECTEDLY",
    "ECONNREFUSED",
    "CONNECTION_CLOSED",
    "CONNECTION_DRAINING",
    "TIMEOUT"
  ].some((token) => message.includes(token));
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
        logger.warn("testing mode throttling equity prints", {
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

const parseSymbolList = (value: string): string[] => {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const selectAdapter = (
  name: string,
  getSyntheticControl: () => SyntheticControlState
): EquityIngestAdapter => {
  if (name === "synthetic") {
    return createSyntheticEquitiesAdapter({
      emitIntervalMs: env.EMIT_INTERVAL_MS,
      mode: syntheticModes.equities,
      getControl: getSyntheticControl
    });
  }

  if (name === "alpaca") {
    if (!hasAlpacaCredentials(alpacaCredentials)) {
      logger.warn("alpaca credentials missing; set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY");
      throw new Error(
        "Alpaca equities adapter requires ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (or legacy ALPACA_API_KEY)."
      );
    }

    return createAlpacaEquitiesAdapter({
      credentials: alpacaCredentials,
      restUrl: env.ALPACA_REST_URL,
      wsBaseUrl: env.ALPACA_WS_BASE_URL,
      feed: env.ALPACA_EQUITIES_FEED,
      symbols: parseSymbolList(env.ALPACA_UNDERLYINGS)
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

  await ensureKnownStreams(jsm, [STREAM_EQUITY_PRINTS, STREAM_EQUITY_QUOTES], { logger });

  let syntheticControl = DEFAULT_SYNTHETIC_CONTROL_STATE;
  let stopSyntheticControlWatch = async () => {};
  if (env.EQUITIES_INGEST_ADAPTER === "synthetic") {
    const syntheticControlKv = await openSyntheticControlKv(js);
    syntheticControl = await ensureSyntheticControlState(syntheticControlKv);
    stopSyntheticControlWatch = await watchSyntheticControlState(
      syntheticControlKv,
      (nextControl) => {
        syntheticControl = nextControl;
      },
      (error) => {
        logger.warn("synthetic control watch failed", {
          error: getErrorMessage(error)
        });
      }
    );
  }

  const clickhouse = createClickHouseClient({
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DATABASE
  });

  await retry("clickhouse table init", 120, 500, async () => {
    await ensureEquityPrintsTable(clickhouse);
    await ensureEquityQuotesTable(clickhouse);
  });

  const adapter = selectAdapter(env.EQUITIES_INGEST_ADAPTER, () => syntheticControl);
  logger.info("ingest adapter selected", { adapter: adapter.name });
  const allowPublish = buildThrottle(env.TESTING_MODE, env.TESTING_THROTTLE_MS);
  const allowQuotePublish = buildThrottle(env.TESTING_MODE, env.TESTING_THROTTLE_MS);

  const stopAdapter: StopHandler = await adapter.start({
    onTrade: async (candidate: EquityPrint) => {
      if (state.shuttingDown) {
        return;
      }

      const now = Date.now();
      if (!allowPublish(now)) {
        return;
      }

      const print = EquityPrintSchema.parse(candidate);

      try {
        await insertEquityPrint(clickhouse, print);
        await publishJson(js, SUBJECT_EQUITY_PRINTS, print);
      } catch (error) {
        if (isExpectedShutdownError(error)) {
          return;
        }

        logger.error("failed to publish equity print", {
          error: getErrorMessage(error),
          trace_id: print.trace_id
        });
      }
    },
    onQuote: async (candidate: EquityQuote) => {
      if (state.shuttingDown) {
        return;
      }

      const now = Date.now();
      if (!allowQuotePublish(now)) {
        return;
      }

      const quote = EquityQuoteSchema.parse(candidate);

      try {
        await insertEquityQuote(clickhouse, quote);
        await publishJson(js, SUBJECT_EQUITY_QUOTES, quote);
      } catch (error) {
        if (isExpectedShutdownError(error)) {
          return;
        }

        logger.error("failed to publish equity quote", {
          error: getErrorMessage(error),
          trace_id: quote.trace_id
        });
      }
    }
  });

  const shutdown = async (signal: string) => {
    if (state.shutdownPromise) {
      return state.shutdownPromise;
    }

    state.shuttingDown = true;
    state.shutdownPromise = (async () => {
      logger.info("service stopping", { signal });
      await stopSyntheticControlWatch();
      await stopAdapter();

      try {
        await nc.drain();
      } catch (error) {
        if (!isExpectedShutdownError(error)) {
          throw error;
        }
      }

      try {
        await clickhouse.close();
      } catch (error) {
        if (!isExpectedShutdownError(error)) {
          throw error;
        }
      }

      process.exit(0);
    })();

    return state.shutdownPromise;
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

await run();
