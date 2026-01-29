import type { FlowPacket } from "@islandflow/types";
import type { ContractLeg, StructureSummary } from "./structures";

export type NbboPlacementCounts = {
  aa: number;
  a: number;
  b: number;
  bb: number;
  mid: number;
  missing: number;
  stale: number;
};

export type LegEvidence = ContractLeg & {
  members: string[];
  totalSize: number;
  totalPremium: number;
  placements: NbboPlacementCounts;
  source_ts: number;
  ingest_ts: number;
  seq: number;
};

export type StructurePacketPlan = {
  id: string;
  dedupeKey: string;
  bucketStartTs: number;
  root: string;
  pseudoContractId: string;
  expiries: string[];
  strikes: number[];
  roll_from_expiry: string | null;
  roll_to_expiry: string | null;
  roll_from_strike: number | null;
  roll_to_strike: number | null;
  roll_strike_delta: number | null;
  roll_expiry_days_delta: number | null;
  startTs: number;
  endTs: number;
  members: string[];
  totalSize: number;
  totalPremium: number;
  count: number;
  placements: NbboPlacementCounts;
  nbboCoverageRatio: number;
  nbboAggressiveBuyRatio: number;
  nbboAggressiveSellRatio: number;
  nbboAggressiveRatio: number;
  source_ts: number;
  ingest_ts: number;
  seq: number;
};

const roundTo = (value: number, digits = 4): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
};

const emptyPlacements = (): NbboPlacementCounts => ({
  aa: 0,
  a: 0,
  b: 0,
  bb: 0,
  mid: 0,
  missing: 0,
  stale: 0
});

const mergePlacements = (legs: LegEvidence[]): NbboPlacementCounts => {
  const merged = emptyPlacements();
  for (const leg of legs) {
    merged.aa += leg.placements.aa;
    merged.a += leg.placements.a;
    merged.b += leg.placements.b;
    merged.bb += leg.placements.bb;
    merged.mid += leg.placements.mid;
    merged.missing += leg.placements.missing;
    merged.stale += leg.placements.stale;
  }
  return merged;
};

const buildPseudoContractId = (root: string, expiry: string, structureType: string): string => {
  const normalizedRoot = root.trim().toUpperCase();
  return `${normalizedRoot}-${expiry}-STRUCT-${structureType}`;
};

const bucketTs = (value: number, bucketMs: number): number => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(bucketMs) || bucketMs <= 0) {
    return 0;
  }
  return Math.floor(value / bucketMs) * bucketMs;
};

const uniqueSorted = (values: string[]): string[] => {
  return Array.from(new Set(values)).sort();
};

const uniqueSortedNumbers = (values: number[]): number[] => {
  return Array.from(new Set(values)).sort((a, b) => a - b);
};

const medianNumber = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return (a + b) / 2;
};

const dayDiff = (from: string | null, to: string | null): number | null => {
  if (!from || !to) {
    return null;
  }
  const fromTs = Date.parse(`${from}T00:00:00Z`);
  const toTs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) {
    return null;
  }
  const diffMs = toTs - fromTs;
  return Math.round(diffMs / 86_400_000);
};

export const shouldEmitStructurePacket = (legs: LegEvidence[], currentLegContractId: string): boolean => {
  if (legs.length < 2) {
    return false;
  }

  const current = legs.find((leg) => leg.contractId === currentLegContractId);
  if (!current) {
    return false;
  }

  const maxEnd = legs.reduce((max, leg) => Math.max(max, leg.endTs), 0);
  return current.endTs >= maxEnd;
};

