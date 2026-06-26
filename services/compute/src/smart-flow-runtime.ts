import {
  smartFlowExplainabilityFromHypothesisEvent,
  type FlowPacket,
  type SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { buildFlowEvidenceClusters, type FlowEvidenceClusterConfig } from "./smart-flow-clusters";
import {
  buildFlowEvidenceCandidateFromPacket,
  type FlowEvidenceCandidateExtraction
} from "./smart-flow-evidence";
import {
  buildFlowHypothesisEventFromCluster,
  type FlowHypothesisProjectionConfig
} from "./smart-flow-scoring";

export type NativeSmartFlowRuntimeConfig = {
  cluster?: FlowEvidenceClusterConfig;
  projection?: FlowHypothesisProjectionConfig;
};

export type NativeSmartFlowProjectionFlush = {
  projections: SmartFlowExplainabilityProjection[];
  commit(): void;
};

const DEFAULT_NATIVE_SMART_FLOW_WINDOW_MS = 60_000;

const resolveWindowMs = (config: NativeSmartFlowRuntimeConfig): number =>
  Math.max(1, Math.round(config.cluster?.windowMs ?? DEFAULT_NATIVE_SMART_FLOW_WINDOW_MS));

const windowStartFor = (ts: number, windowMs: number): number =>
  Math.floor(ts / windowMs) * windowMs;

const windowEndFor = (ts: number, windowMs: number): number =>
  windowStartFor(ts, windowMs) + windowMs;

const buildNativeSmartFlowProjectionsFromExtractions = (
  extractions: FlowEvidenceCandidateExtraction[],
  config: NativeSmartFlowRuntimeConfig = {}
): SmartFlowExplainabilityProjection[] => {
  const { clusters } = buildFlowEvidenceClusters(extractions, {
    windowMs: DEFAULT_NATIVE_SMART_FLOW_WINDOW_MS,
    includeRejectedCandidates: true,
    ...config.cluster
  });

  return clusters.map((cluster) =>
    smartFlowExplainabilityFromHypothesisEvent(
      buildFlowHypothesisEventFromCluster(cluster, config.projection)
    )
  );
};

export const buildNativeSmartFlowProjectionsFromPackets = (
  packets: readonly FlowPacket[],
  config: NativeSmartFlowRuntimeConfig = {}
): SmartFlowExplainabilityProjection[] =>
  buildNativeSmartFlowProjectionsFromExtractions(
    packets.map((packet) => buildFlowEvidenceCandidateFromPacket(packet)),
    config
  );

export const buildNativeSmartFlowProjectionsFromPacket = (
  packet: FlowPacket,
  config: NativeSmartFlowRuntimeConfig = {}
): SmartFlowExplainabilityProjection[] =>
  buildNativeSmartFlowProjectionsFromPackets([packet], config);

export class NativeSmartFlowRuntime {
  private readonly pending = new Map<string, FlowEvidenceCandidateExtraction>();
  private readonly windowMs: number;

  constructor(private readonly config: NativeSmartFlowRuntimeConfig = {}) {
    this.windowMs = resolveWindowMs(config);
  }

  ingest(packet: FlowPacket): NativeSmartFlowProjectionFlush {
    const extraction = buildFlowEvidenceCandidateFromPacket(packet);
    this.pending.set(extraction.candidate.candidate_id, extraction);
    return this.collectReady(extraction.candidate.observed_at_ts);
  }

  collectReady(upToTs: number): NativeSmartFlowProjectionFlush {
    const cutoffTs = windowStartFor(upToTs, this.windowMs);
    return this.collect((extraction) => {
      return windowEndFor(extraction.candidate.observed_at_ts, this.windowMs) <= cutoffTs;
    });
  }

  collectAll(): NativeSmartFlowProjectionFlush {
    return this.collect(() => true);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private collect(
    isReady: (extraction: FlowEvidenceCandidateExtraction) => boolean
  ): NativeSmartFlowProjectionFlush {
    const ready = [...this.pending.values()].filter(isReady);
    const candidateIds = new Set(ready.map((extraction) => extraction.candidate.candidate_id));
    const projections =
      ready.length > 0 ? buildNativeSmartFlowProjectionsFromExtractions(ready, this.config) : [];

    return {
      projections,
      commit: () => {
        for (const candidateId of candidateIds) {
          this.pending.delete(candidateId);
        }
      }
    };
  }
}
