import { type ClickHouseClient, fetchNearestOptionNBBOForPrints } from "@islandflow/storage";
import type { FlowPacket, OptionNBBO, SmartFlowExplainabilityProjection } from "@islandflow/types";
import {
  defaultSmartFlowSupportResolver,
  type SmartFlowOptionSupportResolution,
  type SmartFlowSupportResolverInput,
  type SmartFlowSupportResolverResult
} from "./smart-flow-support-resolver";

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
  support_by_trace_id: Record<string, SmartFlowOptionSupportResolution>;
  nbbo_by_trace_id: Record<string, OptionNBBO | null>;
};

export type OptionsSupportLookupDeps = {
  resolveSmartFlowSupport: (
    client: ClickHouseClient,
    input: SmartFlowSupportResolverInput
  ) => Promise<SmartFlowSupportResolverResult>;
  fetchNearestOptionNBBOForPrints: (
    client: ClickHouseClient,
    inputs: OptionsSupportNbboLookupInput[]
  ) => Promise<Record<string, OptionNBBO | null>>;
};

const defaultOptionsSupportLookupDeps: OptionsSupportLookupDeps = {
  resolveSmartFlowSupport: (client, input) =>
    defaultSmartFlowSupportResolver.resolve(client, input),
  fetchNearestOptionNBBOForPrints
};

export const lookupOptionsSupport = async (
  client: ClickHouseClient,
  input: OptionsSupportLookupInput,
  deps: OptionsSupportLookupDeps = defaultOptionsSupportLookupDeps
): Promise<OptionsSupportLookupPayload> => {
  const smartFlowSupportPromise = deps.resolveSmartFlowSupport(client, {
    optionTraceIds: input.trace_ids,
    allowStorageFallback: true
  });
  const nbboByTraceIdPromise = deps
    .fetchNearestOptionNBBOForPrints(client, input.nbbo_context)
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
  const [smartFlowSupport, nbboByTraceIdResult] = await Promise.all([
    smartFlowSupportPromise,
    nbboByTraceIdPromise
  ]);
  if (!nbboByTraceIdResult.ok) {
    throw nbboByTraceIdResult.error;
  }

  return {
    packets: smartFlowSupport.packets,
    smart_flow: smartFlowSupport.smartFlowProjections,
    support_by_trace_id: Object.fromEntries(smartFlowSupport.supportByTraceId),
    nbbo_by_trace_id: nbboByTraceIdResult.value
  };
};
