import { type ClickHouseClient, fetchFlowPacketsByMemberTraceIds } from "@islandflow/storage";
import type {
  DurableTapeSmartFlowSupport,
  DurableTapeSmartFlowSupportStatus,
  FlowPacket,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { fetchSmartFlowExplainabilityByEvidenceRefs } from "./smart-flow";

export const SMART_FLOW_SUPPORT_MAX_TRACE_IDS = 250;
export const SMART_FLOW_SUPPORT_MAX_PACKET_IDS = 250;
export const SMART_FLOW_SUPPORT_MAX_REFS = 32;
const SMART_FLOW_SUPPORT_CACHE_MAX_ENTRIES = 5_000;
const SMART_FLOW_SUPPORT_POSITIVE_TTL_MS = 60_000;
const SMART_FLOW_SUPPORT_NEGATIVE_TTL_MS = 30_000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

class TtlCache<T> {
  private readonly items = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number
  ) {}

  getEntry(key: string): CacheEntry<T> | undefined {
    const entry = this.items.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.items.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: T, ttlMs: number): void {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return;
    }
    this.items.set(normalized, { value, expiresAt: this.now() + ttlMs });
    this.trim();
  }

  private trim(): void {
    while (this.items.size > this.maxEntries) {
      const oldest = this.items.keys().next().value;
      if (!oldest) {
        return;
      }
      this.items.delete(oldest);
    }
  }
}

export type SmartFlowOptionSupportResolution = {
  packet: FlowPacket | null;
  smart_flow_status: DurableTapeSmartFlowSupportStatus;
  smart_flow_unavailable_reason?: string;
  smart_flow: DurableTapeSmartFlowSupport | null;
};

export type SmartFlowSupportResolverInput = {
  optionTraceIds: string[];
  packetIds?: string[];
  hotPackets?: FlowPacket[];
  hotSmartFlowProjections?: SmartFlowExplainabilityProjection[];
  allowStorageFallback?: boolean;
};

export type SmartFlowSupportResolverResult = {
  supportByTraceId: Map<string, SmartFlowOptionSupportResolution>;
  packets: FlowPacket[];
  smartFlowProjections: SmartFlowExplainabilityProjection[];
  storageLookups: {
    packetTraceIds: string[];
    evidenceRefs: string[];
  };
};

export const resolveSmartFlowSupportFromContext = ({
  optionTraceIds,
  packets,
  projections
}: {
  optionTraceIds: string[];
  packets: readonly FlowPacket[];
  projections: readonly SmartFlowExplainabilityProjection[];
}): Map<string, SmartFlowOptionSupportResolution> => {
  const packetByTraceId = new Map<string, FlowPacket>();
  for (const packet of packets) {
    for (const ref of uniqueNonEmpty([packet.id, packet.trace_id, ...packet.members])) {
      packetByTraceId.set(ref, packet);
    }
  }

  const supportByTraceId = new Map<string, SmartFlowOptionSupportResolution>();
  for (const traceId of uniqueNonEmpty(optionTraceIds, SMART_FLOW_SUPPORT_MAX_TRACE_IDS)) {
    const packet = packetByTraceId.get(traceId) ?? null;
    const refs = new Set(uniqueNonEmpty([traceId, ...packetRefIds(packet)]));
    const candidates = uniqueProjections(
      projections.filter((projection) =>
        getProjectionEvidenceRefs(projection).some((ref) => refs.has(ref))
      )
    );
    supportByTraceId.set(
      traceId,
      resolveTraceSupport({
        optionTraceId: traceId,
        packet,
        projections: candidates,
        sawProjectionContext: projections.length > 0 && candidates.length === 0
      })
    );
  }
  return supportByTraceId;
};

export type SmartFlowSupportResolverDeps = {
  fetchFlowPacketsByMemberTraceIds: (
    client: ClickHouseClient,
    traceIds: string[]
  ) => Promise<FlowPacket[]>;
  fetchSmartFlowExplainabilityByEvidenceRefs: (
    client: ClickHouseClient,
    evidenceRefs: string[]
  ) => Promise<SmartFlowExplainabilityProjection[]>;
};

export type SmartFlowSupportResolverOptions = {
  now?: () => number;
  maxTraceIds?: number;
  maxPacketIds?: number;
  maxCacheEntries?: number;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  deps?: SmartFlowSupportResolverDeps;
};

const defaultDeps: SmartFlowSupportResolverDeps = {
  fetchFlowPacketsByMemberTraceIds,
  fetchSmartFlowExplainabilityByEvidenceRefs
};

const normalizeKey = (value: string | null | undefined): string => value?.trim() ?? "";

