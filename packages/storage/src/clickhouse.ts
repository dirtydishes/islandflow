import type {
  EquityCandle,
  EquityPrint,
  EquityPrintJoin,
  EquityQuote,
  FlowPacket,
  InferredDarkEvent,
  NewsStory,
  OptionFlowFilters,
  OptionFlowView,
  OptionNBBO,
  OptionPrint,
  SmartFlowAlertEvent,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import {
  EquityCandleSchema,
  EquityPrintJoinSchema,
  EquityPrintSchema,
  EquityQuoteSchema,
  FlowPacketSchema,
  InferredDarkEventSchema,
  NewsStorySchema,
  OptionNBBOSchema,
  OptionPrintSchema,
  SmartFlowAlertEventSchema,
  SmartFlowExplainabilityProjectionSchema
} from "@islandflow/types";
import {
  EQUITY_CANDLES_TABLE,
  equityCandlesTableDDL,
  normalizeEquityCandle
} from "./equity-candles";
import {
  EQUITY_PRINT_JOINS_TABLE,
  type EquityPrintJoinRecord,
  equityPrintJoinsTableDDL,
  fromEquityPrintJoinRecord,
  toEquityPrintJoinRecord
} from "./equity-print-joins";
import { EQUITY_PRINTS_TABLE, equityPrintsTableDDL, normalizeEquityPrint } from "./equity-prints";
import { EQUITY_QUOTES_TABLE, equityQuotesTableDDL, normalizeEquityQuote } from "./equity-quotes";
import {
  FLOW_PACKETS_TABLE,
  type FlowPacketRecord,
  flowPacketsTableDDL,
  fromFlowPacketRecord,
  toFlowPacketRecord
} from "./flow-packets";
import {
  fromInferredDarkRecord,
  INFERRED_DARK_TABLE,
  type InferredDarkRecord,
  inferredDarkTableDDL,
  toInferredDarkRecord
} from "./inferred-dark";
import { fromNewsRecord, NEWS_TABLE, type NewsRecord, newsTableDDL, toNewsRecord } from "./news";
import { normalizeOptionNBBO, OPTION_NBBO_TABLE, optionNBBOTableDDL } from "./option-nbbo";
import {
  normalizeOptionPrint,
  OPTION_PRINT_QUERY_MAX_EXECUTION_SECONDS,
  OPTION_PRINT_QUERY_TIMEOUT_MS,
  OPTION_PRINT_TRACE_ID_MAX_LENGTH,
  OPTION_PRINT_TRACE_LOOKUP_MAX_IDS,
  OPTION_PRINTS_TABLE,
  optionPrintsTableDDL,
  optionPrintsTableMigrations
} from "./option-prints";
import {
  fromSmartFlowAlertRecord,
  SMART_FLOW_ALERTS_TABLE,
  type SmartFlowAlertRecord,
  smartFlowAlertsTableDDL,
  toSmartFlowAlertRecord
} from "./smart-flow-alerts";
import {
  fromSmartFlowProjectionRecord,
  SMART_FLOW_PROJECTIONS_TABLE,
  type SmartFlowProjectionRecord,
  smartFlowProjectionsTableDDL,
  toSmartFlowProjectionRecord
} from "./smart-flow-projections";

export type ClickHouseOptions = {
  url: string;
  database?: string;
  username?: string;
  password?: string;
};

type ClickHouseQueryFormat = "JSONEachRow";

export type ClickHouseQuerySettings = Record<string, string | number | boolean>;

export type ClickHouseQueryParams = {
  query: string;
  format: ClickHouseQueryFormat;
  settings?: ClickHouseQuerySettings;
  timeoutMs?: number;
};

type ClickHouseQueryResult = {
  json<T>(): Promise<T>;
};

export type ClickHouseClient = {
  exec(params: { query: string }): Promise<void>;
  insert(params: {
    table: string;
    values: unknown[];
    format: ClickHouseQueryFormat;
  }): Promise<void>;
  query(params: ClickHouseQueryParams): Promise<ClickHouseQueryResult>;
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
    const auth = Buffer.from(`${options.username ?? "default"}:${options.password ?? ""}`).toString(
      "base64"
    );
    headers.set("authorization", `Basic ${auth}`);
  }

  return headers;
};

