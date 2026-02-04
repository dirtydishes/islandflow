import type { ClassifierHitEvent, FlowPacket } from "@islandflow/types";

export const scoreAlert = (
  packet: FlowPacket,
  hits: ClassifierHitEvent[]
): { score: number; severity: string } => {
  const premium =
    typeof packet.features.total_premium === "number" ? packet.features.total_premium : 0;
  const premiumScore = Math.min(70, Math.round(premium / 1000));
  const maxConfidence = hits.reduce((max, hit) => Math.max(max, hit.confidence), 0);
  const confidenceScore = Math.round(maxConfidence * 20);
  const hitScore = Math.min(20, hits.length * 5);
  const score = Math.max(0, Math.min(100, premiumScore + confidenceScore + hitScore));
  const severity = score >= 80 ? "high" : score >= 45 ? "medium" : "low";
  return { score, severity };
};

