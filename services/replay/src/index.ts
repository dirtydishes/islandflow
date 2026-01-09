import { readEnv } from "@islandflow/config";
import { createLogger, createMetrics } from "@islandflow/observability";
import {
  SUBJECT_EQUITY_PRINTS,
  SUBJECT_EQUITY_QUOTES,
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_PRINTS,
  STREAM_EQUITY_PRINTS,
  STREAM_EQUITY_QUOTES,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_PRINTS,
  connectJetStreamWithRetry,
  ensureStream,
  publishJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  fetchEquityPrintsAfter,
  fetchEquityQuotesAfter,
  fetchOptionNBBOAfter,
  fetchOptionPrintsAfter
} from "@islandflow/storage";
import type { EquityPrint, EquityQuote, OptionNBBO, OptionPrint } from "@islandflow/types";
import { z } from "zod";

const service = "replay";
const logger = createLogger({ service });
const metrics = createMetrics({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  REPLAY_STREAMS: z.string().default("options,nbbo,equities,equity-quotes"),
  REPLAY_START_TS: z.coerce.number().int().nonnegative().default(0),
  REPLAY_END_TS: z.coerce.number().int().nonnegative().default(0),
  REPLAY_SPEED: z.coerce.number().nonnegative().default(1),
  REPLAY_BATCH_SIZE: z.coerce.number().int().positive().default(200),
  REPLAY_LOG_EVERY: z.coerce.number().int().positive().default(1000)
});

const env = readEnv(envSchema);

type ReplayCursor = {
  ts: number;
  seq: number;
};

type ReplayStreamKind = "options" | "nbbo" | "equities" | "equity-quotes";

type ReplayEvent = OptionPrint | OptionNBBO | EquityPrint | EquityQuote;

type FetchAfter = (
  afterTs: number,
  afterSeq: number,
  limit: number
) => Promise<ReplayEvent[]>;

type ReplayStream = {
  kind: ReplayStreamKind;
  subject: string;
  streamName: string;
  fetchAfter: FetchAfter;
  buffer: ReplayEvent[];
  cursor: ReplayCursor;
  done: boolean;
  emitted: number;
  rank: number;
};

// Tie-breaker order favors quotes before prints when timestamps match.
const STREAM_ORDER: ReplayStreamKind[] = ["nbbo", "options", "equity-quotes", "equities"];

const STREAM_DEFS: Record<
  ReplayStreamKind,
  {
    subject: string;
    streamName: string;
    rank: number;
    fetchAfter: (client: ReturnType<typeof createClickHouseClient>, afterTs: number, afterSeq: number, limit: number) => Promise<ReplayEvent[]>;
  }
