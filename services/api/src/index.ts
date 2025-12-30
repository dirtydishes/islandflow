import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_ALERTS,
  SUBJECT_CLASSIFIER_HITS,
  SUBJECT_EQUITY_PRINTS,
  SUBJECT_FLOW_PACKETS,
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_PRINTS,
  STREAM_ALERTS,
  STREAM_CLASSIFIER_HITS,
  STREAM_EQUITY_PRINTS,
  STREAM_FLOW_PACKETS,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_PRINTS,
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureStream,
  subscribeJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureAlertsTable,
  ensureClassifierHitsTable,
  ensureEquityPrintsTable,
  ensureFlowPacketsTable,
  ensureOptionNBBOTable,
  ensureOptionPrintsTable,
  fetchRecentAlerts,
  fetchRecentClassifierHits,
  fetchRecentFlowPackets,
  fetchRecentOptionNBBO,
  fetchEquityPrintsAfter,
  fetchRecentEquityPrints,
  fetchOptionNBBOAfter,
  fetchOptionPrintsAfter,
  fetchRecentOptionPrints
} from "@islandflow/storage";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  EquityPrintSchema,
  FlowPacketSchema,
  OptionNBBOSchema,
  OptionPrintSchema
} from "@islandflow/types";
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

const limitSchema = z.coerce.number().int().positive().max(1000);
const replayParamsSchema = z.object({
  after_ts: z.coerce.number().int().nonnegative().default(0),
  after_seq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(1000).default(200)
});

type Channel = "options" | "options-nbbo" | "equities" | "flow" | "classifier-hits" | "alerts";

type WsData = {
  channel: Channel;
};

const optionSockets = new Set<WebSocket<WsData>>();
const optionNbboSockets = new Set<WebSocket<WsData>>();
const equitySockets = new Set<WebSocket<WsData>>();
const flowSockets = new Set<WebSocket<WsData>>();
const classifierHitSockets = new Set<WebSocket<WsData>>();
const alertSockets = new Set<WebSocket<WsData>>();

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

  await ensureStream(jsm, {
    name: STREAM_FLOW_PACKETS,
    subjects: [SUBJECT_FLOW_PACKETS],
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
    name: STREAM_CLASSIFIER_HITS,
    subjects: [SUBJECT_CLASSIFIER_HITS],
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
    name: STREAM_ALERTS,
    subjects: [SUBJECT_ALERTS],
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
    await ensureEquityPrintsTable(clickhouse);
    await ensureFlowPacketsTable(clickhouse);
    await ensureClassifierHitsTable(clickhouse);
    await ensureAlertsTable(clickhouse);
  });

  const optionSubscription = await subscribeJson(
    js,
    SUBJECT_OPTION_PRINTS,
    buildDurableConsumer("api-option-prints")
  );

  const optionNbboSubscription = await subscribeJson(
    js,
    SUBJECT_OPTION_NBBO,
    buildDurableConsumer("api-option-nbbo")
  );

  const equitySubscription = await subscribeJson(
    js,
    SUBJECT_EQUITY_PRINTS,
    buildDurableConsumer("api-equity-prints")
  );

  const flowSubscription = await subscribeJson(
    js,
    SUBJECT_FLOW_PACKETS,
    buildDurableConsumer("api-flow-packets")
  );

  const classifierHitSubscription = await subscribeJson(
    js,
    SUBJECT_CLASSIFIER_HITS,
    buildDurableConsumer("api-classifier-hits")
  );

  const alertSubscription = await subscribeJson(
    js,
    SUBJECT_ALERTS,
    buildDurableConsumer("api-alerts")
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

  const pumpOptionNbbo = async () => {
    for await (const msg of optionNbboSubscription.messages) {
      try {
        const payload = OptionNBBOSchema.parse(optionNbboSubscription.decode(msg));
        broadcast(optionNbboSockets, { type: "option-nbbo", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process option nbbo", {
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

  const pumpFlow = async () => {
    for await (const msg of flowSubscription.messages) {
      try {
        const payload = FlowPacketSchema.parse(flowSubscription.decode(msg));
        broadcast(flowSockets, { type: "flow-packet", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process flow packet", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpClassifierHits = async () => {
    for await (const msg of classifierHitSubscription.messages) {
      try {
        const payload = ClassifierHitEventSchema.parse(classifierHitSubscription.decode(msg));
        broadcast(classifierHitSockets, { type: "classifier-hit", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process classifier hit", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpAlerts = async () => {
    for await (const msg of alertSubscription.messages) {
      try {
        const payload = AlertEventSchema.parse(alertSubscription.decode(msg));
        broadcast(alertSockets, { type: "alert", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process alert", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  void pumpOptions();
  void pumpOptionNbbo();
  void pumpEquities();
  void pumpFlow();
  void pumpClassifierHits();
  void pumpAlerts();

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

      if (req.method === "GET" && url.pathname === "/nbbo/options") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentOptionNBBO(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/prints/equities") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentEquityPrints(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/flow/packets") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentFlowPackets(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/flow/classifier-hits") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentClassifierHits(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/flow/alerts") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentAlerts(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/replay/options") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchOptionPrintsAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/nbbo") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchOptionNBBOAfter(clickhouse, afterTs, afterSeq, limit);
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

      if (req.method === "GET" && url.pathname === "/ws/options-nbbo") {
        if (serverRef.upgrade(req, { data: { channel: "options-nbbo" } })) {
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

      if (req.method === "GET" && url.pathname === "/ws/flow") {
        if (serverRef.upgrade(req, { data: { channel: "flow" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/classifier-hits") {
        if (serverRef.upgrade(req, { data: { channel: "classifier-hits" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/alerts") {
        if (serverRef.upgrade(req, { data: { channel: "alerts" } })) {
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
        } else if (socket.data.channel === "options-nbbo") {
          optionNbboSockets.add(socket);
        } else if (socket.data.channel === "equities") {
          equitySockets.add(socket);
        } else if (socket.data.channel === "flow") {
          flowSockets.add(socket);
        } else if (socket.data.channel === "classifier-hits") {
          classifierHitSockets.add(socket);
        } else {
          alertSockets.add(socket);
        }

        logger.info("websocket connected", { channel: socket.data.channel });
      },
      close: (socket) => {
        if (socket.data.channel === "options") {
          optionSockets.delete(socket);
        } else if (socket.data.channel === "options-nbbo") {
          optionNbboSockets.delete(socket);
        } else if (socket.data.channel === "equities") {
          equitySockets.delete(socket);
        } else if (socket.data.channel === "flow") {
          flowSockets.delete(socket);
        } else if (socket.data.channel === "classifier-hits") {
          classifierHitSockets.delete(socket);
        } else {
          alertSockets.delete(socket);
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
