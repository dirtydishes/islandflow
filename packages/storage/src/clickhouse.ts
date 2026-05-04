import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  EquityCandleSchema,
  EquityPrintSchema,
  EquityQuoteSchema,
  EquityPrintJoinSchema,
  InferredDarkEventSchema,
  FlowPacketSchema,
  OptionNBBOSchema,
  OptionPrintSchema
} from "@islandflow/types";
import type {
  AlertEvent,
  ClassifierHitEvent,
  EquityCandle,
  EquityPrint,
  EquityQuote,
  EquityPrintJoin,
  InferredDarkEvent,
  FlowPacket,
  OptionNBBO,
  OptionPrint,
  OptionFlowFilters,
  OptionFlowView
} from "@islandflow/types";
import {
  normalizeOptionPrint,
  optionPrintsTableDDL,
  optionPrintsTableMigrations,
  OPTION_PRINTS_TABLE
} from "./option-prints";
import { normalizeOptionNBBO, optionNBBOTableDDL, OPTION_NBBO_TABLE } from "./option-nbbo";
import {
  equityPrintsTableDDL,
  EQUITY_PRINTS_TABLE,
  normalizeEquityPrint
} from "./equity-prints";
import {
  equityQuotesTableDDL,
  EQUITY_QUOTES_TABLE,
  normalizeEquityQuote
} from "./equity-quotes";
import {
  equityCandlesTableDDL,
  EQUITY_CANDLES_TABLE,
  normalizeEquityCandle
} from "./equity-candles";
import {
  equityPrintJoinsTableDDL,
  EQUITY_PRINT_JOINS_TABLE,
  fromEquityPrintJoinRecord,
  toEquityPrintJoinRecord,
  type EquityPrintJoinRecord
} from "./equity-print-joins";
import {
  inferredDarkTableDDL,
  INFERRED_DARK_TABLE,
  fromInferredDarkRecord,
  toInferredDarkRecord,
  type InferredDarkRecord
} from "./inferred-dark";
import {
  FLOW_PACKETS_TABLE,
  flowPacketsTableDDL,
  fromFlowPacketRecord,
  toFlowPacketRecord,
  type FlowPacketRecord
} from "./flow-packets";
import {
  CLASSIFIER_HITS_TABLE,
  classifierHitsTableDDL,
  fromClassifierHitRecord,
  toClassifierHitRecord,
  type ClassifierHitRecord
} from "./classifier-hits";
import {
  ALERTS_TABLE,
  alertsTableDDL,
  fromAlertRecord,
  toAlertRecord,
  type AlertRecord
} from "./alerts";

export type ClickHouseOptions = {
  url: string;
  database?: string;
  username?: string;
  password?: string;
};

type ClickHouseQueryFormat = "JSONEachRow";

type ClickHouseQueryResult = {
  json<T>(): Promise<T>;
};

export type ClickHouseClient = {
  exec(params: { query: string }): Promise<void>;
  insert(params: { table: string; values: unknown[]; format: ClickHouseQueryFormat }): Promise<void>;
  query(params: { query: string; format: ClickHouseQueryFormat }): Promise<ClickHouseQueryResult>;
  ping(): Promise<{ success: boolean; error?: Error }>;
  close(): Promise<void>;
};

const buildBaseUrl = (options: ClickHouseOptions): URL => {
  const url = new URL(options.url);

  if (options.database) {
    url.searchParams.set("database", options.database);
  }

  return url;
};

const buildHeaders = (options: ClickHouseOptions, hasBody: boolean): Headers => {
  const headers = new Headers();

  if (hasBody) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }

  if (options.username || options.password) {
    const auth = Buffer.from(`${options.username ?? "default"}:${options.password ?? ""}`).toString("base64");
    headers.set("authorization", `Basic ${auth}`);
  }

  return headers;
};

const executeClickHouse = async (
  options: ClickHouseOptions,
  query: string,
  body?: string
): Promise<Response> => {
  const url = buildBaseUrl(options);
  url.searchParams.set("query", query);

  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(options, body !== undefined),
    body
  });

  if (!response.ok) {
    const message = (await response.text()).trim() || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response;
};