export const planStructurePacket = (
  legs: LegEvidence[],
  summary: StructureSummary,
  clusterWindowMs: number
): StructurePacketPlan | null => {
  if (legs.length < 2) {
    return null;
  }

  const rootRaw = legs[0]?.root;
  if (!rootRaw) {
    return null;
  }

  const expiries = uniqueSorted(legs.map((leg) => leg.expiry));
  const expiry = expiries[0];
  if (!expiry) {
    return null;
  }

  const strikes = uniqueSortedNumbers(legs.map((leg) => leg.strike));

  let rollFromExpiry: string | null = null;
  let rollToExpiry: string | null = null;
  let rollFromStrike: number | null = null;
  let rollToStrike: number | null = null;
  let rollStrikeDelta: number | null = null;
  let rollExpiryDaysDelta: number | null = null;

  if (summary.type === "roll" && expiries.length >= 2) {
    rollFromExpiry = expiries[0] ?? null;
    rollToExpiry = expiries[expiries.length - 1] ?? null;

    const strikesByExpiry = new Map<string, number[]>();
    for (const leg of legs) {
      const bucket = strikesByExpiry.get(leg.expiry);
      if (bucket) {
        bucket.push(leg.strike);
      } else {
        strikesByExpiry.set(leg.expiry, [leg.strike]);
      }
    }

    rollFromStrike = medianNumber(strikesByExpiry.get(rollFromExpiry) ?? []) ?? null;
    rollToStrike = medianNumber(strikesByExpiry.get(rollToExpiry) ?? []) ?? null;

    if (rollFromStrike !== null && rollToStrike !== null) {
      rollStrikeDelta = roundTo(rollToStrike - rollFromStrike, 4);
    }

    rollExpiryDaysDelta = dayDiff(rollFromExpiry, rollToExpiry);
  }

  const contractIds = uniqueSorted(legs.map((leg) => leg.contractId));
  const startTs = legs.reduce((min, leg) => Math.min(min, leg.startTs), Number.POSITIVE_INFINITY);
  const endTs = legs.reduce((max, leg) => Math.max(max, leg.endTs), 0);
  const bucketStartTs = bucketTs(startTs, clusterWindowMs);
  const pseudoContractId = buildPseudoContractId(rootRaw, expiry, summary.type);
  const id = `flowpacket:${pseudoContractId}:${bucketStartTs}:${contractIds.join("|")}`;
  const dedupeKey = `${pseudoContractId}:${bucketStartTs}:${contractIds.join("|")}`;

  const members = uniqueSorted(legs.flatMap((leg) => leg.members));
  const totalPremium = legs.reduce((sum, leg) => sum + leg.totalPremium, 0);
  const totalSize = legs.reduce((sum, leg) => sum + leg.totalSize, 0);
  const count = legs.reduce((sum, leg) => sum + leg.members.length, 0);
  const placements = mergePlacements(legs);
  const placementTotal = placements.aa + placements.a + placements.b + placements.bb + placements.mid;
  const aggressiveTotal = placements.aa + placements.a + placements.b + placements.bb;
  const aggressiveBuy = placements.aa + placements.a;
  const aggressiveSell = placements.bb + placements.b;
  const nbboCoverageRatio = count > 0 ? placementTotal / count : 0;
  const nbboAggressiveBuyRatio = aggressiveTotal > 0 ? aggressiveBuy / aggressiveTotal : 0;
  const nbboAggressiveSellRatio = aggressiveTotal > 0 ? aggressiveSell / aggressiveTotal : 0;
  const nbboAggressiveRatio = placementTotal > 0 ? aggressiveTotal / placementTotal : 0;

  const source_ts = legs.reduce((min, leg) => Math.min(min, leg.source_ts), Number.POSITIVE_INFINITY);
  const ingest_ts = legs.reduce((max, leg) => Math.max(max, leg.ingest_ts), 0);
  const seq = legs.reduce((max, leg) => Math.max(max, leg.seq), 0);

  return {
    id,
    dedupeKey,
    bucketStartTs,
    root: rootRaw.trim().toUpperCase(),
    pseudoContractId,
    expiries,
    strikes,
    roll_from_expiry: rollFromExpiry,
    roll_to_expiry: rollToExpiry,
    roll_from_strike: rollFromStrike,
    roll_to_strike: rollToStrike,
    roll_strike_delta: rollStrikeDelta,
    roll_expiry_days_delta: rollExpiryDaysDelta,
    startTs: Number.isFinite(startTs) ? startTs : 0,
    endTs,
    members,
    totalSize,
    totalPremium,
    count,
    placements,
    nbboCoverageRatio,
    nbboAggressiveBuyRatio,
    nbboAggressiveSellRatio,
    nbboAggressiveRatio,
    source_ts: Number.isFinite(source_ts) ? source_ts : 0,
    ingest_ts,
    seq
  };
};

