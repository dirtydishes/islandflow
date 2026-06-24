import {
  type AlertEvent,
  type ClassifierHitEvent,
  type Cursor,
  DurableTapeAlertRowViewModelSchema,
  type DurableTapeAlertRowViewModel,
  type DurableTapeComposedLane,
  DurableTapeOptionRowViewModelSchema,
  type DurableTapeOptionRowViewModel,
  type DurableTapeRowViewModel,
  type FeedSnapshot,
  type FlowPacket,
  type LiveChannel,
  type LiveSubscription,
  matchesOptionPrintFilters,
  type OptionNBBO,
  type OptionPrint,
  type SmartMoneyEvent
} from "@islandflow/types";

const DURABLE_ROW_DEFAULT_LANES: DurableTapeComposedLane[] = ["options", "alerts"];
const DURABLE_ROW_MAX_REFS = 32;
const DURABLE_ROW_MAX_PACKET_MEMBERS = 100;
const DURABLE_ROW_MAX_ALERT_PREVIEW_PRINTS = 3;

export type DurableRowsSubscription = Extract<LiveSubscription, { channel: "durable-rows" }>;

export type DurableRowCompositionContext = {
  alerts: AlertEvent[];
  flowPackets: FlowPacket[];
  optionPrints: OptionPrint[];
  nbbo: OptionNBBO[];
  classifierHits: ClassifierHitEvent[];
  smartMoney: SmartMoneyEvent[];
};

type DurableRowLookups = {
  flowPacketByMemberTraceId: Map<string, FlowPacket>;
  flowPacketById: Map<string, FlowPacket>;
  optionPrintByTraceId: Map<string, OptionPrint>;
  nbboByContractId: Map<string, OptionNBBO>;
  classifierHitsByPacketId: Map<string, ClassifierHitEvent[]>;
  smartMoneyByPacketId: Map<string, SmartMoneyEvent>;
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

const extractPacketIdFromClassifierHitTrace = (traceId: string): string | null => {
  const index = traceId.indexOf("flowpacket:");
  return index >= 0 ? traceId.slice(index) : null;
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
    if (!existing || quote.ts > existing.ts || (quote.ts === existing.ts && quote.seq > existing.seq)) {
      map.set(quote.option_contract_id, quote);
    }
  }
  return map;
};

const buildClassifierHitsByPacketId = (
  hits: ClassifierHitEvent[]
): Map<string, ClassifierHitEvent[]> => {
  const map = new Map<string, ClassifierHitEvent[]>();
  for (const hit of hits) {
    const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
    if (!packetId) {
      continue;
    }
    map.set(packetId, [...(map.get(packetId) ?? []), hit]);
  }
  return map;
};

const buildSmartMoneyByPacketId = (events: SmartMoneyEvent[]): Map<string, SmartMoneyEvent> => {
  const map = new Map<string, SmartMoneyEvent>();
  for (const event of events) {
    for (const packetId of event.packet_ids) {
      const existing = map.get(packetId);
      if (
        !existing ||
        event.source_ts > existing.source_ts ||
        (event.source_ts === existing.source_ts && event.seq > existing.seq)
      ) {
        map.set(packetId, event);
      }
    }
  }
  return map;
};

const buildDurableRowLookups = (context: DurableRowCompositionContext): DurableRowLookups => ({
  flowPacketByMemberTraceId: buildFlowPacketByMemberTraceId(context.flowPackets),
  flowPacketById: buildFlowPacketById(context.flowPackets),
  optionPrintByTraceId: buildOptionPrintByTraceId(context.optionPrints),
  nbboByContractId: buildNbboByContractId(context.nbbo),
  classifierHitsByPacketId: buildClassifierHitsByPacketId(context.classifierHits),
  smartMoneyByPacketId: buildSmartMoneyByPacketId(context.smartMoney)
});

const selectPrimaryClassifierHit = (
  hits: readonly ClassifierHitEvent[]
): ClassifierHitEvent | null =>
  [...hits].sort((left, right) => {
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    return right.source_ts - left.source_ts || right.seq - left.seq;
  })[0] ?? null;

const selectPrimaryAlertHit = (
  hits: readonly AlertEvent["hits"][number][]
): AlertEvent["hits"][number] | null =>
  [...hits].sort((left, right) => right.confidence - left.confidence)[0] ?? null;

const normalizeAlertSeverity = (alert: AlertEvent): "high" | "medium" | "low" => {
  const severity = alert.severity.trim().toLowerCase();
  if (["high", "critical", "severe", "sev1", "p0", "p1"].includes(severity)) {
    return "high";
  }
  if (["medium", "med", "moderate", "sev2", "p2"].includes(severity)) {
    return "medium";
  }
  if (["low", "minor", "info", "informational", "sev3", "p3", "p4"].includes(severity)) {
    return "low";
  }
  if (alert.score >= 80) {
    return "high";
  }
  if (alert.score >= 45) {
    return "medium";
  }
  return "low";
};

