import {
  type ClickHouseClient,
  fetchRecentSmartMoneyEvents,
  fetchSmartMoneyEventsAfter,
  fetchSmartMoneyEventsBefore,
  fetchSmartMoneyEventsByPacketIds
} from "@islandflow/storage";
import {
  type Cursor,
  type SmartFlowExplainabilityProjection,
  type SmartMoneyEvent,
  smartFlowExplainabilityFromLegacySmartMoneyEvent
} from "@islandflow/types";

export const smartFlowCursor = (item: SmartFlowExplainabilityProjection): Cursor => ({
  ts: item.source_ts,
  seq: item.seq
});

export const projectSmartFlowExplainability = (
  events: readonly SmartMoneyEvent[]
): SmartFlowExplainabilityProjection[] =>
  events.map((event) => smartFlowExplainabilityFromLegacySmartMoneyEvent(event));

export const fetchRecentSmartFlowExplainability = async (
  client: ClickHouseClient,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> =>
  projectSmartFlowExplainability(await fetchRecentSmartMoneyEvents(client, limit));

export const fetchSmartFlowExplainabilityAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> =>
  projectSmartFlowExplainability(
    await fetchSmartMoneyEventsAfter(client, afterTs, afterSeq, limit)
  );

export const fetchSmartFlowExplainabilityBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> =>
  projectSmartFlowExplainability(
    await fetchSmartMoneyEventsBefore(client, beforeTs, beforeSeq, limit)
  );

export const fetchSmartFlowExplainabilityByPacketIds = async (
  client: ClickHouseClient,
  packetIds: string[]
): Promise<SmartFlowExplainabilityProjection[]> =>
  projectSmartFlowExplainability(await fetchSmartMoneyEventsByPacketIds(client, packetIds));
