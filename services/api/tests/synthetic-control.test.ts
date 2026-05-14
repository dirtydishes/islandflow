import { describe, expect, it } from "bun:test";
import { DEFAULT_SYNTHETIC_CONTROL_STATE } from "@islandflow/types";
import {
  buildSyntheticDerivedStatus,
  createRollingSyntheticProfileHits,
  getSyntheticBackendDisabledReason,
  getSyntheticProfileHitCounts,
  recordSyntheticProfileHit,
  resolveSyntheticBackendMode
} from "../src/synthetic-control";

describe("synthetic control backend mode", () => {
  it("detects synthetic, mixed, and live hosted modes", () => {
    expect(resolveSyntheticBackendMode("synthetic", "synthetic")).toBe("synthetic");
    expect(resolveSyntheticBackendMode("synthetic", "alpaca")).toBe("mixed");
    expect(resolveSyntheticBackendMode("alpaca", "alpaca")).toBe("live");
  });

  it("provides a useful disabled reason for non-synthetic modes", () => {
    expect(getSyntheticBackendDisabledReason("mixed")).toContain("both hosted ingest adapters");
    expect(getSyntheticBackendDisabledReason("live")).toContain("not synthetic");
  });
});

describe("synthetic control rolling status", () => {
  it("tracks public-profile hits inside the rolling coverage window", () => {
    const hits = createRollingSyntheticProfileHits();

    recordSyntheticProfileHit(hits, {
      primary_profile_id: "event_driven",
      source_ts: 1_000
    });
    recordSyntheticProfileHit(hits, {
      primary_profile_id: "event_driven",
      source_ts: 60_000
    });
    recordSyntheticProfileHit(hits, {
      primary_profile_id: "arbitrage",
      source_ts: 70_000
    });

    expect(getSyntheticProfileHitCounts(hits, 11 * 60_000, 10)).toEqual({
      institutional_directional: 0,
      retail_whale: 0,
      event_driven: 1,
      vol_seller: 0,
      arbitrage: 1,
      hedge_reactive: 0
    });
  });

  it("builds derived status from the shared session engine", () => {
    const hits = createRollingSyntheticProfileHits();
    recordSyntheticProfileHit(hits, {
      primary_profile_id: "hedge_reactive",
      source_ts: Date.parse("2026-01-14T18:00:00Z")
    });

    const derived = buildSyntheticDerivedStatus(
      Date.parse("2026-01-14T18:05:00Z"),
      DEFAULT_SYNTHETIC_CONTROL_STATE,
      hits
    );

    expect(derived.coverage_window_minutes).toBe(20);
    expect(derived.focus_symbols.length).toBeGreaterThan(0);
    expect(derived.profile_hit_counts.hedge_reactive).toBe(1);
  });
});
