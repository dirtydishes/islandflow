import { describe, expect, it } from "bun:test";
import {
  createSyntheticDemoProfileFixture,
  getLoadProfile,
  getSyntheticLoadProfileRunCount,
  listDemoProfiles,
  listLoadProfiles,
  loadProfileIdForSyntheticMarketMode,
  resolveSyntheticProfileControlState,
  scaleSyntheticEmitIntervalMs,
  selectDemoProfileRun
} from "../src/profiles";

describe("synthetic demo profiles", () => {
  it("selects named deterministic scenario runs instead of ambient randomness", () => {
    const profiles = listDemoProfiles();

    expect(profiles.map((profile) => profile.id)).toEqual([
      "market-command",
      "event-response",
      "quiet-range",
      "stress-tape"
    ]);

    const first = selectDemoProfileRun("market-command", 0);
    const wrapped = selectDemoProfileRun("market-command", 4);

    expect(first).toEqual(wrapped);
    expect(first).toMatchObject({
      scenario_id: "institutional-directional-flow",
      run_id: "phase03-a"
    });
  });

  it("creates byte-stable fixtures for named demo runs", () => {
    const fixtureA = createSyntheticDemoProfileFixture("event-response", 0);
    const fixtureB = createSyntheticDemoProfileFixture("event-response", 0);

    expect(fixtureA.files).toEqual(fixtureB.files);
    expect(fixtureA.manifest.run.scenario_id).toBe("event-noise-positioning");
    expect(fixtureA.manifest.run.run_id).toBe("phase03-c");
    expect(fixtureA.manifest.expected_output_contract.hidden_labels_embedded_in_market_events).toBe(
      false
    );
  });
});

describe("synthetic load profiles", () => {
  it("scales playback cadence and run count without changing selected run semantics", () => {
    const steady = getLoadProfile("steady");
    const firehose = getLoadProfile("firehose");
    const steadyFixture = createSyntheticDemoProfileFixture("market-command", 0);
    const firehoseFixture = createSyntheticDemoProfileFixture("market-command", 0);

    expect(listLoadProfiles().map((profile) => profile.id)).toEqual([
      "steady",
      "active",
      "firehose"
    ]);
    expect(scaleSyntheticEmitIntervalMs(1000, "steady")).toBe(1000);
    expect(scaleSyntheticEmitIntervalMs(1000, "active")).toBe(500);
    expect(scaleSyntheticEmitIntervalMs(1000, "firehose")).toBe(250);
    expect(getSyntheticLoadProfileRunCount("steady")).toBe(1);
    expect(getSyntheticLoadProfileRunCount("firehose")).toBe(2);
    expect(loadProfileIdForSyntheticMarketMode("realistic")).toBe("steady");
    expect(loadProfileIdForSyntheticMarketMode("active")).toBe("active");
    expect(loadProfileIdForSyntheticMarketMode("firehose")).toBe("firehose");
    expect(steady.mode).toBe("realistic");
    expect(firehose.mode).toBe("firehose");
    expect(firehoseFixture.manifest.run).toEqual(steadyFixture.manifest.run);
    expect(firehoseFixture.batch.parameter_snapshot.profile).toEqual(
      steadyFixture.batch.parameter_snapshot.profile
    );
  });

  it("maps demo profile selection to deterministic control defaults", () => {
    const resolved = resolveSyntheticProfileControlState({
      demo_profile_id: "event-response",
      load_profile_id: "active",
      updated_at: 123,
      updated_by: "test"
    });

    expect(resolved.demo_profile_id).toBe("event-response");
    expect(resolved.load_profile_id).toBe("active");
    expect(resolved.preset_id).toBe("event_day");
    expect(resolved.shared_seed).toBe(23);
    expect(resolved.profile_weights.event_driven).toBe(1.6);
    expect(resolved.updated_at).toBe(123);
    expect(resolved.updated_by).toBe("test");
  });
});