const uniqueNonEmpty = (
  items: readonly (string | null | undefined)[],
  limit?: number
): string[] => {
  const values = Array.from(new Set(items.map(normalizeKey).filter(Boolean)));
  return typeof limit === "number" ? values.slice(0, limit) : values;
};

const isFlowPacketRef = (ref: string): boolean => ref.startsWith("flowpacket:");

const getProjectionEvidenceRefs = (projection: SmartFlowExplainabilityProjection): string[] =>
  uniqueNonEmpty([
    ...projection.refs.evidence_refs,
    ...projection.evidence.evidence_refs,
    ...projection.hypothesis.evidence_refs
  ]);

const getProjectionConfidence = (projection: SmartFlowExplainabilityProjection): number =>
  projection.hypothesis.scores.confidence.policy_confidence;

const getProjectionEvidenceQuality = (projection: SmartFlowExplainabilityProjection): number =>
  projection.hypothesis.scores.confidence.evidence_quality;

const compareProjectionForSupport = (
  left: SmartFlowExplainabilityProjection,
  right: SmartFlowExplainabilityProjection
): number => {
  const leftAccepted = !left.abstention.abstained;
  const rightAccepted = !right.abstention.abstained;
  if (leftAccepted !== rightAccepted) {
    return leftAccepted ? 1 : -1;
  }

  return (
    getProjectionConfidence(left) - getProjectionConfidence(right) ||
    getProjectionEvidenceQuality(left) - getProjectionEvidenceQuality(right) ||
    left.source_ts - right.source_ts ||
    left.seq - right.seq
  );
};

const selectBestProjection = (
  projections: SmartFlowExplainabilityProjection[]
): SmartFlowExplainabilityProjection | null => {
  let best: SmartFlowExplainabilityProjection | null = null;
  for (const projection of projections) {
    if (!best || compareProjectionForSupport(projection, best) > 0) {
      best = projection;
    }
  }
  return best;
};

const packetRefIds = (packet: FlowPacket | null | undefined): string[] =>
  packet ? uniqueNonEmpty([packet.id]) : [];

const getMatchSource = (
  projection: SmartFlowExplainabilityProjection,
  optionTraceId: string,
  packet: FlowPacket | null
): "direct_print" | "packet_member" | null => {
  const refs = new Set(getProjectionEvidenceRefs(projection));
  if (refs.has(optionTraceId)) {
    return "direct_print";
  }
  return packetRefIds(packet).some((ref) => refs.has(ref)) ? "packet_member" : null;
};

const toSmartFlowSupport = ({
  projection,
  optionTraceId,
  packet
}: {
  projection: SmartFlowExplainabilityProjection;
  optionTraceId: string;
  packet: FlowPacket | null;
}): DurableTapeSmartFlowSupport | null => {
  const matchSource = getMatchSource(projection, optionTraceId, packet);
  if (!matchSource) {
    return null;
  }

  const evidenceRefs = getProjectionEvidenceRefs(projection);
  const packetRefs = evidenceRefs.filter(isFlowPacketRef);
  const optionPrintRefs = evidenceRefs.filter((ref) => !isFlowPacketRef(ref));
  const confidence = projection.hypothesis.scores.confidence;
  const hypothesisType = projection.hypothesis.hypothesis_type;
  const tintEligible = !projection.abstention.abstained && hypothesisType !== "unclear";

  return {
    status: "matched",
    source_channel: "smart-flow",
    projection_id: projection.refs.event_id,
    projection_trace_id: projection.trace_id,
    packet_id: packet?.id ?? null,
    match_source: matchSource,
    tint_eligible: tintEligible,
    hypothesis_type: hypothesisType,
    direction: projection.hypothesis.direction,
    confidence: confidence.policy_confidence,
    evidence_quality: confidence.evidence_quality,
    abstained: projection.abstention.abstained,
    refs: {
      evidence_refs: evidenceRefs.slice(0, SMART_FLOW_SUPPORT_MAX_REFS),
      packet_refs: packetRefs.slice(0, SMART_FLOW_SUPPORT_MAX_REFS),
      option_print_refs: optionPrintRefs.slice(0, SMART_FLOW_SUPPORT_MAX_REFS)
    },
    counts: {
      evidence_refs: evidenceRefs.length,
      flow_packets: packetRefs.length,
      option_prints: optionPrintRefs.length
    },
    evidence: {
      evidence_refs: evidenceRefs.slice(0, SMART_FLOW_SUPPORT_MAX_REFS),
      evidence_quality: projection.evidence.evidence_quality
    },
    hypothesis: {
      hypothesis_id: projection.refs.hypothesis_id,
      hypothesis_type: hypothesisType,
      direction: projection.hypothesis.direction,
      evidence_refs: evidenceRefs.slice(0, SMART_FLOW_SUPPORT_MAX_REFS),
      scores: {
        confidence: {
          policy_confidence: confidence.policy_confidence,
          evidence_quality: confidence.evidence_quality,
          hypothesis_margin: confidence.hypothesis_margin,
          conviction: confidence.conviction,
          calibration_version: confidence.calibration_version
        }
      }
    },
    abstention: projection.abstention
  };
};

