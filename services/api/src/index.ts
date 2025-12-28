import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_EQUITY_PRINTS,
  SUBJECT_OPTION_PRINTS,
  STREAM_EQUITY_PRINTS,
  STREAM_OPTION_PRINTS,
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureStream,
  subscribeJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureEquityPrintsTable,
  ensureOptionPrintsTable,
  fetchEquityPrintsAfter,
  fetchRecentEquityPrints,
  fetchOptionPrintsAfter,
  fetchRecentOptionPrints
} from "@islandflow/storage";
import { EquityPrintSchema, OptionPrintSchema } from "@islandflow/types";
import { z } from "zod";

const service = "api";
const logger = createLogger({ service });

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  NATS_URL: z.string().default("nats://localhost:4222"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  REST_DEFAULT_LIMIT: z.coerce.number().int().positive().default(200)
});

const env = readEnv(envSchema);

const limitSchema = z.coerce.number().int().positive().max(1000);
const replayParamsSchema = z.object({
  after_ts: z.coerce.number().int().nonnegative().default(0),
  after_seq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(1000).default(200)
});

type Channel = "options" | "equities";

type WsData = {
  channel: Channel;
};

const optionSockets = new Set<WebSocket<WsData>>();
const equitySockets = new Set<WebSocket<WsData>>();

const jsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
};

const parseLimit = (value: string | null): number => {
  if (value === null) {
    return env.REST_DEFAULT_LIMIT;
  }

  return limitSchema.parse(value);
};

const parseReplayParams = (url: URL): { afterTs: number; afterSeq: number; limit: number } => {
  const params = replayParamsSchema.parse({
    after_ts: url.searchParams.get("after_ts") ?? undefined,
    after_seq: url.searchParams.get("after_seq") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });

  return {
    afterTs: params.after_ts,
    afterSeq: params.after_seq,
    limit: params.limit
  };
};

const broadcast = (sockets: Set<WebSocket<WsData>>, payload: unknown): void => {
  const message = JSON.stringify(payload);

  for (const socket of sockets) {
    try {
      socket.send(message);
    } catch (error) {
      logger.warn("failed to send websocket message", {
        error: error instanceof Error ? error.message : String(error)
      });
      sockets.delete(socket);
    }
  }
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

  await ensureStream(jsm, {
    name: STREAM_EQUITY_PRINTS,
    subjects: [SUBJECT_EQUITY_PRINTS],
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

  await ensureOptionPrintsTable(clickhouse);
  await ensureEquityPrintsTable(clickhouse);

  const optionSubscription = await subscribeJson(
    js,
    SUBJECT_OPTION_PRINTS,
    buildDurableConsumer("api-option-prints")
  );

  const equitySubscription = await subscribeJson(
    js,
    SUBJECT_EQUITY_PRINTS,
    buildDurableConsumer("api-equity-prints")
  );

  const pumpOptions = async () => {
    for await (const msg of optionSubscription.messages) {
      try {
        const payload = OptionPrintSchema.parse(optionSubscription.decode(msg));
        broadcast(optionSockets, { type: "option-print", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process option print", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpEquities = async () => {
    for await (const msg of equitySubscription.messages) {
      try {
        const payload = EquityPrintSchema.parse(equitySubscription.decode(msg));
        broadcast(equitySockets, { type: "equity-print", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process equity print", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  void pumpOptions();
  void pumpEquities();

  const server = Bun.serve<WsData>({
    port: env.API_PORT,
    fetch: async (req, serverRef) => {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok" });
      }

      if (req.method === "GET" && url.pathname === "/prints/options") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentOptionPrints(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/prints/equities") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentEquityPrints(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/replay/options") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchOptionPrintsAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/equities") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchEquityPrintsAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/ws/options") {
        if (serverRef.upgrade(req, { data: { channel: "options" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/equities") {
        if (serverRef.upgrade(req, { data: { channel: "equities" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      return jsonResponse({ error: "not found" }, 404);
    },
    websocket: {
      open: (socket) => {
        if (socket.data.channel === "options") {
          optionSockets.add(socket);
        } else {
          equitySockets.add(socket);
        }

        logger.info("websocket connected", { channel: socket.data.channel });
      },
      close: (socket) => {
        if (socket.data.channel === "options") {
          optionSockets.delete(socket);
        } else {
          equitySockets.delete(socket);
        }

        logger.info("websocket disconnected", { channel: socket.data.channel });
      }
    }
  });

  logger.info("api listening", { port: server.port });

  const shutdown = async (signal: string) => {
    logger.info("service stopping", { signal });
    server.stop();
    await nc.drain();
    await clickhouse.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

await run();
