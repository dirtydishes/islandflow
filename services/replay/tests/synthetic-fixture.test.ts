import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SYNTHETIC_SOURCE_KIND } from "@islandflow/synthetic-market";
import {
  createSyntheticScenarioFixtureArtifacts,
  writeSyntheticScenarioFixture
} from "@islandflow/synthetic-market/scenarios";
import {
  compareSyntheticDerivedOutputsToManifest,
  compareSyntheticFixtureExpectedOutputs,
  createSyntheticFixtureReplayPlan
} from "../src/synthetic-fixture";

describe("synthetic fixture replay integration", () => {
  it("selects a synthetic source/run and restores manifest replay ordering", () => {
    const fixture = createSyntheticScenarioFixtureArtifacts({
      scenario_id: "institutional-directional-flow"
    });
    const shuffledFixture = {
      manifest: fixture.manifest,
      batch: {
        ...fixture.batch,
        events: [...fixture.batch.events].reverse()
      }
    };

    const replay = createSyntheticFixtureReplayPlan(shuffledFixture, {
      source_id: SYNTHETIC_SOURCE_KIND,
      run_id: fixture.manifest.run.run_id
    });

    expect(replay.source_id).toBe("synthetic_market");
    expect(replay.run_id).toBe(fixture.manifest.run.run_id);
    expect(replay.order_by).toEqual(["ts", "ingest_ts", "seq", "trace_id"]);
    expect(replay.events.map((entry) => entry.stable_trace_id)).toEqual(
      fixture.manifest.replay_plan.trace_ids
    );
    expect(new Set(replay.events.map((entry) => entry.stream))).toEqual(
      new Set(["equity-quotes", "equities", "nbbo", "options"])
    );
  });

  it("rejects selectors that would mix synthetic runs or source IDs", () => {
    const fixture = createSyntheticScenarioFixtureArtifacts({
      scenario_id: "retail-attention-call-chase"
    });

    expect(() =>
      createSyntheticFixtureReplayPlan(fixture, {
        source_id: SYNTHETIC_SOURCE_KIND,
        run_id: "different-run"
      })
    ).toThrow("does not match fixture run");
    expect(() =>
      createSyntheticFixtureReplayPlan(fixture, {
        source_id: "live_market",
        run_id: fixture.manifest.run.run_id
      })
    ).toThrow("unsupported");
  });

  it("compares derived smart-flow output signatures to manifest signatures", async () => {
    const fixture = createSyntheticScenarioFixtureArtifacts({
      scenario_id: "structure-arbitrage-calm"
    });

    const match = compareSyntheticDerivedOutputsToManifest(
      fixture.manifest,
      fixture.smart_flow_expected_outputs
    );
    const mismatch = compareSyntheticDerivedOutputsToManifest(fixture.manifest, {
      ...fixture.smart_flow_expected_outputs,
      expectations: []
    });

    expect(match.matches).toBe(true);
    expect(match.expected_hash).toBe(
      fixture.manifest.expected_output_contract.smart_flow_outputs_hash
    );
    expect(mismatch.matches).toBe(false);
  });

  it("loads fixture sidecars and verifies their expected-output signature infra-free", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "islandflow-replay-synthetic-"));

    try {
      await writeSyntheticScenarioFixture({
        scenario_id: "hedge-reactive-put-flow",
        output_dir: directory
      });

      const comparison = await compareSyntheticFixtureExpectedOutputs(directory);

      expect(comparison.matches).toBe(true);
      expect(comparison.kind).toBe("smart_flow_outputs");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
