import {
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  normalizeSyntheticControlState,
  type SyntheticControlPresetId,
  type SyntheticControlState,
  type SyntheticCoverageWindowMinutes,
  type SyntheticDemoProfileId,
  type SyntheticLoadProfileId,
  type SyntheticMarketMode,
  type SyntheticProfileWeightMap
} from "@islandflow/types";
import {
  createSyntheticScenarioFixtureArtifacts,
  getSyntheticScenarioInjection,
  listSyntheticScenarioInjections,
  type SyntheticScenarioFamily,
  type SyntheticScenarioFixtureArtifacts
} from "./scenarios";

export type DemoProfileRun = {
  scenario_id: string;
  run_id: string;
  run_name: string;
  title: string;
  family: SyntheticScenarioFamily;
};

export type DemoProfileControlDefaults = {
  preset_id: SyntheticControlPresetId;
  coverage_assist: boolean;
  coverage_window_minutes: SyntheticCoverageWindowMinutes;
  shared_seed: number;
  profile_weights: SyntheticProfileWeightMap;
};

export type DemoProfile = {
  id: SyntheticDemoProfileId;
  title: string;
  description: string;
  default_load_profile_id: SyntheticLoadProfileId;
  runs: readonly DemoProfileRun[];
  control_defaults: DemoProfileControlDefaults;
};

export type LoadProfile = {
  id: SyntheticLoadProfileId;
  title: string;
  description: string;
  rate_multiplier: number;
  volume_multiplier: number;
  mode: SyntheticMarketMode;
};

export type DemoProfileSummary = Omit<DemoProfile, "control_defaults">;

export type LoadProfileSummary = LoadProfile;

export type SyntheticDemoLiveEvent = {
  source_ts: number;
  ingest_ts: number;
  ts: number;
  seq: number;
  trace_id: string;
};

export const SYNTHETIC_DEMO_RUN_INTERVAL_MS = 60_000;

const balancedWeights = (): SyntheticProfileWeightMap => ({
  institutional_directional: 1.0,
  retail_whale: 1.0,
  event_driven: 1.0,
  vol_seller: 1.0,
  arbitrage: 1.0,
  hedge_reactive: 1.0
});

const biasedWeights = (patch: Partial<SyntheticProfileWeightMap>): SyntheticProfileWeightMap => ({
  ...balancedWeights(),
  ...patch
});

const run = (scenarioId: string): DemoProfileRun => {
  const scenario = getSyntheticScenarioInjection(scenarioId);
  return {
    scenario_id: scenario.scenario_id,
    run_id: scenario.run_id,
    run_name: scenario.run_name,
    title: scenario.title,
    family: scenario.family
  };
};

export const SYNTHETIC_DEMO_PROFILES: readonly DemoProfile[] = [
  {
    id: "market-command",
    title: "Market Command",
    description: "Balanced deterministic run sequence for broad live-demo coverage.",
    default_load_profile_id: "steady",
    runs: [
      run("institutional-directional-flow"),
      run("retail-attention-call-chase"),
      run("structure-arbitrage-calm"),
      run("no-alert-wide-quote-chop")
    ],
    control_defaults: {
      preset_id: "balanced_demo",
      coverage_assist: true,
      coverage_window_minutes: 20,
      shared_seed: 11,
      profile_weights: balancedWeights()
    }
  },
  {
    id: "event-response",
    title: "Event Response",
    description: "Deterministic event and hedge-response runs for volatile demo sessions.",
    default_load_profile_id: "active",
    runs: [
      run("event-noise-positioning"),
      run("hedge-reactive-put-flow"),
      run("institutional-directional-flow")
    ],
    control_defaults: {
      preset_id: "event_day",
      coverage_assist: true,
      coverage_window_minutes: 20,
      shared_seed: 23,
      profile_weights: biasedWeights({
        event_driven: 1.6,
        hedge_reactive: 1.6,
        arbitrage: 0.6
      })
    }
  },
  {
    id: "quiet-range",
    title: "Quiet Range",
    description: "Deterministic structure, volatility-supply, and no-alert runs.",
    default_load_profile_id: "steady",
    runs: [
      run("structure-arbitrage-calm"),
      run("volatility-seller-supply"),
      run("no-alert-wide-quote-chop")
    ],
    control_defaults: {
      preset_id: "quiet_range",
      coverage_assist: true,
      coverage_window_minutes: 30,
      shared_seed: 37,
      profile_weights: biasedWeights({
        vol_seller: 1.6,
        arbitrage: 1.6,
        retail_whale: 0.6
      })
    }
  },
  {
    id: "stress-tape",
    title: "Stress Tape",
    description: "All named synthetic scenario runs under the highest demo load profile.",
    default_load_profile_id: "firehose",
    runs: listSyntheticScenarioInjections().map((scenario) => ({
      scenario_id: scenario.scenario_id,
      run_id: scenario.run_id,
      run_name: scenario.run_name,
      title: scenario.title,
      family: scenario.family
    })),
    control_defaults: {
      preset_id: "dealer_day",
      coverage_assist: true,
      coverage_window_minutes: 10,
      shared_seed: 53,
      profile_weights: balancedWeights()
    }
  }
] as const;

export const SYNTHETIC_LOAD_PROFILES: readonly LoadProfile[] = [
  {
    id: "steady",
    title: "Steady",
    description: "One deterministic run per base interval.",
    rate_multiplier: 1,
    volume_multiplier: 1,
    mode: "realistic"
  },
  {
    id: "active",
    title: "Active",
    description: "Faster deterministic playback without changing selected run semantics.",
    rate_multiplier: 2,
    volume_multiplier: 1,
    mode: "active"
  },
  {
    id: "firehose",
    title: "Firehose",
    description: "Fast deterministic playback with repeated named runs per tick.",
    rate_multiplier: 4,
    volume_multiplier: 2,
    mode: "firehose"
  }
] as const;

