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
  INGEST_ADAPTER: z.string().min(1).default("synthetic"),
  IBKR_HOST: z.string().default("127.0.0.1"),
  IBKR_PORT: z.coerce.number().int().positive().default(7497),
  IBKR_CLIENT_ID: z.coerce.number().int().nonnegative().default(0),
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

  if (name === "ibkr") {
    return createIbkrOptionsAdapter({
      host: env.IBKR_HOST,
      port: env.IBKR_PORT,
      clientId: env.IBKR_CLIENT_ID
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
