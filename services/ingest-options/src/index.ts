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
import { z } from "zod";

const service = "ingest-options";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://localhost:4222"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  EMIT_INTERVAL_MS: z.coerce.number().int().positive().default(1000)
});

const env = readEnv(envSchema);

const state = {
  shuttingDown: false,
  seq: 0,
  timer: null as ReturnType<typeof setInterval> | null
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

const buildSyntheticPrint = (): OptionPrint => {
  const now = Date.now();
  state.seq += 1;

  return {
    source_ts: now,
    ingest_ts: now,
    seq: state.seq,
    trace_id: `ingest-options-${state.seq}`,
    ts: now,
    option_contract_id: "SPY-2025-01-17-450-C",
    price: 1.25,
    size: 10,
    exchange: "TEST",
    conditions: ["TEST"]
  };
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

  const emit = async () => {
    if (state.shuttingDown) {
      return;
    }

    const candidate = buildSyntheticPrint();
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
  };

  state.timer = setInterval(() => {
    void emit();
  }, env.EMIT_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    if (state.shuttingDown) {
      return;
    }

    state.shuttingDown = true;
    if (state.timer) {
      clearInterval(state.timer);
    }

    logger.info("service stopping", { signal });

    await nc.drain();
    await clickhouse.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

await run();
