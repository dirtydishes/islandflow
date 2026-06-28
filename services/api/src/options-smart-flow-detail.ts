import {
  type ClickHouseClient,
  type FlowPacketOptionPrintsPage,
  type OptionPrintQueryFilters,
  fetchFlowPacketById,
  fetchNearestOptionNBBOForPrints,
  fetchOptionPrintsBefore,
  fetchOptionPrintsByTraceIds,
  fetchOptionPrintsForFlowPacketBefore
} from "@islandflow/storage";
import {
  type Cursor,
  type FlowPacket,
  type OptionNBBO,
  type OptionPrint,
  type OptionsSmartFlowTriageDetail,
  OptionsSmartFlowTriageDetailSchema,
  type SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { z } from "zod";
import { composeDurableOptionRows } from "./durable-rows";
import {
  defaultSmartFlowSupportResolver,
  type SmartFlowOptionSupportResolution,
  type SmartFlowSupportResolverInput,
  type SmartFlowSupportResolverResult
} from "./smart-flow-support-resolver";

export const OPTIONS_SMART_FLOW_DETAIL_DEFAULT_ROW_LIMIT = 12;
export const OPTIONS_SMART_FLOW_DETAIL_MAX_ROW_LIMIT = 50;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_CURSOR = Number.MAX_SAFE_INTEGER;

const detailIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL_CHARACTER_PATTERN.test(value), "id contains control characters");

const optionalDetailIdSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}, detailIdSchema.optional());

const rowLimitSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(OPTIONS_SMART_FLOW_DETAIL_MAX_ROW_LIMIT)
  .default(OPTIONS_SMART_FLOW_DETAIL_DEFAULT_ROW_LIMIT);

const cursorValueSchema = z.coerce.number().int().nonnegative().default(MAX_CURSOR);

const optionsSmartFlowDetailQuerySchema = z.object({
  option_trace_id: detailIdSchema,
  projection_trace_id: optionalDetailIdSchema,
  packet_id: optionalDetailIdSchema,
  option_contract_id: optionalDetailIdSchema,
  packet_before_ts: cursorValueSchema,
  packet_before_seq: cursorValueSchema,
  packet_limit: rowLimitSchema,
  contract_before_ts: cursorValueSchema,
  contract_before_seq: cursorValueSchema,
  contract_limit: rowLimitSchema
});

export type OptionsSmartFlowDetailParams = {
  optionTraceId: string;
  projectionTraceId?: string;
  packetId?: string;
  optionContractId?: string;
  packetBefore: Cursor;
  packetLimit: number;
  contractBefore: Cursor;
  contractLimit: number;
};

export type OptionsSmartFlowTriageDetailDeps = {
  resolveSmartFlowSupport: (
    client: ClickHouseClient,
    input: SmartFlowSupportResolverInput
  ) => Promise<SmartFlowSupportResolverResult>;
  fetchFlowPacketById: (client: ClickHouseClient, packetId: string) => Promise<FlowPacket | null>;
  fetchOptionPrintsByTraceIds: (
    client: ClickHouseClient,
    traceIds: string[]
  ) => Promise<OptionPrint[]>;
  fetchOptionPrintsForFlowPacketBefore: (
    client: ClickHouseClient,
    packetId: string,
    beforeTs: number,
    beforeSeq: number,
    limit: number,
    pinnedTraceId?: string
  ) => Promise<FlowPacketOptionPrintsPage>;
  fetchOptionPrintsBefore: (
    client: ClickHouseClient,
    beforeTs: number,
    beforeSeq: number,
    limit: number,
    tracePrefix?: string,
    filters?: OptionPrintQueryFilters
  ) => Promise<OptionPrint[]>;
  fetchNearestOptionNBBOForPrints: (
    client: ClickHouseClient,
    inputs: Array<{ trace_id: string; option_contract_id: string; ts: number }>
  ) => Promise<Record<string, OptionNBBO | null>>;
};

const defaultOptionsSmartFlowTriageDetailDeps: OptionsSmartFlowTriageDetailDeps = {
  resolveSmartFlowSupport: (client, input) =>
    defaultSmartFlowSupportResolver.resolve(client, input),
  fetchFlowPacketById,
  fetchOptionPrintsByTraceIds,
  fetchOptionPrintsForFlowPacketBefore,
  fetchOptionPrintsBefore,
  fetchNearestOptionNBBOForPrints
};

export const parseOptionsSmartFlowDetailParams = (url: URL): OptionsSmartFlowDetailParams => {
  const params = optionsSmartFlowDetailQuerySchema.parse({
    option_trace_id: url.searchParams.get("option_trace_id") ?? undefined,
    projection_trace_id: url.searchParams.get("projection_trace_id") ?? undefined,
    packet_id: url.searchParams.get("packet_id") ?? undefined,
    option_contract_id: url.searchParams.get("option_contract_id") ?? undefined,
    packet_before_ts: url.searchParams.get("packet_before_ts") ?? undefined,
    packet_before_seq: url.searchParams.get("packet_before_seq") ?? undefined,
    packet_limit: url.searchParams.get("packet_limit") ?? undefined,
    contract_before_ts: url.searchParams.get("contract_before_ts") ?? undefined,
    contract_before_seq: url.searchParams.get("contract_before_seq") ?? undefined,
    contract_limit: url.searchParams.get("contract_limit") ?? undefined
  });

  return {
    optionTraceId: params.option_trace_id,
    projectionTraceId: params.projection_trace_id,
    packetId: params.packet_id,
    optionContractId: params.option_contract_id,
    packetBefore: {
      ts: params.packet_before_ts,
      seq: params.packet_before_seq
    },
    packetLimit: params.packet_limit,
    contractBefore: {
      ts: params.contract_before_ts,
      seq: params.contract_before_seq
    },
    contractLimit: params.contract_limit
  };
};