const normalizeDirection = (value: string | null | undefined): "bullish" | "bearish" | "neutral" => {
  const normalized = value?.toLowerCase();
  return normalized === "bullish" || normalized === "bearish" || normalized === "neutral"
    ? normalized
    : "neutral";
};

const deriveAlertDirection = (alert: AlertEvent): "bullish" | "bearish" | "neutral" => {
  const totals = {
    bullish: { count: 0, confidence: 0 },
    bearish: { count: 0, confidence: 0 },
    neutral: { count: 0, confidence: 0 }
  };
  for (const hit of alert.hits) {
    const direction = normalizeDirection(hit.direction);
    totals[direction].count += 1;
    totals[direction].confidence += Number.isFinite(hit.confidence) ? hit.confidence : 0;
  }
  const [direction, value] = Object.entries(totals).sort((left, right) => {
    if (right[1].count !== left[1].count) {
      return right[1].count - left[1].count;
    }
    return right[1].confidence - left[1].confidence;
  })[0] as ["bullish" | "bearish" | "neutral", { count: number; confidence: number }];
  return value.count > 0 ? direction : "neutral";
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
  const underlying = (print.underlying_id ?? extractUnderlyingFromContract(print.option_contract_id) ?? "")
    .toUpperCase();
  return subscription.underlying_ids.map((value) => value.toUpperCase()).includes(underlying);
};

