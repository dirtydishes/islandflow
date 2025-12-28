import { createClient, type ClickHouseClient } from "@clickhouse/client";
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