const parseJsonEachRow = <T>(text: string): T => {
  const trimmed = text.trim();

  if (!trimmed) {
    return [] as T;
  }

  const rows = trimmed
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

  return rows as T;
};

export const createClickHouseClient = (options: ClickHouseOptions): ClickHouseClient => {
  return {
    async exec({ query }) {
      await executeClickHouse(options, query);
    },

    async insert({ table, values, format }) {
      const rows = values.map((value) => JSON.stringify(value)).join("\n");
      const body = rows.length > 0 ? `${rows}\n` : "";
      await executeClickHouse(options, `INSERT INTO ${table} FORMAT ${format}`, body);
    },

    async query({ query, format }) {
      const response = await executeClickHouse(options, `${query} FORMAT ${format}`);
      return {
        async json<T>() {
          const text = await response.text();
          return parseJsonEachRow<T>(text);
        }
      };
    },

    async ping() {
      try {
        const url = buildBaseUrl(options);
        url.pathname = "/ping";

        const response = await fetch(url, {
          method: "GET",
          headers: buildHeaders(options, false)
        });

        if (!response.ok) {
          const message = (await response.text()).trim() || `${response.status} ${response.statusText}`;
          return { success: false, error: new Error(message) };
        }

        return { success: true };
      } catch (error) {
        if (error instanceof Error) {
          return { success: false, error };
        }

        throw error;
      }
    },

    async close() {
      return;
    }
  };
};

export const ensureOptionPrintsTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: optionPrintsTableDDL()
  });
  for (const query of optionPrintsTableMigrations()) {
    await client.exec({ query });
  }
};

export const ensureOptionNBBOTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: optionNBBOTableDDL()
  });
};

export const ensureEquityPrintsTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: equityPrintsTableDDL()
  });
};

export const ensureEquityQuotesTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: equityQuotesTableDDL()
  });
};

export const ensureEquityCandlesTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: equityCandlesTableDDL()
  });
};

export const ensureEquityPrintJoinsTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: equityPrintJoinsTableDDL()
  });
};

export const ensureInferredDarkTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: inferredDarkTableDDL()
  });
};

export const ensureFlowPacketsTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: flowPacketsTableDDL()
  });
};

export const ensureClassifierHitsTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: classifierHitsTableDDL()
  });
};

export const ensureAlertsTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: alertsTableDDL()
  });
};

