import { describe, expect, it } from "bun:test";
import {
  buildGroundTruthLabels,
  generateSyntheticMarketBatch,
  getScenarioInjection,
  listScenarioInjections,
  SYNTHETIC_GROUND_TRUTH_LABEL_VERSION,
  SYNTHETIC_SCENARIO_CATALOG_VERSION,
  stableStringify
} from "../src";

const EXPECTED_SCENARIO_FAMILIES = [
  "institutional_directional",
  "retail_whale",
  "event_driven",
  "vol_seller",
  "hedge_reactive",
  "arbitrage",
  "neutral_noise"
];

describe("synthetic scenario catalog and labels", () => {
  it("defines deterministic named scenarios for every phase-03a family", () => {
    const scenarios = listScenarioInjections();
    const scenarioIds = scenarios.map((scenario) => scenario.scenario_id);

    expect(scenarios).toHaveLength(EXPECTED_SCENARIO_FAMILIES.length);
    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    expect(scenarios.map((scenario) => scenario.family_id)).toEqual(EXPECTED_SCENARIO_FAMILIES);

    for (const scenario of scenarios) {
      expect(scenario.catalog_version).toBe(SYNTHETIC_SCENARIO_CATALOG_VERSION);
      expect(scenario.name.length).toBeGreaterThan(0);
      expect(scenario.profile.scenario_id).toBe(scenario.scenario_id);
      expect(scenario.seed_bundle.namespace).toBe("synthetic-phase-03a");
      expect(scenario.label_policy.anchor_event_kinds.length).toBeGreaterThan(0);
      expect(
        scenario.label_policy.required_evidence.length +
          scenario.label_policy.forbidden_evidence.length
      ).toBeGreaterThan(0);
      expect(scenario.label_policy.false_positive_penalties.length).toBeGreaterThan(0);
    }
  });

  it("builds stable ground-truth labels separately from market event payloads", () => {
    for (const [index, scenario] of listScenarioInjections().entries()) {
      const batchA = generateSyntheticMarketBatch({
        seed_bundle: scenario.seed_bundle,
        profile: scenario.profile,
        run_id: `phase-03a-catalog-${index}`
      });
      const batchB = generateSyntheticMarketBatch({
        seed_bundle: scenario.seed_bundle,
        profile: scenario.profile,
        run_id: `phase-03a-catalog-${index}`
      });
      const labelsA = buildGroundTruthLabels(batchA, scenario);
      const labelsB = buildGroundTruthLabels(batchB, scenario);
      const [label] = labelsA;

      expect(stableStringify(batchA)).toBe(stableStringify(batchB));
      expect(stableStringify(labelsA)).toBe(stableStringify(labelsB));
      expect(labelsA).toHaveLength(1);
      expect(label?.label_version).toBe(SYNTHETIC_GROUND_TRUTH_LABEL_VERSION);
      expect(label?.run_id).toBe(batchA.run.run_id);
      expect(label?.scenario_id).toBe(scenario.scenario_id);
      expect(label?.expected_class).toBe(scenario.expected_class);
      expect(label?.expected_direction).toBe(scenario.expected_direction);
      expect(label?.confidence_band).toBe(scenario.confidence_band);
      expect(label?.event_refs.length).toBeGreaterThan(0);

      for (const eventRef of label?.event_refs ?? []) {
        expect(batchA.provenance_by_trace_id[eventRef.trace_id]?.scenario_id).toBe(
          scenario.scenario_id
        );
        expect(eventRef.underlying_id.length).toBeGreaterThan(0);
      }

      const marketEventBytes = stableStringify(batchA.events);
      expect(marketEventBytes).not.toContain(scenario.scenario_id);
      expect(marketEventBytes).not.toContain("expected_class");
      expect(marketEventBytes).not.toContain("required_evidence");
      expect(marketEventBytes).not.toContain("false_positive_penalties");
    }
  });

  it("includes an explicit no-alert negative label for abstention and false-positive checks", () => {
    const scenario = getScenarioInjection("synthetic:no-alert:quiet-clean-background");
    const batch = generateSyntheticMarketBatch({
      seed_bundle: scenario.seed_bundle,
      profile: scenario.profile,
      run_id: "phase-03a-no-alert"
    });
    const [label] = buildGroundTruthLabels(batch, scenario);

    expect(scenario.family_id).toBe("neutral_noise");
    expect(label?.expected_class).toBe("no_alert");
    expect(label?.expected_hypothesis_type).toBe("unclear");
    expect(label?.confidence_band).toBe("abstain");
    expect(label?.no_alert_expected).toBe(true);
    expect(label?.forbidden_evidence.map((entry) => entry.kind)).toEqual([
      "premium_size",
      "execution_aggression",
      "event_context"
    ]);
    expect(label?.false_positive_penalties).toContainEqual({
      penalty_id: "quiet-background-alerted",
      applies_to: "any_alert",
      severity: "high",
      reason: "Any positive smart-flow alert on this scenario is a false positive."
    });
  });

  it("returns cloned scenario records so callers cannot mutate the catalog", () => {
    const scenario = getScenarioInjection("synthetic:institutional-directional:call-accumulation");
    scenario.profile.symbols[0]!.underlying_id = "MUTATED";

    expect(
      getScenarioInjection("synthetic:institutional-directional:call-accumulation").profile
        .symbols[0]?.underlying_id
    ).toBe("SPY");
  });
});
