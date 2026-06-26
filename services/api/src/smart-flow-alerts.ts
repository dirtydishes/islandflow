import {
  type ClickHouseClient,
  fetchRecentSmartFlowAlerts,
  fetchSmartFlowAlertsAfter,
  fetchSmartFlowAlertsBefore
} from "@islandflow/storage";
import { type Cursor, type SmartFlowAlertEvent } from "@islandflow/types";

export const smartFlowAlertCursor = (item: SmartFlowAlertEvent): Cursor => ({
  ts: item.source_ts,
  seq: item.seq
});

export const fetchRecentSmartFlowAlertEvents = async (
  client: ClickHouseClient,
  limit: number
): Promise<SmartFlowAlertEvent[]> => fetchRecentSmartFlowAlerts(client, limit);

export const fetchSmartFlowAlertEventsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<SmartFlowAlertEvent[]> => fetchSmartFlowAlertsAfter(client, afterTs, afterSeq, limit);

export const fetchSmartFlowAlertEventsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<SmartFlowAlertEvent[]> => fetchSmartFlowAlertsBefore(client, beforeTs, beforeSeq, limit);