const readResponseText = async (response: Response, timeoutMs?: number): Promise<string> => {
  if (!timeoutMs) {
    return response.text();
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      response.text(),
      new Promise<string>((_, reject) => {
        timeout = setTimeout(() => {
          void response.body?.cancel();
          reject(new Error(`ClickHouse response timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const executeClickHouse = async (
  options: ClickHouseOptions,
  query: string,
  body?: string,
  settings?: ClickHouseQuerySettings,
  timeoutMs?: number
): Promise<Response> => {
  const url = buildBaseUrl(options);
  url.searchParams.set("query", query);
  if (settings) {
    for (const [key, value] of Object.entries(settings)) {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => {
        controller.abort();
      }, timeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(options, body !== undefined),
      body,
      signal: controller?.signal
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(`ClickHouse request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    const message =
      (await readResponseText(response, timeoutMs)).trim() ||
      `${response.status} ${response.statusText}`;
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

    async query({ query, format, settings, timeoutMs }) {
      const response = await executeClickHouse(
        options,
        `${query} FORMAT ${format}`,
        undefined,
        settings,
        timeoutMs
      );
      return {
        async json<T>() {
          const text = await readResponseText(response, timeoutMs);
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
          const message =
            (await response.text()).trim() || `${response.status} ${response.statusText}`;
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

export const ensureOptionPrintsTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: optionPrintsTableDDL()
  });
  for (const query of optionPrintsTableMigrations()) {
    await client.exec({ query });
  }
};

export const ensureOptionNBBOTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: optionNBBOTableDDL()
  });
};

export const ensureEquityPrintsTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: equityPrintsTableDDL()
  });
};

export const ensureEquityQuotesTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: equityQuotesTableDDL()
  });
};

export const ensureEquityCandlesTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: equityCandlesTableDDL()
  });
};

export const ensureEquityPrintJoinsTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: equityPrintJoinsTableDDL()
  });
};

export const ensureInferredDarkTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: inferredDarkTableDDL()
  });
};

export const ensureFlowPacketsTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: flowPacketsTableDDL()
  });
};

export const ensureSmartFlowProjectionsTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: smartFlowProjectionsTableDDL()
  });
};

export const ensureSmartFlowAlertsTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: smartFlowAlertsTableDDL()
  });
};

