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
  minNbboCoverage: number;
  minAggressorRatio: number;
  zeroDteMaxAtmPct: number;
  zeroDteMinPremium: number;
  zeroDteMinSize: number;
};

const MS_PER_DAY = 86_400_000;

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

const getStringFeature = (packet: FlowPacket, key: string): string => {
  const value = packet.features[key];
  return typeof value === "string" ? value : "";
};

const formatPct = (value: number): string => `${Math.round(value * 100)}%`;

const formatPctPrecise = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${(value * 100).toFixed(digits)}%`;
};

const getAggressorContext = (
  packet: FlowPacket
): {
  coverage: number;
  aggressiveBuyRatio: number;
  aggressiveSellRatio: number;
  aggressiveRatio: number;
} => {
  return {
    coverage: getNumberFeature(packet, "nbbo_coverage_ratio"),
    aggressiveBuyRatio: getNumberFeature(packet, "nbbo_aggressive_buy_ratio"),
    aggressiveSellRatio: getNumberFeature(packet, "nbbo_aggressive_sell_ratio"),
    aggressiveRatio: getNumberFeature(packet, "nbbo_aggressive_ratio")
  };
};

const applyAggressorAdjustment = (
  confidence: number,
  coverage: number,
  aggressiveRatio: number,
  config: ClassifierConfig
): { confidence: number; note: string } => {
  if (!Number.isFinite(coverage) || coverage <= 0) {
    return { confidence, note: "Aggressor mix unavailable (no NBBO coverage)." };
  }

  let adjusted = confidence;
  if (coverage >= config.minNbboCoverage) {
    if (aggressiveRatio >= config.minAggressorRatio) {
      adjusted += 0.05;
    } else {
      adjusted -= 0.1;
    }
  }

  const note = `Aggressor mix ${formatPct(aggressiveRatio)} aggressive, NBBO coverage ${formatPct(
    coverage
  )}.`;

  return { confidence: adjusted, note };
};

type LargeActivity = {
  count: number;
  totalPremium: number;
  totalSize: number;
  windowMs: number;
  premiumZ: number;
  sizeZ: number;
  premiumBaselineReady: boolean;
  sizeBaselineReady: boolean;
  passesAbsolute: boolean;
  passesZ: boolean;
  baselineNote: string;
};

const getLargeActivity = (packet: FlowPacket, config: ClassifierConfig): LargeActivity => {
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

  const baselineNote =
    premiumBaselineReady || sizeBaselineReady
      ? `Baseline z-scores: premium ${premiumZ.toFixed(2)}, size ${sizeZ.toFixed(2)}.`
      : "Baseline z-scores unavailable.";

  return {
    count,
    totalPremium,
    totalSize,
    windowMs,
    premiumZ,
    sizeZ,
    premiumBaselineReady,
    sizeBaselineReady,
    passesAbsolute,
    passesZ,
    baselineNote
  };
};

const applySideAggressorAdjustment = (
  confidence: number,
  coverage: number,
  ratio: number,
  config: ClassifierConfig,
  label: string
): { confidence: number; note: string } => {
  const normalizedCoverage = clamp(coverage, 0, 1);
  const normalizedRatio = clamp(ratio, 0, 1);
  let adjusted = confidence;

  if (normalizedCoverage <= 0) {
    return {
      confidence: adjusted - 0.15,
      note: "Aggressor mix unavailable (no NBBO coverage)."
    };
  }

  if (normalizedCoverage < config.minNbboCoverage) {
    adjusted -= 0.1;
  }

  if (normalizedRatio >= config.minAggressorRatio) {
    adjusted += 0.05;
  } else {
    adjusted -= 0.1;
  }

  const note = `Aggressor mix ${formatPct(normalizedRatio)} ${label}, NBBO coverage ${formatPct(
    normalizedCoverage
  )}.`;

  return { confidence: adjusted, note };
};

const getReferenceTs = (packet: FlowPacket): number | null => {
  const endTs = getNumberFeature(packet, "end_ts");
  if (endTs > 0) {
    return endTs;
  }

  if (Number.isFinite(packet.source_ts) && packet.source_ts > 0) {
    return packet.source_ts;
  }

  return null;
};

const getReferenceDay = (packet: FlowPacket): string | null => {
  const referenceTs = getReferenceTs(packet);
  if (!referenceTs) {
    return null;
  }
  return new Date(referenceTs).toISOString().slice(0, 10);
};

const getDteDays = (packet: FlowPacket, contract: ParsedContract): number | null => {
  const expiryTs = Date.parse(`${contract.expiry}T00:00:00Z`);
  if (!Number.isFinite(expiryTs)) {
    return null;
  }

  const referenceTs = getReferenceTs(packet);
  if (!referenceTs) {
    return null;
  }

  const diffMs = expiryTs - referenceTs;
  if (diffMs < 0) {
    return null;
  }

  return Math.ceil(diffMs / MS_PER_DAY);
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
  const coverage = getNumberFeature(packet, "nbbo_coverage_ratio");
  const aggressiveBuyRatio = getNumberFeature(packet, "nbbo_aggressive_buy_ratio");
  const aggressiveSellRatio = getNumberFeature(packet, "nbbo_aggressive_sell_ratio");
  const aggressiveRatio = Math.max(aggressiveBuyRatio, aggressiveSellRatio);

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

  const aggressor = applyAggressorAdjustment(confidence, coverage, aggressiveRatio, config);
  confidence = clamp(aggressor.confidence, 0, 0.95);

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
      baselineNote,
      aggressor.note
    ]
  };
};

const buildSpikeHit = (packet: FlowPacket, config: ClassifierConfig): ClassifierHit | null => {
  const activity = getLargeActivity(packet, config);
  const { coverage, aggressiveBuyRatio, aggressiveSellRatio } = getAggressorContext(packet);
  const aggressiveRatio = Math.max(aggressiveBuyRatio, aggressiveSellRatio);

  if (!activity.passesAbsolute && !activity.passesZ) {
    return null;
  }

  let confidence = 0.5;
  if (activity.totalSize >= config.spikeMinSize * 2) {
    confidence += 0.15;
  }
  if (activity.totalPremium >= config.spikeMinPremium * 2) {
    confidence += 0.15;
  }
  if (activity.count >= 3) {
    confidence += 0.1;
  }
  if (activity.passesZ) {
    confidence += 0.1;
    if (
      activity.premiumZ >= config.spikeMinPremiumZ + 1 ||
      activity.sizeZ >= config.spikeMinSizeZ + 1
    ) {
      confidence += 0.05;
    }
  }

  const aggressor = applyAggressorAdjustment(confidence, coverage, aggressiveRatio, config);
  confidence = clamp(aggressor.confidence, 0, 0.9);

  return {
    classifier_id: "unusual_contract_spike",
    confidence,
    direction: "neutral",
    explanations: [
      `Unusual contract spike: ${activity.count} prints in ${Math.round(activity.windowMs)}ms for ${packet.features.option_contract_id ?? packet.id}.`,
      `Premium ${formatUsd(activity.totalPremium)} across ${Math.round(activity.totalSize)} contracts.`,
      `Thresholds: >=${config.spikeMinSize} contracts and >=${formatUsd(config.spikeMinPremium)} premium or z>=${config.spikeMinPremiumZ.toFixed(1)}.`,
      activity.baselineNote,
      aggressor.note
    ]
  };
};

const buildOverwriteHit = (
  packet: FlowPacket,
  contract: ParsedContract,
  config: ClassifierConfig
): ClassifierHit | null => {
  if (contract.right !== "C") {
    return null;
  }

  const activity = getLargeActivity(packet, config);
  if (!activity.passesAbsolute && !activity.passesZ) {
    return null;
  }

  const { coverage, aggressiveSellRatio } = getAggressorContext(packet);
  let confidence = 0.45;
  if (activity.totalPremium >= config.spikeMinPremium * 2) {
    confidence += 0.15;
  }
  if (activity.totalSize >= config.spikeMinSize * 2) {
    confidence += 0.1;
  }
  if (activity.count >= 3) {
    confidence += 0.05;
  }
  if (activity.passesZ) {
    confidence += 0.1;
  }

  const aggressor = applySideAggressorAdjustment(
    confidence,
    coverage,
    aggressiveSellRatio,
    config,
    "sell-side"
  );
  confidence = clamp(aggressor.confidence, 0, 0.9);

  return {
    classifier_id: "large_call_sell_overwrite",
    confidence,
    direction: "bearish",
    explanations: [
      `Likely call overwrite: ${activity.count} prints in ${Math.round(activity.windowMs)}ms for ${packet.features.option_contract_id ?? packet.id}.`,
      `Premium ${formatUsd(activity.totalPremium)} across ${Math.round(activity.totalSize)} contracts.`,
      `Thresholds: >=${config.spikeMinSize} contracts and >=${formatUsd(config.spikeMinPremium)} premium or z>=${config.spikeMinPremiumZ.toFixed(1)}.`,
      "Direction inferred from sell-side aggressor mix.",
      activity.baselineNote,
      aggressor.note
    ]
  };
};

const buildPutWriteHit = (
  packet: FlowPacket,
  contract: ParsedContract,
  config: ClassifierConfig
): ClassifierHit | null => {
  if (contract.right !== "P") {
    return null;
  }

  const activity = getLargeActivity(packet, config);
  if (!activity.passesAbsolute && !activity.passesZ) {
    return null;
  }

  const { coverage, aggressiveSellRatio } = getAggressorContext(packet);
  let confidence = 0.45;
  if (activity.totalPremium >= config.spikeMinPremium * 2) {
    confidence += 0.15;
  }
  if (activity.totalSize >= config.spikeMinSize * 2) {
    confidence += 0.1;
  }
  if (activity.count >= 3) {
    confidence += 0.05;
  }
  if (activity.passesZ) {
    confidence += 0.1;
  }

  const aggressor = applySideAggressorAdjustment(
    confidence,
    coverage,
    aggressiveSellRatio,
    config,
    "sell-side"
  );
  confidence = clamp(aggressor.confidence, 0, 0.9);

  return {
    classifier_id: "large_put_sell_write",
    confidence,
    direction: "bullish",
    explanations: [
      `Likely put write: ${activity.count} prints in ${Math.round(activity.windowMs)}ms for ${packet.features.option_contract_id ?? packet.id}.`,
      `Premium ${formatUsd(activity.totalPremium)} across ${Math.round(activity.totalSize)} contracts.`,
      `Thresholds: >=${config.spikeMinSize} contracts and >=${formatUsd(config.spikeMinPremium)} premium or z>=${config.spikeMinPremiumZ.toFixed(1)}.`,
      "Direction inferred from sell-side aggressor mix.",
      activity.baselineNote,
      aggressor.note
    ]
  };
};

const buildStraddleStrangleHit = (
  packet: FlowPacket,
  config: ClassifierConfig
): ClassifierHit | null => {
  const structureType = getStringFeature(packet, "structure_type");
  if (structureType !== "straddle" && structureType !== "strangle") {
    return null;
  }

  const activity = getLargeActivity(packet, config);
  const { coverage, aggressiveBuyRatio, aggressiveSellRatio, aggressiveRatio } =
    getAggressorContext(packet);
  const structureLegs = getNumberFeature(packet, "structure_legs");
  const structureStrikes = getNumberFeature(packet, "structure_strikes");
  const strikeSpan = getNumberFeature(packet, "structure_strike_span");

  let confidence = 0.45;
  if (activity.totalPremium >= config.spikeMinPremium) {
    confidence += 0.1;
  }
  if (activity.totalSize >= config.spikeMinSize) {
    confidence += 0.05;
  }
  if (structureLegs >= 4) {
    confidence += 0.05;
  }

  const aggressor = applyAggressorAdjustment(confidence, coverage, aggressiveRatio, config);
  confidence = clamp(aggressor.confidence, 0, 0.85);

  let volBias = "mixed aggressor skew";
  if (aggressiveBuyRatio >= aggressiveSellRatio + 0.1) {
    volBias = "buy-side skew suggests long volatility";
  } else if (aggressiveSellRatio >= aggressiveBuyRatio + 0.1) {
    volBias = "sell-side skew suggests short volatility";
  }

  const skewNote = `Aggressor skew: buy ${formatPct(aggressiveBuyRatio)}, sell ${formatPct(
    aggressiveSellRatio
  )}; ${volBias}.`;

  return {
    classifier_id: structureType === "straddle" ? "straddle" : "strangle",
    confidence,
    direction: "neutral",
    explanations: [
      `Likely ${structureType}: ${structureLegs} legs across ${structureStrikes} strikes (span ${strikeSpan}).`,
      `Premium ${formatUsd(activity.totalPremium)} across ${Math.round(activity.totalSize)} contracts.`,
      skewNote,
      aggressor.note
    ]
  };
};

const buildVerticalSpreadHit = (
  packet: FlowPacket,
  config: ClassifierConfig
): ClassifierHit | null => {
  const structureType = getStringFeature(packet, "structure_type");
  if (structureType !== "vertical") {
    return null;
  }

  const structureRights = getStringFeature(packet, "structure_rights");
  if (structureRights !== "C" && structureRights !== "P") {
    return null;
  }

  const activity = getLargeActivity(packet, config);
  const { coverage, aggressiveBuyRatio, aggressiveSellRatio } = getAggressorContext(packet);
  const structureLegs = getNumberFeature(packet, "structure_legs");
  const structureStrikes = getNumberFeature(packet, "structure_strikes");
  const strikeSpan = getNumberFeature(packet, "structure_strike_span");

  let confidence = 0.5;
  if (activity.totalPremium >= config.spikeMinPremium) {
    confidence += 0.1;
  }
  if (activity.totalSize >= config.spikeMinSize) {
    confidence += 0.05;
  }
  if (structureLegs >= 3) {
    confidence += 0.05;
  }

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  let biasNote = "Debit/credit bias unclear (insufficient aggressor data).";
  let aggressorNote = "Aggressor mix unavailable (no NBBO coverage).";
  const hasAggressor = coverage > 0 && aggressiveBuyRatio + aggressiveSellRatio > 0;
  if (hasAggressor) {
    const buyDominant = aggressiveBuyRatio >= aggressiveSellRatio;
    const dominantRatio = buyDominant ? aggressiveBuyRatio : aggressiveSellRatio;
    const label = buyDominant ? "buy-side" : "sell-side";
    const aggressor = applySideAggressorAdjustment(
      confidence,
      coverage,
      dominantRatio,
      config,
      label
    );
    confidence = aggressor.confidence;
    aggressorNote = aggressor.note;

    const spreadBias = buyDominant ? "debit" : "credit";
    biasNote = `Aggressor skew: buy ${formatPct(aggressiveBuyRatio)}, sell ${formatPct(
      aggressiveSellRatio
    )}; suggests ${spreadBias} ${structureRights === "C" ? "call" : "put"} vertical.`;

    if (structureRights === "C") {
      direction = buyDominant ? "bullish" : "bearish";
    } else {
      direction = buyDominant ? "bearish" : "bullish";
    }
  } else {
    confidence -= 0.1;
  }

  confidence = clamp(confidence, 0, 0.85);

  return {
    classifier_id: "vertical_spread",
    confidence,
    direction,
    explanations: [
      `Likely vertical spread: ${structureLegs} legs across ${structureStrikes} strikes (span ${strikeSpan}).`,
      `Premium ${formatUsd(activity.totalPremium)} across ${Math.round(activity.totalSize)} contracts.`,
      biasNote,
      aggressorNote,
      "Direction inferred from debit/credit bias."
    ]
  };
};

const buildLadderHit = (
  packet: FlowPacket,
  config: ClassifierConfig
): ClassifierHit | null => {
  const structureType = getStringFeature(packet, "structure_type");
  if (structureType !== "ladder") {
    return null;
  }

  const activity = getLargeActivity(packet, config);
  const { coverage, aggressiveRatio } = getAggressorContext(packet);
  const structureRights = getStringFeature(packet, "structure_rights");
  const structureLegs = getNumberFeature(packet, "structure_legs");
  const structureStrikes = getNumberFeature(packet, "structure_strikes");
  const strikeSpan = getNumberFeature(packet, "structure_strike_span");

  const qualifies =
    activity.totalPremium >= config.spikeMinPremium ||
    activity.totalSize >= config.spikeMinSize ||
    activity.passesZ;
  if (!qualifies) {
    return null;
  }

  let confidence = 0.45;
  if (activity.totalPremium >= config.spikeMinPremium * 2) {
    confidence += 0.1;
  }
  if (activity.totalSize >= config.spikeMinSize * 2) {
    confidence += 0.1;
  }
  if (structureStrikes >= 4) {
    confidence += 0.05;
  }
  if (activity.passesZ) {
    confidence += 0.05;
  }

  const aggressor = applyAggressorAdjustment(confidence, coverage, aggressiveRatio, config);
  confidence = clamp(aggressor.confidence, 0, 0.85);

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  if (structureRights === "C") {
    direction = "bullish";
  } else if (structureRights === "P") {
    direction = "bearish";
  }

  return {
    classifier_id: "ladder_accumulation",
    confidence,
    direction,
    explanations: [
      `Likely multi-strike ladder accumulation: ${structureLegs} legs across ${structureStrikes} strikes (span ${strikeSpan}).`,
      `Premium ${formatUsd(activity.totalPremium)} across ${Math.round(activity.totalSize)} contracts.`,
      `Thresholds: ladder structure plus >=${config.spikeMinSize} contracts or >=${formatUsd(config.spikeMinPremium)} premium.`,
      "Direction inferred from call/put ladder.",
      activity.baselineNote,
      aggressor.note
    ]
  };
};

const buildFarDatedHit = (
  packet: FlowPacket,
  contract: ParsedContract,
  config: ClassifierConfig
): ClassifierHit | null => {
  const dteDays = getDteDays(packet, contract);
  if (!dteDays || dteDays < 60) {
    return null;
  }

  const activity = getLargeActivity(packet, config);
  if (!activity.passesAbsolute && !activity.passesZ) {
    return null;
  }

  const { coverage, aggressiveRatio } = getAggressorContext(packet);
  let confidence = 0.5;
  if (dteDays >= 90) {
    confidence += 0.05;
  }
  if (activity.totalPremium >= config.spikeMinPremium * 2) {
    confidence += 0.1;
  }
  if (activity.totalSize >= config.spikeMinSize * 2) {
    confidence += 0.05;
  }
  if (activity.passesZ) {
    confidence += 0.1;
  }

  const aggressor = applyAggressorAdjustment(confidence, coverage, aggressiveRatio, config);
  confidence = clamp(aggressor.confidence, 0, 0.85);

  return {
    classifier_id: "far_dated_conviction",
    confidence,
    direction: contract.right === "C" ? "bullish" : "bearish",
    explanations: [
      `Likely far-dated ${contract.right === "C" ? "call" : "put"} positioning: ${dteDays} DTE for ${packet.features.option_contract_id ?? packet.id}.`,
      `Premium ${formatUsd(activity.totalPremium)} across ${Math.round(activity.totalSize)} contracts.`,
      `Thresholds: DTE >=60 and >=${config.spikeMinSize} contracts or >=${formatUsd(config.spikeMinPremium)} premium (or z-scores).`,
      "Direction inferred from call/put right.",
      activity.baselineNote,
      aggressor.note
    ]
  };
};

const buildZeroDteGammaPunchHit = (
  packet: FlowPacket,
  contract: ParsedContract,
  config: ClassifierConfig
): ClassifierHit | null => {
  const referenceDay = getReferenceDay(packet);
  if (!referenceDay || contract.expiry !== referenceDay) {
    return null;
  }

  const activity = getLargeActivity(packet, config);
  if (
    activity.totalPremium < config.zeroDteMinPremium ||
    activity.totalSize < config.zeroDteMinSize
  ) {
    return null;
  }

  const underlyingMid = getNumberFeature(packet, "underlying_mid");
  if (!Number.isFinite(underlyingMid) || underlyingMid <= 0) {
    return null;
  }

  const strike = contract.strike;
  const atmPct = Math.abs(strike - underlyingMid) / underlyingMid;
  if (atmPct > config.zeroDteMaxAtmPct) {
    return null;
  }

  const { coverage, aggressiveRatio } = getAggressorContext(packet);
  let confidence = 0.55;
  if (atmPct <= config.zeroDteMaxAtmPct * 0.5) {
    confidence += 0.05;
  }
  if (activity.totalPremium >= config.zeroDteMinPremium * 2) {
    confidence += 0.1;
  }
  if (activity.totalSize >= config.zeroDteMinSize * 2) {
    confidence += 0.05;
  }

  const aggressor = applyAggressorAdjustment(confidence, coverage, aggressiveRatio, config);
  confidence = clamp(aggressor.confidence, 0, 0.9);

  return {
    classifier_id: "zero_dte_gamma_punch",
    confidence,
    direction: contract.right === "C" ? "bullish" : "bearish",
    explanations: [
      `Likely 0DTE gamma punch: ${packet.features.option_contract_id ?? packet.id} near ATM.`,
      `Underlying mid ${formatUsd(underlyingMid)}, strike ${formatUsd(strike)} (${formatPctPrecise(atmPct)} from ATM).`,
      `Premium ${formatUsd(activity.totalPremium)} across ${Math.round(activity.totalSize)} contracts.`,
      `Thresholds: DTE=0, ATM <=${formatPctPrecise(config.zeroDteMaxAtmPct)}, >=${formatUsd(
        config.zeroDteMinPremium
      )} premium, >=${config.zeroDteMinSize} contracts.`,
      activity.baselineNote,
      aggressor.note
    ]
  };
};

export const evaluateClassifiers = (
  packet: FlowPacket,
  config: ClassifierConfig
): ClassifierHit[] => {
  const packetKind = getStringFeature(packet, "packet_kind");
  const structureOnly = packetKind === "structure";

  const contractId = typeof packet.features.option_contract_id === "string"
    ? packet.features.option_contract_id
    : "";
  const contract = structureOnly ? null : parseContractId(contractId);
  const hits: ClassifierHit[] = [];

  if (structureOnly) {
    const structureHit = buildStraddleStrangleHit(packet, config);
    if (structureHit) {
      hits.push(structureHit);
    }

    const verticalHit = buildVerticalSpreadHit(packet, config);
    if (verticalHit) {
      hits.push(verticalHit);
    }

    const ladderHit = buildLadderHit(packet, config);
    if (ladderHit) {
      hits.push(ladderHit);
    }

    return hits;
  }

  if (!structureOnly) {
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

    if (contract) {
      const overwriteHit = buildOverwriteHit(packet, contract, config);
      if (overwriteHit) {
        hits.push(overwriteHit);
      }

      const putWriteHit = buildPutWriteHit(packet, contract, config);
      if (putWriteHit) {
        hits.push(putWriteHit);
      }

      const farDatedHit = buildFarDatedHit(packet, contract, config);
      if (farDatedHit) {
        hits.push(farDatedHit);
      }

      const zeroDteHit = buildZeroDteGammaPunchHit(packet, contract, config);
      if (zeroDteHit) {
        hits.push(zeroDteHit);
      }
    }
  }

  return hits;
};
