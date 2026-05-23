import { hasAlpacaCredentials, readEnv, resolveAlpacaCredentials } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_PRINTS,
  SUBJECT_OPTION_SIGNAL_PRINTS,
  SUBJECT_EQUITY_QUOTES,
  STREAM_EQUITY_QUOTES,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_PRINTS,
  STREAM_OPTION_SIGNAL_PRINTS,
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureSyntheticControlState,
  ensureKnownStreams,
  openSyntheticControlKv,
  publishJson,
  subscribeJson,
  watchSyntheticControlState
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureOptionNBBOTable,
  ensureOptionPrintsTable,
  insertOptionNBBO,
  insertOptionPrint
} from "@islandflow/storage";
import {
  OptionNBBOSchema,
  OptionPrintSchema,
  EquityQuoteSchema,
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  deriveOptionPrintMetadata,
  resolveSyntheticMarketModes,
  type EquityQuote,
  type OptionNBBO,
  type OptionPrint,
  type OptionsSignalConfig,
  type SyntheticControlState
} from "@islandflow/types";
import { createAlpacaOptionsAdapter } from "./adapters/alpaca";
import { createDatabentoOptionsAdapter } from "./adapters/databento";
import { createIbkrOptionsAdapter } from "./adapters/ibkr";
import { createSyntheticOptionsAdapter } from "./adapters/synthetic";
import type { OptionIngestAdapter, StopHandler } from "./adapters/types";
import { enrichOptionPrint, rememberContext, selectAtOrBefore, type ContextHistory } from "./enrichment";
import { processOptionTrade } from "./trade-pipeline";
import { z } from "zod";

const service = "ingest-options";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  OPTIONS_INGEST_ADAPTER: z.string().min(1).default("synthetic"),
  ALPACA_API_KEY: z.string().default(""),
  ALPACA_API_KEY_ID: z.string().default(""),
  ALPACA_KEY_ID: z.string().default(""),
  ALPACA_API_SECRET_KEY: z.string().default(""),
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
  SYNTHETIC_MARKET_MODE: z.string().default("realistic"),
  SYNTHETIC_OPTIONS_MODE: z.string().default(""),
  OPTIONS_SIGNAL_MODE: z.enum(["smart-money", "balanced", "all"]).default("smart-money"),
  OPTIONS_SIGNAL_MIN_NOTIONAL: z.coerce.number().nonnegative().default(10_000),
  OPTIONS_SIGNAL_ETF_MIN_NOTIONAL: z.coerce.number().nonnegative().default(50_000),
  OPTIONS_SIGNAL_BID_SIDE_MIN_NOTIONAL: z.coerce.number().nonnegative().default(25_000),
  OPTIONS_SIGNAL_MID_MIN_NOTIONAL: z.coerce.number().nonnegative().default(20_000),
  OPTIONS_SIGNAL_NBBO_MAX_AGE_MS: z.coerce.number().int().positive().default(1500),
  OPTIONS_SIGNAL_ETF_UNDERLYINGS: z
    .string()
    .default("SPY,QQQ,IWM,DIA,TLT,GLD,SLV,XLF,XLE,XLV,XLI,XLP,XLU,XLY,SMH,ARKK"),
  OPTIONS_PERSIST_SIGNAL_ONLY: z
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
    .default(true),
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
  TESTING_THROTTLE_MS: z.coerce.number().int().nonnegative().default(200),
  OPTION_CONTEXT_MAX_KEYS: z.coerce.number().int().positive().default(20_000),
  OPTION_CONTEXT_TTL_MS: z.coerce.number().int().positive().default(900_000)
});

