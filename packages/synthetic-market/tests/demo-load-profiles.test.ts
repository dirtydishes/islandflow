import { describe, expect, it } from "bun:test";
import {
  createSyntheticDemoProfileFixture,
  getLoadProfile,
  getSyntheticLoadProfileRunCount,
  listDemoProfiles,
  listLoadProfiles,
  loadProfileIdForSyntheticMarketMode,
  projectSyntheticDemoLiveEvent,
  resolveSyntheticProfileControlState,
  scaleSyntheticDemoRunIntervalMs,
  scaleSyntheticEmitIntervalMs,
  SYNTHETIC_DEMO_RUN_INTERVAL_MS,
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

  it("projects fixture events into live traces without leaking labels", () => {
    const projected = projectSyntheticDemoLiveEvent(
      {
        source_ts: 1_000,
        ingest_ts: 1_001,
        ts: 1_002,
        seq: 7,
        trace_id: "fixture:equity:1",
        scenario_id: "hidden-scenario",
        label: "hidden-label",
        hiddenLabel: "also-hidden",
        labels: ["hidden"],
        source_kind: "fixture"
      } as any,
      {
        firstTs: 1_000,
        baseTs: 10_000,
        seq: 42,
        runId: "phase03-x",
        runSerial: 3
      }
    );

    expect(projected).toMatchObject({
      source_ts: 10_000,
      ingest_ts: 10_001,
      ts: 10_002,
      seq: 42,
      trace_id: "phase03-x:live:3:equity:1"
    });
    expect("scenario_id" in projected).toBe(false);
    expect("label" in projected).toBe(false);
    expect("hiddenLabel" in projected).toBe(false);
    expect("labels" in projected).toBe(false);
    expect("source_kind" in projected).toBe(false);
  });
});

describe("synthetic load profiles", () => {
  it("scales regular emit cadence without changing selected run semantics", () => {
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

  it("scales demo-run injection cadence and run count separately from regular emits", () => {
    expect(SYNTHETIC_DEMO_RUN_INTERVAL_MS).toBe(60_000);
    expect(scaleSyntheticDemoRunIntervalMs(SYNTHETIC_DEMO_RUN_INTERVAL_MS, "steady")).toBe(
      60_000
    );
    expect(scaleSyntheticDemoRunIntervalMs(SYNTHETIC_DEMO_RUN_INTERVAL_MS, "active")).toBe(
      30_000
    );
    expect(scaleSyntheticDemoRunIntervalMs(SYNTHETIC_DEMO_RUN_INTERVAL_MS, "firehose")).toBe(
      15_000
    );
    expect(getSyntheticLoadProfileRunCount("steady")).toBe(1);
    expect(getSyntheticLoadProfileRunCount("active")).toBe(1);
    expect(getSyntheticLoadProfileRunCount("firehose")).toBe(2);
    expect(selectDemoProfileRun("quiet-range", 0)).toMatchObject({
      scenario_id: "structure-arbitrage-calm",
      run_id: "phase03-f"
    });
    expect(selectDemoProfileRun("quiet-range", 1)).toMatchObject({
      scenario_id: "volatility-seller-supply",
      run_id: "phase03-d"
    });
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
