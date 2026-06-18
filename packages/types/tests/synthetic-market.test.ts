import { describe, expect, it } from "bun:test";
import {
  buildEmptySyntheticProfileHitCounts,
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  getSyntheticCoverageBoost,
  getSyntheticScenarioWeights,
  getSyntheticSessionState,
  getSyntheticUnderlyingState
} from "../src/synthetic-market";

describe("synthetic market regime engine", () => {
  it("includes named demo and load profile selectors in the default control state", () => {
    expect(DEFAULT_SYNTHETIC_CONTROL_STATE.demo_profile_id).toBe("market-command");
    expect(DEFAULT_SYNTHETIC_CONTROL_STATE.load_profile_id).toBe("steady");
  });

  it("is deterministic for the same timestamp, control, and seed", () => {
    const ts = Date.parse("2026-01-14T15:25:00Z");
    const sessionA = getSyntheticSessionState(ts, DEFAULT_SYNTHETIC_CONTROL_STATE);
    const sessionB = getSyntheticSessionState(ts, DEFAULT_SYNTHETIC_CONTROL_STATE);
    const underlyingA = getSyntheticUnderlyingState(
      "NVDA",
      ts,
      DEFAULT_SYNTHETIC_CONTROL_STATE,
      sessionA
    );
    const underlyingB = getSyntheticUnderlyingState(
      "NVDA",
      ts,
      DEFAULT_SYNTHETIC_CONTROL_STATE,
      sessionB
    );

    expect(sessionA).toEqual(sessionB);
    expect(underlyingA).toEqual(underlyingB);
  });

  it("makes quiet range calmer than retail chase", () => {
    const ts = Date.parse("2026-01-14T17:10:00Z");
    const quietControl = {
      ...DEFAULT_SYNTHETIC_CONTROL_STATE,
      preset_id: "quiet_range" as const
    };
    const chaseControl = {
      ...DEFAULT_SYNTHETIC_CONTROL_STATE,
      preset_id: "retail_chase" as const
    };
    const quietSession = getSyntheticSessionState(ts, quietControl);
    const chaseSession = getSyntheticSessionState(ts, chaseControl);
    const quietState = getSyntheticUnderlyingState("AAPL", ts, quietControl, quietSession);
    const chaseState = getSyntheticUnderlyingState("AAPL", ts, chaseControl, chaseSession);

    expect(quietSession.volatility_level).toBeLessThan(chaseSession.volatility_level);
    expect(quietState.spread).toBeLessThanOrEqual(chaseState.spread);
    expect(quietState.sessionVolatility).toBeLessThan(chaseState.sessionVolatility);
  });

  it("materially tilts family weights by preset and regime", () => {
    const ts = Date.parse("2026-01-14T19:40:00Z");
    const eventControl = {
      ...DEFAULT_SYNTHETIC_CONTROL_STATE,
      preset_id: "event_day" as const
    };
    const quietControl = {
      ...DEFAULT_SYNTHETIC_CONTROL_STATE,
      preset_id: "quiet_range" as const
    };
    const eventSession = getSyntheticSessionState(ts, eventControl);
    const quietSession = getSyntheticSessionState(ts, quietControl);
    const eventWeights = getSyntheticScenarioWeights("AAPL", ts, eventControl, eventSession);
    const quietWeights = getSyntheticScenarioWeights("AAPL", ts, quietControl, quietSession);

    expect(eventWeights.event_driven).toBeGreaterThan(quietWeights.event_driven);
    expect(quietWeights.neutral_noise).toBeGreaterThan(eventWeights.neutral_noise);
  });
});

describe("synthetic coverage assist", () => {
  it("boosts under-hit profiles without forcing when enabled", () => {
    const counts = buildEmptySyntheticProfileHitCounts();
    counts.institutional_directional = 3;
    counts.arbitrage = 2;

    const boost = getSyntheticCoverageBoost(
      "event_driven",
      { profile_hit_counts: counts },
      DEFAULT_SYNTHETIC_CONTROL_STATE
    );

    expect(boost).toBeGreaterThan(1);
    expect(boost).toBeLessThanOrEqual(1.86);
  });

  it("returns neutral boost when coverage assist is disabled", () => {
    const counts = buildEmptySyntheticProfileHitCounts();
    counts.institutional_directional = 4;

    expect(
      getSyntheticCoverageBoost(
        "event_driven",
        { profile_hit_counts: counts },
        {
          coverage_assist: false,
          coverage_window_minutes: 20
        }
      )
    ).toBe(1);
  });
});
