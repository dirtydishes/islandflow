import type { NewsStory, NewsSymbolResolution } from "@islandflow/types";

export const NEWS_TABLE = "news";

export type NewsRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  story_id: number;
  provider: string;
  source: string;
  headline: string;
  summary: string;
  content_html: string;
  url: string;
  published_ts: number;
  updated_ts: number;
  provider_symbols_json: string;
  resolved_symbols_json: string;
  symbol_resolution: NewsSymbolResolution;
};

export const newsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${NEWS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  story_id UInt64,
  provider String,
  source String,
  headline String,
  summary String,
  content_html String,
  url String,
  published_ts UInt64,
  updated_ts UInt64,
  provider_symbols_json String,
  resolved_symbols_json String,
  symbol_resolution String
)
ENGINE = ReplacingMergeTree(updated_ts)
ORDER BY (provider, story_id, updated_ts, seq)
`;
};

const safeStringArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry));
    }
  } catch {
    // ignore
  }

  return [];
};

export const toNewsRecord = (story: NewsStory): NewsRecord => {
  return {
    source_ts: story.source_ts,
    ingest_ts: story.ingest_ts,
    seq: story.seq,
    trace_id: story.trace_id,
    story_id: story.story_id,
    provider: story.provider,
    source: story.source,
    headline: story.headline,
    summary: story.summary,
    content_html: story.content_html,
    url: story.url,
    published_ts: story.published_ts,
    updated_ts: story.updated_ts,
    provider_symbols_json: JSON.stringify(story.provider_symbols),
    resolved_symbols_json: JSON.stringify(story.resolved_symbols),
    symbol_resolution: story.symbol_resolution
  };
};

export const fromNewsRecord = (record: NewsRecord): NewsStory => {
  return {
    source_ts: record.source_ts,
    ingest_ts: record.ingest_ts,
    seq: record.seq,
    trace_id: record.trace_id,
    story_id: record.story_id,
    provider: record.provider,
    source: record.source,
    headline: record.headline,
    summary: record.summary,
    content_html: record.content_html,
    url: record.url,
    published_ts: record.published_ts,
    updated_ts: record.updated_ts,
    provider_symbols: safeStringArray(record.provider_symbols_json),
    resolved_symbols: safeStringArray(record.resolved_symbols_json),
    symbol_resolution: record.symbol_resolution
  };
};
