import {
  type GeneratedEventBatch,
  type GeneratedMarketEvent,
  type GeneratedMarketEventKind,
  hashGeneratedEventBatch,
  type NormalizedSeedBundle,
  SYNTHETIC_MARKET_GENERATOR_VERSION,
  stableHash
} from "./index";

export const SYNTHETIC_FIXTURE_MANIFEST_VERSION = "synthetic-market-fixture-v1";
export const SYNTHETIC_FIXTURE_REPLAY_ORDERING = ["ts", "ingest_ts", "seq", "event_id"] as const;

export type ReplayOrderingKey = (typeof SYNTHETIC_FIXTURE_REPLAY_ORDERING)[number];

export type SyntheticFixtureArtifactLayout = {
  manifest_path: string;
  market_events_path: string;
  provenance_path: string;
  parameter_snapshot_path: string;
  labels_path?: string;
  smart_flow_outputs_path?: string;
};

export type SyntheticFixtureProfileIdentity = {
  profile_hash: string;
  source_path?: string;
};

export type ReplayPlan = {
  market_events_path: string;
  order_by: ReplayOrderingKey[];
  event_count: number;
  first_event_ts: number | null;
  last_event_ts: number | null;
  event_kind_counts: Record<GeneratedMarketEventKind, number>;
  trace_ids: string[];
};

export type ExpectedOutputManifestEventHash = {
  index: number;
  kind: GeneratedMarketEventKind;
  trace_id: string;
  hash: string;
};

export type SyntheticFixtureExpectedOutputContract = {
  hidden_labels_embedded_in_market_events: false;
  labels_path: string | null;
  smart_flow_outputs_path: string | null;
  labels_hash?: string;
  smart_flow_outputs_hash?: string;
  label_count?: number;
  expected_output_count?: number;
};

export type ExpectedOutputManifest = {
  manifest_version: typeof SYNTHETIC_FIXTURE_MANIFEST_VERSION;
  generator: {
    name: "@islandflow/synthetic-market";
    version: typeof SYNTHETIC_MARKET_GENERATOR_VERSION;
  };
  run: {
    run_id: string;
    run_name: string;
    start_ts: number;
    event_count: number;
    scenario_id?: string;
  };
  seed_bundle: NormalizedSeedBundle;
  profile_identity: SyntheticFixtureProfileIdentity;
  parameter_snapshot_hash: string;
  event_hashes: {
    batch_hash: string;
    events_hash: string;
    events: ExpectedOutputManifestEventHash[];
  };
  replay_plan: ReplayPlan;
  artifacts: SyntheticFixtureArtifactLayout;
  expected_output_contract: SyntheticFixtureExpectedOutputContract;
};

export type BuildExpectedOutputManifestInput = {
  batch: GeneratedEventBatch;
  run_name: string;
  profile_source_path?: string;
  artifact_layout?: Partial<SyntheticFixtureArtifactLayout>;
  expected_output_contract?: Partial<
    Omit<SyntheticFixtureExpectedOutputContract, "hidden_labels_embedded_in_market_events">
  >;
};

export const DEFAULT_SYNTHETIC_FIXTURE_ARTIFACT_LAYOUT: SyntheticFixtureArtifactLayout = {
  manifest_path: "manifest.json",
  market_events_path: "market-events.json",
  provenance_path: "provenance.json",
  parameter_snapshot_path: "parameter-snapshot.json"
};

const HIDDEN_LABEL_FIELD_NAMES = new Set([
  "expected_outputs",
  "hidden_label",
  "hidden_labels",
  "label",
  "labels",
  "scenario_id",
  "source_kind"
]);

export const buildExpectedOutputManifest = (
  input: BuildExpectedOutputManifestInput
): ExpectedOutputManifest => {
  assertGeneratedMarketEventsDoNotContainHiddenLabels(input.batch.events);

  const artifacts = {
    ...DEFAULT_SYNTHETIC_FIXTURE_ARTIFACT_LAYOUT,
    ...input.artifact_layout
  };
  const event_hashes = input.batch.events.map((generated, index) => ({
    index,
    kind: generated.kind,
    trace_id: generated.event.trace_id,
    hash: stableHash(generated)
  }));
  const profile_hash = stableHash(input.batch.parameter_snapshot.profile);

  return {
    manifest_version: SYNTHETIC_FIXTURE_MANIFEST_VERSION,
    generator: {
      name: "@islandflow/synthetic-market",
      version: SYNTHETIC_MARKET_GENERATOR_VERSION
    },
    run: {
      run_id: input.batch.run.run_id,
      run_name: requireNonEmpty(input.run_name, "run_name"),
      start_ts: input.batch.run.start_ts,
      event_count: input.batch.run.event_count,
      scenario_id: input.batch.parameter_snapshot.profile.scenario_id
    },
    seed_bundle: input.batch.run.seed_bundle,
    profile_identity: {
      profile_hash,
      source_path: input.profile_source_path
    },
    parameter_snapshot_hash: input.batch.parameter_snapshot_hash,
    event_hashes: {
      batch_hash: hashGeneratedEventBatch(input.batch),
      events_hash: stableHash(input.batch.events),
      events: event_hashes
    },
    replay_plan: buildReplayPlan(input.batch, artifacts.market_events_path),
    artifacts,
    expected_output_contract: {
      hidden_labels_embedded_in_market_events: false,
      labels_path: input.expected_output_contract?.labels_path ?? null,
      smart_flow_outputs_path: input.expected_output_contract?.smart_flow_outputs_path ?? null,
      labels_hash: input.expected_output_contract?.labels_hash,
      smart_flow_outputs_hash: input.expected_output_contract?.smart_flow_outputs_hash,
      label_count: input.expected_output_contract?.label_count,
      expected_output_count: input.expected_output_contract?.expected_output_count
    }
  };
};

