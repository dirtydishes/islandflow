import {
  smartFlowExplainabilityFromHypothesisEvent,
  type FlowPacket,
  type SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { buildFlowEvidenceClusters, type FlowEvidenceClusterConfig } from "./smart-flow-clusters";
import { buildFlowEvidenceCandidateFromPacket } from "./smart-flow-evidence";
import {
  buildFlowHypothesisEventFromCluster,
  type FlowHypothesisProjectionConfig
} from "./smart-flow-scoring";

export type NativeSmartFlowRuntimeConfig = {
  cluster?: FlowEvidenceClusterConfig;
  projection?: FlowHypothesisProjectionConfig;
};

export const buildNativeSmartFlowProjectionsFromPacket = (
  packet: FlowPacket,
  config: NativeSmartFlowRuntimeConfig = {}
): SmartFlowExplainabilityProjection[] => {
  const extraction = buildFlowEvidenceCandidateFromPacket(packet);
  const { clusters } = buildFlowEvidenceClusters([extraction], {
    windowMs: 60_000,
    includeRejectedCandidates: true,
    ...config.cluster
  });

  return clusters.map((cluster) =>
    smartFlowExplainabilityFromHypothesisEvent(
      buildFlowHypothesisEventFromCluster(cluster, config.projection),
      { source_channel: "smart-flow" }
    )
  );
};
