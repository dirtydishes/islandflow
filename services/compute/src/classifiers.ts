import type { ClassifierHit, FlowPacket } from "@islandflow/types";

type ParsedContract = {
  root: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
};

export type ClassifierConfig = {
  sweepMinPremium: number;
  sweepMinCount: number;
  spikeMinPremium: number;
  spikeMinSize: number;
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

const parseDashedContract = (value: string): ParsedContract | null => {
  const parts = value.split("-");
  if (parts.length < 6) {
    return null;
  }

  const rightRaw = parts.at(-1) ?? "";
  if (rightRaw !== "C" && rightRaw !== "P") {
    return null;
  }

  const strikeRaw = parts.at(-2) ?? "";
  const strike = Number(strikeRaw);
  const expiryParts = parts.slice(-5, -2);
  const expiry = expiryParts.join("-");
  const root = parts.slice(0, -5).join("-");

  if (!root || !expiry || !Number.isFinite(strike)) {
    return null;
  }

  return {
    root,
    expiry,
    strike,
    right: rightRaw
  };
};

const parseOccContract = (value: string): ParsedContract | null => {
  if (value.length < 15) {
    return null;
  }

  const tail = value.slice(-15);
  const root = value.slice(0, -15).trim();
  const expiryRaw = tail.slice(0, 6);
  const right = tail.slice(6, 7);
  const strikeRaw = tail.slice(7);

  if (!/^\d{6}$/.test(expiryRaw) || !/^\d{8}$/.test(strikeRaw)) {
    return null;
  }

  if (right !== "C" && right !== "P") {
    return null;
  }

  const year = 2000 + Number(expiryRaw.slice(0, 2));
  const month = Number(expiryRaw.slice(2, 4)) - 1;
  const day = Number(expiryRaw.slice(4, 6));
  const expiryDate = new Date(Date.UTC(year, month, day));
  const expiry = expiryDate.toISOString().slice(0, 10);
  const strike = Number(strikeRaw) / 1000;

  if (!root || !Number.isFinite(strike)) {
    return null;
  }

  return {
    root,
    expiry,
    strike,
    right
  };
};

const parseContractId = (value: string | undefined): ParsedContract | null => {
  if (!value) {
    return null;
  }

  return parseDashedContract(value) ?? parseOccContract(value);
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

  if (count < config.sweepMinCount || totalPremium < config.sweepMinPremium) {
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

  confidence = clamp(confidence, 0, 0.95);

  return {
    classifier_id: direction === "bullish" ? "large_bullish_call_sweep" : "large_bearish_put_sweep",
    confidence,
    direction,
    explanations: [
      `Likely ${direction === "bullish" ? "call" : "put"} sweep: ${count} prints in ${Math.round(windowMs)}ms for ${packet.features.option_contract_id ?? packet.id}.`,
      `Premium ${formatUsd(totalPremium)} across ${Math.round(totalSize)} contracts; price ${priceTrend}.`,
      `Thresholds: >=${config.sweepMinCount} prints and >=${formatUsd(config.sweepMinPremium)} premium.`
    ]
  };
};

const buildSpikeHit = (packet: FlowPacket, config: ClassifierConfig): ClassifierHit | null => {
  const count = getNumberFeature(packet, "count");
  const totalPremium = getNumberFeature(packet, "total_premium");
  const totalSize = getNumberFeature(packet, "total_size");
  const windowMs = getNumberFeature(packet, "window_ms");

  if (totalSize < config.spikeMinSize || totalPremium < config.spikeMinPremium) {
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

  confidence = clamp(confidence, 0, 0.9);

  return {
    classifier_id: "unusual_contract_spike",
    confidence,
    direction: "neutral",
    explanations: [
      `Unusual contract spike: ${count} prints in ${Math.round(windowMs)}ms for ${packet.features.option_contract_id ?? packet.id}.`,
      `Premium ${formatUsd(totalPremium)} across ${Math.round(totalSize)} contracts.`,
      `Thresholds: >=${config.spikeMinSize} contracts and >=${formatUsd(config.spikeMinPremium)} premium.`
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