export const buildReplayPlan = (
  batch: GeneratedEventBatch,
  marketEventsPath = DEFAULT_SYNTHETIC_FIXTURE_ARTIFACT_LAYOUT.market_events_path
): ReplayPlan => {
  const timestamps = batch.events.map((generated) => generated.event.ts);

  return {
    market_events_path: marketEventsPath,
    order_by: [...SYNTHETIC_FIXTURE_REPLAY_ORDERING],
    event_count: batch.events.length,
    first_event_ts: timestamps.length > 0 ? Math.min(...timestamps) : null,
    last_event_ts: timestamps.length > 0 ? Math.max(...timestamps) : null,
    event_kind_counts: countEventKinds(batch.events),
    trace_ids: batch.events.map((generated) => generated.event.trace_id)
  };
};

export const parseExpectedOutputManifest = (value: unknown): ExpectedOutputManifest => {
  const manifest = requireRecord(value, "manifest");
  const manifestVersion = manifest.manifest_version;

  if (manifestVersion !== SYNTHETIC_FIXTURE_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported synthetic fixture manifest version: ${String(manifestVersion ?? "(missing)")}`
    );
  }

  const parsed = manifest as ExpectedOutputManifest;

  if (parsed.generator?.version !== SYNTHETIC_MARKET_GENERATOR_VERSION) {
    throw new Error(
      `Unsupported synthetic generator version: ${String(parsed.generator?.version ?? "(missing)")}`
    );
  }
  if (!Array.isArray(parsed.event_hashes?.events)) {
    throw new Error("Synthetic fixture manifest is missing event_hashes.events.");
  }
  if (!Array.isArray(parsed.replay_plan?.order_by)) {
    throw new Error("Synthetic fixture manifest is missing replay_plan.order_by.");
  }
  if (parsed.replay_plan.order_by.join(",") !== SYNTHETIC_FIXTURE_REPLAY_ORDERING.join(",")) {
    throw new Error(
      `Unsupported replay ordering: ${parsed.replay_plan.order_by.join(",") || "(missing)"}`
    );
  }
  if (parsed.run.event_count !== parsed.event_hashes.events.length) {
    throw new Error(
      `Manifest event_count ${parsed.run.event_count} does not match ${parsed.event_hashes.events.length} event hashes.`
    );
  }
  if (parsed.expected_output_contract?.hidden_labels_embedded_in_market_events !== false) {
    throw new Error("Synthetic fixture manifest must declare market events label-free.");
  }
  assertNullablePath(parsed.expected_output_contract.labels_path, "labels_path");
  assertNullablePath(
    parsed.expected_output_contract.smart_flow_outputs_path,
    "smart_flow_outputs_path"
  );

  return parsed;
};

export const assertGeneratedMarketEventsDoNotContainHiddenLabels = (
  events: GeneratedMarketEvent[]
) => {
  for (const [eventIndex, generated] of events.entries()) {
    assertNoHiddenLabelFields(generated.event, `events[${eventIndex}].event`);
  }
};

const countEventKinds = (
  events: GeneratedMarketEvent[]
): Record<GeneratedMarketEventKind, number> => {
  const counts: Record<GeneratedMarketEventKind, number> = {
    equity_quote: 0,
    equity_print: 0,
    option_nbbo: 0,
    option_print: 0
  };

  for (const generated of events) {
    counts[generated.kind] += 1;
  }

  return counts;
};

const assertNoHiddenLabelFields = (value: unknown, path: string) => {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoHiddenLabelFields(entry, `${path}[${index}]`);
    }
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (HIDDEN_LABEL_FIELD_NAMES.has(key)) {
      throw new Error(`Market event payload contains hidden-label field ${path}.${key}.`);
    }
    assertNoHiddenLabelFields(nested, `${path}.${key}`);
  }
};

const requireNonEmpty = (value: string, fieldName: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Synthetic fixture ${fieldName} is required.`);
  }
  return normalized;
};

const requireRecord = (value: unknown, fieldName: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Synthetic fixture ${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const assertNullablePath = (value: unknown, fieldName: string) => {
  if (value !== null && typeof value !== "string") {
    throw new Error(
      `Synthetic fixture expected_output_contract.${fieldName} must be a path or null.`
    );
  }
};