const buildUnavailableResolution = (
  packet: FlowPacket | null,
  status: Exclude<DurableTapeSmartFlowSupportStatus, "matched">,
  reason: string
): SmartFlowOptionSupportResolution => ({
  packet,
  smart_flow_status: status,
  smart_flow_unavailable_reason: reason,
  smart_flow: null
});

const uniqueProjections = (
  projections: readonly SmartFlowExplainabilityProjection[]
): SmartFlowExplainabilityProjection[] => {
  const byKey = new Map<string, SmartFlowExplainabilityProjection>();
  for (const projection of projections) {
    const key = projection.trace_id || projection.refs.event_id || projection.refs.hypothesis_id;
    const existing = byKey.get(key);
    if (!existing || compareProjectionForSupport(projection, existing) > 0) {
      byKey.set(key, projection);
    }
  }
  return Array.from(byKey.values());
};

const resolveTraceSupport = ({
  optionTraceId,
  packet,
  projections,
  sawProjectionContext
}: {
  optionTraceId: string;
  packet: FlowPacket | null;
  projections: SmartFlowExplainabilityProjection[];
  sawProjectionContext: boolean;
}): SmartFlowOptionSupportResolution => {
  const matching = projections.filter((projection) =>
    Boolean(getMatchSource(projection, optionTraceId, packet))
  );
  const best = selectBestProjection(matching);
  if (best) {
    const smartFlow = toSmartFlowSupport({ projection: best, optionTraceId, packet });
    if (smartFlow) {
      return {
        packet,
        smart_flow_status: "matched",
        smart_flow: smartFlow
      };
    }
  }

  if (sawProjectionContext) {
    return buildUnavailableResolution(
      packet,
      "no_matching_projection",
      "smart-flow projections were present, but none referenced this option print or packet"
    );
  }

  if (packet) {
    return buildUnavailableResolution(
      packet,
      "smart_flow_unavailable",
      "no smart-flow projection references the hydrated packet or direct option print"
    );
  }

  return buildUnavailableResolution(
    null,
    "packet_unavailable",
    "no packet membership or direct smart-flow projection is available for this option print"
  );
};

export class SmartFlowSupportResolver {
  private readonly packetByTraceId: TtlCache<FlowPacket | null>;
  private readonly projectionsByEvidenceRef: TtlCache<SmartFlowExplainabilityProjection[]>;
  private readonly deps: SmartFlowSupportResolverDeps;
  private readonly maxTraceIds: number;
  private readonly maxPacketIds: number;
  private readonly positiveTtlMs: number;
  private readonly negativeTtlMs: number;

  constructor(options: SmartFlowSupportResolverOptions = {}) {
    const now = options.now ?? Date.now;
    const maxCacheEntries = options.maxCacheEntries ?? SMART_FLOW_SUPPORT_CACHE_MAX_ENTRIES;
    this.packetByTraceId = new TtlCache(maxCacheEntries, now);
    this.projectionsByEvidenceRef = new TtlCache(maxCacheEntries, now);
    this.deps = options.deps ?? defaultDeps;
    this.maxTraceIds = options.maxTraceIds ?? SMART_FLOW_SUPPORT_MAX_TRACE_IDS;
    this.maxPacketIds = options.maxPacketIds ?? SMART_FLOW_SUPPORT_MAX_PACKET_IDS;
    this.positiveTtlMs = options.positiveTtlMs ?? SMART_FLOW_SUPPORT_POSITIVE_TTL_MS;
    this.negativeTtlMs = options.negativeTtlMs ?? SMART_FLOW_SUPPORT_NEGATIVE_TTL_MS;
  }