const env = readEnv(envSchema);
const alpacaCredentials = resolveAlpacaCredentials(env);
const syntheticModes = resolveSyntheticMarketModes({
  syntheticMarketMode: env.SYNTHETIC_MARKET_MODE,
  syntheticOptionsMode: env.SYNTHETIC_OPTIONS_MODE
});
const optionsSignalConfig: OptionsSignalConfig = {
  mode: env.OPTIONS_SIGNAL_MODE,
  minNotional: env.OPTIONS_SIGNAL_MIN_NOTIONAL,
  etfMinNotional: env.OPTIONS_SIGNAL_ETF_MIN_NOTIONAL,
  bidSideMinNotional: env.OPTIONS_SIGNAL_BID_SIDE_MIN_NOTIONAL,
  midMinNotional: env.OPTIONS_SIGNAL_MID_MIN_NOTIONAL,
  missingNbboMinNotional: 50_000,
  largePrintMinSize: 500,
  largePrintMinNotional: env.OPTIONS_SIGNAL_MIN_NOTIONAL,
  sweepMinNotional: env.OPTIONS_SIGNAL_BID_SIDE_MIN_NOTIONAL,
  autoKeepMinNotional: 100_000,
  nbboMaxAgeMs: env.OPTIONS_SIGNAL_NBBO_MAX_AGE_MS,
  etfUnderlyings: new Set(
    env.OPTIONS_SIGNAL_ETF_UNDERLYINGS.split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  )
};

const state = {
  shuttingDown: false,
  shutdownPromise: null as Promise<void> | null
};

const nbboHistoryByContract: ContextHistory<OptionNBBO> = new Map();
const equityQuoteHistoryByUnderlying: ContextHistory<EquityQuote> = new Map();
const OPTION_CONTEXT_PRUNE_INTERVAL_MS = 60_000;

