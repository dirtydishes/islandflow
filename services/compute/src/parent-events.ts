import {
  SmartMoneyEventSchema,
  type ClassifierHit,
  type FlowPacket,
  type SmartMoneyDirection,
  type SmartMoneyEvent,
  type SmartMoneyFeatures,
  type SmartMoneyProfileId,
  type SmartMoneyProfileScore
} from "@islandflow/types";
import type { EventCalendarMatch } from "@islandflow/refdata/event-calendar";
import { parseContractId } from "./contracts";

const MS_PER_DAY = 86_400_000;
const SPECIAL_CONDITIONS = new Set(["AUCTION", "CROSS", "OPENING", "CLOSING", "COMPLEX", "SPREAD"]);

const clamp = (value: number, min = 0, max = 1): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const numberFeature = (packet: FlowPacket, key: string): number => {
  const value = packet.features[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const stringFeature = (packet: FlowPacket, key: string): string => {
  const value = packet.features[key];
  return typeof value === "string" ? value : "";
};

const boolFeature = (packet: FlowPacket, key: string): boolean | null => {
  const value = packet.features[key];
  return typeof value === "boolean" ? value : null;
};

const confidenceBand = (probability: number): SmartMoneyProfileScore["confidence_band"] => {
  if (probability >= 0.72) {
    return "high";
  }
  if (probability >= 0.52) {
    return "medium";
  }
  return "low";
};

const score = (
  profile_id: SmartMoneyProfileId,
  probability: number,
  direction: SmartMoneyDirection,
  reasons: string[]
): SmartMoneyProfileScore => ({
  profile_id,
  probability: clamp(probability),
  confidence_band: confidenceBand(probability),
  direction,
  reasons
});

const getReferenceTs = (packet: FlowPacket): number => {
  return numberFeature(packet, "end_ts") || packet.source_ts;
};

const getDteDays = (packet: FlowPacket): number | null => {
  const contract = parseContractId(stringFeature(packet, "option_contract_id"));
  if (!contract) {
    return null;
  }
  const expiryTs = Date.parse(`${contract.expiry}T00:00:00Z`);
  if (!Number.isFinite(expiryTs)) {
    return null;
  }
  const diff = expiryTs - getReferenceTs(packet);
  return diff >= 0 ? Math.ceil(diff / MS_PER_DAY) : null;
};

const inferDirection = (packet: FlowPacket): SmartMoneyDirection => {
  const structureRights = stringFeature(packet, "structure_rights");
  const optionType = stringFeature(packet, "option_type") || parseContractId(stringFeature(packet, "option_contract_id"))?.right;
  const buy = numberFeature(packet, "nbbo_aggressive_buy_ratio");
  const sell = numberFeature(packet, "nbbo_aggressive_sell_ratio");
  const sellDominant = sell >= buy + 0.12;

  if (structureRights === "C") {
    return sellDominant ? "bearish" : "bullish";
  }
  if (structureRights === "P") {
    return sellDominant ? "bullish" : "bearish";
  }
  if (optionType === "C") {
    return sellDominant ? "bearish" : "bullish";
  }
  if (optionType === "P") {
    return sellDominant ? "bullish" : "bearish";
  }
  return "neutral";
};

export type SmartMoneyParentEventOptions = {
  eventCalendarMatch?: EventCalendarMatch | null;
};

const buildFeatures = (packet: FlowPacket, options: SmartMoneyParentEventOptions = {}): SmartMoneyFeatures => {
  const contractId = stringFeature(packet, "option_contract_id");
  const contract = parseContractId(contractId);
  const underlyingMid = numberFeature(packet, "underlying_mid");
  const quoteAge = numberFeature(packet, "nbbo_age_ms") || numberFeature(packet, "underlying_quote_age_ms");
  const printCount = Math.max(0, Math.round(numberFeature(packet, "count") || packet.members.length));
  const staleCount = numberFeature(packet, "nbbo_stale_count");
  const missingCount = numberFeature(packet, "nbbo_missing_count");
  const structureLegs = Math.max(0, Math.round(numberFeature(packet, "structure_legs")));
  const strikeCount = Math.max(1, Math.round(numberFeature(packet, "structure_strikes") || (contract ? 1 : 0)));
  const specialCount = numberFeature(packet, "special_print_count");
  const calendarEventTs = options.eventCalendarMatch?.event_ts ?? null;
  const eventTs = calendarEventTs ?? numberFeature(packet, "corporate_event_ts");
  const referenceTs = getReferenceTs(packet);
  const expiryTs = contract ? Date.parse(`${contract.expiry}T00:00:00Z`) : Number.NaN;

  const atmProximity =
    contract && underlyingMid > 0 ? Math.abs(contract.strike - underlyingMid) / underlyingMid : null;

  return {
    contract_count: Math.max(1, structureLegs || 1),
    print_count: printCount,
    total_size: numberFeature(packet, "total_size"),
    total_premium: numberFeature(packet, "total_premium"),
    total_notional: numberFeature(packet, "total_notional"),
    start_ts: numberFeature(packet, "start_ts") || packet.source_ts,
    end_ts: numberFeature(packet, "end_ts") || packet.source_ts,
    window_ms: Math.max(0, Math.round(numberFeature(packet, "window_ms"))),
    ...(contractId ? { option_contract_id: contractId } : {}),
    ...(contract?.right === "C" || contract?.right === "P" ? { option_type: contract.right } : {}),
    dte_days: getDteDays(packet),
    moneyness: contract && underlyingMid > 0 ? contract.strike / underlyingMid : null,
    atm_proximity: atmProximity,
    aggressor_buy_ratio: clamp(numberFeature(packet, "nbbo_aggressive_buy_ratio")),
    aggressor_sell_ratio: clamp(numberFeature(packet, "nbbo_aggressive_sell_ratio")),
    aggressor_ratio: clamp(numberFeature(packet, "nbbo_aggressive_ratio")),
    nbbo_coverage_ratio: clamp(numberFeature(packet, "nbbo_coverage_ratio")),
    nbbo_inside_ratio: clamp(numberFeature(packet, "nbbo_inside_ratio")),
    nbbo_stale_ratio: printCount > 0 ? clamp((staleCount + missingCount) / printCount) : 0,
    quote_age_ms: quoteAge > 0 ? quoteAge : null,
    venue_count: Math.max(1, Math.round(numberFeature(packet, "venue_count") || 1)),
    inter_fill_ms_mean: printCount > 1 ? numberFeature(packet, "window_ms") / Math.max(1, printCount - 1) : null,
    strike_count: strikeCount,
    strike_concentration: strikeCount > 0 ? clamp(1 / strikeCount) : 0,
    ...(stringFeature(packet, "structure_type") ? { structure_type: stringFeature(packet, "structure_type") } : {}),
    structure_legs: structureLegs,
    same_size_leg_symmetry: clamp(numberFeature(packet, "same_size_leg_symmetry")),
    net_directional_bias: clamp(
      numberFeature(packet, "nbbo_aggressive_buy_ratio") - numberFeature(packet, "nbbo_aggressive_sell_ratio"),
      -1,
      1
    ),
    synthetic_iv_shock: numberFeature(packet, "execution_iv_shock") || null,
    spread_widening: numberFeature(packet, "nbbo_spread_z") || null,
    underlying_move_bps: numberFeature(packet, "underlying_move_bps") || null,
    days_to_event: eventTs > 0 ? (eventTs - referenceTs) / MS_PER_DAY : null,
    expiry_after_event: eventTs > 0 && Number.isFinite(expiryTs) ? expiryTs >= eventTs : null,
    pre_event_concentration: eventTs > 0 && eventTs >= referenceTs ? clamp(1 - (eventTs - referenceTs) / (21 * MS_PER_DAY)) : null,
    special_print_ratio: printCount > 0 ? clamp(specialCount / printCount) : 0
  };
};

const detectSuppression = (packet: FlowPacket, features: SmartMoneyFeatures): string[] => {
  const reasons: string[] = [];
  const conditions = String(packet.features.conditions ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  if (conditions.some((condition) => SPECIAL_CONDITIONS.has(condition)) || features.special_print_ratio >= 0.34) {
    reasons.push("special_print_or_complex_context");
  }
  if (features.nbbo_coverage_ratio < 0.35 || features.nbbo_stale_ratio >= 0.5) {
    reasons.push("stale_or_missing_quote_context");
  }
  if (features.nbbo_inside_ratio >= 0.7 && features.aggressor_ratio < 0.35) {
    reasons.push("inside_market_or_cross_like_execution");
  }
  return reasons;
};

const evaluateProfiles = (
  packet: FlowPacket,
  features: SmartMoneyFeatures,
  suppressed: string[]
): SmartMoneyProfileScore[] => {
  const direction = inferDirection(packet);
  const dte = features.dte_days ?? 999;
  const structure = features.structure_type ?? "";
  const isStructure = features.structure_legs >= 2 || Boolean(structure);
  const buy = features.aggressor_buy_ratio;
  const sell = features.aggressor_sell_ratio;
  const premiumFactor = clamp(features.total_premium / 120_000);
  const sizeFactor = clamp(features.total_size / 1800);
  const burstFactor = clamp(features.print_count / 8);
  const quality = clamp(features.nbbo_coverage_ratio - features.nbbo_stale_ratio);
  const shortDatedOtm =
    dte <= 7 && features.atm_proximity !== null && features.atm_proximity >= 0.05 && features.option_type === "C";
  const nearAtm = features.atm_proximity !== null && features.atm_proximity <= 0.015;
  const preEvent =
    features.days_to_event !== null &&
    features.days_to_event >= 0 &&
    features.days_to_event <= 21 &&
    features.expiry_after_event === true;

  const scores = [
    score(
      "institutional_directional",
      suppressed.length > 0 || shortDatedOtm
        ? 0.18
        : 0.2 + premiumFactor * 0.25 + burstFactor * 0.18 + quality * 0.16 + (buy >= 0.58 || sell >= 0.58 ? 0.12 : 0),
      direction,
      [
        "large_parent_event",
        "directional_aggressor_mix",
        ...(shortDatedOtm ? ["retail_frenzy_guard"] : []),
        ...suppressed
      ]
    ),
    score(
      "retail_whale",
      0.12 +
        (shortDatedOtm ? 0.28 : 0) +
        burstFactor * 0.18 +
        clamp(features.synthetic_iv_shock ?? 0, 0, 0.2) +
        (features.total_premium < 100_000 ? 0.1 : 0),
      direction,
      ["short_dated_otm_attention_flow", "burst_print_pattern"]
    ),
    score(
      "event_driven",
      0.12 + (preEvent ? 0.32 : 0) + premiumFactor * 0.14 + clamp(features.spread_widening ?? 0, 0, 0.16),
      direction === "unknown" ? "neutral" : direction,
      ["event_calendar_alignment", "expiry_after_event", "pre_event_concentration"]
    ),
    score(
      "vol_seller",
      0.12 + (sell >= 0.58 ? 0.24 : 0) + (structure === "straddle" || structure === "strangle" ? 0.2 : 0) + premiumFactor * 0.14,
      "neutral",
      ["sell_side_premium", "short_vol_structure_evidence"]
    ),
    score(
      "arbitrage",
      0.08 +
        (isStructure ? 0.18 : 0) +
        (features.same_size_leg_symmetry >= 0.7 ? 0.24 : 0) +
        (Math.abs(features.net_directional_bias) <= 0.15 ? 0.18 : 0),
      "neutral",
      ["matched_leg_symmetry", "near_flat_directional_exposure"]
    ),
    score(
      "hedge_reactive",
      0.1 +
        (dte <= 2 && nearAtm ? 0.32 : 0) +
        clamp(Math.abs(features.underlying_move_bps ?? 0) / 80, 0, 0.18) +
        sizeFactor * 0.12,
      direction,
      ["short_dated_atm_gamma_context", "underlying_move_linkage"]
    )
  ];

  return scores.sort((a, b) => b.probability - a.probability);
};

export const buildSmartMoneyEventFromPacket = (
  packet: FlowPacket,
  options: SmartMoneyParentEventOptions = {}
): SmartMoneyEvent => {
  const features = buildFeatures(packet, options);
  const suppressed = detectSuppression(packet, features);
  const profileScores = evaluateProfiles(packet, features, suppressed);
  const primary = profileScores[0] ?? null;
  const abstained = !primary || primary.probability < 0.42 || suppressed.includes("stale_or_missing_quote_context");
  const underlying = stringFeature(packet, "underlying_id") || parseContractId(features.option_contract_id ?? "")?.root || "UNKNOWN";
  const eventKind = features.structure_legs >= 2 || stringFeature(packet, "packet_kind") === "structure"
    ? "multi_leg_event"
    : "single_leg_event";

  return SmartMoneyEventSchema.parse({
    source_ts: packet.source_ts,
    ingest_ts: packet.ingest_ts,
    seq: packet.seq,
    trace_id: `smartmoney:${packet.id}`,
    event_id: `smartmoney:${eventKind}:${packet.id}`,
    packet_ids: [packet.id],
    member_print_ids: packet.members,
    underlying_id: underlying,
    event_kind: eventKind,
    event_window_ms: features.window_ms,
    features,
    profile_scores: profileScores,
    primary_profile_id: abstained ? null : primary?.profile_id ?? null,
    primary_direction: abstained ? "unknown" : primary?.direction ?? "unknown",
    abstained,
    suppressed_reasons: suppressed
  });
};

const LEGACY_PROFILE_MAP: Record<SmartMoneyProfileId, string> = {
  institutional_directional: "smart_money_institutional_directional",
  retail_whale: "smart_money_retail_whale",
  event_driven: "smart_money_event_driven",
  vol_seller: "smart_money_vol_seller",
  arbitrage: "smart_money_arbitrage",
  hedge_reactive: "smart_money_hedge_reactive"
};

export const deriveClassifierHitsFromSmartMoneyEvent = (event: SmartMoneyEvent): ClassifierHit[] => {
  if (event.abstained || !event.primary_profile_id) {
    return [];
  }

  return event.profile_scores
    .filter((entry) => entry.profile_id === event.primary_profile_id || entry.probability >= 0.5)
    .slice(0, 3)
    .map((entry) => ({
      classifier_id: LEGACY_PROFILE_MAP[entry.profile_id],
      confidence: entry.probability,
      direction: entry.direction,
      explanations: [
        `Profile ${entry.profile_id} probability ${(entry.probability * 100).toFixed(0)}%.`,
        ...entry.reasons,
        ...event.suppressed_reasons.map((reason) => `Suppression guard: ${reason}.`)
      ]
    }));
};
