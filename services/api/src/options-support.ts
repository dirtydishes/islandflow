import {
  type ClickHouseClient,
  fetchClassifierHitsByPacketIds,
  fetchFlowPacketsByMemberTraceIds,
  fetchNearestOptionNBBOForPrints,
  fetchSmartMoneyEventsByPacketIds
} from "@islandflow/storage";
import type {
  ClassifierHitEvent,
  FlowPacket,
  OptionNBBO,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";
import { projectSmartFlowExplainability } from "./smart-flow";

export type OptionsSupportNbboLookupInput = {
  trace_id: string;
  option_contract_id: string;
  ts: number;
};

export type OptionsSupportLookupInput = {
  trace_ids: string[];
  nbbo_context: OptionsSupportNbboLookupInput[];
};

export type OptionsSupportLookupPayload = {
  packets: FlowPacket[];
  smart_money: SmartMoneyEvent[];
  smart_flow: SmartFlowExplainabilityProjection[];
  classifier_hits: ClassifierHitEvent[];
  nbbo_by_trace_id: Record<string, OptionNBBO | null>;
};

export type OptionsSupportLookupDeps = {
  fetchFlowPacketsByMemberTraceIds: (
    client: ClickHouseClient,
    traceIds: string[]
  ) => Promise<FlowPacket[]>;
  fetchSmartMoneyEventsByPacketIds: (
    client: ClickHouseClient,
    packetIds: string[]
  ) => Promise<SmartMoneyEvent[]>;
  fetchClassifierHitsByPacketIds: (
    client: ClickHouseClient,
    packetIds: string[]
  ) => Promise<ClassifierHitEvent[]>;
  fetchNearestOptionNBBOForPrints: (
    client: ClickHouseClient,
    inputs: OptionsSupportNbboLookupInput[]
  ) => Promise<Record<string, OptionNBBO | null>>;
};

const defaultOptionsSupportLookupDeps: OptionsSupportLookupDeps = {
  fetchFlowPacketsByMemberTraceIds,
  fetchSmartMoneyEventsByPacketIds,
  fetchClassifierHitsByPacketIds,
  fetchNearestOptionNBBOForPrints
};

export const lookupOptionsSupport = async (
  client: ClickHouseClient,
  input: OptionsSupportLookupInput,
  deps: OptionsSupportLookupDeps = defaultOptionsSupportLookupDeps
): Promise<OptionsSupportLookupPayload> => {
  const packetsPromise = deps.fetchFlowPacketsByMemberTraceIds(client, input.trace_ids);
  const nbboByTraceIdPromise = deps
    .fetchNearestOptionNBBOForPrints(client, input.nbbo_context)
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
  const packets = await packetsPromise;
  const packetIds = packets.map((packet) => packet.id);
  const [smartMoney, classifierHits, nbboByTraceIdResult] = await Promise.all([
    deps.fetchSmartMoneyEventsByPacketIds(client, packetIds),
    deps.fetchClassifierHitsByPacketIds(client, packetIds),
    nbboByTraceIdPromise
  ]);
  if (!nbboByTraceIdResult.ok) {
    throw nbboByTraceIdResult.error;
  }

  return {
    packets,
    smart_money: smartMoney,
    smart_flow: projectSmartFlowExplainability(smartMoney),
    classifier_hits: classifierHits,
    nbbo_by_trace_id: nbboByTraceIdResult.value
  };
};
