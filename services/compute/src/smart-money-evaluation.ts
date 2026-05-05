import type { FlowPacket, SmartMoneyDirection, SmartMoneyEvent, SmartMoneyProfileId } from "@islandflow/types";
import { buildSmartMoneyEventFromPacket, type SmartMoneyParentEventOptions } from "./parent-events";

export type SmartMoneyLabel = {
  event_id: string;
  profile_id: SmartMoneyProfileId | null;
  direction?: Exclude<SmartMoneyDirection, "unknown">;
  realized_return_bps?: number;
};

export type ReplayConsistencyMismatch = {
  event_id: string;
  field: "missing_live" | "missing_batch" | "signature";
  live?: SmartMoneyEventSignature;
  batch?: SmartMoneyEventSignature;
};

export type ReplayConsistencyReport = {
  live_count: number;
  batch_count: number;
  matched_count: number;
  mismatches: ReplayConsistencyMismatch[];
  consistent: boolean;
};

export type SmartMoneyEventSignature = {
  event_id: string;
  primary_profile_id: SmartMoneyProfileId | null;
  primary_direction: SmartMoneyDirection;
  abstained: boolean;
  suppressed_reasons: string[];
  profile_scores: Array<{
    profile_id: SmartMoneyProfileId;
    probability: number;
    confidence_band: SmartMoneyEvent["profile_scores"][number]["confidence_band"];
    direction: SmartMoneyDirection;
  }>;
};

export type CalibrationBucket = {
  min_probability: number;
  max_probability: number;
  count: number;
  average_probability: number;
  accuracy: number | null;
};

export type SmartMoneyEvaluationReport = {
  sample_count: number;
  labeled_count: number;
  emitted_count: number;
  abstained_count: number;
  abstention_rate: number;
  profile_precision: Partial<Record<SmartMoneyProfileId, number | null>>;
  profile_recall: Partial<Record<SmartMoneyProfileId, number | null>>;
  calibration: CalibrationBucket[];
  economic_sanity: {
    directional_count: number;
    direction_hit_rate: number | null;
    average_signed_return_bps: number | null;
  };
};

const PROFILES: SmartMoneyProfileId[] = [
  "institutional_directional",
  "retail_whale",
  "event_driven",
  "vol_seller",
  "arbitrage",
  "hedge_reactive"
];

const directionalSign = (direction: SmartMoneyDirection): number => {
  if (direction === "bullish") {
    return 1;
  }
  if (direction === "bearish") {
    return -1;
  }
  return 0;
};

const round = (value: number, digits = 4): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
};

export const smartMoneyEventSignature = (event: SmartMoneyEvent): SmartMoneyEventSignature => ({
  event_id: event.event_id,
  primary_profile_id: event.primary_profile_id,
  primary_direction: event.primary_direction,
  abstained: event.abstained,
  suppressed_reasons: [...event.suppressed_reasons].sort(),
  profile_scores: event.profile_scores.map((entry) => ({
    profile_id: entry.profile_id,
    probability: round(entry.probability, 6),
    confidence_band: entry.confidence_band,
    direction: entry.direction
  }))
});

export const buildSmartMoneyEventsForReplay = (
  packets: FlowPacket[],
  optionsByPacketId: Record<string, SmartMoneyParentEventOptions | undefined> = {}
): SmartMoneyEvent[] => {
  return packets
    .slice()
    .sort((a, b) => a.source_ts - b.source_ts || a.seq - b.seq || a.id.localeCompare(b.id))
    .map((packet) => buildSmartMoneyEventFromPacket(packet, optionsByPacketId[packet.id]));
};

export const compareSmartMoneyReplayOutputs = (
  liveEvents: SmartMoneyEvent[],
  batchEvents: SmartMoneyEvent[]
): ReplayConsistencyReport => {
  const liveById = new Map(liveEvents.map((event) => [event.event_id, smartMoneyEventSignature(event)]));
  const batchById = new Map(batchEvents.map((event) => [event.event_id, smartMoneyEventSignature(event)]));
  const ids = [...new Set([...liveById.keys(), ...batchById.keys()])].sort();
  const mismatches: ReplayConsistencyMismatch[] = [];

  for (const id of ids) {
    const live = liveById.get(id);
    const batch = batchById.get(id);
    if (!live) {
      mismatches.push({ event_id: id, field: "missing_live", batch });
      continue;
    }
    if (!batch) {
      mismatches.push({ event_id: id, field: "missing_batch", live });
      continue;
    }
    if (JSON.stringify(live) !== JSON.stringify(batch)) {
      mismatches.push({ event_id: id, field: "signature", live, batch });
    }
  }

  return {
    live_count: liveEvents.length,
    batch_count: batchEvents.length,
    matched_count: ids.length - mismatches.length,
    mismatches,
    consistent: mismatches.length === 0
  };
};

