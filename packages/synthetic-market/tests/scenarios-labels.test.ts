import { describe, expect, it } from "bun:test";
import {
  createSyntheticScenarioFixtureArtifacts,
  listSyntheticScenarioInjections,
  SYNTHETIC_GROUND_TRUTH_LABELS_VERSION,
  SYNTHETIC_SCENARIO_CATALOG_VERSION,
  SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION
} from "../src";

const EXPECTED_SCENARIO_FAMILIES = [
  "institutional_directional_flow",
  "retail_attention_flow",
  "event_noise_flow",
  "volatility_seller_behavior",
  "hedge_reactive_flow",
  "structure_arbitrage_flow",
  "no_alert_negative"
];

describe("synthetic scenario catalog and labels", () => {
  it("keeps deterministic named scenarios for every phase-03 family", () => {
    const scenarios = listSyntheticScenarioInjections();
    const scenarioIds = scenarios.map((scenario) => scenario.scenario_id);

    expect(scenarios).toHaveLength(EXPECTED_SCENARIO_FAMILIES.length);
    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    expect(scenarios.map((scenario) => scenario.family)).toEqual(EXPECTED_SCENARIO_FAMILIES);

    for (const scenario of scenarios) {
      expect(scenario.catalog_version).toBe(SYNTHETIC_SCENARIO_CATALOG_VERSION);
      expect(scenario.title.length).toBeGreaterThan(0);
      expect(scenario.profile.scenario_id).toBe(scenario.scenario_id);
      expect(scenario.seed_bundle.namespace).toBe("synthetic-phase-03");
      expect(scenario.event_selectors.length).toBeGreaterThan(0);
      expect(
        scenario.expected_output.required_evidence.length +
          scenario.expected_output.forbidden_evidence.length
      ).toBeGreaterThan(0);
      expect(scenario.expected_output.false_positive_penalty.severity).not.toBe("none");
    }
  });

  it("builds stable ground-truth sidecars separately from market event payloads", () => {
    for (const scenario of listSyntheticScenarioInjections()) {
      const fixtureA = createSyntheticScenarioFixtureArtifacts({
        scenario_id: scenario.scenario_id
      });
      const fixtureB = createSyntheticScenarioFixtureArtifacts({
        scenario_id: scenario.scenario_id
      });
      const [label] = fixtureA.labels.labels;
      const [expectedOutput] = fixtureA.smart_flow_expected_outputs.expectations;

      expect(fixtureA.files).toEqual(fixtureB.files);
      expect(fixtureA.labels.schema_version).toBe(SYNTHETIC_GROUND_TRUTH_LABELS_VERSION);
      expect(fixtureA.labels.catalog_version).toBe(SYNTHETIC_SCENARIO_CATALOG_VERSION);
      expect(fixtureA.smart_flow_expected_outputs.schema_version).toBe(
        SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION
      );
      expect(label?.run_id).toBe(fixtureA.batch.run.run_id);
      expect(label?.scenario_id).toBe(scenario.scenario_id);
      expect(label?.family).toBe(scenario.family);
      expect(label?.expected_class).toBe(scenario.expected_output.expected_class);
      expect(label?.expected_direction).toBe(scenario.expected_output.expected_direction);
      expect(label?.confidence_band).toBe(scenario.expected_output.confidence_band);
      expect(label?.event_refs.length).toBeGreaterThan(0);
      expect(expectedOutput?.label_id).toBe(label?.label_id);

      for (const eventRef of label?.event_refs ?? []) {
        expect(fixtureA.batch.provenance_by_trace_id[eventRef.trace_id]?.scenario_id).toBe(
          scenario.scenario_id
        );
      }

      expect(fixtureA.files.market_events).not.toContain(scenario.scenario_id);
      expect(fixtureA.files.market_events).not.toContain("scenario_id");
      expect(fixtureA.files.market_events).not.toContain("label_id");
      expect(fixtureA.files.market_events).not.toContain("expected_class");
      expect(fixtureA.files.labels).toContain(scenario.scenario_id);
      expect(fixtureA.files.smart_flow_outputs).toContain("alert_expectation");
    }
  });

  it("includes an explicit no-alert negative label for abstention and false-positive checks", () => {
    const fixture = createSyntheticScenarioFixtureArtifacts({
      scenario_id: "no-alert-wide-quote-chop"
    });
    const [label] = fixture.labels.labels;
    const [expectedOutput] = fixture.smart_flow_expected_outputs.expectations;

    expect(fixture.scenario.family).toBe("no_alert_negative");
    expect(label?.expected_class).toBe("unclear");
    expect(label?.expected_direction).toBe("unknown");
    expect(label?.confidence_band).toBe("low");
    expect(expectedOutput?.alert_expectation).toBe("no_alert");
    expect(expectedOutput?.false_positive_penalty.severity).toBe("high");
    expect(expectedOutput?.expected_pipeline_events).toContainEqual(
      expect.objectContaining({
        event_kind: "flow_hypothesis_event",
        expectation: "absent"
      })
    );
  });
});
