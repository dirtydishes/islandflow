import { describe, expect, it } from "bun:test";
import { SYNTHETIC_SOURCE_KIND } from "@islandflow/synthetic-market";
import {
  createSyntheticDemoProfileFixture,
  listDemoProfiles
} from "@islandflow/synthetic-market/profiles";
import { createSyntheticFixtureReplayPlan } from "../src/synthetic-fixture";

describe("synthetic demo profile replay smoke", () => {
  it("replays every named demo profile through source and run selectors", () => {
    for (const profile of listDemoProfiles()) {
      const fixture = createSyntheticDemoProfileFixture(profile.id, 0);
      const replay = createSyntheticFixtureReplayPlan(fixture, {
        source_id: SYNTHETIC_SOURCE_KIND,
        run_id: fixture.manifest.run.run_id
      });

      expect(replay.run_id, profile.id).toBe(fixture.manifest.run.run_id);
      expect(replay.source_id, profile.id).toBe(SYNTHETIC_SOURCE_KIND);
      expect(replay.events.length, profile.id).toBe(fixture.manifest.run.event_count);
      expect(
        replay.events.map((event) => event.stable_trace_id),
        profile.id
      ).toEqual(fixture.manifest.replay_plan.trace_ids);
    }
  });
});