export const evaluateSmartMoneyEvents = (
  events: SmartMoneyEvent[],
  labels: SmartMoneyLabel[],
  bucketCount = 5
): SmartMoneyEvaluationReport => {
  const labelsById = new Map(labels.map((label) => [label.event_id, label]));
  const labeledEvents = events
    .map((event) => ({ event, label: labelsById.get(event.event_id) }))
    .filter((entry): entry is { event: SmartMoneyEvent; label: SmartMoneyLabel } => Boolean(entry.label));

  const emitted = events.filter((event) => !event.abstained && event.primary_profile_id);
  const profilePrecision: SmartMoneyEvaluationReport["profile_precision"] = {};
  const profileRecall: SmartMoneyEvaluationReport["profile_recall"] = {};

  for (const profile of PROFILES) {
    const predicted = labeledEvents.filter((entry) => entry.event.primary_profile_id === profile);
    const actual = labeledEvents.filter((entry) => entry.label.profile_id === profile);
    const truePositive = predicted.filter((entry) => entry.label.profile_id === profile).length;
    profilePrecision[profile] = predicted.length > 0 ? round(truePositive / predicted.length) : null;
    profileRecall[profile] = actual.length > 0 ? round(truePositive / actual.length) : null;
  }

  const calibration = buildCalibration(labeledEvents, Math.max(1, Math.floor(bucketCount)));
  const economic = buildEconomicSanity(labeledEvents);

  return {
    sample_count: events.length,
    labeled_count: labeledEvents.length,
    emitted_count: emitted.length,
    abstained_count: events.filter((event) => event.abstained).length,
    abstention_rate: events.length > 0 ? round(events.filter((event) => event.abstained).length / events.length) : 0,
    profile_precision: profilePrecision,
    profile_recall: profileRecall,
    calibration,
    economic_sanity: economic
  };
};

const buildCalibration = (
  entries: Array<{ event: SmartMoneyEvent; label: SmartMoneyLabel }>,
  bucketCount: number
): CalibrationBucket[] => {
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    min_probability: round(index / bucketCount),
    max_probability: round((index + 1) / bucketCount),
    probabilities: [] as number[],
    correct: 0
  }));

  for (const { event, label } of entries) {
    const probability = event.profile_scores.find((entry) => entry.profile_id === event.primary_profile_id)?.probability ?? 0;
    const index = Math.min(bucketCount - 1, Math.floor(probability * bucketCount));
    buckets[index].probabilities.push(probability);
    if (!event.abstained && event.primary_profile_id === label.profile_id) {
      buckets[index].correct += 1;
    }
  }

  return buckets.map((bucket) => ({
    min_probability: bucket.min_probability,
    max_probability: bucket.max_probability,
    count: bucket.probabilities.length,
    average_probability:
      bucket.probabilities.length > 0
        ? round(bucket.probabilities.reduce((sum, value) => sum + value, 0) / bucket.probabilities.length)
        : 0,
    accuracy: bucket.probabilities.length > 0 ? round(bucket.correct / bucket.probabilities.length) : null
  }));
};

const buildEconomicSanity = (
  entries: Array<{ event: SmartMoneyEvent; label: SmartMoneyLabel }>
): SmartMoneyEvaluationReport["economic_sanity"] => {
  const directional = entries
    .map(({ event, label }) => ({
      sign: directionalSign(event.primary_direction),
      realized: label.realized_return_bps
    }))
    .filter((entry): entry is { sign: number; realized: number } => entry.sign !== 0 && Number.isFinite(entry.realized));

  if (directional.length === 0) {
    return {
      directional_count: 0,
      direction_hit_rate: null,
      average_signed_return_bps: null
    };
  }

  const signedReturns = directional.map((entry) => entry.sign * entry.realized);
  return {
    directional_count: directional.length,
    direction_hit_rate: round(signedReturns.filter((value) => value > 0).length / directional.length),
    average_signed_return_bps: round(signedReturns.reduce((sum, value) => sum + value, 0) / signedReturns.length, 2)
  };
};
