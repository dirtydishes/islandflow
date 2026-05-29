import {
  buildAlpacaAuthHeaders,
  buildAlpacaWebSocketAuthMessage,
  hasAlpacaCredentials,
  readEnv,
  resolveAlpacaCredentials
} from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_NEWS,
  STREAM_NEWS,
  connectJetStreamWithRetry,
  ensureKnownStreams,
  publishJson
} from "@islandflow/bus";
import { NewsStorySchema, type NewsStory } from "@islandflow/types";
import WebSocket from "ws";
import { z } from "zod";
import { resolveNewsSymbols } from "./symbols";

const service = "ingest-news";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  ALPACA_API_KEY: z.string().default(""),
  ALPACA_API_KEY_ID: z.string().default(""),
  ALPACA_KEY_ID: z.string().default(""),
  ALPACA_API_SECRET_KEY: z.string().default(""),
  ALPACA_SECRET_KEY: z.string().default(""),
  ALPACA_REST_URL: z.string().default("https://data.alpaca.markets"),
  ALPACA_WS_BASE_URL: z.string().default("wss://stream.data.alpaca.markets"),
  ALPACA_NEWS_BACKFILL_LIMIT: z.coerce.number().int().positive().max(50).default(50),
  ALPACA_NEWS_WEBSOCKET_PATH: z.string().default("/v1beta1/news")
});

const env = readEnv(envSchema);
const alpacaCredentials = resolveAlpacaCredentials(env);

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type AlpacaNewsItem = {
  id?: number;
  headline?: string;
  summary?: string;
  content?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
  symbols?: string[];
  source?: string;
};

type AlpacaNewsResponse = {
  news?: AlpacaNewsItem[];
};

const parseTimestamp = (value: string | undefined): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const toStory = (item: AlpacaNewsItem, seq: number): NewsStory | null => {
  const storyId = Number(item.id);
  if (!Number.isFinite(storyId) || storyId < 0) {
    return null;
  }

  const provider = "alpaca";
  const summary = item.summary?.trim() ?? "";
  const contentHtml = item.content?.trim() || (summary ? `<p>${escapeHtml(summary)}</p>` : "");
  const symbols = resolveNewsSymbols(item.symbols ?? [], contentHtml);
  const publishedTs = parseTimestamp(item.created_at);
  const updatedTs = parseTimestamp(item.updated_at ?? item.created_at);

  return NewsStorySchema.parse({
    source_ts: publishedTs,
    ingest_ts: Date.now(),
    seq,
    trace_id: `${provider}:${storyId}`,
    story_id: storyId,
    provider,
    source: item.source?.trim() || item.author?.trim() || "Alpaca News",
    headline: item.headline?.trim() || `Story ${storyId}`,
    summary,
    content_html: contentHtml,
    url: item.url?.trim() || "",
    published_ts: publishedTs,
    updated_ts: updatedTs,
    provider_symbols: symbols.provider_symbols,
    resolved_symbols: symbols.resolved_symbols,
    symbol_resolution: symbols.symbol_resolution
  });
};

const fetchBackfill = async (): Promise<AlpacaNewsItem[]> => {
  const url = new URL("/v1beta1/news", env.ALPACA_REST_URL);
  url.searchParams.set("sort", "desc");
  url.searchParams.set("limit", env.ALPACA_NEWS_BACKFILL_LIMIT.toString());
  url.searchParams.set("include_content", "true");

  const response = await fetch(url.toString(), {
    headers: buildAlpacaAuthHeaders(alpacaCredentials)
  });

  if (!response.ok) {
    throw new Error(`alpaca news backfill failed (${response.status})`);
  }

  const payload = (await response.json()) as AlpacaNewsResponse;
  return Array.isArray(payload.news) ? payload.news : [];
};

const decodePayload = (data: WebSocket.RawData): unknown => {
  if (typeof data === "string") {
    return JSON.parse(data) as unknown;
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as unknown;
  }
  if (ArrayBuffer.isView(data)) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))) as unknown;
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(data as unknown as ArrayBuffer))) as unknown;
};

const run = async () => {
  if (!hasAlpacaCredentials(alpacaCredentials)) {
    throw new Error(
      "Alpaca news requires ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (or ALPACA_KEY_ID / ALPACA_SECRET_KEY)."
    );
  }

  const { nc, js, jsm } = await connectJetStreamWithRetry(
    {
      servers: env.NATS_URL,
      name: service
    },
    { attempts: 120, delayMs: 500 }
  );

  await ensureKnownStreams(jsm, [STREAM_NEWS], { logger });

  let seq = 0;
  const publishStory = async (item: AlpacaNewsItem) => {
    seq += 1;
    const story = toStory(item, seq);
    if (!story) {
      return;
    }
    await publishJson(js, SUBJECT_NEWS, story);
  };

  const backfill = await fetchBackfill();
  for (const item of backfill.reverse()) {
    await publishStory(item);
  }

  const wsUrl = new URL(env.ALPACA_NEWS_WEBSOCKET_PATH, env.ALPACA_WS_BASE_URL).toString();
  const ws = new WebSocket(wsUrl, {
    headers: buildAlpacaAuthHeaders(alpacaCredentials)
  });

  ws.on("open", () => {
    ws.send(JSON.stringify(buildAlpacaWebSocketAuthMessage(alpacaCredentials)));
  });

  ws.on("message", (raw) => {
    let payload: unknown;
    try {
      payload = decodePayload(raw);
    } catch (error) {
      logger.warn("failed to decode alpaca news message", {
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (!Array.isArray(payload)) {
      return;
    }

    for (const entry of payload) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const message = entry as Record<string, unknown>;
      if (message.T === "success") {
        const msg = typeof message.msg === "string" ? message.msg : "";
        if (msg === "authenticated") {
          ws.send(JSON.stringify({ action: "subscribe", news: ["*"] }));
        }
        continue;
      }
      if (message.T === "subscription" || message.T === "error") {
        continue;
      }
      void publishStory(message as AlpacaNewsItem).catch((error) => {
        logger.error("failed to publish alpaca news story", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  });

  const shutdown = async (signal: string) => {
    logger.info("shutting down", { signal });
    ws.close();
    await nc.drain();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

void run().catch((error) => {
  logger.error("service crashed", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