const compactCursorForPrints = (prints: readonly OptionPrint[]): Cursor | null => {
  const last = prints.at(-1);
  return last ? { ts: last.ts, seq: last.seq } : null;
};

const uniqueOptionPrints = (prints: readonly (OptionPrint | null | undefined)[]): OptionPrint[] => {
  const byTraceId = new Map<string, OptionPrint>();
  for (const print of prints) {
    if (!print?.trace_id) {
      continue;
    }
    const existing = byTraceId.get(print.trace_id);
    if (
      !existing ||
      print.ts > existing.ts ||
      (print.ts === existing.ts && print.seq > existing.seq)
    ) {
      byTraceId.set(print.trace_id, print);
    }
  }
  return Array.from(byTraceId.values());
};

const uniqueByPacketId = (packets: readonly (FlowPacket | null | undefined)[]): FlowPacket[] => {
  const byId = new Map<string, FlowPacket>();
  for (const packet of packets) {
    if (packet?.id) {
      byId.set(packet.id, packet);
    }
  }
  return Array.from(byId.values());
};

const uniqueByProjectionTraceId = (
  projections: readonly (SmartFlowExplainabilityProjection | null | undefined)[]
): SmartFlowExplainabilityProjection[] => {
  const byId = new Map<string, SmartFlowExplainabilityProjection>();
  for (const projection of projections) {
    const key = projection?.trace_id || projection?.refs.event_id || projection?.refs.hypothesis_id;
    if (projection && key) {
      byId.set(key, projection);
    }
  }
  return Array.from(byId.values());
};

const projectionConfidence = (projection: SmartFlowExplainabilityProjection): number =>
  projection.hypothesis.scores.confidence.policy_confidence;

const projectionEvidenceQuality = (projection: SmartFlowExplainabilityProjection): number =>
  projection.hypothesis.scores.confidence.evidence_quality;

const compareProjection = (
  left: SmartFlowExplainabilityProjection,
  right: SmartFlowExplainabilityProjection
): number => {
  const leftAccepted = !left.abstention.abstained;
  const rightAccepted = !right.abstention.abstained;
  if (leftAccepted !== rightAccepted) {
    return leftAccepted ? 1 : -1;
  }
  return (
    projectionConfidence(left) - projectionConfidence(right) ||
    projectionEvidenceQuality(left) - projectionEvidenceQuality(right) ||
    left.source_ts - right.source_ts ||
    left.seq - right.seq
  );
};

const selectProjection = ({
  projections,
  requestedTraceId,
  support
}: {
  projections: readonly SmartFlowExplainabilityProjection[];
  requestedTraceId?: string;
  support: SmartFlowOptionSupportResolution | null;
}): SmartFlowExplainabilityProjection | null => {
  const supportTraceId = support?.smart_flow?.projection_trace_id;
  const exact =
    projections.find((projection) => projection.trace_id === requestedTraceId) ??
    projections.find((projection) => projection.trace_id === supportTraceId);
  if (exact) {
    return exact;
  }

  let best: SmartFlowExplainabilityProjection | null = null;
  for (const projection of projections) {
    if (!best || compareProjection(projection, best) > 0) {
      best = projection;
    }
  }
  return best;
};

