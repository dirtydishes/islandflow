import {
  type ClickHouseClient,
  fetchRecentSmartFlowProjections,
  fetchSmartFlowProjectionsAfter,
  fetchSmartFlowProjectionsBefore,
  fetchSmartFlowProjectionsByPacketIds
} from "@islandflow/storage";
import { type Cursor, type SmartFlowExplainabilityProjection } from "@islandflow/types";

export const smartFlowCursor = (item: SmartFlowExplainabilityProjection): Cursor => ({
  ts: item.source_ts,
  seq: item.seq
});

export const fetchRecentSmartFlowExplainability = async (
  client: ClickHouseClient,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> => fetchRecentSmartFlowProjections(client, limit);

export const fetchSmartFlowExplainabilityAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> =>
  fetchSmartFlowProjectionsAfter(client, afterTs, afterSeq, limit);

export const fetchSmartFlowExplainabilityBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<SmartFlowExplainabilityProjection[]> =>
  fetchSmartFlowProjectionsBefore(client, beforeTs, beforeSeq, limit);

export const fetchSmartFlowExplainabilityByPacketIds = async (
  client: ClickHouseClient,
  packetIds: string[]
): Promise<SmartFlowExplainabilityProjection[]> =>
  fetchSmartFlowProjectionsByPacketIds(client, packetIds);
