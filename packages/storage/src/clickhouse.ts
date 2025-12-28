import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { EquityPrintSchema, OptionPrintSchema } from "@islandflow/types";
import type { EquityPrint, OptionPrint } from "@islandflow/types";
import {
  normalizeOptionPrint,
  optionPrintsTableDDL,
  OPTION_PRINTS_TABLE
} from "./option-prints";
import {
  equityPrintsTableDDL,
  EQUITY_PRINTS_TABLE,
  normalizeEquityPrint
} from "./equity-prints";

export type ClickHouseOptions = {
  url: string;
  database?: string;
  username?: string;
  password?: string;
};

export const createClickHouseClient = (options: ClickHouseOptions): ClickHouseClient => {
  return createClient({
    url: options.url,
    database: options.database,
    username: options.username,
    password: options.password
  });
};

export const ensureOptionPrintsTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: optionPrintsTableDDL()
  });
};

export const ensureEquityPrintsTable = async (
  client: ClickHouseClient
): Promise<void> => {
  await client.exec({
    query: equityPrintsTableDDL()
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

const clampLimit = (limit: number): number => {
  if (!Number.isFinite(limit)) {
    return 100;
  }

  return Math.max(1, Math.min(1000, Math.floor(limit)));
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
    return normalizeNumericFields(row as Record<string, unknown>, [
      "source_ts",
      "ingest_ts",
      "seq",
      "ts",
      "price",
      "size"
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

export const fetchRecentOptionPrints = async (
  client: ClickHouseClient,
  limit: number
): Promise<OptionPrint[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${OPTION_PRINTS_TABLE} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionPrintSchema.array().parse(rows.map(normalizeOptionRow));
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

export const fetchOptionPrintsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<OptionPrint[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${OPTION_PRINTS_TABLE} WHERE (ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
    format: "JSONEachRow"
  });

  const rows = await result.json<unknown[]>();
  return OptionPrintSchema.array().parse(rows.map(normalizeOptionRow));
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