export const buildStructureFlowPacket = (
  plan: StructurePacketPlan,
  summary: StructureSummary
): FlowPacket => {
  const totalPremium = roundTo(plan.totalPremium);
  const totalNotional = roundTo(totalPremium * 100, 2);
  const windowMs = Math.max(0, plan.endTs - plan.startTs);

  const features: Record<string, string | number | boolean> = {
    packet_kind: "structure",
    option_contract_id: plan.pseudoContractId,
    underlying_id: plan.root,
    count: plan.count,
    total_size: plan.totalSize,
    total_premium: totalPremium,
    total_notional: totalNotional,
    start_ts: plan.startTs,
    end_ts: plan.endTs,
    window_ms: windowMs,
    structure_type: summary.type,
    structure_legs: summary.legs,
    structure_strikes: summary.strikes,
    structure_strike_span: roundTo(summary.strikeSpan),
    structure_rights: summary.rights,
    structure_contract_ids: summary.contractIds.join(","),
    structure_expiries_count: plan.expiries.length,
    structure_expiries: plan.expiries.join(","),
    structure_strikes_list: plan.strikes.join(",")
  };

  if (summary.type === "roll") {
    if (plan.roll_from_expiry) {
      features.roll_from_expiry = plan.roll_from_expiry;
    }
    if (plan.roll_to_expiry) {
      features.roll_to_expiry = plan.roll_to_expiry;
    }
    if (plan.roll_from_strike !== null) {
      features.roll_from_strike = plan.roll_from_strike;
    }
    if (plan.roll_to_strike !== null) {
      features.roll_to_strike = plan.roll_to_strike;
    }
    if (plan.roll_strike_delta !== null) {
      features.roll_strike_delta = plan.roll_strike_delta;
    }
    if (plan.roll_expiry_days_delta !== null) {
      features.roll_expiry_days_delta = plan.roll_expiry_days_delta;
    }
  }

  // These are aggregate counts across the legs. We do not attach rolling z-scores
  // (baseline is per-contract), so structure packets default to absolute thresholds.
  features.nbbo_aa_count = plan.placements.aa;
  features.nbbo_a_count = plan.placements.a;
  features.nbbo_b_count = plan.placements.b;
  features.nbbo_bb_count = plan.placements.bb;
  features.nbbo_mid_count = plan.placements.mid;
  features.nbbo_missing_count = plan.placements.missing;
  features.nbbo_stale_count = plan.placements.stale;
  features.nbbo_coverage_ratio = roundTo(plan.nbboCoverageRatio);
  features.nbbo_aggressive_buy_ratio = roundTo(plan.nbboAggressiveBuyRatio);
  features.nbbo_aggressive_sell_ratio = roundTo(plan.nbboAggressiveSellRatio);
  features.nbbo_aggressive_ratio = roundTo(plan.nbboAggressiveRatio);

  const join_quality: Record<string, number> = {
    nbbo_coverage_ratio: roundTo(plan.nbboCoverageRatio)
  };

  return {
    source_ts: plan.source_ts,
    ingest_ts: plan.ingest_ts,
    seq: plan.seq,
    trace_id: plan.id,
    id: plan.id,
    members: plan.members,
    features,
    join_quality
  };
};
