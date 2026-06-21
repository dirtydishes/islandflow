import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type GeneratedEventBatch,
  type GeneratedMarketEvent,
  type GenerateSyntheticMarketBatchInput,
  generateSyntheticMarketBatch,
  hashGeneratedEventBatch,
  type ParameterSnapshot,
  stableHash,
  stableStringify
} from "./index";
import {
  assertGeneratedMarketEventsDoNotContainHiddenLabels,
  buildExpectedOutputManifest,
  DEFAULT_SYNTHETIC_FIXTURE_ARTIFACT_LAYOUT,
  type ExpectedOutputManifest,
  parseExpectedOutputManifest,
  type SyntheticFixtureArtifactLayout
} from "./manifest";

export type CreateSyntheticFixtureInput = GenerateSyntheticMarketBatchInput & {
  run_name: string;
  profile_source_path?: string;
  artifact_layout?: Partial<SyntheticFixtureArtifactLayout>;
};

export type WriteSyntheticFixtureInput = CreateSyntheticFixtureInput & {
  output_dir: string;
};

export type SyntheticFixtureFileMap = {
  manifest: string;
  market_events: string;
  provenance: string;
  parameter_snapshot: string;
};

export type SyntheticFixtureArtifacts = {
  manifest: ExpectedOutputManifest;
  batch: GeneratedEventBatch;
  files: SyntheticFixtureFileMap;
};

export type WrittenSyntheticFixture = SyntheticFixtureArtifacts & {
  paths: SyntheticFixtureFileMap;
};

export type LoadedSyntheticFixture = {
  manifest: ExpectedOutputManifest;
  batch: GeneratedEventBatch;
};

export type LoadSyntheticFixtureInput =
  | string
  | {
      directory?: string;
      manifest_path?: string;
    };

export const createSyntheticFixtureArtifacts = (
  input: CreateSyntheticFixtureInput
): SyntheticFixtureArtifacts => {
  const batch = generateSyntheticMarketBatch(input);
  const manifest = buildExpectedOutputManifest({
    batch,
    run_name: input.run_name,
    profile_source_path: input.profile_source_path,
    artifact_layout: input.artifact_layout
  });

  return {
    manifest,
    batch,
    files: {
      manifest: toDeterministicJson(manifest),
      market_events: toDeterministicJson(batch.events),
      provenance: toDeterministicJson(batch.provenance_by_trace_id),
      parameter_snapshot: toDeterministicJson(batch.parameter_snapshot)
    }
  };
};

export const writeSyntheticFixture = async (
  input: WriteSyntheticFixtureInput
): Promise<WrittenSyntheticFixture> => {
  const artifacts = createSyntheticFixtureArtifacts(input);
  const outputDir = path.resolve(input.output_dir);
  await mkdir(outputDir, { recursive: true });

  const paths = {
    manifest: path.join(outputDir, artifacts.manifest.artifacts.manifest_path),
    market_events: path.join(outputDir, artifacts.manifest.artifacts.market_events_path),
    provenance: path.join(outputDir, artifacts.manifest.artifacts.provenance_path),
    parameter_snapshot: path.join(outputDir, artifacts.manifest.artifacts.parameter_snapshot_path)
  };

  await Promise.all([
    writeFile(paths.manifest, artifacts.files.manifest, "utf8"),
    writeFile(paths.market_events, artifacts.files.market_events, "utf8"),
    writeFile(paths.provenance, artifacts.files.provenance, "utf8"),
    writeFile(paths.parameter_snapshot, artifacts.files.parameter_snapshot, "utf8")
  ]);

  return {
    ...artifacts,
    paths
  };
};

export const loadSyntheticFixture = async (
  input: LoadSyntheticFixtureInput
): Promise<LoadedSyntheticFixture> => {
  const manifestPath = resolveManifestPath(input);
  const manifestDir = path.dirname(manifestPath);
  const manifest = parseExpectedOutputManifest(await readJsonFile(manifestPath));
  const marketEvents = (await readJsonFile(
    path.join(manifestDir, manifest.artifacts.market_events_path)
  )) as GeneratedMarketEvent[];
  const provenanceByTraceId = (await readJsonFile(
    path.join(manifestDir, manifest.artifacts.provenance_path)
  )) as GeneratedEventBatch["provenance_by_trace_id"];
  const parameterSnapshot = (await readJsonFile(
    path.join(manifestDir, manifest.artifacts.parameter_snapshot_path)
  )) as ParameterSnapshot;

  const batch: GeneratedEventBatch = {
    run: {
      run_id: manifest.run.run_id,
      seed_bundle: manifest.seed_bundle,
      start_ts: manifest.run.start_ts,
      event_count: manifest.run.event_count,
      parameter_snapshot_hash: manifest.parameter_snapshot_hash
    },
    parameter_snapshot: parameterSnapshot,
    parameter_snapshot_hash: manifest.parameter_snapshot_hash,
    events: marketEvents,
    provenance_by_trace_id: provenanceByTraceId
  };

  verifyLoadedSyntheticFixture(manifest, batch);

  return {
    manifest,
    batch
  };
};

export const toDeterministicJson = (value: unknown): string => {
  return `${stableStringify(value)}\n`;
};

const verifyLoadedSyntheticFixture = (
  manifest: ExpectedOutputManifest,
  batch: GeneratedEventBatch
) => {
  assertGeneratedMarketEventsDoNotContainHiddenLabels(batch.events);

  if (batch.events.length !== manifest.run.event_count) {
    throw new Error(
      `Fixture event file has ${batch.events.length} events, but manifest expects ${manifest.run.event_count}.`
    );
  }
  if (stableHash(batch.parameter_snapshot) !== manifest.parameter_snapshot_hash) {
    throw new Error("Fixture parameter snapshot hash does not match manifest.");
  }
  if (stableHash(batch.events) !== manifest.event_hashes.events_hash) {
    throw new Error("Fixture market event collection hash does not match manifest.");
  }
  if (hashGeneratedEventBatch(batch) !== manifest.event_hashes.batch_hash) {
    throw new Error("Fixture batch hash does not match manifest.");
  }

  for (const [index, generated] of batch.events.entries()) {
    const expected = manifest.event_hashes.events[index];
    if (!expected) {
      throw new Error(`Fixture manifest is missing event hash at index ${index}.`);
    }
    const actualHash = stableHash(generated);
    if (
      expected.index !== index ||
      expected.kind !== generated.kind ||
      expected.trace_id !== generated.event.trace_id ||
      expected.hash !== actualHash
    ) {
      throw new Error(`Fixture event hash mismatch at index ${index}.`);
    }
  }

  const replayTraceIds = manifest.replay_plan.trace_ids;
  const eventTraceIds = batch.events.map((generated) => generated.event.trace_id);
  if (stableStringify(replayTraceIds) !== stableStringify(eventTraceIds)) {
    throw new Error("Fixture replay trace ordering does not match event file ordering.");
  }
};

const resolveManifestPath = (input: LoadSyntheticFixtureInput): string => {
  if (typeof input === "string") {
    return path.join(path.resolve(input), DEFAULT_SYNTHETIC_FIXTURE_ARTIFACT_LAYOUT.manifest_path);
  }
  if (input.manifest_path) {
    return path.resolve(input.manifest_path);
  }
  if (input.directory) {
    return path.join(
      path.resolve(input.directory),
      DEFAULT_SYNTHETIC_FIXTURE_ARTIFACT_LAYOUT.manifest_path
    );
  }
  throw new Error("loadSyntheticFixture requires a directory or manifest_path.");
};

const readJsonFile = async (filePath: string): Promise<unknown> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
};
