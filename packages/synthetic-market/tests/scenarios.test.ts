import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSyntheticFixture } from "../src/fixtures";
import { stableHash } from "../src/index";
import { parseExpectedOutputManifest } from "../src/manifest";
import {
  createSyntheticScenarioFixtureArtifacts,
  listSyntheticScenarioInjections,
  SYNTHETIC_GROUND_TRUTH_LABELS_VERSION,
  SYNTHETIC_SCENARIO_CATALOG_VERSION,
  SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION,
  writeSyntheticScenarioFixture
} from "../src/scenarios";

const expectedFamilies = [
  "institutional_directional_flow",
  "retail_attention_flow",
  "event_noise_flow",
  "volatility_seller_behavior",
  "hedge_reactive_flow",
  "structure_arbitrage_flow",
  "no_alert_negative"
].sort();

describe("synthetic scenario catalog labels and expected outputs", () => {
  it("defines one deterministic named scenario for each phase 03 family", () => {
    const scenarios = listSyntheticScenarioInjections();

    expect(scenarios.map((scenario) => scenario.family).sort()).toEqual(expectedFamilies);
    expect(new Set(scenarios.map((scenario) => scenario.scenario_id)).size).toBe(scenarios.length);
    for (const scenario of scenarios) {
      expect(scenario.catalog_version).toBe(SYNTHETIC_SCENARIO_CATALOG_VERSION);
      expect(scenario.profile.scenario_id).toBe(scenario.scenario_id);
      expect(scenario.event_selectors.length).toBeGreaterThanOrEqual(3);
      expect(scenario.expected_output.required_evidence.length).toBeGreaterThan(0);
      expect(scenario.expected_output.forbidden_evidence.length).toBeGreaterThan(0);
      expect(scenario.expected_output.expected_pipeline_events.length).toBeGreaterThan(0);
    }
  });

  it("builds deterministic scenario fixtures without embedding labels in market events", () => {
    for (const scenario of listSyntheticScenarioInjections()) {
      const fixtureA = createSyntheticScenarioFixtureArtifacts({
        scenario_id: scenario.scenario_id
      });
      const fixtureB = createSyntheticScenarioFixtureArtifacts({
        scenario_id: scenario.scenario_id
      });

      expect(fixtureA.files).toEqual(fixtureB.files);
      expect(parseExpectedOutputManifest(JSON.parse(fixtureA.files.manifest))).toEqual(
        fixtureA.manifest
      );
      expect(fixtureA.manifest.expected_output_contract).toMatchObject({
        hidden_labels_embedded_in_market_events: false,
        labels_path: "labels.json",
        smart_flow_outputs_path: "smart-flow-expected-outputs.json",
        label_count: 1,
        expected_output_count: 1
      });
      expect(fixtureA.manifest.expected_output_contract.labels_hash).toBe(
        stableHash(fixtureA.labels)
      );
      expect(fixtureA.manifest.expected_output_contract.smart_flow_outputs_hash).toBe(
        stableHash(fixtureA.smart_flow_expected_outputs)
      );
      expect(fixtureA.labels.schema_version).toBe(SYNTHETIC_GROUND_TRUTH_LABELS_VERSION);
      expect(fixtureA.labels.catalog_version).toBe(SYNTHETIC_SCENARIO_CATALOG_VERSION);
      expect(fixtureA.smart_flow_expected_outputs.schema_version).toBe(
        SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION
      );
      expect(fixtureA.smart_flow_expected_outputs.source_label_hash).toBe(
        stableHash(fixtureA.labels)
      );

      const marketEventBytes = fixtureA.files.market_events;
      expect(marketEventBytes).not.toContain(scenario.scenario_id);
      expect(marketEventBytes).not.toContain("scenario_id");
      expect(marketEventBytes).not.toContain("label_id");
      expect(marketEventBytes).not.toContain("expected_class");

      const traceIds = new Set(fixtureA.batch.events.map((generated) => generated.event.trace_id));
      const [label] = fixtureA.labels.labels;
      const [expectedOutput] = fixtureA.smart_flow_expected_outputs.expectations;
      expect(label).toBeDefined();
      expect(expectedOutput).toBeDefined();
      expect(expectedOutput?.label_id).toBe(label?.label_id);
      expect(expectedOutput?.required_evidence.length).toBeGreaterThan(0);
      expect(expectedOutput?.forbidden_evidence.length).toBeGreaterThan(0);
      expect(expectedOutput?.false_positive_penalty.score).toBeGreaterThanOrEqual(0);

      for (const ref of label?.event_refs ?? []) {
        expect(traceIds.has(ref.trace_id)).toBe(true);
      }
    }
  });

  it("includes positive alert expectations and a no-alert false-positive case", () => {
    const expectations = listSyntheticScenarioInjections().map((scenario) => {
      return createSyntheticScenarioFixtureArtifacts({
        scenario_id: scenario.scenario_id
      }).smart_flow_expected_outputs.expectations[0];
    });

    expect(
      expectations.filter((expectation) => expectation?.alert_expectation === "alert")
    ).toHaveLength(6);
    const noAlert = expectations.find(
      (expectation) => expectation?.alert_expectation === "no_alert"
    );
    expect(noAlert?.expected_class).toBe("unclear");
    expect(noAlert?.expected_direction).toBe("unknown");
    expect(noAlert?.false_positive_penalty.severity).toBe("high");
    expect(noAlert?.expected_pipeline_events).toContainEqual(
      expect.objectContaining({
        event_kind: "flow_hypothesis_event",
        expectation: "absent"
      })
    );
  });

  it("writes scenario sidecars and keeps generic fixture loading infra-free", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "islandflow-synthetic-scenario-"));

    try {
      const written = await writeSyntheticScenarioFixture({
        scenario_id: "institutional-directional-flow",
        output_dir: directory
      });
      const loaded = await loadSyntheticFixture(directory);
      const labels = JSON.parse(await readFile(written.paths.labels, "utf8"));
      const expectedOutputs = JSON.parse(await readFile(written.paths.smart_flow_outputs, "utf8"));

      expect(loaded.manifest).toEqual(written.manifest);
      expect(loaded.batch).toEqual(written.batch);
      expect(labels).toEqual(written.labels);
      expect(expectedOutputs).toEqual(written.smart_flow_expected_outputs);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
