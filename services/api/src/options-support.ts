import {
  type ClickHouseClient,
  fetchFlowPacketsByMemberTraceIds,
  fetchNearestOptionNBBOForPrints
} from "@islandflow/storage";
import type {
  FlowPacket,
  OptionNBBO,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { fetchSmartFlowExplainabilityByPacketIds } from "./smart-flow";

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
  smart_flow: SmartFlowExplainabilityProjection[];
  nbbo_by_trace_id: Record<string, OptionNBBO | null>;
};

export type OptionsSupportLookupDeps = {
  fetchFlowPacketsByMemberTraceIds: (
    client: ClickHouseClient,
    traceIds: string[]
  ) => Promise<FlowPacket[]>;
  fetchSmartFlowExplainabilityByPacketIds: (
    client: ClickHouseClient,
    packetIds: string[]
  ) => Promise<SmartFlowExplainabilityProjection[]>;
  fetchNearestOptionNBBOForPrints: (
    client: ClickHouseClient,
    inputs: OptionsSupportNbboLookupInput[]
  ) => Promise<Record<string, OptionNBBO | null>>;
};

const defaultOptionsSupportLookupDeps: OptionsSupportLookupDeps = {
  fetchFlowPacketsByMemberTraceIds,
  fetchSmartFlowExplainabilityByPacketIds,
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
  const [smartFlow, nbboByTraceIdResult] = await Promise.all([
    deps.fetchSmartFlowExplainabilityByPacketIds(client, packetIds),
    nbboByTraceIdPromise
  ]);
  if (!nbboByTraceIdResult.ok) {
    throw nbboByTraceIdResult.error;
  }

  return {
    packets,
    smart_flow: smartFlow,
    nbbo_by_trace_id: nbboByTraceIdResult.value
  };
};