  async resolve(
    client: ClickHouseClient,
    input: SmartFlowSupportResolverInput
  ): Promise<SmartFlowSupportResolverResult> {
    const optionTraceIds = uniqueNonEmpty(input.optionTraceIds, this.maxTraceIds);
    const explicitPacketIds = uniqueNonEmpty(input.packetIds ?? [], this.maxPacketIds);
    const allowStorageFallback = input.allowStorageFallback ?? true;

    this.primePackets(input.hotPackets ?? []);
    this.primeProjections(input.hotSmartFlowProjections ?? []);

    const packetLookupTraceIds = optionTraceIds.filter(
      (traceId) => !this.packetByTraceId.getEntry(traceId)
    );
    if (allowStorageFallback && packetLookupTraceIds.length > 0) {
      const fetchedPackets = await this.deps.fetchFlowPacketsByMemberTraceIds(
        client,
        packetLookupTraceIds
      );
      this.primePackets(fetchedPackets);
      for (const traceId of packetLookupTraceIds) {
        if (!this.packetByTraceId.getEntry(traceId)) {
          this.packetByTraceId.set(traceId, null, this.negativeTtlMs);
        }
      }
    }

    const evidenceRefs = new Set<string>([...optionTraceIds, ...explicitPacketIds]);
    for (const traceId of optionTraceIds) {
      const packet = this.packetByTraceId.getEntry(traceId)?.value;
      for (const ref of packetRefIds(packet)) {
        evidenceRefs.add(ref);
      }
    }

    const projectionLookupRefs = Array.from(evidenceRefs)
      .filter((ref) => !this.projectionsByEvidenceRef.getEntry(ref))
      .slice(0, this.maxTraceIds + this.maxPacketIds);
    if (allowStorageFallback && projectionLookupRefs.length > 0) {
      const fetchedProjections = await this.deps.fetchSmartFlowExplainabilityByEvidenceRefs(
        client,
        projectionLookupRefs
      );
      this.cacheFetchedProjections(projectionLookupRefs, fetchedProjections);
    }

    const supportByTraceId = new Map<string, SmartFlowOptionSupportResolution>();
    const packets = new Map<string, FlowPacket>();
    const projections = new Map<string, SmartFlowExplainabilityProjection>();

    for (const traceId of optionTraceIds) {
      const packet = this.packetByTraceId.getEntry(traceId)?.value ?? null;
      if (packet) {
        packets.set(packet.id, packet);
      }

      const refs = uniqueNonEmpty([traceId, ...packetRefIds(packet)]);
      const candidates = uniqueProjections(
        refs.flatMap((ref) => this.projectionsByEvidenceRef.getEntry(ref)?.value ?? [])
      );
      for (const projection of candidates) {
        projections.set(projection.trace_id, projection);
      }

      const sawProjectionContext = input.hotSmartFlowProjections?.length
        ? input.hotSmartFlowProjections.length > 0
        : false;
      supportByTraceId.set(
        traceId,
        resolveTraceSupport({
          optionTraceId: traceId,
          packet,
          projections: candidates,
          sawProjectionContext: sawProjectionContext && candidates.length === 0
        })
      );
    }

    return {
      supportByTraceId,
      packets: Array.from(packets.values()),
      smartFlowProjections: Array.from(projections.values()),
      storageLookups: {
        packetTraceIds: allowStorageFallback ? packetLookupTraceIds : [],
        evidenceRefs: allowStorageFallback ? projectionLookupRefs : []
      }
    };
  }

  private primePackets(packets: readonly FlowPacket[]): void {
    for (const packet of packets) {
      for (const ref of uniqueNonEmpty([packet.id, packet.trace_id, ...packet.members])) {
        this.packetByTraceId.set(ref, packet, this.positiveTtlMs);
      }
    }
  }

  private primeProjections(projections: readonly SmartFlowExplainabilityProjection[]): void {
    for (const projection of projections) {
      for (const ref of getProjectionEvidenceRefs(projection)) {
        const existing = this.projectionsByEvidenceRef.getEntry(ref)?.value ?? [];
        this.projectionsByEvidenceRef.set(
          ref,
          uniqueProjections([...existing, projection]),
          this.positiveTtlMs
        );
      }
    }
  }

  private cacheFetchedProjections(
    requestedRefs: readonly string[],
    projections: readonly SmartFlowExplainabilityProjection[]
  ): void {
    const byRef = new Map<string, SmartFlowExplainabilityProjection[]>();
    for (const ref of requestedRefs) {
      byRef.set(ref, []);
    }

    for (const projection of projections) {
      const evidenceRefs = new Set(getProjectionEvidenceRefs(projection));
      for (const ref of requestedRefs) {
        if (evidenceRefs.has(ref)) {
          byRef.set(ref, [...(byRef.get(ref) ?? []), projection]);
        }
      }
    }

    for (const [ref, items] of byRef) {
      this.projectionsByEvidenceRef.set(
        ref,
        uniqueProjections(items),
        items.length > 0 ? this.positiveTtlMs : this.negativeTtlMs
      );
    }
  }
}

export const createSmartFlowSupportResolver = (
  options?: SmartFlowSupportResolverOptions
): SmartFlowSupportResolver => new SmartFlowSupportResolver(options);

export const defaultSmartFlowSupportResolver = createSmartFlowSupportResolver();
