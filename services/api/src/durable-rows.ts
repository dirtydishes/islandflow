import {
  type Cursor,
  type DurableTapeAlertRowViewModel,
  DurableTapeAlertRowViewModelSchema,
  type DurableTapeComposedLane,
  type DurableTapeOptionRowViewModel,
  DurableTapeOptionRowViewModelSchema,
  type DurableTapeRowViewModel,
  type FeedSnapshot,
  type FlowPacket,
  type LiveChannel,
  type LiveSubscription,
  matchesOptionPrintFilters,
  type OptionNBBO,
  type OptionPrint,
  type SmartFlowAlertEvent,
  type SmartFlowExplainabilityProjection
} from "@islandflow/types";
import {
  resolveSmartFlowSupportFromContext,
  type SmartFlowOptionSupportResolution
} from "./smart-flow-support-resolver";

const DURABLE_ROW_DEFAULT_LANES: DurableTapeComposedLane[] = ["options", "alerts"];
const DURABLE_ROW_MAX_REFS = 32;
const DURABLE_ROW_MAX_PACKET_MEMBERS = 100;
const DURABLE_ROW_MAX_ALERT_PREVIEW_PRINTS = 3;

export type DurableRowsSubscription = Extract<LiveSubscription, { channel: "durable-rows" }>;

export type DurableRowCompositionContext = {
  alerts: SmartFlowAlertEvent[];
  flowPackets: FlowPacket[];
  optionPrints: OptionPrint[];
  nbbo: OptionNBBO[];
  smartFlowProjections: SmartFlowExplainabilityProjection[];
  smartFlowSupportByTraceId?: ReadonlyMap<string, SmartFlowOptionSupportResolution>;
};

type DurableRowLookups = {
  flowPacketByMemberTraceId: Map<string, FlowPacket>;
  flowPacketById: Map<string, FlowPacket>;
  optionPrintByTraceId: Map<string, OptionPrint>;
  nbboByContractId: Map<string, OptionNBBO>;
  smartFlowSupportByTraceId: ReadonlyMap<string, SmartFlowOptionSupportResolution>;
};

const compareCursors = (a: Cursor, b: Cursor): number => b.ts - a.ts || b.seq - a.seq;

const durableRowLanesFor = (subscription: DurableRowsSubscription): Set<DurableTapeComposedLane> =>
  new Set(subscription.lanes?.length ? subscription.lanes : DURABLE_ROW_DEFAULT_LANES);

const getOptionPremium = (print: OptionPrint): number =>
  print.notional ?? print.price * print.size * 100;

const snapshotLimitForDurableRows = (
  subscription: DurableRowsSubscription,
  configuredLimit: number
): number => {
  if (!subscription.snapshot_limit) {
    return configuredLimit;
  }
  return Math.max(1, Math.min(configuredLimit, Math.floor(subscription.snapshot_limit)));
};