> = {
  options: {
    subject: SUBJECT_OPTION_PRINTS,
    streamName: STREAM_OPTION_PRINTS,
    rank: STREAM_ORDER.indexOf("options"),
    fetchAfter: (client, afterTs, afterSeq, limit) =>
      fetchOptionPrintsAfter(client, afterTs, afterSeq, limit)
  },
  nbbo: {
    subject: SUBJECT_OPTION_NBBO,
    streamName: STREAM_OPTION_NBBO,
    rank: STREAM_ORDER.indexOf("nbbo"),
    fetchAfter: (client, afterTs, afterSeq, limit) =>
      fetchOptionNBBOAfter(client, afterTs, afterSeq, limit)
  },
  equities: {
    subject: SUBJECT_EQUITY_PRINTS,
    streamName: STREAM_EQUITY_PRINTS,
    rank: STREAM_ORDER.indexOf("equities"),
    fetchAfter: (client, afterTs, afterSeq, limit) =>
      fetchEquityPrintsAfter(client, afterTs, afterSeq, limit)
  },
  "equity-quotes": {
    subject: SUBJECT_EQUITY_QUOTES,
    streamName: STREAM_EQUITY_QUOTES,
    rank: STREAM_ORDER.indexOf("equity-quotes"),
    fetchAfter: (client, afterTs, afterSeq, limit) =>
      fetchEquityQuotesAfter(client, afterTs, afterSeq, limit)
  }
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const normalizeStreamName = (value: string): ReplayStreamKind | null => {
  switch (value.trim().toLowerCase()) {
    case "options":
    case "option-prints":
    case "option_prints":
    case "options-prints":
      return "options";
    case "nbbo":
    case "option-nbbo":
    case "option_nbbo":
    case "options-nbbo":
      return "nbbo";
    case "equities":
    case "equity":
    case "equity-prints":
    case "equity_prints":
      return "equities";
    case "equity-quotes":
    case "equity_quotes":
    case "quotes":
      return "equity-quotes";
    case "all":
      return null;
    default:
      return null;
  }
};

const parseStreamList = (value: string): ReplayStreamKind[] => {
  const tokens = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (tokens.some((entry) => entry.toLowerCase() === "all")) {
    return [...STREAM_ORDER];
  }

  const seen = new Set<ReplayStreamKind>();
  const result: ReplayStreamKind[] = [];
  const invalid: string[] = [];

  for (const token of tokens) {
    const kind = normalizeStreamName(token);
    if (!kind) {
      invalid.push(token);
      continue;
    }
    if (!seen.has(kind)) {
      seen.add(kind);
      result.push(kind);
    }
  }

  if (invalid.length > 0) {
    throw new Error(`Unknown replay stream(s): ${invalid.join(", ")}`);
  }

  if (result.length === 0) {
    throw new Error("No replay streams selected.");
  }

  return result;
};

const buildStreamConfig = (name: string, subject: string) => ({
  name,
  subjects: [subject],
  retention: "limits",
  storage: "file",
  discard: "old",
  max_msgs_per_subject: -1,
  max_msgs: -1,
  max_bytes: -1,
  max_age: 0,
  num_replicas: 1
});

const buildStartCursor = (startTs: number): ReplayCursor => {
  if (startTs <= 0) {
    return { ts: 0, seq: 0 };
  }

  const adjusted = Math.max(0, startTs - 1);
  return { ts: adjusted, seq: 0 };
};

const getEventTs = (event: ReplayEvent): number => (Number.isFinite(event.ts) ? event.ts : 0);

const getEventIngestTs = (event: ReplayEvent): number =>
  Number.isFinite(event.ingest_ts) ? event.ingest_ts : 0;

const getEventSeq = (event: ReplayEvent): number => (Number.isFinite(event.seq) ? event.seq : 0);

const pickNextEvent = (streams: ReplayStream[]): { stream: ReplayStream; event: ReplayEvent } | null => {
  let choice: { stream: ReplayStream; event: ReplayEvent } | null = null;

  for (const stream of streams) {
    const event = stream.buffer[0];
    if (!event) {
      continue;
    }

    if (!choice) {
      choice = { stream, event };
      continue;
    }

    const candidateTs = getEventTs(event);
    const currentTs = getEventTs(choice.event);
    if (candidateTs !== currentTs) {
      if (candidateTs < currentTs) {
        choice = { stream, event };
      }
      continue;
    }

    const candidateIngest = getEventIngestTs(event);
    const currentIngest = getEventIngestTs(choice.event);
    if (candidateIngest !== currentIngest) {
      if (candidateIngest < currentIngest) {
        choice = { stream, event };
      }
      continue;
    }

    const candidateSeq = getEventSeq(event);
    const currentSeq = getEventSeq(choice.event);
    if (candidateSeq !== currentSeq) {
      if (candidateSeq < currentSeq) {
        choice = { stream, event };
      }
      continue;
    }

    if (stream.rank < choice.stream.rank) {
      choice = { stream, event };
    }
  }

  return choice;
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
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error(`${label} failed after retries`);
};

const run = async () => {
  logger.info("service starting");

  if (env.REPLAY_END_TS > 0 && env.REPLAY_END_TS < env.REPLAY_START_TS) {
    throw new Error("REPLAY_END_TS must be >= REPLAY_START_TS when set.");
  }

  const streamKinds = parseStreamList(env.REPLAY_STREAMS);

  const { nc, js, jsm } = await connectJetStreamWithRetry(
    {
      servers: env.NATS_URL,
      name: service
    },
    { attempts: 120, delayMs: 500 }
  );

  for (const kind of streamKinds) {
    const def = STREAM_DEFS[kind];
    await ensureStream(jsm, buildStreamConfig(def.streamName, def.subject));
  }

  const clickhouse = createClickHouseClient({
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DATABASE
  });

  await retry("clickhouse ready", 20, 500, async () => {
    await clickhouse.query({ query: "SELECT 1", format: "JSONEachRow" });
  });

  const startCursor = buildStartCursor(env.REPLAY_START_TS);
  const streams: ReplayStream[] = streamKinds.map((kind) => {
    const def = STREAM_DEFS[kind];
    return {
      kind,
      subject: def.subject,
      streamName: def.streamName,
      fetchAfter: (afterTs, afterSeq, limit) => def.fetchAfter(clickhouse, afterTs, afterSeq, limit),
      buffer: [],
      cursor: { ...startCursor },
      done: false,
      emitted: 0,
      rank: def.rank
    };
  });

  logger.info("replay configured", {
    streams: streams.map((stream) => stream.kind),
    start_ts: env.REPLAY_START_TS,
    end_ts: env.REPLAY_END_TS > 0 ? env.REPLAY_END_TS : null,
    speed: env.REPLAY_SPEED,
    batch_size: env.REPLAY_BATCH_SIZE
  });

  let stopping = false;
  let baseEventTs: number | null = null;
  let startWallMs = 0;
  let totalEmitted = 0;

  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info("service stopping", { signal });
    await nc.drain();
    await clickhouse.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const speed = env.REPLAY_SPEED;
  const endTs = env.REPLAY_END_TS > 0 ? env.REPLAY_END_TS : null;

  while (!stopping) {
    for (const stream of streams) {
      if (stream.done || stream.buffer.length > 0) {
        continue;
      }

      const data = await stream.fetchAfter(
        stream.cursor.ts,
        stream.cursor.seq,
        env.REPLAY_BATCH_SIZE
      );

      if (data.length === 0) {
        stream.done = true;
        logger.info("replay stream exhausted", { stream: stream.kind });
        continue;
      }

      stream.buffer = data;
      metrics.gauge("replay.buffer_depth", data.length, { stream: stream.kind });
    }

    const next = pickNextEvent(streams);
    if (!next) {
      break;
    }

    const { stream, event } = next;
    const eventTs = getEventTs(event);
    const eventSeq = getEventSeq(event);

    if (endTs !== null && eventTs > endTs) {
      logger.info("replay reached end timestamp", { end_ts: endTs, last_ts: eventTs });
      break;
    }

    if (baseEventTs === null) {
      baseEventTs = eventTs;
      startWallMs = Date.now();
    }

    if (speed > 0 && baseEventTs !== null) {
      const targetMs = startWallMs + (eventTs - baseEventTs) / speed;
      const delayMs = Math.max(0, targetMs - Date.now());
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    try {
      await publishJson(js, stream.subject, event);
    } catch (error) {
      logger.error("failed to publish replay event", {
        error: error instanceof Error ? error.message : String(error),
        stream: stream.kind,
        ts: eventTs,
        seq: eventSeq
      });
      throw error;
    }

    stream.buffer.shift();
    stream.cursor = { ts: eventTs, seq: eventSeq };
    stream.emitted += 1;
    totalEmitted += 1;
    metrics.count("replay.emitted", 1, { stream: stream.kind });

    if (totalEmitted % env.REPLAY_LOG_EVERY === 0) {
      logger.info("replay progress", {
        emitted: totalEmitted,
        last_ts: eventTs
      });
    }
  }

  logger.info("replay complete", {
    emitted: totalEmitted,
    streams: streams.map((stream) => ({
      stream: stream.kind,
      emitted: stream.emitted
    }))
  });

  await nc.drain();
  await clickhouse.close();
  process.exit(0);
};

try {
  await run();
} catch (error) {
  logger.error("replay service failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}
