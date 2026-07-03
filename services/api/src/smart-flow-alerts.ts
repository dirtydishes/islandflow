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

const normalizeAdapterName = (value: string | undefined): string =>
  value?.trim().toLowerCase() || "synthetic";

export const shouldHideSyntheticSmartFlowAlerts = (): boolean =>
  normalizeAdapterName(process.env.OPTIONS_INGEST_ADAPTER) !== "synthetic" ||
  normalizeAdapterName(process.env.EQUITIES_INGEST_ADAPTER) !== "synthetic";

export const hasSyntheticEvidenceRef = (alert: Pick<SmartFlowAlertEvent, "evidence_refs">) =>
  alert.evidence_refs.some((ref) => ref.startsWith("synthetic-"));

export const shouldSurfaceSmartFlowAlert = (
  alert: Pick<SmartFlowAlertEvent, "evidence_refs">
): boolean => !shouldHideSyntheticSmartFlowAlerts() || !hasSyntheticEvidenceRef(alert);

export const filterSmartFlowAlertsForRuntime = (
  alerts: SmartFlowAlertEvent[]
): SmartFlowAlertEvent[] => alerts.filter(shouldSurfaceSmartFlowAlert);

const recentStorageLimitForRuntime = (limit: number): number =>
  shouldHideSyntheticSmartFlowAlerts() ? Math.min(Math.max(limit * 5, limit), 1_000) : limit;

export const fetchRecentSmartFlowAlertEvents = async (
  client: ClickHouseClient,
  limit: number
): Promise<SmartFlowAlertEvent[]> =>
  filterSmartFlowAlertsForRuntime(
    await fetchRecentSmartFlowAlerts(client, recentStorageLimitForRuntime(limit))
  ).slice(0, limit);

export const fetchSmartFlowAlertEventsAfter = async (
  client: ClickHouseClient,
  afterTs: number,
  afterSeq: number,
  limit: number
): Promise<SmartFlowAlertEvent[]> =>
  filterSmartFlowAlertsForRuntime(await fetchSmartFlowAlertsAfter(client, afterTs, afterSeq, limit));

export const fetchSmartFlowAlertEventsBefore = async (
  client: ClickHouseClient,
  beforeTs: number,
  beforeSeq: number,
  limit: number
): Promise<SmartFlowAlertEvent[]> =>
  filterSmartFlowAlertsForRuntime(
    await fetchSmartFlowAlertsBefore(client, beforeTs, beforeSeq, limit)
  );
