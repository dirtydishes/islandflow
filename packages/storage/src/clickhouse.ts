import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  EquityPrintSchema,
  FlowPacketSchema,
  OptionNBBOSchema,
  OptionPrintSchema
} from "@islandflow/types";
import type {
  AlertEvent,
  ClassifierHitEvent,
  EquityPrint,
  FlowPacket,
  OptionNBBO,
  OptionPrint
} from "@islandflow/types";
import {
  normalizeOptionPrint,
  optionPrintsTableDDL,
  OPTION_PRINTS_TABLE
} from "./option-prints";
import { normalizeOptionNBBO, optionNBBOTableDDL, OPTION_NBBO_TABLE } from "./option-nbbo";
import {
  equityPrintsTableDDL,
  EQUITY_PRINTS_TABLE,
  normalizeEquityPrint
} from "./equity-prints";
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

export const fetchRecentOptionNBBO = async (
  client: ClickHouseClient,
  limit: number
): Promise<OptionNBBO[]> => {
  const safeLimit = clampLimit(limit);
  const result = await client.query({
    query: `SELECT * FROM ${OPTION_NBBO_TABLE} ORDER BY ts DESC, seq DESC LIMIT ${safeLimit}`,
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

export const fetchOptionNBBOAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<OptionNBBO[]> => {
  const safeLimit = clampLimit(limit);
  const safeAfterTs = clampCursor(afterTs);
  const safeAfterSeq = clampCursor(afterSeq);

  const result = await client.query({
    query: `SELECT * FROM ${OPTION_NBBO_TABLE} WHERE (ts, seq) > (${safeAfterTs}, ${safeAfterSeq}) ORDER BY ts ASC, seq ASC LIMIT ${safeLimit}`,
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