export const insertOptionPrint = async (
  client: ClickHouseClient,
  print: OptionPrint
): Promise<void> => {
  const record = normalizeOptionPrint(print);
  await client.insert({
    table: OPTION_PRINTS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertOptionNBBO = async (
  client: ClickHouseClient,
  nbbo: OptionNBBO
): Promise<void> => {
  const record = normalizeOptionNBBO(nbbo);
  await client.insert({
    table: OPTION_NBBO_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertEquityPrint = async (
  client: ClickHouseClient,
  print: EquityPrint
): Promise<void> => {
  const record = normalizeEquityPrint(print);
  await client.insert({
    table: EQUITY_PRINTS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertEquityQuote = async (
  client: ClickHouseClient,
  quote: EquityQuote
): Promise<void> => {
  const record = normalizeEquityQuote(quote);
  await client.insert({
    table: EQUITY_QUOTES_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertEquityCandle = async (
  client: ClickHouseClient,
  candle: EquityCandle
): Promise<void> => {
  const record = normalizeEquityCandle(candle);
  await client.insert({
    table: EQUITY_CANDLES_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertEquityPrintJoin = async (
  client: ClickHouseClient,
  join: EquityPrintJoin
): Promise<void> => {
  const record = toEquityPrintJoinRecord(join);
  await client.insert({
    table: EQUITY_PRINT_JOINS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertInferredDark = async (
  client: ClickHouseClient,
  event: InferredDarkEvent
): Promise<void> => {
  const record = toInferredDarkRecord(event);
  await client.insert({
    table: INFERRED_DARK_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertFlowPacket = async (
  client: ClickHouseClient,
  packet: FlowPacket
): Promise<void> => {
  const record = toFlowPacketRecord(packet);
  await client.insert({
    table: FLOW_PACKETS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertClassifierHit = async (
  client: ClickHouseClient,
  hit: ClassifierHitEvent
): Promise<void> => {
  const record = toClassifierHitRecord(hit);
  await client.insert({
    table: CLASSIFIER_HITS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertAlert = async (client: ClickHouseClient, alert: AlertEvent): Promise<void> => {
  const record = toAlertRecord(alert);
  await client.insert({
    table: ALERTS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

const clampLimit = (limit: number): number => {
  if (!Number.isFinite(limit)) {
    return 100;
  }

  return Math.max(1, Math.min(1000, Math.floor(limit)));
};

const clampLookupLimit = (limit: number): number => {
  if (!Number.isFinite(limit)) {
    return 100;
  }

  return Math.max(1, Math.min(5000, Math.floor(limit)));
};

const clampPositiveInt = (value: number, fallback = 1): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
};

const clampCursor = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const coerceNumber = (value: unknown): unknown => {
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return value;
};

const quoteString = (value: string): string => {
  const escaped = value.replace(/'/g, "''");
  return `'${escaped}'`;
};

const buildStringList = (values: string[]): string => {
  return values.map((value) => quoteString(value)).join(", ");
};

const buildTracePrefixCondition = (tracePrefix: string | undefined): string | null => {
  if (!tracePrefix) {
    return null;
  }
  const normalized = tracePrefix.trim();
  if (!normalized) {
    return null;
  }
  return `startsWith(trace_id, ${quoteString(normalized)})`;
};

const buildBeforeTupleCondition = (
  tsColumn: string,
  seqColumn: string,
  beforeTs: number,
  beforeSeq: number
): string => {
  return `(${tsColumn}, ${seqColumn}) < (${clampCursor(beforeTs)}, ${clampCursor(beforeSeq)})`;
};

const normalizeNumericFields = (
  row: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> => {
  const record: Record<string, unknown> = { ...row };

  for (const field of fields) {
    if (field in record) {
      record[field] = coerceNumber(record[field]);
    }
  }

  return record;
};

const normalizeOptionRow = (row: unknown): unknown => {
  if (row && typeof row === "object") {
    const record = normalizeNumericFields(row as Record<string, unknown>, [
      "source_ts",
      "ingest_ts",
      "seq",
      "ts",
      "price",
      "size",
      "notional",
      "execution_nbbo_bid",
      "execution_nbbo_ask",
      "execution_nbbo_mid",
      "execution_nbbo_spread",
      "execution_nbbo_bid_size",
      "execution_nbbo_ask_size",
      "execution_nbbo_ts",
      "execution_nbbo_age_ms",
      "execution_underlying_spot",
      "execution_underlying_bid",
      "execution_underlying_ask",
      "execution_underlying_mid",
      "execution_underlying_spread",
      "execution_underlying_ts",
      "execution_underlying_age_ms",
      "execution_iv"
    ]);

    if ("is_etf" in record) {
      record.is_etf = Boolean(record.is_etf);
    }
    if ("signal_pass" in record) {
      record.signal_pass = Boolean(record.signal_pass);
    }
    if (record.signal_reasons == null) {
      record.signal_reasons = [];
    }
    return record;
  }

  return row;
};

export type OptionPrintQueryFilters = {
  view?: OptionFlowView;
  minNotional?: number;
  security?: "stock" | "etf" | "all";
  optionTypes?: string[];
  nbboSides?: string[];
};

const buildOptionPrintFilterConditions = (
  filters: OptionPrintQueryFilters | undefined,
  tracePrefix: string | undefined
): string[] => {
  const conditions: string[] = [];
  const traceCondition = buildTracePrefixCondition(tracePrefix);
  if (traceCondition) {
    conditions.push(traceCondition);
  }

  if (!filters) {
    return conditions;
  }

  if ((filters.view ?? "signal") === "signal") {
    conditions.push("signal_pass = 1");
  }

  if (typeof filters.minNotional === "number" && Number.isFinite(filters.minNotional)) {
    conditions.push(`notional >= ${filters.minNotional}`);
  }

  if (filters.security === "stock") {
    conditions.push("(is_etf = 0 OR is_etf IS NULL)");
  } else if (filters.security === "etf") {
    conditions.push("is_etf = 1");
  }

  if (filters.optionTypes && filters.optionTypes.length > 0) {
    conditions.push(`option_type IN (${buildStringList(filters.optionTypes)})`);
  }

  if (filters.nbboSides && filters.nbboSides.length > 0) {
    conditions.push(`nbbo_side IN (${buildStringList(filters.nbboSides)})`);
  }

  return conditions;
};

const normalizeOptionNbboRow = (row: unknown): unknown => {
  if (row && typeof row === "object") {
    return normalizeNumericFields(row as Record<string, unknown>, [
      "source_ts",
      "ingest_ts",
      "seq",
      "ts",
      "bid",
      "ask",
      "bidSize",
      "askSize"
    ]);
  }

  return row;
};

const normalizeEquityQuoteRow = (row: unknown): unknown => {
  if (row && typeof row === "object") {
    return normalizeNumericFields(row as Record<string, unknown>, [
      "source_ts",
      "ingest_ts",
      "seq",
      "ts",
      "bid",
      "ask"
    ]);
  }

  return row;
};

const normalizeEquityCandleRow = (row: unknown): unknown => {
  if (row && typeof row === "object") {
    return normalizeNumericFields(row as Record<string, unknown>, [
      "source_ts",
      "ingest_ts",
      "seq",
      "ts",
      "interval_ms",
      "open",
      "high",
      "low",
      "close",
      "volume",
      "trade_count"
    ]);
  }

  return row;
};

const normalizeEquityRow = (row: unknown): unknown => {
  if (row && typeof row === "object") {
    const record = normalizeNumericFields(row as Record<string, unknown>, [
      "source_ts",
      "ingest_ts",
      "seq",
      "ts",
      "price",
      "size"
    ]);

    if ("offExchangeFlag" in record) {
      return {
        ...record,
        offExchangeFlag: Boolean(record.offExchangeFlag)
      };
    }

    return record;
  }

  return row;
};

const normalizeEquityPrintJoinRow = (row: unknown): EquityPrintJoinRecord | null => {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  return {
    source_ts: coerceNumber(record.source_ts) as number,
    ingest_ts: coerceNumber(record.ingest_ts) as number,
    seq: coerceNumber(record.seq) as number,
    trace_id: String(record.trace_id ?? ""),
    id: String(record.id ?? ""),
    print_trace_id: String(record.print_trace_id ?? ""),
    quote_trace_id: String(record.quote_trace_id ?? ""),
    features_json: String(record.features_json ?? "{}"),
    join_quality_json: String(record.join_quality_json ?? "{}")
  };
};

const normalizeInferredDarkRow = (row: unknown): InferredDarkRecord | null => {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  return {
    source_ts: coerceNumber(record.source_ts) as number,
    ingest_ts: coerceNumber(record.ingest_ts) as number,
    seq: coerceNumber(record.seq) as number,
    trace_id: String(record.trace_id ?? ""),
    type: String(record.type ?? ""),
    confidence: Number(coerceNumber(record.confidence) ?? 0),
    evidence_refs_json: String(record.evidence_refs_json ?? "[]")
  };
};

const normalizeFlowPacketRow = (row: unknown): FlowPacketRecord | null => {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  return {
    source_ts: coerceNumber(record.source_ts) as number,
    ingest_ts: coerceNumber(record.ingest_ts) as number,
    seq: coerceNumber(record.seq) as number,
    trace_id: String(record.trace_id ?? ""),
    id: String(record.id ?? ""),
    members: Array.isArray(record.members)
      ? record.members.map((value) => String(value))
      : [],
    features_json: String(record.features_json ?? "{}"),
    join_quality_json: String(record.join_quality_json ?? "{}")
  };
};

const normalizeClassifierHitRow = (row: unknown): ClassifierHitRecord | null => {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  return {
    source_ts: coerceNumber(record.source_ts) as number,
    ingest_ts: coerceNumber(record.ingest_ts) as number,
    seq: coerceNumber(record.seq) as number,
    trace_id: String(record.trace_id ?? ""),
    classifier_id: String(record.classifier_id ?? ""),
    confidence: Number(coerceNumber(record.confidence) ?? 0),
    direction: String(record.direction ?? ""),
    explanations_json: String(record.explanations_json ?? "[]")
  };
};

const normalizeAlertRow = (row: unknown): AlertRecord | null => {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  return {
    source_ts: coerceNumber(record.source_ts) as number,
    ingest_ts: coerceNumber(record.ingest_ts) as number,
    seq: coerceNumber(record.seq) as number,
    trace_id: String(record.trace_id ?? ""),
    score: Number(coerceNumber(record.score) ?? 0),
    severity: String(record.severity ?? ""),
    hits_json: String(record.hits_json ?? "[]"),
    evidence_refs_json: String(record.evidence_refs_json ?? "[]")
  };
};

export const fetchRecentOptionPrints = async (
  client: ClickHouseClient,
  limit: number,
  tracePrefix?: string,
  filters?: OptionPrintQueryFilters
): Promise<OptionPrint[]> => {
  const safeLimit = clampLimit(limit);
  const conditions = buildOptionPrintFilterConditions(filters, tracePrefix);
  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const result = await client.query({
    query: `SELECT * FROM ${OPTION_PRINTS_TABLE}${whereClause} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionPrintSchema.array().parse(rows.map(normalizeOptionRow));
};

export const fetchRecentOptionNBBO = async (
  client: ClickHouseClient,
  limit: number,
  tracePrefix?: string
): Promise<OptionNBBO[]> => {
  const safeLimit = clampLimit(limit);
  const condition = buildTracePrefixCondition(tracePrefix);
  const whereClause = condition ? ` WHERE ${condition}` : "";
  const result = await client.query({
    query: `SELECT * FROM ${OPTION_NBBO_TABLE}${whereClause} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionNBBOSchema.array().parse(rows.map(normalizeOptionNbboRow));
};

export const fetchRecentEquityPrints = async (
  client: ClickHouseClient,
  limit: number
): Promise<EquityPrint[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINTS_TABLE} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityPrintSchema.array().parse(rows.map(normalizeEquityRow));
};

export const fetchRecentEquityQuotes = async (
  client: ClickHouseClient,
  limit: number
): Promise<EquityQuote[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_QUOTES_TABLE} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityQuoteSchema.array().parse(rows.map(normalizeEquityQuoteRow));
};

export const fetchRecentEquityCandles = async (
  client: ClickHouseClient,
  underlyingId: string,
  intervalMs: number,
  limit: number
): Promise<EquityCandle[]> => {
  const safeLimit = clampLimit(limit);
  const safeInterval = clampPositiveInt(intervalMs, 1000);
  const safeUnderlying = quoteString(underlyingId);
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_CANDLES_TABLE} WHERE underlying_id = ${safeUnderlying} AND interval_ms = ${safeInterval} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityCandleSchema.array().parse(rows.map(normalizeEquityCandleRow));
};

export const fetchRecentEquityPrintJoins = async (
  client: ClickHouseClient,
  limit: number
): Promise<EquityPrintJoin[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINT_JOINS_TABLE} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeEquityPrintJoinRow)
    .filter((record): record is EquityPrintJoinRecord => record !== null);
  const joins = records.map(fromEquityPrintJoinRecord);
  return EquityPrintJoinSchema.array().parse(joins);
};

export const fetchRecentInferredDark = async (
  client: ClickHouseClient,
  limit: number
): Promise<InferredDarkEvent[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${INFERRED_DARK_TABLE} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeInferredDarkRow)
    .filter((record): record is InferredDarkRecord => record !== null);
  const events = records.map(fromInferredDarkRecord);
  return InferredDarkEventSchema.array().parse(events);
};

export const fetchRecentFlowPackets = async (
  client: ClickHouseClient,
  limit: number
): Promise<FlowPacket[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${FLOW_PACKETS_TABLE} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeFlowPacketRow)
    .filter((record): record is FlowPacketRecord => record !== null);
  const packets = records.map(fromFlowPacketRecord);
  return FlowPacketSchema.array().parse(packets);
};

export const fetchRecentClassifierHits = async (
  client: ClickHouseClient,
  limit: number
): Promise<ClassifierHitEvent[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${CLASSIFIER_HITS_TABLE} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeClassifierHitRow)
    .filter((record): record is ClassifierHitRecord => record !== null);
  const hits = records.map(fromClassifierHitRecord);
  return ClassifierHitEventSchema.array().parse(hits);
};

export const fetchRecentAlerts = async (
  client: ClickHouseClient,
  limit: number
): Promise<AlertEvent[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${ALERTS_TABLE} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeAlertRow)
    .filter((record): record is AlertRecord => record !== null);
  const alerts = records.map(fromAlertRecord);
  return AlertEventSchema.array().parse(alerts);
};

export const fetchOptionPrintsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number,
  tracePrefix?: string,
  filters?: OptionPrintQueryFilters
): Promise<OptionPrint[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);
  const conditions = [
    `((ts, seq) > (${safeAfterTs}, ${safeAfterSeq}))`,
    ...buildOptionPrintFilterConditions(filters, tracePrefix)
  ];

  const result = await client.query({
    query: `SELECT * FROM ${OPTION_PRINTS_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionPrintSchema.array().parse(rows.map(normalizeOptionRow));
};

export const fetchOptionNBBOAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number,
  tracePrefix?: string
): Promise<OptionNBBO[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);
  const traceCondition = buildTracePrefixCondition(tracePrefix);
  const traceClause = traceCondition ? ` AND ${traceCondition}` : "";

  const result = await client.query({
    query: `SELECT * FROM ${OPTION_NBBO_TABLE} WHERE (ts, seq) > (${safeAfterTs}, ${safeAfterSeq})${traceClause} ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionNBBOSchema.array().parse(rows.map(normalizeOptionNbboRow));
};

export const fetchEquityPrintsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<EquityPrint[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINTS_TABLE} WHERE (ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityPrintSchema.array().parse(rows.map(normalizeEquityRow));
};

export const fetchEquityPrintsRange = async (
  client: ClickHouseClient,
  underlyingId: string,
  startTs: number,
  endTs: number,
  limit: number
): Promise<EquityPrint[]> => {
  const safeLimit = clampLimit(limit);
  const safeStart = clampCursor(startTs);
  const safeEnd = clampCursor(endTs);
  const rangeStart = Math.min(safeStart, safeEnd);
  const rangeEnd = Math.max(safeStart, safeEnd);
  const safeUnderlying = quoteString(underlyingId);

  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINTS_TABLE} WHERE underlying_id = ${safeUnderlying} AND ts >= ${rangeStart} AND ts <= ${rangeEnd} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const parsed = EquityPrintSchema.array().parse(rows.map(normalizeEquityRow));
  return parsed.reverse();
};

export const fetchEquityQuotesAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<EquityQuote[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_QUOTES_TABLE} WHERE (ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityQuoteSchema.array().parse(rows.map(normalizeEquityQuoteRow));
};

export const fetchEquityCandlesAfter = async (
  client: ClickHouseClient,
  underlyingId: string,
  intervalMs: number,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<EquityCandle[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);
  const safeInterval = clampPositiveInt(intervalMs, 1000);
  const safeUnderlying = quoteString(underlyingId);

  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_CANDLES_TABLE} WHERE underlying_id = ${safeUnderlying} AND interval_ms = ${safeInterval} AND (ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityCandleSchema.array().parse(rows.map(normalizeEquityCandleRow));
};

export const fetchEquityCandlesRange = async (
  client: ClickHouseClient,
  underlyingId: string,
  intervalMs: number,
  startTs: number,
  endTs: number,
  limit: number
): Promise<EquityCandle[]> => {
  const safeLimit = clampLimit(limit);
  const safeStart = clampCursor(startTs);
  const safeEnd = clampCursor(endTs);
  const safeInterval = clampPositiveInt(intervalMs, 1000);
  const safeUnderlying = quoteString(underlyingId);

  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_CANDLES_TABLE} WHERE underlying_id = ${safeUnderlying} AND interval_ms = ${safeInterval} AND ts >= ${safeStart} AND ts <= ${safeEnd} ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityCandleSchema.array().parse(rows.map(normalizeEquityCandleRow));
};

export const fetchEquityPrintJoinsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<EquityPrintJoin[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINT_JOINS_TABLE} WHERE (source_ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY source_ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeEquityPrintJoinRow)
    .filter((record): record is EquityPrintJoinRecord => record !== null);
  const joins = records.map(fromEquityPrintJoinRecord);
  return EquityPrintJoinSchema.array().parse(joins);
};

export const fetchInferredDarkAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<InferredDarkEvent[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${INFERRED_DARK_TABLE} WHERE (source_ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY source_ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeInferredDarkRow)
    .filter((record): record is InferredDarkRecord => record !== null);
  const events = records.map(fromInferredDarkRecord);
  return InferredDarkEventSchema.array().parse(events);
};

export const fetchFlowPacketsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<FlowPacket[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${FLOW_PACKETS_TABLE} WHERE (source_ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY source_ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeFlowPacketRow)
    .filter((record): record is FlowPacketRecord => record !== null);
  const packets = records.map(fromFlowPacketRecord);
  return FlowPacketSchema.array().parse(packets);
};

export const fetchClassifierHitsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<ClassifierHitEvent[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${CLASSIFIER_HITS_TABLE} WHERE (source_ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY source_ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeClassifierHitRow)
    .filter((record): record is ClassifierHitRecord => record !== null);
  const hits = records.map(fromClassifierHitRecord);
  return ClassifierHitEventSchema.array().parse(hits);
};

export const fetchAlertsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<AlertEvent[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${ALERTS_TABLE} WHERE (source_ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY source_ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeAlertRow)
    .filter((record): record is AlertRecord => record !== null);
  const alerts = records.map(fromAlertRecord);
  return AlertEventSchema.array().parse(alerts);
};

export const fetchOptionPrintsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number,
  tracePrefix?: string,
  filters?: OptionPrintQueryFilters
): Promise<OptionPrint[]> => {
  const safeLimit = clampLimit(limit);
  const conditions = [
    buildBeforeTupleCondition("ts", "seq", beforeTs, beforeSeq),
    ...buildOptionPrintFilterConditions(filters, tracePrefix)
  ];

  const result = await client.query({
    query: `SELECT * FROM ${OPTION_PRINTS_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionPrintSchema.array().parse(rows.map(normalizeOptionRow));
};

export const fetchOptionNBBOBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number,
  tracePrefix?: string
): Promise<OptionNBBO[]> => {
  const safeLimit = clampLimit(limit);
  const conditions = [buildBeforeTupleCondition("ts", "seq", beforeTs, beforeSeq)];
  const traceCondition = buildTracePrefixCondition(tracePrefix);
  if (traceCondition) {
    conditions.push(traceCondition);
  }

  const result = await client.query({
    query: `SELECT * FROM ${OPTION_NBBO_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionNBBOSchema.array().parse(rows.map(normalizeOptionNbboRow));
};

export const fetchEquityPrintsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<EquityPrint[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINTS_TABLE} WHERE ${buildBeforeTupleCondition("ts", "seq", beforeTs, beforeSeq)} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityPrintSchema.array().parse(rows.map(normalizeEquityRow));
};

export const fetchEquityPrintJoinsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<EquityPrintJoin[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINT_JOINS_TABLE} WHERE ${buildBeforeTupleCondition("source_ts", "seq", beforeTs, beforeSeq)} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeEquityPrintJoinRow)
    .filter((record): record is EquityPrintJoinRecord => record !== null);
  return EquityPrintJoinSchema.array().parse(records.map(fromEquityPrintJoinRecord));
};

export const fetchFlowPacketsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<FlowPacket[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${FLOW_PACKETS_TABLE} WHERE ${buildBeforeTupleCondition("source_ts", "seq", beforeTs, beforeSeq)} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeFlowPacketRow)
    .filter((record): record is FlowPacketRecord => record !== null);
  return FlowPacketSchema.array().parse(records.map(fromFlowPacketRecord));
};

export const fetchClassifierHitsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<ClassifierHitEvent[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${CLASSIFIER_HITS_TABLE} WHERE ${buildBeforeTupleCondition("source_ts", "seq", beforeTs, beforeSeq)} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeClassifierHitRow)
    .filter((record): record is ClassifierHitRecord => record !== null);
  return ClassifierHitEventSchema.array().parse(records.map(fromClassifierHitRecord));
};

export const fetchAlertsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<AlertEvent[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${ALERTS_TABLE} WHERE ${buildBeforeTupleCondition("source_ts", "seq", beforeTs, beforeSeq)} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeAlertRow)
    .filter((record): record is AlertRecord => record !== null);
  return AlertEventSchema.array().parse(records.map(fromAlertRecord));
};

export const fetchInferredDarkBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<InferredDarkEvent[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${INFERRED_DARK_TABLE} WHERE ${buildBeforeTupleCondition("source_ts", "seq", beforeTs, beforeSeq)} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeInferredDarkRow)
    .filter((record): record is InferredDarkRecord => record !== null);
  return InferredDarkEventSchema.array().parse(records.map(fromInferredDarkRecord));
};

export const fetchFlowPacketById = async (
  client: ClickHouseClient,
  id: string
): Promise<FlowPacket | null> => {
  const result = await client.query({
    query: `SELECT * FROM ${FLOW_PACKETS_TABLE} WHERE id = ${quoteString(id)} ORDER BY source_ts DESC, seq DESC LIMIT 1`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const record = rows
    .map(normalizeFlowPacketRow)
    .find((row): row is FlowPacketRecord => row !== null);
  return record ? FlowPacketSchema.parse(fromFlowPacketRecord(record)) : null;
};

export const fetchOptionPrintsByTraceIds = async (
  client: ClickHouseClient,
  traceIds: string[]
): Promise<OptionPrint[]> => {
  const ids = Array.from(new Set(traceIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) {
    return [];
  }

  const result = await client.query({
    query: `SELECT * FROM ${OPTION_PRINTS_TABLE} WHERE trace_id IN (${buildStringList(ids)}) ORDER BY ts DESC, seq DESC LIMIT ${clampLookupLimit(ids.length)}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionPrintSchema.array().parse(rows.map(normalizeOptionRow));
};

export const fetchEquityPrintJoinsByIds = async (
  client: ClickHouseClient,
  ids: string[]
): Promise<EquityPrintJoin[]> => {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [];
  }

  const joinIds = new Set<string>();
  const printTraceIds = new Set<string>();
  for (const id of uniqueIds) {
    joinIds.add(id);
    if (id.startsWith("equityjoin:")) {
      const trace = id.slice("equityjoin:".length);
      if (trace) {
        printTraceIds.add(trace);
      }
    } else {
      joinIds.add(`equityjoin:${id}`);
      printTraceIds.add(id);
    }
  }

  const joinIdList = Array.from(joinIds);
  const printTraceList = Array.from(printTraceIds);
  const whereParts = [
    `id IN (${buildStringList(joinIdList)})`,
    `trace_id IN (${buildStringList(joinIdList)})`
  ];
  if (printTraceList.length > 0) {
    whereParts.push(`print_trace_id IN (${buildStringList(printTraceList)})`);
  }
  const lookupLimit = clampLookupLimit(joinIdList.length + printTraceList.length);

  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINT_JOINS_TABLE} WHERE ${whereParts.join(" OR ")} ORDER BY source_ts DESC, seq DESC LIMIT ${lookupLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeEquityPrintJoinRow)
    .filter((record): record is EquityPrintJoinRecord => record !== null);
  return EquityPrintJoinSchema.array().parse(records.map(fromEquityPrintJoinRecord));
};
