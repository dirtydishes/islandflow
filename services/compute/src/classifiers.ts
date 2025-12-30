import type { ClassifierHit, FlowPacket } from "@islandflow/types";
import { parseContractId, type ParsedContract } from "./contracts";

export type ClassifierConfig = {
  sweepMinPremium: number;
  sweepMinCount: number;
  sweepMinPremiumZ: number;
  spikeMinPremium: number;
  spikeMinSize: number;
  spikeMinPremiumZ: number;
  spikeMinSizeZ: number;
  zMinSamples: number;
};

const clamp = (value: number, min = 0, max = 1): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const formatUsd = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "$0";
  }
  return `$${value.toFixed(2)}`;
};

const getNumberFeature = (packet: FlowPacket, key: string): number => {
  const value = packet.features[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const buildSweepHit = (
  packet: FlowPacket,
  contract: ParsedContract,
  direction: "bullish" | "bearish",
  config: ClassifierConfig
): ClassifierHit | null => {
  const count = getNumberFeature(packet, "count");
  const totalPremium = getNumberFeature(packet, "total_premium");
  const totalSize = getNumberFeature(packet, "total_size");
  const firstPrice = getNumberFeature(packet, "first_price");
  const lastPrice = getNumberFeature(packet, "last_price");
  const windowMs = getNumberFeature(packet, "window_ms");
  const premiumZ = getNumberFeature(packet, "total_premium_z");
  const premiumBaseline = getNumberFeature(packet, "total_premium_baseline_n");

  const baselineReady = premiumBaseline >= config.zMinSamples;
  const passesAbsolute = totalPremium >= config.sweepMinPremium;
  const passesZ = baselineReady && premiumZ >= config.sweepMinPremiumZ;

  if (count < config.sweepMinCount || (!passesAbsolute && !passesZ)) {
    return null;
  }

  const priceDelta = lastPrice - firstPrice;
  const priceTrend = priceDelta >= 0 ? "up" : "down";

  let confidence = 0.55;
  if (priceDelta >= 0) {
    confidence += 0.1;
  }
  if (count >= config.sweepMinCount + 2) {
    confidence += 0.1;
  }
  if (totalPremium >= config.sweepMinPremium * 2) {
    confidence += 0.15;
  }
  if (passesZ) {
    confidence += 0.1;
    if (premiumZ >= config.sweepMinPremiumZ + 1) {
      confidence += 0.05;
    }
  }

  confidence = clamp(confidence, 0, 0.95);

  const baselineNote = baselineReady
    ? `Baseline premium z-score ${premiumZ.toFixed(2)} over ${Math.round(premiumBaseline)} samples.`
    : "Baseline premium z-score unavailable.";

  return {
    classifier_id: direction === "bullish" ? "large_bullish_call_sweep" : "large_bearish_put_sweep",
    confidence,
    direction,
    explanations: [
      `Likely ${direction === "bullish" ? "call" : "put"} sweep: ${count} prints in ${Math.round(windowMs)}ms for ${packet.features.option_contract_id ?? packet.id}.`,
      `Premium ${formatUsd(totalPremium)} across ${Math.round(totalSize)} contracts; price ${priceTrend}.`,
      `Thresholds: >=${config.sweepMinCount} prints and >=${formatUsd(config.sweepMinPremium)} premium or z>=${config.sweepMinPremiumZ.toFixed(1)}.`,
      baselineNote
    ]
  };
};

const buildSpikeHit = (packet: FlowPacket, config: ClassifierConfig): ClassifierHit | null => {
  const count = getNumberFeature(packet, "count");
  const totalPremium = getNumberFeature(packet, "total_premium");
  const totalSize = getNumberFeature(packet, "total_size");
  const windowMs = getNumberFeature(packet, "window_ms");
  const premiumZ = getNumberFeature(packet, "total_premium_z");
  const sizeZ = getNumberFeature(packet, "total_size_z");
  const premiumBaseline = getNumberFeature(packet, "total_premium_baseline_n");
  const sizeBaseline = getNumberFeature(packet, "total_size_baseline_n");

  const premiumBaselineReady = premiumBaseline >= config.zMinSamples;
  const sizeBaselineReady = sizeBaseline >= config.zMinSamples;
  const passesAbsolute = totalSize >= config.spikeMinSize && totalPremium >= config.spikeMinPremium;
  const passesZ =
    (premiumBaselineReady && premiumZ >= config.spikeMinPremiumZ) ||
    (sizeBaselineReady && sizeZ >= config.spikeMinSizeZ);

  if (!passesAbsolute && !passesZ) {
    return null;
  }

  let confidence = 0.5;
  if (totalSize >= config.spikeMinSize * 2) {
    confidence += 0.15;
  }
  if (totalPremium >= config.spikeMinPremium * 2) {
    confidence += 0.15;
  }
  if (count >= 3) {
    confidence += 0.1;
  }
  if (passesZ) {
    confidence += 0.1;
    if (premiumZ >= config.spikeMinPremiumZ + 1 || sizeZ >= config.spikeMinSizeZ + 1) {
      confidence += 0.05;
    }
  }

  confidence = clamp(confidence, 0, 0.9);

  const baselineNote =
    premiumBaselineReady || sizeBaselineReady
      ? `Baseline z-scores: premium ${premiumZ.toFixed(2)}, size ${sizeZ.toFixed(2)}.`
      : "Baseline z-scores unavailable.";

  return {
    classifier_id: "unusual_contract_spike",
    confidence,
    direction: "neutral",
    explanations: [
      `Unusual contract spike: ${count} prints in ${Math.round(windowMs)}ms for ${packet.features.option_contract_id ?? packet.id}.`,
      `Premium ${formatUsd(totalPremium)} across ${Math.round(totalSize)} contracts.`,
      `Thresholds: >=${config.spikeMinSize} contracts and >=${formatUsd(config.spikeMinPremium)} premium or z>=${config.spikeMinPremiumZ.toFixed(1)}.`,
      baselineNote
    ]
  };
};

export const evaluateClassifiers = (
  packet: FlowPacket,
  config: ClassifierConfig
): ClassifierHit[] => {
  const contractId = typeof packet.features.option_contract_id === "string"
    ? packet.features.option_contract_id
    : "";
  const contract = parseContractId(contractId);
  const hits: ClassifierHit[] = [];

  if (contract?.right === "C") {
    const hit = buildSweepHit(packet, contract, "bullish", config);
    if (hit) {
      hits.push(hit);
    }
  }

  if (contract?.right === "P") {
    const hit = buildSweepHit(packet, contract, "bearish", config);
    if (hit) {
      hits.push(hit);
    }
  }

  const spikeHit = buildSpikeHit(packet, config);
  if (spikeHit) {
    hits.push(spikeHit);
  }

  return hits;
};
