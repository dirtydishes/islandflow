import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedMarketEvent } from "@islandflow/synthetic-market";
import { SYNTHETIC_SOURCE_KIND, stableHash } from "@islandflow/synthetic-market";
import {
  type LoadedSyntheticFixture,
  type LoadSyntheticFixtureInput,
  loadSyntheticFixture
} from "@islandflow/synthetic-market/fixtures";
import type { ExpectedOutputManifest } from "@islandflow/synthetic-market/manifest";
import type { EquityPrint, EquityQuote, OptionNBBO, OptionPrint } from "@islandflow/types";

export type SyntheticReplayStreamKind = "options" | "nbbo" | "equities" | "equity-quotes";

export type SyntheticReplaySelector = {
  source_id?: string;
  run_id?: string;
};

export type SyntheticFixtureReplayEvent = {
  stream: SyntheticReplayStreamKind;
  generated: GeneratedMarketEvent;
  event: OptionPrint | OptionNBBO | EquityPrint | EquityQuote;
  stable_event_id: string;
};

export type SyntheticFixtureReplayPlan = {
  manifest: ExpectedOutputManifest;
  source_id: string;
  run_id: string;
  order_by: readonly ["ts", "ingest_ts", "seq", "event_id"];
  events: SyntheticFixtureReplayEvent[];
};

export type SyntheticDerivedOutputComparison = {
  kind: "smart_flow_outputs";
  expected_hash: string;
  actual_hash: string;
  matches: boolean;
};

export const syntheticReplayStreamForKind = (
  kind: GeneratedMarketEvent["kind"]
): SyntheticReplayStreamKind => {
  switch (kind) {
    case "option_print":
      return "options";
    case "option_nbbo":
      return "nbbo";
    case "equity_print":
      return "equities";
    case "equity_quote":
      return "equity-quotes";
  }
};

export const createSyntheticFixtureReplayPlan = (
  fixture: LoadedSyntheticFixture,
  selector: SyntheticReplaySelector = {}
): SyntheticFixtureReplayPlan => {
  const sourceId = normalizeSelectorValue(selector.source_id) ?? SYNTHETIC_SOURCE_KIND;
  const runId = normalizeSelectorValue(selector.run_id) ?? fixture.manifest.run.run_id;

  if (sourceId !== SYNTHETIC_SOURCE_KIND) {
    throw new Error(
      `Synthetic replay source_id ${sourceId} is unsupported; expected ${SYNTHETIC_SOURCE_KIND}.`
    );
  }
  if (fixture.manifest.run.run_id !== runId) {
    throw new Error(
      `Synthetic replay run_id ${runId} does not match fixture run ${fixture.manifest.run.run_id}.`
    );
  }

  for (const generated of fixture.batch.events) {
    const provenance = fixture.batch.provenance_by_trace_id[generated.event.trace_id];
    if (!provenance) {
      throw new Error(`Synthetic replay event ${generated.event.trace_id} is missing provenance.`);
    }
    if (provenance.source_kind !== sourceId) {
      throw new Error(
        `Synthetic replay event ${generated.event.trace_id} has source ${provenance.source_kind}, expected ${sourceId}.`
      );
    }
    if (provenance.run_id !== runId) {
      throw new Error(
        `Synthetic replay event ${generated.event.trace_id} has run ${provenance.run_id}, expected ${runId}.`
      );
    }
  }

  const ordered = orderSyntheticReplayEvents(fixture.batch.events);
  const orderedIds = ordered.map((generated) => getStableEventId(generated));
  if (JSON.stringify(orderedIds) !== JSON.stringify(fixture.manifest.replay_plan.trace_ids)) {
    throw new Error("Synthetic fixture replay ordering does not match manifest trace order.");
  }

  return {
    manifest: fixture.manifest,
    source_id: sourceId,
    run_id: runId,
    order_by: ["ts", "ingest_ts", "seq", "event_id"],
    events: ordered.map((generated) => ({
      stream: syntheticReplayStreamForKind(generated.kind),
      generated,
      event: generated.event,
      stable_event_id: getStableEventId(generated)
    }))
  };
};

export const loadSyntheticFixtureReplayPlan = async (
  input: LoadSyntheticFixtureInput,
  selector: SyntheticReplaySelector = {}
): Promise<SyntheticFixtureReplayPlan> => {
  return createSyntheticFixtureReplayPlan(await loadSyntheticFixture(input), selector);
};

export const orderSyntheticReplayEvents = (
  events: readonly GeneratedMarketEvent[]
): GeneratedMarketEvent[] => {
  return [...events].sort((a, b) => {
    return (
      a.event.ts - b.event.ts ||
      a.event.ingest_ts - b.event.ingest_ts ||
      a.event.seq - b.event.seq ||
      getStableEventId(a).localeCompare(getStableEventId(b))
    );
  });
};

export const compareSyntheticDerivedOutputsToManifest = (
  manifest: ExpectedOutputManifest,
  actualOutputs: unknown
): SyntheticDerivedOutputComparison => {
  const expectedHash = manifest.expected_output_contract.smart_flow_outputs_hash;
  if (!expectedHash) {
    throw new Error("Synthetic fixture manifest does not include a smart-flow output hash.");
  }

  const actualHash = stableHash(actualOutputs);
  return {
    kind: "smart_flow_outputs",
    expected_hash: expectedHash,
    actual_hash: actualHash,
    matches: actualHash === expectedHash
  };
};

export const compareSyntheticFixtureExpectedOutputs = async (
  input: LoadSyntheticFixtureInput
): Promise<SyntheticDerivedOutputComparison> => {
  const fixture = await loadSyntheticFixture(input);
  const expectedPath = fixture.manifest.expected_output_contract.smart_flow_outputs_path;
  if (!expectedPath) {
    throw new Error("Synthetic fixture manifest does not point to smart-flow expected outputs.");
  }
  const manifestPath = resolveManifestPath(input);
  const raw = await readFile(path.join(path.dirname(manifestPath), expectedPath), "utf8");
  return compareSyntheticDerivedOutputsToManifest(fixture.manifest, JSON.parse(raw));
};

const getStableEventId = (generated: GeneratedMarketEvent): string => generated.event.trace_id;

const normalizeSelectorValue = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const resolveManifestPath = (input: LoadSyntheticFixtureInput): string => {
  if (typeof input === "string") {
    return path.join(path.resolve(input), "manifest.json");
  }
  if (input.manifest_path) {
    return path.resolve(input.manifest_path);
  }
  if (input.directory) {
    return path.join(path.resolve(input.directory), "manifest.json");
  }
  throw new Error("Synthetic fixture comparison requires a directory or manifest_path.");
};
