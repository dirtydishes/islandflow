import type {
  FlowPacket,
  OptionNBBO,
  OptionPrint,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";

import type {
  DurableTapeCursor,
  DurableTapeHistoryPage,
  DurableTapeSource,
  DurableTapeSubscription
} from "../durable-tape/types";
import type {
  OptionSupportNbboContext,
  OptionSupportRequest
} from "../terminal/hydration-scheduler";

export const OPTIONS_TAPE_SUPPORT_BATCH_LIMIT = 250;
export const OPTIONS_TAPE_SUPPORT_CACHE_LIMIT = 2_000;

export type OptionsTapeSupportRequestContext = {
  smartFlowContextByTraceId?: ReadonlyMap<string, unknown>;
  nbboByTraceId?: ReadonlyMap<string, OptionNBBO | null>;
  traceLimit?: number;
  nbboLimit?: number;
};

export type OptionsTapeSupportPacketMaps = {
  flowPacketById: ReadonlyMap<string, FlowPacket>;
  flowPacketByTraceId: ReadonlyMap<string, FlowPacket>;
  packetIdByOptionTraceId: ReadonlyMap<string, string>;
};

const hasPreservedNbbo = (print: OptionPrint): boolean =>
  typeof print.execution_nbbo_side === "string" ||
  typeof print.nbbo_side === "string" ||
  (typeof print.execution_nbbo_bid === "number" && typeof print.execution_nbbo_ask === "number");

export const buildOptionsTapeSupportRequest = (
  prints: readonly OptionPrint[],
  context: OptionsTapeSupportRequestContext = {}
): OptionSupportRequest => {
  const traceLimit = context.traceLimit ?? OPTIONS_TAPE_SUPPORT_BATCH_LIMIT;
  const nbboLimit = context.nbboLimit ?? OPTIONS_TAPE_SUPPORT_BATCH_LIMIT;
  const traceIds = new Set<string>();
  const nbboContext = new Map<string, OptionSupportNbboContext>();

  for (const print of prints) {
    const traceId = print.trace_id?.trim() ?? "";
    if (!traceId) {
      continue;
    }

    if (
      traceIds.size < traceLimit &&
      !context.smartFlowContextByTraceId?.has(traceId)
    ) {
      traceIds.add(traceId);
    }

    if (
      nbboContext.size < nbboLimit &&
      !hasPreservedNbbo(print) &&
      !context.nbboByTraceId?.has(traceId)
    ) {
      nbboContext.set(traceId, {
        trace_id: traceId,
        option_contract_id: print.option_contract_id,
        ts: print.ts
      });
    }

    if (traceIds.size >= traceLimit && nbboContext.size >= nbboLimit) {
      break;
    }
  }

  return {
    traceIds: Array.from(traceIds),
    nbboContext: Array.from(nbboContext.values())
  };
};

export const buildOptionsTapeSupportPacketMaps = (
  packets: readonly FlowPacket[]
): OptionsTapeSupportPacketMaps => {
  const flowPacketById = new Map<string, FlowPacket>();
  const flowPacketByTraceId = new Map<string, FlowPacket>();
  const packetIdByOptionTraceId = new Map<string, string>();

  for (const packet of packets) {
    if (packet.id) {
      flowPacketById.set(packet.id, packet);
    }
    if (packet.trace_id) {
      flowPacketById.set(packet.trace_id, packet);
      flowPacketByTraceId.set(packet.trace_id, packet);
    }
    for (const member of packet.members ?? []) {
      flowPacketByTraceId.set(member, packet);
      packetIdByOptionTraceId.set(member, packet.id);
    }
  }

  return { flowPacketById, flowPacketByTraceId, packetIdByOptionTraceId };
};

const getProjectionKey = (projection: SmartFlowExplainabilityProjection): string =>
  projection.trace_id || projection.refs.event_id || projection.refs.hypothesis_id;

export const mergeOptionsTapeSmartFlowProjections = (
  current: readonly SmartFlowExplainabilityProjection[],
  incoming: readonly SmartFlowExplainabilityProjection[],
  limit = OPTIONS_TAPE_SUPPORT_CACHE_LIMIT
): SmartFlowExplainabilityProjection[] => {
  const byKey = new Map<string, SmartFlowExplainabilityProjection>();
  for (const projection of [...current, ...incoming]) {
    const key = getProjectionKey(projection);
    const existing = byKey.get(key);
    if (
      !existing ||
      projection.source_ts > existing.source_ts ||
      (projection.source_ts === existing.source_ts && projection.seq >= existing.seq)
    ) {
      byKey.set(key, projection);
    }
  }
  return Array.from(byKey.values())
    .sort((left, right) => right.source_ts - left.source_ts || right.seq - left.seq)
    .slice(0, limit);
};

export const mergeOptionsTapeSupportPackets = (
  current: readonly FlowPacket[],
  incoming: readonly FlowPacket[],
  limit = OPTIONS_TAPE_SUPPORT_CACHE_LIMIT
): FlowPacket[] => {
  const byKey = new Map<string, FlowPacket>();
  for (const packet of [...current, ...incoming]) {
    if (!packet.id) {
      continue;
    }
    byKey.set(packet.id, packet);
  }
  return Array.from(byKey.values())
    .sort((left, right) => right.source_ts - left.source_ts || right.seq - left.seq)
    .slice(0, limit);
};

export const createOptionsTapeSupportHydratingSource = <
  TScope,
  TFilters
>(
  source: DurableTapeSource<OptionPrint, TScope, TFilters>,
  hydrateRows: (rows: readonly OptionPrint[]) => void
): DurableTapeSource<OptionPrint, TScope, TFilters> => {
  const hydrate = (rows: readonly OptionPrint[] | undefined): void => {
    if (rows && rows.length > 0) {
      hydrateRows(rows);
    }
  };

  return {
    subscribe: (input): DurableTapeSubscription<OptionPrint> => {
      const subscription = source.subscribe(input);
      const getSnapshot = subscription.getSnapshot;
      const listen = subscription.listen;
      return {
        getSnapshot: getSnapshot
          ? () => {
              const snapshot = getSnapshot();
              hydrate(snapshot);
              return snapshot;
            }
          : undefined,
        listen: listen
          ? (listener) =>
              listen((items) => {
                hydrate(items);
                listener(items);
              })
          : undefined,
        unsubscribe: () => subscription.unsubscribe()
      };
    },
    getInitialHistoryCursor: source.getInitialHistoryCursor
      ? (input) => source.getInitialHistoryCursor?.(input)
      : undefined,
    loadOlder: async (
      cursor: DurableTapeCursor,
      input
    ): Promise<DurableTapeHistoryPage<OptionPrint>> => {
      const page = await source.loadOlder(cursor, input);
      hydrate(page.items);
      return page;
    }
  };
};