const matchesDurableAlertSubscription = (
  row: DurableTapeAlertRowViewModel,
  subscription: DurableRowsSubscription
): boolean => {
  if (!subscription.underlying_ids?.length) {
    return true;
  }
  const symbol = row.symbol?.toUpperCase();
  return Boolean(symbol && subscription.underlying_ids.map((value) => value.toUpperCase()).includes(symbol));
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
  const packet = lookups.flowPacketByMemberTraceId.get(print.trace_id) ?? null;
  const classifier = packet
    ? selectPrimaryClassifierHit(lookups.classifierHitsByPacketId.get(packet.id) ?? [])
    : null;
  const smartMoney = packet ? (lookups.smartMoneyByPacketId.get(packet.id) ?? null) : null;
  const premium = getOptionPremium(print);
  const side = print.execution_nbbo_side ?? print.nbbo_side ?? null;
  const nbbo = resolveOptionNbbo(print, lookups.nbboByContractId);
  const underlying = print.underlying_id ?? extractUnderlyingFromContract(print.option_contract_id) ?? undefined;
  const primarySmartMoneyScore =
    smartMoney?.profile_scores.find((score) => score.profile_id === smartMoney.primary_profile_id) ??
    smartMoney?.profile_scores[0] ??
    null;
  const badges = [
    side
      ? {
          kind: "side",
          label: side,
          tone: side.startsWith("A") ? "bullish" : side.startsWith("B") ? "bearish" : "neutral"
        }
      : null,
    print.signal_pass ? { kind: "signal", label: print.signal_profile ?? "signal", tone: "info" } : null,
    packet ? { kind: "packet", label: `${packet.members.length} prints`, tone: "neutral" } : null,
    smartMoney
      ? {
          kind: "smart-money",
          label: humanizeToken(smartMoney.primary_profile_id),
          tone: smartMoney.abstained ? "neutral" : smartMoney.primary_direction
        }
      : classifier
        ? {
            kind: "classifier",
            label: humanizeToken(classifier.classifier_id),
            tone: normalizeDirection(classifier.direction)
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
      support: smartMoney
        ? humanizeToken(smartMoney.primary_profile_id)
        : classifier
          ? humanizeToken(classifier.classifier_id)
          : packet
            ? "packet"
            : "--"
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
          typeof print.execution_underlying_spot === "number" ? print.execution_underlying_spot : null,
        quote_age_ms: typeof print.execution_nbbo_age_ms === "number" ? print.execution_nbbo_age_ms : null
      },
      nbbo
    },
    support: {
      packet: packetSummary(packet),
      classifier: classifier
        ? {
            trace_id: classifier.trace_id,
            classifier_id: classifier.classifier_id,
            label: humanizeToken(classifier.classifier_id),
            direction: classifier.direction ?? null,
            confidence: Number.isFinite(classifier.confidence) ? classifier.confidence : null,
            explanation: classifier.explanations?.[0] ?? null
          }
        : null,
      smart_money: smartMoney
        ? {
            trace_id: smartMoney.trace_id,
            event_id: smartMoney.event_id,
            profile_id: smartMoney.primary_profile_id ?? null,
            label: humanizeToken(smartMoney.primary_profile_id),
            direction: smartMoney.primary_direction ?? null,
            confidence_band: primarySmartMoneyScore?.confidence_band ?? null,
            probability: primarySmartMoneyScore?.probability ?? null,
            abstained: smartMoney.abstained,
            reasons: primarySmartMoneyScore?.reasons ?? smartMoney.suppressed_reasons ?? []
          }
        : null
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

const buildDurableAlertRow = (
  alert: AlertEvent,
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
    (packetContract ? extractUnderlyingFromContract(packetContract) : null) ??
    firstPreviewPrint?.underlying_id ??
    (firstPreviewPrint ? extractUnderlyingFromContract(firstPreviewPrint.option_contract_id) : null);
  const severity = normalizeAlertSeverity(alert);
  const direction = deriveAlertDirection(alert);
  const topHit = selectPrimaryAlertHit(alert.hits);
  const primaryLabel = humanizeToken(topHit?.classifier_id ?? alert.primary_profile_id);
  const badges = [
    { kind: "severity", label: severity, tone: severity },
    { kind: "direction", label: direction, tone: direction },
    {
      kind: "evidence",
      label: `${alert.evidence_refs.length} refs`,
      tone: missingRefs.length > 0 ? "warning" : "neutral"
    }
  ];

  return DurableTapeAlertRowViewModelSchema.parse({
    id: `alerts:${alert.trace_id}:${alert.seq}`,
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
      score: Math.round(alert.score),
      state: `${severity} / ${direction}`,
      evidence: `${availableRefs.length}/${alert.evidence_refs.length} refs`
    },
    alert: {
      trace_id: alert.trace_id,
      primary_label: primaryLabel,
      primary_profile_id: alert.primary_profile_id ?? null,
      score: alert.score,
      severity,
      direction,
      hit_count: alert.hits.length,
      top_hit: topHit
        ? {
            classifier_id: topHit.classifier_id,
            label: humanizeToken(topHit.classifier_id),
            direction: topHit.direction ?? null,
            confidence: Number.isFinite(topHit.confidence) ? topHit.confidence : null,
            explanation: topHit.explanations?.[0] ?? null
          }
        : null
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
  const lookups = buildDurableRowLookups(context);
  const lanes = durableRowLanesFor(subscription);
  const limit = snapshotLimitForDurableRows(subscription, configuredLimit);
  const rows: DurableTapeRowViewModel[] = [];
  const seen = new Set<string>();
  const push = (row: DurableTapeRowViewModel) => {
    if (seen.has(row.id)) {
      return;
    }
    seen.add(row.id);
    rows.push(row);
  };
  const pushOptionPrint = (print: OptionPrint | null | undefined) => {
    if (!print || !matchesDurableOptionSubscription(print, subscription)) {
      return;
    }
    push(buildDurableOptionRow(print, lookups));
  };
  const pushAlert = (alert: AlertEvent | null | undefined) => {
    if (!alert) {
      return;
    }
    const row = buildDurableAlertRow(alert, lookups);
    if (matchesDurableAlertSubscription(row, subscription)) {
      push(row);
    }
  };

  if (lanes.has("options")) {
    if (channel === "options") {
      pushOptionPrint(item as OptionPrint);
    } else if (channel === "flow") {
      const packet = item as FlowPacket;
      for (const traceId of packet.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS)) {
        pushOptionPrint(lookups.optionPrintByTraceId.get(traceId));
      }
    } else if (channel === "classifier-hits") {
      const hit = item as ClassifierHitEvent;
      const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
      const packet = packetId ? lookups.flowPacketById.get(packetId) : null;
      for (const traceId of packet?.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS) ?? []) {
        pushOptionPrint(lookups.optionPrintByTraceId.get(traceId));
      }
    } else if (channel === "smart-money") {
      const event = item as SmartMoneyEvent;
      for (const packetId of event.packet_ids.slice(0, DURABLE_ROW_MAX_REFS)) {
        const packet = lookups.flowPacketById.get(packetId);
        for (const traceId of packet?.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS) ?? []) {
          pushOptionPrint(lookups.optionPrintByTraceId.get(traceId));
        }
      }
    } else if (channel === "nbbo") {
      const quote = item as OptionNBBO;
      for (const print of context.optionPrints
        .filter((candidate) => candidate.option_contract_id === quote.option_contract_id)
        .slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS)) {
        pushOptionPrint(print);
      }
    }
  }

  if (lanes.has("alerts")) {
    if (channel === "alerts") {
      pushAlert(item as AlertEvent);
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

  return sortDurableRows(rows).slice(0, limit);
};