const formatCompactMoney = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}m`;
  }
  if (abs >= 1_000) {
    return `$${Math.round(value / 1_000).toLocaleString()}k`;
  }
  return `$${Math.round(value).toLocaleString()}`;
};

const formatPrice = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : "--";

const formatTimeCell = (ts: number): string => new Date(ts).toISOString().slice(11, 19);

const humanizeToken = (value: string | null | undefined): string => {
  if (!value) {
    return "Unknown";
  }
  return value
    .split(/[_:-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

const extractUnderlyingFromContract = (contractId: string): string | null => {
  const match = contractId.match(/^(.+)-\d{4}-\d{2}-\d{2}-/);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }
  const fallback = contractId.split("-")[0]?.trim();
  return fallback ? fallback.toUpperCase() : null;
};

const getPacketContractId = (packet: FlowPacket | null | undefined): string | undefined => {
  const value = packet?.features.option_contract_id;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const match = packet?.id.match(/^flowpacket:([^:]+):/);
  return match?.[1];
};

const buildFlowPacketByMemberTraceId = (packets: FlowPacket[]): Map<string, FlowPacket> => {
  const map = new Map<string, FlowPacket>();
  for (const packet of packets) {
    for (const member of packet.members) {
      map.set(member, packet);
    }
  }
  return map;
};

const buildFlowPacketById = (packets: FlowPacket[]): Map<string, FlowPacket> => {
  const map = new Map<string, FlowPacket>();
  for (const packet of packets) {
    map.set(packet.id, packet);
    if (packet.trace_id) {
      map.set(packet.trace_id, packet);
    }
  }
  return map;
};

const buildOptionPrintByTraceId = (prints: OptionPrint[]): Map<string, OptionPrint> => {
  const map = new Map<string, OptionPrint>();
  for (const print of prints) {
    map.set(print.trace_id, print);
  }
  return map;
};

const buildNbboByContractId = (items: OptionNBBO[]): Map<string, OptionNBBO> => {
  const map = new Map<string, OptionNBBO>();
  for (const quote of items) {
    const existing = map.get(quote.option_contract_id);
    if (
      !existing ||
      quote.ts > existing.ts ||
      (quote.ts === existing.ts && quote.seq > existing.seq)
    ) {
      map.set(quote.option_contract_id, quote);
    }
  }
  return map;
};

const buildDurableRowLookups = (
  context: DurableRowCompositionContext,
  supportTraceIds?: readonly string[]
): DurableRowLookups => ({
  flowPacketByMemberTraceId: buildFlowPacketByMemberTraceId(context.flowPackets),
  flowPacketById: buildFlowPacketById(context.flowPackets),
  optionPrintByTraceId: buildOptionPrintByTraceId(context.optionPrints),
  nbboByContractId: buildNbboByContractId(context.nbbo),
  smartFlowSupportByTraceId:
    context.smartFlowSupportByTraceId ??
    resolveSmartFlowSupportFromContext({
      optionTraceIds: supportTraceIds
        ? [...supportTraceIds]
        : context.optionPrints.map((print) => print.trace_id),
      packets: context.flowPackets,
      projections: context.smartFlowProjections
    })
});

const confidenceBandForAlert = (alert: SmartFlowAlertEvent): "high" | "medium" | "low" => {
  if (alert.policy_confidence >= 0.72) {
    return "high";
  }
  if (alert.policy_confidence >= 0.52) {
    return "medium";
  }
  return "low";
};

const evidenceQualityBandForAlert = (
  alert: SmartFlowAlertEvent
): "strong" | "usable" | "thin" | "poor" => {
  if (alert.evidence_quality >= 0.75) {
    return "strong";
  }
  if (alert.evidence_quality >= 0.55) {
    return "usable";
  }
  if (alert.evidence_quality > 0) {
    return "thin";
  }
  return "poor";
};

const normalizeDirection = (
  value: string | null | undefined
): "bullish" | "bearish" | "neutral" => {
  const normalized = value?.toLowerCase();
  return normalized === "bullish" || normalized === "bearish" || normalized === "neutral"
    ? normalized
    : "neutral";
};

const matchesDurableOptionSubscription = (
  print: OptionPrint,
  subscription: DurableRowsSubscription
): boolean => {
  if (!matchesOptionPrintFilters(print, subscription.filters)) {
    return false;
  }
  if (
    subscription.option_contract_id &&
    subscription.option_contract_id !== print.option_contract_id
  ) {
    return false;
  }
  if (!subscription.underlying_ids?.length) {
    return true;
  }
  const underlying = (
    print.underlying_id ??
    extractUnderlyingFromContract(print.option_contract_id) ??
    ""
  ).toUpperCase();
  return subscription.underlying_ids.map((value) => value.toUpperCase()).includes(underlying);
};

export const wantsDurableOptionRows = (subscription: DurableRowsSubscription): boolean =>
  !subscription.lanes?.length || subscription.lanes.includes("options");

export const selectDurableOptionSnapshotPrints = (
  subscription: DurableRowsSubscription,
  context: DurableRowCompositionContext,
  configuredLimit: number,
  maxOptions: number
): OptionPrint[] => {
  if (!wantsDurableOptionRows(subscription)) {
    return [];
  }
  const limit = Math.min(snapshotLimitForDurableRows(subscription, configuredLimit), maxOptions);
  return context.optionPrints
    .filter((print) => matchesDurableOptionSubscription(print, subscription))
    .slice(0, limit);
};

const matchesDurableAlertSubscription = (
  row: DurableTapeAlertRowViewModel,
  subscription: DurableRowsSubscription
): boolean => {
  if (!subscription.underlying_ids?.length) {
    return true;
  }
  const symbol = row.symbol?.toUpperCase();
  return Boolean(
    symbol && subscription.underlying_ids.map((value) => value.toUpperCase()).includes(symbol)
  );
};

const packetSummary = (packet: FlowPacket | null) => {
  if (!packet) {
    return null;
  }
  const members = packet.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS);
  return {
    id: packet.id,
    trace_id: packet.trace_id,
    option_contract_id: getPacketContractId(packet),
    member_trace_ids: members,
    member_count: packet.members.length,
    ...(members.length < packet.members.length ? { truncated: true } : {})
  };
};

const resolveOptionNbbo = (
  print: OptionPrint,
  nbboByContractId: ReadonlyMap<string, OptionNBBO>
): DurableTapeOptionRowViewModel["option"]["nbbo"] => {
  if (
    typeof print.execution_nbbo_bid === "number" &&
    typeof print.execution_nbbo_ask === "number"
  ) {
    return {
      bid: print.execution_nbbo_bid,
      ask: print.execution_nbbo_ask,
      mid:
        typeof print.execution_nbbo_mid === "number"
          ? print.execution_nbbo_mid
          : (print.execution_nbbo_bid + print.execution_nbbo_ask) / 2,
      spread:
        typeof print.execution_nbbo_spread === "number"
          ? print.execution_nbbo_spread
          : Math.max(0, print.execution_nbbo_ask - print.execution_nbbo_bid),
      source: "print",
      age_ms: typeof print.execution_nbbo_age_ms === "number" ? print.execution_nbbo_age_ms : null
    };
  }

  const quote = nbboByContractId.get(print.option_contract_id);
  if (!quote) {
    return null;
  }
  return {
    bid: quote.bid,
    ask: quote.ask,
    mid: (quote.bid + quote.ask) / 2,
    spread: Math.max(0, quote.ask - quote.bid),
    source: "latest",
    age_ms: Math.max(0, print.ts - quote.ts)
  };
};

const buildDurableOptionRow = (
  print: OptionPrint,
  lookups: DurableRowLookups
): DurableTapeOptionRowViewModel => {
  const resolvedSupport = lookups.smartFlowSupportByTraceId.get(print.trace_id);
  const packet =
    resolvedSupport?.packet ?? lookups.flowPacketByMemberTraceId.get(print.trace_id) ?? null;
  const smartFlow = resolvedSupport?.smart_flow ?? null;
  const smartFlowStatus =
    resolvedSupport?.smart_flow_status ??
    (packet ? "smart_flow_unavailable" : "packet_unavailable");
  const premium = getOptionPremium(print);
  const side = print.execution_nbbo_side ?? print.nbbo_side ?? null;
  const nbbo = resolveOptionNbbo(print, lookups.nbboByContractId);
  const underlying =
    print.underlying_id ?? extractUnderlyingFromContract(print.option_contract_id) ?? undefined;
  const supportLabel = smartFlow
    ? humanizeToken(smartFlow.hypothesis_type)
    : packet
      ? "smart-flow unavailable"
      : "packet unavailable";
  const badges = [
    side
      ? {
          kind: "side",
          label: side,
          tone: side.startsWith("A") ? "bullish" : side.startsWith("B") ? "bearish" : "neutral"
        }
      : null,
    print.signal_pass
      ? { kind: "signal", label: print.signal_profile ?? "signal", tone: "info" }
      : null,
    packet ? { kind: "packet", label: `${packet.members.length} prints`, tone: "neutral" } : null,
    smartFlow
      ? {
          kind: "smart-flow",
          label: humanizeToken(smartFlow.hypothesis_type),
          tone: smartFlow.tint_eligible ? normalizeDirection(smartFlow.direction) : "neutral"
        }
      : packet
        ? {
            kind: "diagnostic",
            label: "smart-flow unavailable",
            tone: "warning"
          }
        : null
  ].filter((badge): badge is NonNullable<typeof badge> => badge !== null);

  return DurableTapeOptionRowViewModelSchema.parse({
    id: `options:${print.trace_id}:${print.seq}`,
    lane: "options",
    source: "server",
    ts: print.ts,
    seq: print.seq,
    source_ts: print.source_ts,
    ingest_ts: print.ingest_ts,
    symbol: underlying,
    cells: {
      time: formatTimeCell(print.ts),
      contract: print.option_contract_id,
      price: formatPrice(print.price),
      size: print.size,
      premium: formatCompactMoney(premium),
      side: side ?? "--",
      nbbo: nbbo ? `${formatPrice(nbbo.bid)} x ${formatPrice(nbbo.ask)}` : "--",
      exchange: print.exchange,
      support: supportLabel
    },
    option: {
      trace_id: print.trace_id,
      option_contract_id: print.option_contract_id,
      underlying_id: underlying,
      option_type: print.option_type,
      price: print.price,
      size: print.size,
      premium,
      side,
      exchange: print.exchange,
      conditions: print.conditions,
      signal: {
        pass: print.signal_pass,
        profile: print.signal_profile,
        reasons: print.signal_reasons
      },
      execution: {
        iv: typeof print.execution_iv === "number" ? print.execution_iv : null,
        underlying_spot:
          typeof print.execution_underlying_spot === "number"
            ? print.execution_underlying_spot
            : null,
        quote_age_ms:
          typeof print.execution_nbbo_age_ms === "number" ? print.execution_nbbo_age_ms : null
      },
      nbbo
    },
    support: {
      packet: packetSummary(packet),
      smart_flow_status: smartFlowStatus,
      ...(resolvedSupport?.smart_flow_unavailable_reason
        ? { smart_flow_unavailable_reason: resolvedSupport.smart_flow_unavailable_reason }
        : {}),
      smart_flow: smartFlow
    },
    badges,
    evidence_summary: {
      label: packet ? `${packet.members.length} packet members` : "No packet context",
      refs: [print.trace_id, ...(packet ? [packet.id] : [])].slice(0, DURABLE_ROW_MAX_REFS),
      available_refs: [print.trace_id, ...(packet ? [packet.id] : [])],
      missing_refs: packet ? [] : [print.trace_id],
      counts: {
        total: packet ? packet.members.length + 1 : 1,
        flow_packets: packet ? 1 : 0,
        option_prints: 1,
        unresolved: packet ? 0 : 1
      }
    },
    drilldown_refs: [print.trace_id, ...(packet ? [packet.id] : [])].slice(0, DURABLE_ROW_MAX_REFS)
  });
};

export const composeDurableOptionRows = (
  prints: readonly OptionPrint[],
  context: Omit<DurableRowCompositionContext, "alerts" | "optionPrints"> & {
    optionPrints?: OptionPrint[];
  }
): DurableTapeOptionRowViewModel[] => {
  const optionPrints = context.optionPrints ?? [...prints];
  const lookups = buildDurableRowLookups({
    alerts: [],
    optionPrints,
    flowPackets: context.flowPackets,
    nbbo: context.nbbo,
    smartFlowProjections: context.smartFlowProjections,
    smartFlowSupportByTraceId: context.smartFlowSupportByTraceId
  });

  return prints.map((print) => buildDurableOptionRow(print, lookups));
};

const buildDurableAlertRow = (
  alert: SmartFlowAlertEvent,
  lookups: DurableRowLookups
): DurableTapeAlertRowViewModel => {
  const flowPacketRefs = alert.evidence_refs.filter((ref) => ref.startsWith("flowpacket:"));
  const optionPrintRefs = alert.evidence_refs.filter((ref) => !ref.startsWith("flowpacket:"));
  const primaryPacket =
    flowPacketRefs.map((ref) => lookups.flowPacketById.get(ref)).find(Boolean) ?? null;
  const previewPrints = optionPrintRefs
    .map((ref) => lookups.optionPrintByTraceId.get(ref))
    .filter((print): print is OptionPrint => Boolean(print))
    .slice(0, DURABLE_ROW_MAX_ALERT_PREVIEW_PRINTS);
  const availableRefs = [
    ...flowPacketRefs.filter((ref) => lookups.flowPacketById.has(ref)),
    ...optionPrintRefs.filter((ref) => lookups.optionPrintByTraceId.has(ref))
  ];
  const missingRefs = alert.evidence_refs.filter((ref) => !availableRefs.includes(ref));
  const packetContract = getPacketContractId(primaryPacket);
  const firstPreviewPrint = previewPrints[0];
  const underlying =
    alert.underlying_id ||
    (packetContract ? extractUnderlyingFromContract(packetContract) : null) ||
    firstPreviewPrint?.underlying_id ||
    (firstPreviewPrint
      ? extractUnderlyingFromContract(firstPreviewPrint.option_contract_id)
      : null);
  const confidenceBand = confidenceBandForAlert(alert);
  const evidenceQualityBand = evidenceQualityBandForAlert(alert);
  const direction = normalizeDirection(alert.direction);
  const primaryLabel = humanizeToken(alert.hypothesis_type);
  const badges = [
    { kind: "confidence", label: confidenceBand, tone: confidenceBand },
    { kind: "direction", label: direction, tone: direction },
    {
      kind: "evidence",
      label: evidenceQualityBand,
      tone: missingRefs.length > 0 ? "warning" : "neutral"
    }
  ];

  return DurableTapeAlertRowViewModelSchema.parse({
    id: `smart-flow-alerts:${alert.alert_id}:${alert.seq}`,
    lane: "alerts",
    source: "server",
    ts: alert.source_ts,
    seq: alert.seq,
    source_ts: alert.source_ts,
    ingest_ts: alert.ingest_ts,
    symbol: underlying ?? undefined,
    cells: {
      time: formatTimeCell(alert.source_ts),
      symbol: underlying ?? "ALERT",
      kind: primaryLabel,
      confidence: `${Math.round(alert.policy_confidence * 100)}%`,
      state: `${confidenceBand} / ${direction}`,
      evidence: `${availableRefs.length}/${alert.evidence_refs.length} refs`
    },
    alert: {
      trace_id: alert.trace_id,
      alert_id: alert.alert_id,
      hypothesis_id: alert.hypothesis_id,
      insight_id: alert.insight_id,
      primary_label: primaryLabel,
      hypothesis_type: alert.hypothesis_type,
      direction,
      policy_confidence: alert.policy_confidence,
      evidence_quality: alert.evidence_quality,
      confidence_band: confidenceBand,
      evidence_quality_band: evidenceQualityBand,
      trigger_kind: alert.trigger.kind,
      projection_trace_id: alert.trigger.projection_trace_id
    },
    evidence: {
      total_refs: alert.evidence_refs.length,
      flow_packet_refs: flowPacketRefs.slice(0, DURABLE_ROW_MAX_REFS),
      option_print_refs: optionPrintRefs.slice(0, DURABLE_ROW_MAX_REFS),
      unresolved_refs: missingRefs.slice(0, DURABLE_ROW_MAX_REFS),
      underlying_id: underlying,
      primary_packet: primaryPacket
        ? {
            id: primaryPacket.id,
            option_contract_id: getPacketContractId(primaryPacket),
            member_trace_ids: primaryPacket.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS),
            member_count: primaryPacket.members.length,
            ...(primaryPacket.members.length > DURABLE_ROW_MAX_PACKET_MEMBERS
              ? { truncated: true }
              : {})
          }
        : null,
      preview_prints: previewPrints.map((print) => ({
        trace_id: print.trace_id,
        option_contract_id: print.option_contract_id,
        ts: print.ts,
        price: print.price,
        size: print.size,
        premium: getOptionPremium(print),
        exchange: print.exchange
      }))
    },
    badges,
    evidence_summary: {
      label: `${availableRefs.length}/${alert.evidence_refs.length} refs available`,
      refs: alert.evidence_refs.slice(0, DURABLE_ROW_MAX_REFS),
      available_refs: availableRefs.slice(0, DURABLE_ROW_MAX_REFS),
      missing_refs: missingRefs.slice(0, DURABLE_ROW_MAX_REFS),
      counts: {
        total: alert.evidence_refs.length,
        flow_packets: flowPacketRefs.length,
        option_prints: optionPrintRefs.length,
        unresolved: missingRefs.length
      }
    },
    drilldown_refs: alert.evidence_refs.slice(0, DURABLE_ROW_MAX_REFS)
  });
};

const sortDurableRows = (rows: DurableTapeRowViewModel[]): DurableTapeRowViewModel[] =>
  [...rows].sort((a, b) => compareCursors({ ts: a.ts, seq: a.seq }, { ts: b.ts, seq: b.seq }));

const nextBeforeForRows = (rows: DurableTapeRowViewModel[]): Cursor | null => {
  const last = rows.at(-1);
  return last ? { ts: last.ts, seq: last.seq } : null;
};

export const composeDurableRowSnapshot = (
  subscription: DurableRowsSubscription,
  context: DurableRowCompositionContext,
  configuredLimit: number
): FeedSnapshot<unknown> => {
  const lookups = buildDurableRowLookups(context);
  const lanes = durableRowLanesFor(subscription);
  const limit = snapshotLimitForDurableRows(subscription, configuredLimit);
  const rows: DurableTapeRowViewModel[] = [];

  if (lanes.has("options")) {
    for (const print of context.optionPrints) {
      if (matchesDurableOptionSubscription(print, subscription)) {
        rows.push(buildDurableOptionRow(print, lookups));
      }
    }
  }

  if (lanes.has("alerts")) {
    for (const alert of context.alerts) {
      const row = buildDurableAlertRow(alert, lookups);
      if (matchesDurableAlertSubscription(row, subscription)) {
        rows.push(row);
      }
    }
  }

  const items = sortDurableRows(rows).slice(0, limit);
  return {
    subscription,
    items,
    watermark: items[0] ? { ts: items[0].ts, seq: items[0].seq } : null,
    next_before: nextBeforeForRows(items)
  };
};

export const composeDurableRowsForEvent = (
  subscription: DurableRowsSubscription,
  channel: LiveChannel,
  item: unknown,
  context: DurableRowCompositionContext,
  configuredLimit: number
): DurableTapeRowViewModel[] => {
  const baseLookups = buildDurableRowLookups(context, []);
  const lanes = durableRowLanesFor(subscription);
  const limit = snapshotLimitForDurableRows(subscription, configuredLimit);
  const rows: DurableTapeRowViewModel[] = [];
  const seen = new Set<string>();
  const candidateOptionPrints: OptionPrint[] = [];
  const seenOptionTraceIds = new Set<string>();
  const push = (row: DurableTapeRowViewModel) => {
    if (seen.has(row.id)) {
      return;
    }
    seen.add(row.id);
    rows.push(row);
  };
  const collectOptionPrint = (print: OptionPrint | null | undefined) => {
    if (!print || !matchesDurableOptionSubscription(print, subscription)) {
      return;
    }
    if (seenOptionTraceIds.has(print.trace_id)) {
      return;
    }
    seenOptionTraceIds.add(print.trace_id);
    candidateOptionPrints.push(print);
  };
  const pushAlert = (alert: SmartFlowAlertEvent | null | undefined) => {
    if (!alert) {
      return;
    }
    const row = buildDurableAlertRow(alert, baseLookups);
    if (matchesDurableAlertSubscription(row, subscription)) {
      push(row);
    }
  };

  if (lanes.has("options")) {
    if (channel === "options") {
      collectOptionPrint(item as OptionPrint);
    } else if (channel === "flow") {
      const packet = item as FlowPacket;
      for (const traceId of packet.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS)) {
        collectOptionPrint(baseLookups.optionPrintByTraceId.get(traceId));
      }
    } else if (channel === "smart-flow") {
      const projection = item as SmartFlowExplainabilityProjection;
      for (const traceId of projection.refs.evidence_refs
        .filter((ref) => !ref.startsWith("flowpacket:"))
        .slice(0, DURABLE_ROW_MAX_REFS)) {
        collectOptionPrint(baseLookups.optionPrintByTraceId.get(traceId));
      }
      for (const packetId of projection.refs.evidence_refs
        .filter((ref) => ref.startsWith("flowpacket:"))
        .slice(0, DURABLE_ROW_MAX_REFS)) {
        const packet = baseLookups.flowPacketById.get(packetId);
        for (const traceId of packet?.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS) ?? []) {
          collectOptionPrint(baseLookups.optionPrintByTraceId.get(traceId));
        }
      }
    } else if (channel === "nbbo") {
      const quote = item as OptionNBBO;
      for (const print of context.optionPrints
        .filter((candidate) => candidate.option_contract_id === quote.option_contract_id)
        .slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS)) {
        collectOptionPrint(print);
      }
    }
  }

  if (lanes.has("alerts")) {
    if (channel === "smart-flow-alerts") {
      pushAlert(item as SmartFlowAlertEvent);
    } else if (channel === "flow") {
      const packet = item as FlowPacket;
      for (const alert of context.alerts) {
        if (alert.evidence_refs.includes(packet.id)) {
          pushAlert(alert);
        }
      }
    } else if (channel === "options") {
      const print = item as OptionPrint;
      for (const alert of context.alerts) {
        if (alert.evidence_refs.includes(print.trace_id)) {
          pushAlert(alert);
        }
      }
    }
  }

  if (candidateOptionPrints.length > 0) {
    const targetedLookups = buildDurableRowLookups(
      {
        ...context,
        optionPrints: candidateOptionPrints
      },
      candidateOptionPrints.map((print) => print.trace_id)
    );
    for (const print of candidateOptionPrints) {
      push(buildDurableOptionRow(print, targetedLookups));
    }
  }

  return sortDurableRows(rows).slice(0, limit);
};
