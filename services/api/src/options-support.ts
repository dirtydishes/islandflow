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
  const packets = await deps.fetchFlowPacketsByMemberTraceIds(client, input.trace_ids);
  const packetIds = packets.map((packet) => packet.id);
  const [smartMoney, classifierHits, nbboByTraceId] = await Promise.all([
    deps.fetchSmartMoneyEventsByPacketIds(client, packetIds),
    deps.fetchClassifierHitsByPacketIds(client, packetIds),
    deps.fetchNearestOptionNBBOForPrints(client, input.nbbo_context)
  ]);

  return {
    packets,
    smart_money: smartMoney,
    smart_flow: projectSmartFlowExplainability(smartMoney),
    classifier_hits: classifierHits,
    nbbo_by_trace_id: nbboByTraceId
  };
};