export const ensureNewsTable = async (client: ClickHouseClient): Promise<void> => {
  await client.exec({
    query: newsTableDDL()
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

export const insertSmartFlowProjection = async (
  client: ClickHouseClient,
  projection: SmartFlowExplainabilityProjection
): Promise<void> => {
  const record = toSmartFlowProjectionRecord(projection);
  await client.insert({
    table: SMART_FLOW_PROJECTIONS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertSmartFlowAlert = async (
  client: ClickHouseClient,
  alert: SmartFlowAlertEvent
): Promise<void> => {
  const record = toSmartFlowAlertRecord(alert);
  await client.insert({
    table: SMART_FLOW_ALERTS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export const insertNewsStory = async (
  client: ClickHouseClient,
  story: NewsStory
): Promise<void> => {
  const record = toNewsRecord(story);
  await client.insert({
    table: NEWS_TABLE,
    values: [record],
    format: "JSONEachRow"
  });
};

export type ClickHouseBatchWriterOptions = {
  flushIntervalMs?: number;
  maxRows?: number;
  onError?: (table: string, error: unknown, rowCount: number) => void;
};

type BatchState = {
  rows: unknown[];
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
};

const createBatchState = (): BatchState => ({
  rows: [],
  timer: null,
  flushing: null
});

export class ClickHouseBatchWriter {
  private readonly flushIntervalMs: number;
  private readonly maxRows: number;
  private readonly states = new Map<string, BatchState>();

  constructor(
    private readonly client: ClickHouseClient,
    options: ClickHouseBatchWriterOptions = {}
  ) {
    this.flushIntervalMs = Math.max(1, Math.floor(options.flushIntervalMs ?? 100));
    this.maxRows = Math.max(1, Math.floor(options.maxRows ?? 250));
    this.onError = options.onError;
  }

  private readonly onError?: (table: string, error: unknown, rowCount: number) => void;

  enqueue(table: string, row: unknown): void {
    const state = this.states.get(table) ?? createBatchState();
    if (!this.states.has(table)) {
      this.states.set(table, state);
    }

    state.rows.push(row);

    if (state.rows.length >= this.maxRows) {
      void this.flush(table);
      return;
    }

    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        void this.flush(table);
      }, this.flushIntervalMs);
    }
  }

  async flush(table: string): Promise<void> {
    const state = this.states.get(table);
    if (!state) {
      return;
    }

    if (state.flushing) {
      await state.flushing;
      return;
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.rows.length === 0) {
      return;
    }

    const rows = state.rows.splice(0, state.rows.length);
    state.flushing = this.client
      .insert({
        table,
        values: rows,
        format: "JSONEachRow"
      })
      .catch((error) => {
        this.onError?.(table, error, rows.length);
      })
      .finally(() => {
        state.flushing = null;
      });

    await state.flushing;
  }

  async flushAll(): Promise<void> {
    for (const table of this.states.keys()) {
      await this.flush(table);
    }
  }

  async close(): Promise<void> {
    for (const state of this.states.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }
    await this.flushAll();
  }
}

export const enqueueEquityPrintJoinInsert = (
  writer: ClickHouseBatchWriter,
  join: EquityPrintJoin
): void => {
  writer.enqueue(EQUITY_PRINT_JOINS_TABLE, toEquityPrintJoinRecord(join));
};

export const enqueueInferredDarkInsert = (
  writer: ClickHouseBatchWriter,
  event: InferredDarkEvent
): void => {
  writer.enqueue(INFERRED_DARK_TABLE, toInferredDarkRecord(event));
};

export const enqueueFlowPacketInsert = (
  writer: ClickHouseBatchWriter,
  packet: FlowPacket
): void => {
  writer.enqueue(FLOW_PACKETS_TABLE, toFlowPacketRecord(packet));
};

export const enqueueSmartFlowProjectionInsert = (
  writer: ClickHouseBatchWriter,
  projection: SmartFlowExplainabilityProjection
): void => {
  writer.enqueue(SMART_FLOW_PROJECTIONS_TABLE, toSmartFlowProjectionRecord(projection));
};

export const enqueueSmartFlowAlertInsert = (
  writer: ClickHouseBatchWriter,
  alert: SmartFlowAlertEvent
): void => {
  writer.enqueue(SMART_FLOW_ALERTS_TABLE, toSmartFlowAlertRecord(alert));
};

export const enqueueNewsStoryInsert = (writer: ClickHouseBatchWriter, story: NewsStory): void => {
  writer.enqueue(NEWS_TABLE, toNewsRecord(story));
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

const OPTION_PRINT_QUERY_SETTINGS: ClickHouseQuerySettings = {
  max_execution_time: OPTION_PRINT_QUERY_MAX_EXECUTION_SECONDS
};

const OPTION_PRINT_QUERY_BOUNDS = {
  settings: OPTION_PRINT_QUERY_SETTINGS,
  timeoutMs: OPTION_PRINT_QUERY_TIMEOUT_MS
};

const normalizeOptionPrintTraceLookupIds = (traceIds: string[]): string[] => {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const rawId of traceIds) {
    const id = rawId.trim();
    if (!id || id.length > OPTION_PRINT_TRACE_ID_MAX_LENGTH || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
    if (ids.length >= OPTION_PRINT_TRACE_LOOKUP_MAX_IDS) {
      break;
    }
  }

  return ids;
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

const CANONICAL_SIGNAL_PROFILES = new Set(["smart-flow", "balanced", "all"]);

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
    if (
      record.signal_profile != null &&
      (typeof record.signal_profile !== "string" ||
        !CANONICAL_SIGNAL_PROFILES.has(record.signal_profile))
    ) {
      delete record.signal_profile;
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
  underlyingIds?: string[];
  optionContractId?: string;
  sinceTs?: number;
};

export type EquityPrintQueryFilters = {
  underlyingIds?: string[];
  sinceTs?: number;
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

  if (filters.underlyingIds && filters.underlyingIds.length > 0) {
    conditions.push(`underlying_id IN (${buildStringList(filters.underlyingIds)})`);
  }

  if (filters.optionContractId) {
    conditions.push(`option_contract_id = ${quoteString(filters.optionContractId)}`);
  }

  if (typeof filters.sinceTs === "number" && Number.isFinite(filters.sinceTs)) {
    conditions.push(`ts >= ${clampCursor(filters.sinceTs)}`);
  }

  return conditions;
};

const buildEquityPrintFilterConditions = (filters?: EquityPrintQueryFilters): string[] => {
  const conditions: string[] = [];
  if (!filters) {
    return conditions;
  }
  if (filters.underlyingIds && filters.underlyingIds.length > 0) {
    conditions.push(`underlying_id IN (${buildStringList(filters.underlyingIds)})`);
  }
  if (typeof filters.sinceTs === "number" && Number.isFinite(filters.sinceTs)) {
    conditions.push(`ts >= ${clampCursor(filters.sinceTs)}`);
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
    members: Array.isArray(record.members) ? record.members.map((value) => String(value)) : [],
    features_json: String(record.features_json ?? "{}"),
    join_quality_json: String(record.join_quality_json ?? "{}")
  };
};

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry)) : [];

const normalizeBoolean = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || value === "true";

const normalizeSmartFlowProjectionRow = (row: unknown): SmartFlowProjectionRecord | null => {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  return {
    source_ts: coerceNumber(record.source_ts) as number,
    ingest_ts: coerceNumber(record.ingest_ts) as number,
    seq: coerceNumber(record.seq) as number,
    trace_id: String(record.trace_id ?? ""),
    projection_version: String(record.projection_version ?? ""),
    source_channel: String(record.source_channel ?? ""),
    hypothesis_id: String(record.hypothesis_id ?? ""),
    cluster_id: String(record.cluster_id ?? ""),
    underlying_id: String(record.underlying_id ?? ""),
    candidate_ids: normalizeStringArray(record.candidate_ids),
    evidence_refs: normalizeStringArray(record.evidence_refs),
    abstained: normalizeBoolean(record.abstained),
    projection_json: String(record.projection_json ?? "{}")
  };
};

const normalizeSmartFlowAlertRow = (row: unknown): SmartFlowAlertRecord | null => {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  return {
    source_ts: coerceNumber(record.source_ts) as number,
    ingest_ts: coerceNumber(record.ingest_ts) as number,
    seq: coerceNumber(record.seq) as number,
    trace_id: String(record.trace_id ?? ""),
    schema_version: String(record.schema_version ?? ""),
    alert_id: String(record.alert_id ?? ""),
    hypothesis_id: String(record.hypothesis_id ?? ""),
    insight_id: String(record.insight_id ?? ""),
    underlying_id: String(record.underlying_id ?? ""),
    hypothesis_type: String(record.hypothesis_type ?? ""),
    direction: String(record.direction ?? ""),
    policy_confidence: Number(coerceNumber(record.policy_confidence) ?? 0),
    evidence_quality: Number(coerceNumber(record.evidence_quality) ?? 0),
    trigger_kind: String(record.trigger_kind ?? ""),
    projection_trace_id: String(record.projection_trace_id ?? ""),
    evidence_refs: normalizeStringArray(record.evidence_refs),
    alert_json: String(record.alert_json ?? "{}")
  };
};

const smartFlowAlertEventsFromRows = (rows: unknown[]): SmartFlowAlertEvent[] => {
  const records = rows
    .map(normalizeSmartFlowAlertRow)
    .filter((record): record is SmartFlowAlertRecord => record !== null);
  return SmartFlowAlertEventSchema.array().parse(records.map(fromSmartFlowAlertRecord));
};

const appendSmartFlowAlertBoundaryTies = async (
  client: ClickHouseClient,
  alerts: SmartFlowAlertEvent[],
  limit: number,
  direction: "asc" | "desc"
): Promise<SmartFlowAlertEvent[]> => {
  if (alerts.length < limit) {
    return alerts;
  }

  const boundary = alerts.at(-1);
  if (!boundary) {
    return alerts;
  }

  const order = direction === "asc" ? "ASC" : "DESC";
  const result = await client.query({
    query: `SELECT * FROM ${SMART_FLOW_ALERTS_TABLE} WHERE source_ts = ${boundary.source_ts} AND seq = ${boundary.seq} ORDER BY source_ts ${order}, seq ${order}, alert_id ${order}`,
    format: "JSONEachRow"
  });
  const boundaryTies = smartFlowAlertEventsFromRows(await result.json<unknown[]>());
  const byAlertId = new Map<string, SmartFlowAlertEvent>();

  for (const alert of [...alerts, ...boundaryTies]) {
    byAlertId.set(alert.alert_id, alert);
  }

  return [...byAlertId.values()].sort((left, right) => {
    const timeOrder = right.source_ts - left.source_ts || right.seq - left.seq;
    const alertOrder = right.alert_id.localeCompare(left.alert_id);
    const descending = timeOrder || alertOrder;
    return direction === "asc" ? -descending : descending;
  });
};

const normalizeNewsRow = (row: unknown): NewsRecord | null => {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  return {
    source_ts: coerceNumber(record.source_ts) as number,
    ingest_ts: coerceNumber(record.ingest_ts) as number,
    seq: coerceNumber(record.seq) as number,
    trace_id: String(record.trace_id ?? ""),
    story_id: coerceNumber(record.story_id) as number,
    provider: String(record.provider ?? ""),
    source: String(record.source ?? ""),
    headline: String(record.headline ?? ""),
    summary: String(record.summary ?? ""),
    content_html: String(record.content_html ?? ""),
    url: String(record.url ?? ""),
    published_ts: coerceNumber(record.published_ts) as number,
    updated_ts: coerceNumber(record.updated_ts) as number,
    provider_symbols_json: String(record.provider_symbols_json ?? "[]"),
    resolved_symbols_json: String(record.resolved_symbols_json ?? "[]"),
    symbol_resolution: String(record.symbol_resolution ?? "none") as NewsRecord["symbol_resolution"]
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
    format: "JSONEachRow",
    ...OPTION_PRINT_QUERY_BOUNDS
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
  limit: number,
  filters?: EquityPrintQueryFilters
): Promise<EquityPrint[]> => {
  const safeLimit = clampLimit(limit);
  const conditions = buildEquityPrintFilterConditions(filters);
  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINTS_TABLE}${whereClause} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
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

export const fetchRecentSmartFlowProjections = async (
  client: ClickHouseClient,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${SMART_FLOW_PROJECTIONS_TABLE} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeSmartFlowProjectionRow)
    .filter((record): record is SmartFlowProjectionRecord => record !== null);
  return SmartFlowExplainabilityProjectionSchema.array().parse(
    records.map(fromSmartFlowProjectionRecord)
  );
};

export const fetchRecentSmartFlowAlerts = async (
  client: ClickHouseClient,
  limit: number
): Promise<SmartFlowAlertEvent[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${SMART_FLOW_ALERTS_TABLE} ORDER BY source_ts DESC, seq DESC, alert_id DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return smartFlowAlertEventsFromRows(rows);
};

const latestNewsSelect = `
SELECT
  source_ts,
  ingest_ts,
  seq,
  trace_id,
  story_id,
  provider,
  source,
  headline,
  summary,
  content_html,
  url,
  published_ts,
  updated_ts,
  provider_symbols_json,
  resolved_symbols_json,
  symbol_resolution
FROM (
  SELECT
    *,
    row_number() OVER (PARTITION BY provider, story_id ORDER BY updated_ts DESC, ingest_ts DESC, seq DESC) AS revision_rank
  FROM ${NEWS_TABLE}
)
WHERE revision_rank = 1
`;

export const fetchRecentNews = async (
  client: ClickHouseClient,
  limit: number
): Promise<NewsStory[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `${latestNewsSelect} ORDER BY published_ts DESC, story_id DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeNewsRow)
    .filter((record): record is NewsRecord => record !== null);
  return NewsStorySchema.array().parse(records.map(fromNewsRecord));
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
    format: "JSONEachRow",
    ...OPTION_PRINT_QUERY_BOUNDS
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
  limit: number,
  filters?: EquityPrintQueryFilters
): Promise<EquityPrint[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const conditions = [
    `((ts, seq) > (${safeAfterTs}, ${safeAfterSeq}))`,
    ...buildEquityPrintFilterConditions(filters)
  ];

  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINTS_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
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

export const fetchSmartFlowProjectionsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${SMART_FLOW_PROJECTIONS_TABLE} WHERE (source_ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY source_ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeSmartFlowProjectionRow)
    .filter((record): record is SmartFlowProjectionRecord => record !== null);
  return SmartFlowExplainabilityProjectionSchema.array().parse(
    records.map(fromSmartFlowProjectionRecord)
  );
};

export const fetchSmartFlowAlertsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<SmartFlowAlertEvent[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${SMART_FLOW_ALERTS_TABLE} WHERE (source_ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY source_ts ASC, seq ASC, alert_id ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return appendSmartFlowAlertBoundaryTies(
    client,
    smartFlowAlertEventsFromRows(rows),
    safeLimit,
    "asc"
  );
};

export const fetchNewsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<NewsStory[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);
  const result = await client.query({
    query: `${latestNewsSelect} AND (published_ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY published_ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeNewsRow)
    .filter((record): record is NewsRecord => record !== null);
  return NewsStorySchema.array().parse(records.map(fromNewsRecord));
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
    format: "JSONEachRow",
    ...OPTION_PRINT_QUERY_BOUNDS
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
  limit: number,
  filters?: EquityPrintQueryFilters
): Promise<EquityPrint[]> => {
  const safeLimit = clampLimit(limit);
  const conditions = [
    buildBeforeTupleCondition("ts", "seq", beforeTs, beforeSeq),
    ...buildEquityPrintFilterConditions(filters)
  ];
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_PRINTS_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityPrintSchema.array().parse(rows.map(normalizeEquityRow));
};

export const fetchEquityQuotesBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<EquityQuote[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${EQUITY_QUOTES_TABLE} WHERE ${buildBeforeTupleCondition("ts", "seq", beforeTs, beforeSeq)} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return EquityQuoteSchema.array().parse(rows.map(normalizeEquityQuoteRow));
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

export const fetchSmartFlowProjectionsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${SMART_FLOW_PROJECTIONS_TABLE} WHERE ${buildBeforeTupleCondition("source_ts", "seq", beforeTs, beforeSeq)} ORDER BY source_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeSmartFlowProjectionRow)
    .filter((record): record is SmartFlowProjectionRecord => record !== null);
  return SmartFlowExplainabilityProjectionSchema.array().parse(
    records.map(fromSmartFlowProjectionRecord)
  );
};

export const fetchSmartFlowAlertsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<SmartFlowAlertEvent[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${SMART_FLOW_ALERTS_TABLE} WHERE ${buildBeforeTupleCondition("source_ts", "seq", beforeTs, beforeSeq)} ORDER BY source_ts DESC, seq DESC, alert_id DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return appendSmartFlowAlertBoundaryTies(
    client,
    smartFlowAlertEventsFromRows(rows),
    safeLimit,
    "desc"
  );
};

export const fetchNewsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<NewsStory[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `${latestNewsSelect} AND ${buildBeforeTupleCondition("published_ts", "seq", beforeTs, beforeSeq)} ORDER BY published_ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeNewsRow)
    .filter((record): record is NewsRecord => record !== null);
  return NewsStorySchema.array().parse(records.map(fromNewsRecord));
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

export const fetchFlowPacketsByIds = async (
  client: ClickHouseClient,
  ids: string[]
): Promise<FlowPacket[]> => {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [];
  }
  const result = await client.query({
    query: `SELECT * FROM ${FLOW_PACKETS_TABLE} WHERE id IN (${buildStringList(uniqueIds)}) ORDER BY source_ts DESC, seq DESC LIMIT ${clampLookupLimit(uniqueIds.length)}`,
    format: "JSONEachRow"
  });
  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeFlowPacketRow)
    .filter((record): record is FlowPacketRecord => record !== null);
  return FlowPacketSchema.array().parse(records.map(fromFlowPacketRecord));
};

export const fetchFlowPacketsByMemberTraceIds = async (
  client: ClickHouseClient,
  traceIds: string[]
): Promise<FlowPacket[]> => {
  const ids = Array.from(new Set(traceIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) {
    return [];
  }

  const memberPredicates = ids.map((id) => `has(members, ${quoteString(id)})`);
  const result = await client.query({
    query: `SELECT * FROM ${FLOW_PACKETS_TABLE} WHERE ${memberPredicates.join(" OR ")} ORDER BY source_ts DESC, seq DESC LIMIT ${clampLookupLimit(ids.length * 4)}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeFlowPacketRow)
    .filter((record): record is FlowPacketRecord => record !== null);
  return FlowPacketSchema.array().parse(records.map(fromFlowPacketRecord));
};

export const fetchSmartFlowProjectionsByEvidenceRefs = async (
  client: ClickHouseClient,
  evidenceRefs: string[]
): Promise<SmartFlowExplainabilityProjection[]> => {
  const ids = Array.from(new Set(evidenceRefs.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) {
    return [];
  }

  const result = await client.query({
    query: `SELECT * FROM (SELECT *, arrayJoin(evidence_refs) AS matched_ref FROM ${SMART_FLOW_PROJECTIONS_TABLE} WHERE hasAny(evidence_refs, [${buildStringList(ids)}])) WHERE matched_ref IN (${buildStringList(ids)}) ORDER BY matched_ref ASC, source_ts DESC, seq DESC LIMIT 4 BY matched_ref`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  const records = rows
    .map(normalizeSmartFlowProjectionRow)
    .filter((record): record is SmartFlowProjectionRecord => record !== null);
  const projections = records.map(fromSmartFlowProjectionRecord);
  const byKey = new Map<string, SmartFlowExplainabilityProjection>();
  for (const projection of projections) {
    byKey.set(
      projection.trace_id || projection.refs.event_id || projection.refs.hypothesis_id,
      projection
    );
  }
  return SmartFlowExplainabilityProjectionSchema.array().parse(Array.from(byKey.values()));
};

export const fetchSmartFlowProjectionsByPacketIds = async (
  client: ClickHouseClient,
  packetIds: string[]
): Promise<SmartFlowExplainabilityProjection[]> =>
  fetchSmartFlowProjectionsByEvidenceRefs(client, packetIds);

export const fetchNearestOptionNBBOForPrints = async (
  client: ClickHouseClient,
  inputs: Array<{ trace_id: string; option_contract_id: string; ts: number }>
): Promise<Record<string, OptionNBBO | null>> => {
  const normalized = inputs
    .map((item) => ({
      trace_id: item.trace_id.trim(),
      option_contract_id: item.option_contract_id.trim(),
      ts: clampCursor(item.ts)
    }))
    .filter((item) => item.trace_id && item.option_contract_id);
  if (normalized.length === 0) {
    return {};
  }

  const byTraceId: Record<string, OptionNBBO | null> = Object.fromEntries(
    normalized.map((item) => [item.trace_id, null])
  );
  await Promise.all(
    normalized.map(async (item) => {
      const result = await client.query({
        query: `SELECT * FROM ${OPTION_NBBO_TABLE} WHERE option_contract_id = ${quoteString(item.option_contract_id)} AND ts <= ${item.ts} ORDER BY ts DESC, seq DESC LIMIT 1`,
        format: "JSONEachRow"
      });
      const rows = await result.json<unknown[]>();
      const quote = OptionNBBOSchema.array().parse(rows.map(normalizeOptionNbboRow))[0] ?? null;
      byTraceId[item.trace_id] = quote;
    })
  );
  return byTraceId;
};

export const fetchOptionPrintsByTraceIds = async (
  client: ClickHouseClient,
  traceIds: string[]
): Promise<OptionPrint[]> => {
  const ids = normalizeOptionPrintTraceLookupIds(traceIds);
  if (ids.length === 0) {
    return [];
  }

  const result = await client.query({
    query: `SELECT * FROM ${OPTION_PRINTS_TABLE} WHERE trace_id IN (${buildStringList(ids)}) ORDER BY trace_id ASC, ts DESC, seq DESC LIMIT 1 BY trace_id`,
    format: "JSONEachRow",
    ...OPTION_PRINT_QUERY_BOUNDS
  });

  const rows = await result.json<unknown[]>();
  return OptionPrintSchema.array().parse(rows.map(normalizeOptionRow));
};

export type FlowPacketOptionPrintsPage = {
  packet: FlowPacket | null;
  data: OptionPrint[];
  pinned: OptionPrint | null;
};

const normalizePinnedTraceId = (traceId: string | undefined): string | null => {
  const normalized = traceId?.trim();
  return normalized ? normalized : null;
};

const buildLatestPacketMemberPrintsQuery = ({
  packetId,
  traceIdFilter
}: {
  packetId: string;
  traceIdFilter?: string;
}): string => {
  const packetMembersSubquery = `SELECT arrayJoin(members) FROM (SELECT members FROM ${FLOW_PACKETS_TABLE} WHERE id = ${quoteString(packetId)} ORDER BY source_ts DESC, seq DESC LIMIT 1)`;
  const filters = [`trace_id IN (${packetMembersSubquery})`];
  if (traceIdFilter) {
    filters.push(`trace_id = ${quoteString(traceIdFilter)}`);
  }
  return `SELECT * FROM ${OPTION_PRINTS_TABLE} WHERE ${filters.join(" AND ")} ORDER BY ts DESC, seq DESC LIMIT 1 BY trace_id`;
};

export const fetchOptionPrintsForFlowPacketBefore = async (
  client: ClickHouseClient,
  packetId: string,
  beforeTs: number,
  beforeSeq: number,
  limit: number,
  pinnedTraceId?: string
): Promise<FlowPacketOptionPrintsPage> => {
  const normalizedPacketId = packetId.trim();
  if (!normalizedPacketId) {
    return { packet: null, data: [], pinned: null };
  }

  const packet = await fetchFlowPacketById(client, normalizedPacketId);
  if (!packet || packet.members.length === 0) {
    return { packet, data: [], pinned: null };
  }

  const safeLimit = clampLimit(limit);
  const packetMemberPrintsQuery = buildLatestPacketMemberPrintsQuery({
    packetId: normalizedPacketId
  });
  const result = await client.query({
    query: `SELECT * FROM (${packetMemberPrintsQuery}) WHERE ${buildBeforeTupleCondition("ts", "seq", beforeTs, beforeSeq)} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow",
    ...OPTION_PRINT_QUERY_BOUNDS
  });

  const rows = await result.json<unknown[]>();
  const data = OptionPrintSchema.array().parse(rows.map(normalizeOptionRow));
  const normalizedPinnedTraceId = normalizePinnedTraceId(pinnedTraceId);
  const pinnedFromPage =
    normalizedPinnedTraceId && packet.members.includes(normalizedPinnedTraceId)
      ? (data.find((print) => print.trace_id === normalizedPinnedTraceId) ?? null)
      : null;
  const pinned =
    pinnedFromPage ??
    (normalizedPinnedTraceId && packet.members.includes(normalizedPinnedTraceId)
      ? (OptionPrintSchema.array().parse(
          (
            await (
              await client.query({
                query: `SELECT * FROM (${buildLatestPacketMemberPrintsQuery({
                  packetId: normalizedPacketId,
                  traceIdFilter: normalizedPinnedTraceId
                })}) LIMIT 1`,
                format: "JSONEachRow",
                ...OPTION_PRINT_QUERY_BOUNDS
              })
            ).json<unknown[]>()
          ).map(normalizeOptionRow)
        )[0] ?? null)
      : null);

  return { packet, data, pinned };
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