const pruneContextHistory = <T extends { ts: number }>(
  history: ContextHistory<T>,
  maxKeys: number,
  ttlMs: number,
  now = Date.now()
): number => {
  let removed = 0;
  for (const [key, items] of history) {
    const filtered = items.filter((item) => now - item.ts <= ttlMs);
    if (filtered.length === 0) {
      history.delete(key);
      removed += 1;
      continue;
    }
    if (filtered.length !== items.length) {
      history.set(key, filtered);
    }
  }

  if (history.size <= maxKeys) {
    return removed;
  }

  const overflow = history.size - maxKeys;
  const oldestKeys = [...history.entries()]
    .map(([key, items]) => [key, items.at(-1)?.ts ?? Number.NEGATIVE_INFINITY] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, overflow);

  for (const [key] of oldestKeys) {
    history.delete(key);
    removed += 1;
  }

  return removed;
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

const selectAdapter = (
  name: string,
  getSyntheticControl: () => SyntheticControlState
): OptionIngestAdapter => {
  if (name === "synthetic") {
    return createSyntheticOptionsAdapter({
      emitIntervalMs: env.EMIT_INTERVAL_MS,
      mode: syntheticModes.options,
      getControl: getSyntheticControl
    });
  }

  if (name === "alpaca") {
    if (!hasAlpacaCredentials(alpacaCredentials)) {
      logger.warn("alpaca credentials missing; set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY");
      throw new Error(
        "Alpaca adapter requires ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (or legacy ALPACA_API_KEY)."
      );
    }

    const underlyings = env.ALPACA_UNDERLYINGS.split(",").map((symbol) => symbol.trim());

    return createAlpacaOptionsAdapter({
      credentials: alpacaCredentials,
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

  await ensureKnownStreams(
    jsm,
    [STREAM_OPTION_PRINTS, STREAM_OPTION_NBBO, STREAM_OPTION_SIGNAL_PRINTS, STREAM_EQUITY_QUOTES],
    { logger }
  );

  let syntheticControl = DEFAULT_SYNTHETIC_CONTROL_STATE;
  let stopSyntheticControlWatch = async () => {};
  if (env.OPTIONS_INGEST_ADAPTER === "synthetic") {
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
    await ensureOptionPrintsTable(clickhouse);
    await ensureOptionNBBOTable(clickhouse);
  });

  const adapter = selectAdapter(
    env.OPTIONS_INGEST_ADAPTER,
    () => syntheticControl
  );
  logger.info("ingest adapter selected", { adapter: adapter.name });
  logger.info("option print clickhouse persistence mode", {
    signal_only: env.OPTIONS_PERSIST_SIGNAL_ONLY
  });
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

      const rawPrint = OptionPrintSchema.parse(candidate);
      const parsedMetadata = deriveOptionPrintMetadata(rawPrint, null, optionsSignalConfig);
      const optionQuote = selectAtOrBefore(
        nbboHistoryByContract.get(rawPrint.option_contract_id),
        rawPrint.ts
      );
      const equityQuote = parsedMetadata.underlying_id
        ? selectAtOrBefore(equityQuoteHistoryByUnderlying.get(parsedMetadata.underlying_id), rawPrint.ts)
        : null;
      const print = enrichOptionPrint(rawPrint, optionQuote, equityQuote, optionsSignalConfig);

      try {
        await processOptionTrade(print, {
          persistSignalOnly: env.OPTIONS_PERSIST_SIGNAL_ONLY,
          persist: async (value) => insertOptionPrint(clickhouse, value),
          publishRaw: async (value) => publishJson(js, SUBJECT_OPTION_PRINTS, value),
          publishSignal: async (value) => publishJson(js, SUBJECT_OPTION_SIGNAL_PRINTS, value)
        });
      } catch (error) {
        if (isExpectedShutdownError(error)) {
          return;
        }

        logger.error("failed to publish option print", {
          error: getErrorMessage(error),
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
      rememberContext(nbboHistoryByContract, nbbo.option_contract_id, nbbo);

      try {
        await insertOptionNBBO(clickhouse, nbbo);
        await publishJson(js, SUBJECT_OPTION_NBBO, nbbo);
      } catch (error) {
        if (isExpectedShutdownError(error)) {
          return;
        }

        logger.error("failed to publish option nbbo", {
          error: getErrorMessage(error),
          trace_id: nbbo.trace_id
        });
      }
    }
  });

  const equityQuoteConsumer = buildDurableConsumer("ingest-options-equity-quotes");
  equityQuoteConsumer.deliverAll();
  const equityQuoteSubscription = await subscribeJson<EquityQuote>(
    js,
    SUBJECT_EQUITY_QUOTES,
    equityQuoteConsumer
  );

  void (async () => {
    for await (const msg of equityQuoteSubscription.messages) {
      if (state.shuttingDown) {
        msg.ack();
        continue;
      }
      try {
        const quote = EquityQuoteSchema.parse(equityQuoteSubscription.decode(msg));
        rememberContext(equityQuoteHistoryByUnderlying, quote.underlying_id.toUpperCase(), quote);
        msg.ack();
      } catch (error) {
        logger.error("failed to process equity quote context", {
          error: getErrorMessage(error)
        });
        msg.ack();
      }
    }
  })();

  const pruneTimer = setInterval(() => {
    const removed =
      pruneContextHistory(nbboHistoryByContract, env.OPTION_CONTEXT_MAX_KEYS, env.OPTION_CONTEXT_TTL_MS) +
      pruneContextHistory(equityQuoteHistoryByUnderlying, env.OPTION_CONTEXT_MAX_KEYS, env.OPTION_CONTEXT_TTL_MS);
    logger.info("option context cache summary", {
      nbbo_context_keys: nbboHistoryByContract.size,
      equity_quote_context_keys: equityQuoteHistoryByUnderlying.size,
      removed
    });
  }, OPTION_CONTEXT_PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();

  const shutdown = async (signal: string) => {
    if (state.shutdownPromise) {
      return state.shutdownPromise;
    }

    state.shuttingDown = true;
    state.shutdownPromise = (async () => {
      logger.info("service stopping", { signal });
      clearInterval(pruneTimer);
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