const getPacketContractId = (packet: FlowPacket | null | undefined): string | undefined => {
  const value = packet?.features.option_contract_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const resolveContractId = ({
  params,
  selectedPrint,
  packet
}: {
  params: OptionsSmartFlowDetailParams;
  selectedPrint: OptionPrint | null;
  packet: FlowPacket | null;
}): string | null =>
  params.optionContractId ??
  selectedPrint?.option_contract_id ??
  getPacketContractId(packet) ??
  null;

const fetchNbboForPrints = async (
  client: ClickHouseClient,
  prints: readonly OptionPrint[],
  deps: OptionsSmartFlowTriageDetailDeps
): Promise<OptionNBBO[]> => {
  if (prints.length === 0) {
    return [];
  }
  const byTraceId = await deps.fetchNearestOptionNBBOForPrints(
    client,
    prints.map((print) => ({
      trace_id: print.trace_id,
      option_contract_id: print.option_contract_id,
      ts: print.ts
    }))
  );
  return Object.values(byTraceId).filter((quote): quote is OptionNBBO => Boolean(quote));
};

const composeRows = async ({
  client,
  prints,
  packets,
  projections,
  deps
}: {
  client: ClickHouseClient;
  prints: readonly OptionPrint[];
  packets: readonly FlowPacket[];
  projections: readonly SmartFlowExplainabilityProjection[];
  deps: OptionsSmartFlowTriageDetailDeps;
}) => {
  const rowsPrints = uniqueOptionPrints(prints);
  if (rowsPrints.length === 0) {
    return [];
  }

  const [nbbo, rowSupport] = await Promise.all([
    fetchNbboForPrints(client, rowsPrints, deps),
    deps.resolveSmartFlowSupport(client, {
      optionTraceIds: rowsPrints.map((print) => print.trace_id),
      hotPackets: packets,
      hotSmartFlowProjections: projections,
      allowStorageFallback: true
    })
  ]);

  return composeDurableOptionRows(rowsPrints, {
    optionPrints: rowsPrints,
    flowPackets: uniqueByPacketId([...packets, ...rowSupport.packets]),
    nbbo,
    smartFlowProjections: uniqueByProjectionTraceId([
      ...projections,
      ...rowSupport.smartFlowProjections
    ]),
    smartFlowSupportByTraceId: rowSupport.supportByTraceId
  });
};

export const lookupOptionsSmartFlowTriageDetail = async (
  client: ClickHouseClient,
  params: OptionsSmartFlowDetailParams,
  deps: OptionsSmartFlowTriageDetailDeps = defaultOptionsSmartFlowTriageDetailDeps
): Promise<OptionsSmartFlowTriageDetail> => {
  const supportResult = await deps.resolveSmartFlowSupport(client, {
    optionTraceIds: [params.optionTraceId],
    packetIds: params.packetId ? [params.packetId] : undefined,
    allowStorageFallback: true
  });
  const support = supportResult.supportByTraceId.get(params.optionTraceId) ?? null;
  const explicitPacket = params.packetId
    ? await deps.fetchFlowPacketById(client, params.packetId)
    : null;
  const packet =
    support?.packet ??
    explicitPacket ??
    (support?.smart_flow?.packet_id
      ? await deps.fetchFlowPacketById(client, support.smart_flow.packet_id)
      : null);

  const projection = selectProjection({
    projections: supportResult.smartFlowProjections,
    requestedTraceId: params.projectionTraceId,
    support
  });

  const selectedPrint =
    (await deps.fetchOptionPrintsByTraceIds(client, [params.optionTraceId]))[0] ?? null;
  const contractId = resolveContractId({ params, selectedPrint, packet });

  const packetPage = packet?.id
    ? await deps.fetchOptionPrintsForFlowPacketBefore(
        client,
        packet.id,
        params.packetBefore.ts,
        params.packetBefore.seq,
        params.packetLimit,
        params.optionTraceId
      )
    : ({ packet: null, data: [], pinned: null } satisfies FlowPacketOptionPrintsPage);
  const packetPrints = uniqueOptionPrints([packetPage.pinned, ...packetPage.data]);

  const contractPagePrints = contractId
    ? await deps.fetchOptionPrintsBefore(
        client,
        params.contractBefore.ts,
        params.contractBefore.seq,
        params.contractLimit,
        undefined,
        { view: "raw", optionContractId: contractId }
      )
    : [];
  const exactContractPrints = uniqueOptionPrints([
    selectedPrint?.option_contract_id === contractId ? selectedPrint : null,
    ...contractPagePrints
  ]);

  const hotPackets = uniqueByPacketId([packet, packetPage.packet, ...supportResult.packets]);
  const hotProjections = uniqueByProjectionTraceId([
    projection,
    ...supportResult.smartFlowProjections
  ]);
  const selectedRows = await composeRows({
    client,
    prints: selectedPrint ? [selectedPrint] : [],
    packets: hotPackets,
    projections: hotProjections,
    deps
  });
  const packetRows = await composeRows({
    client,
    prints: packetPrints,
    packets: hotPackets,
    projections: hotProjections,
    deps
  });
  const contractRows = await composeRows({
    client,
    prints: exactContractPrints,
    packets: hotPackets,
    projections: hotProjections,
    deps
  });

  const detailUnavailableReason =
    projection || support?.smart_flow
      ? null
      : (support?.smart_flow_unavailable_reason ??
        "smart-flow detail is unavailable for this option print");

  return OptionsSmartFlowTriageDetailSchema.parse({
    option_trace_id: params.optionTraceId,
    projection_trace_id:
      projection?.trace_id ??
      support?.smart_flow?.projection_trace_id ??
      params.projectionTraceId ??
      null,
    option_contract_id: contractId,
    support,
    packet,
    projection,
    selected_print: selectedRows[0] ?? null,
    packet_members: {
      rows: packetRows,
      next_before: compactCursorForPrints(packetPage.data),
      limit: params.packetLimit,
      row_count: packetRows.length
    },
    exact_contract: {
      rows: contractRows,
      next_before: compactCursorForPrints(contractPagePrints),
      limit: params.contractLimit,
      row_count: contractRows.length
    },
    missing: {
      projection: !projection,
      packet: !packet,
      selected_print: !selectedPrint
    },
    detail_unavailable_reason: detailUnavailableReason
  });
};
