import {
  SyntheticDerivedStatusSchema,
  buildEmptySyntheticProfileHitCounts,
  getSyntheticSessionState,
  type FlowHypothesisType,
  type SmartFlowExplainabilityProjection,
  type SmartMoneyProfileId,
  type SyntheticControlState,
  type SyntheticDerivedStatus
} from "@islandflow/types";

export type SyntheticBackendMode = "synthetic" | "mixed" | "live";

export type RollingSyntheticProfileHits = Record<SmartMoneyProfileId, number[]>;

export const createRollingSyntheticProfileHits = (): RollingSyntheticProfileHits => ({
  institutional_directional: [],
  retail_whale: [],
  event_driven: [],
  vol_seller: [],
  arbitrage: [],
  hedge_reactive: []
});

const HYPOTHESIS_PROFILE_MAP: Partial<Record<FlowHypothesisType, SmartMoneyProfileId>> = {
  directional_accumulation: "institutional_directional",
  retail_attention_flow: "retail_whale",
  event_positioning: "event_driven",
  volatility_supply: "vol_seller",
  structure_arbitrage: "arbitrage",
  hedge_rebalance: "hedge_reactive"
};

export const resolveSyntheticBackendMode = (
  optionsAdapter: string,
  equitiesAdapter: string
): SyntheticBackendMode => {
  const optionsSynthetic = optionsAdapter === "synthetic";
  const equitiesSynthetic = equitiesAdapter === "synthetic";
  if (optionsSynthetic && equitiesSynthetic) {
    return "synthetic";
  }
  if (optionsSynthetic || equitiesSynthetic) {
    return "mixed";
  }
  return "live";
};

export const getSyntheticBackendDisabledReason = (
  mode: SyntheticBackendMode
): string | undefined => {
  if (mode === "synthetic") {
    return undefined;
  }
  if (mode === "mixed") {
    return "Synthetic control requires both hosted ingest adapters to run in synthetic mode.";
  }
  return "Hosted ingest adapters are not synthetic, so the internal synthetic control surface is unavailable.";
};

export const recordSyntheticProfileHit = (
  state: RollingSyntheticProfileHits,
  projection: Pick<SmartFlowExplainabilityProjection, "hypothesis" | "source_ts" | "abstention">
): void => {
  if (projection.abstention.abstained) {
    return;
  }
  const profileId = HYPOTHESIS_PROFILE_MAP[projection.hypothesis.hypothesis_type];
  if (!profileId) {
    return;
  }
  state[profileId].push(projection.source_ts);
};

export const getSyntheticProfileHitCounts = (
  state: RollingSyntheticProfileHits,
  now: number,
  coverageWindowMinutes: number
): Record<SmartMoneyProfileId, number> => {
  const floorTs = now - coverageWindowMinutes * 60_000;
  const counts = buildEmptySyntheticProfileHitCounts();
  for (const profileId of Object.keys(state) as SmartMoneyProfileId[]) {
    const retained = state[profileId].filter((ts) => ts >= floorTs);
    state[profileId] = retained;
    counts[profileId] = retained.length;
  }
  return counts;
};

export const buildSyntheticDerivedStatus = (
  now: number,
  control: SyntheticControlState,
  state: RollingSyntheticProfileHits
): SyntheticDerivedStatus => {
  const session = getSyntheticSessionState(now, control);
  return SyntheticDerivedStatusSchema.parse({
    session_phase: session.session_phase,
    regime: session.regime,
    focus_symbols: session.focus_symbols,
    profile_hit_counts: getSyntheticProfileHitCounts(state, now, control.coverage_window_minutes),
    coverage_window_minutes: control.coverage_window_minutes
  });
};