export const listDemoProfiles = (): DemoProfile[] => clone([...SYNTHETIC_DEMO_PROFILES]);

export const listLoadProfiles = (): LoadProfile[] => clone([...SYNTHETIC_LOAD_PROFILES]);

export const listDemoProfileSummaries = (): DemoProfileSummary[] =>
  listDemoProfiles().map(({ control_defaults, ...profile }) => profile);

export const listLoadProfileSummaries = (): LoadProfileSummary[] => listLoadProfiles();

export const getDemoProfile = (
  profileId: SyntheticDemoProfileId | string | null | undefined
): DemoProfile => {
  const profile =
    SYNTHETIC_DEMO_PROFILES.find((candidate) => candidate.id === profileId) ??
    SYNTHETIC_DEMO_PROFILES.find(
      (candidate) => candidate.id === DEFAULT_SYNTHETIC_CONTROL_STATE.demo_profile_id
    );
  if (!profile) {
    throw new Error(`Unknown synthetic demo profile: ${String(profileId ?? "(missing)")}`);
  }
  return clone(profile);
};

export const getLoadProfile = (
  profileId: SyntheticLoadProfileId | string | null | undefined
): LoadProfile => {
  const profile =
    SYNTHETIC_LOAD_PROFILES.find((candidate) => candidate.id === profileId) ??
    SYNTHETIC_LOAD_PROFILES.find(
      (candidate) => candidate.id === DEFAULT_SYNTHETIC_CONTROL_STATE.load_profile_id
    );
  if (!profile) {
    throw new Error(`Unknown synthetic load profile: ${String(profileId ?? "(missing)")}`);
  }
  return clone(profile);
};

export const selectDemoProfileRun = (
  profileId: SyntheticDemoProfileId | string | null | undefined,
  ordinal: number
): DemoProfileRun => {
  const profile = getDemoProfile(profileId);
  const index = positiveModulo(Math.trunc(ordinal), profile.runs.length);
  const selected = profile.runs[index];
  if (!selected) {
    throw new Error(`Synthetic demo profile ${profile.id} has no deterministic runs.`);
  }
  return clone(selected);
};

export const createSyntheticDemoProfileFixture = (
  profileId: SyntheticDemoProfileId | string | null | undefined,
  ordinal: number
): SyntheticScenarioFixtureArtifacts => {
  const selectedRun = selectDemoProfileRun(profileId, ordinal);
  return createSyntheticScenarioFixtureArtifacts({
    scenario_id: selectedRun.scenario_id,
    run_id: selectedRun.run_id
  });
};

export const projectSyntheticDemoLiveEvent = <T extends SyntheticDemoLiveEvent>(
  event: T,
  input: {
    firstTs: number;
    baseTs: number;
    seq: number;
    runId: string;
    runSerial: number;
  }
): T => {
  const cleanEvent = { ...(event as T & Record<string, unknown>) };
  delete cleanEvent.scenario_id;
  delete cleanEvent.label;
  delete cleanEvent.hiddenLabel;
  delete cleanEvent.labels;
  delete cleanEvent.source_kind;

  const traceSuffix = event.trace_id.split(":").slice(1).join(":") || event.trace_id;
  return {
    ...(cleanEvent as T),
    source_ts: input.baseTs + (event.source_ts - input.firstTs),
    ingest_ts: input.baseTs + (event.ingest_ts - input.firstTs),
    ts: input.baseTs + (event.ts - input.firstTs),
    seq: input.seq,
    trace_id: `${input.runId}:live:${input.runSerial}:${traceSuffix}`
  };
};

export const scaleSyntheticEmitIntervalMs = (
  baseIntervalMs: number,
  profileId: SyntheticLoadProfileId | string | null | undefined
): number => {
  const loadProfile = getLoadProfile(profileId);
  const normalizedBase = Number.isFinite(baseIntervalMs)
    ? Math.max(1, Math.round(baseIntervalMs))
    : 1;
  return Math.max(1, Math.round(normalizedBase / loadProfile.rate_multiplier));
};

export const scaleSyntheticDemoRunIntervalMs = (
  baseIntervalMs: number = SYNTHETIC_DEMO_RUN_INTERVAL_MS,
  profileId: SyntheticLoadProfileId | string | null | undefined
): number => scaleSyntheticEmitIntervalMs(baseIntervalMs, profileId);

export const getSyntheticLoadProfileRunCount = (
  profileId: SyntheticLoadProfileId | string | null | undefined
): number => {
  const loadProfile = getLoadProfile(profileId);
  return Math.max(1, Math.round(loadProfile.volume_multiplier));
};

export const loadProfileIdForSyntheticMarketMode = (
  mode: SyntheticMarketMode
): SyntheticLoadProfileId => {
  if (mode === "firehose") {
    return "firehose";
  }
  if (mode === "active") {
    return "active";
  }
  return "steady";
};

export const resolveSyntheticProfileControlState = (
  control: Partial<SyntheticControlState> | null | undefined
): SyntheticControlState => {
  const normalized = normalizeSyntheticControlState(control);
  const demoProfile = getDemoProfile(normalized.demo_profile_id);
  const loadProfile = getLoadProfile(normalized.load_profile_id);
  return normalizeSyntheticControlState({
    ...normalized,
    ...demoProfile.control_defaults,
    demo_profile_id: demoProfile.id,
    load_profile_id: loadProfile.id,
    updated_at: normalized.updated_at,
    updated_by: normalized.updated_by
  });
};

const positiveModulo = (value: number, length: number): number => {
  if (length <= 0) {
    return 0;
  }
  return ((value % length) + length) % length;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
