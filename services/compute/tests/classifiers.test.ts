import { describe, expect, it } from "bun:test";
import { evaluateClassifiers } from "../src/classifiers";
import { buildFlowPacket, getHit, TEST_CLASSIFIER_CONFIG } from "./helpers";

const expectExplainable = (hit: NonNullable<ReturnType<typeof getHit>>) => {
  expect(hit.confidence).toBeGreaterThanOrEqual(0);
  expect(hit.confidence).toBeLessThanOrEqual(1);
  expect(hit.direction.length).toBeGreaterThan(0);
  expect(hit.explanations.length).toBeGreaterThan(0);
  expect(hit.explanations.join(" ")).toMatch(/Likely|Consistent with|Unusual/i);
};

describe("compute classifiers", () => {
  it("detects large bullish call sweep", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:sweep-call",
      features: {
        option_contract_id: "SPY-2025-02-01-450-C",
        count: 5,
        window_ms: 500,
        total_size: 1200,
        total_premium: 85_000,
        first_price: 1.0,
        last_price: 1.05,
        nbbo_coverage_ratio: 0.9,
        nbbo_aggressive_buy_ratio: 0.65,
        nbbo_aggressive_sell_ratio: 0.15
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "large_bullish_call_sweep");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bullish");
    expectExplainable(hit!);
  });

  it("detects large bearish put sweep", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:sweep-put",
      features: {
        option_contract_id: "SPY-2025-02-01-450-P",
        count: 4,
        window_ms: 420,
        total_size: 900,
        total_premium: 60_000,
        first_price: 2.0,
        last_price: 2.15,
        nbbo_coverage_ratio: 0.85,
        nbbo_aggressive_buy_ratio: 0.2,
        nbbo_aggressive_sell_ratio: 0.7
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "large_bearish_put_sweep");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bearish");
    expectExplainable(hit!);
  });

  it("detects unusual contract spike", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:spike",
      features: {
        option_contract_id: "NVDA-2025-02-21-600-C",
        count: 2,
        window_ms: 200,
        total_size: 520,
        total_premium: 30_000,
        nbbo_coverage_ratio: 0.6,
        nbbo_aggressive_buy_ratio: 0.6,
        nbbo_aggressive_sell_ratio: 0.1
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "unusual_contract_spike");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("neutral");
    expectExplainable(hit!);
  });

  it("detects large call sell overwrite (sell-side skew)", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:overwrite",
      features: {
        option_contract_id: "AAPL-2025-02-21-200-C",
        count: 3,
        window_ms: 300,
        total_size: 900,
        total_premium: 35_000,
        nbbo_coverage_ratio: 0.75,
        nbbo_aggressive_buy_ratio: 0.1,
        nbbo_aggressive_sell_ratio: 0.75
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "large_call_sell_overwrite");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bearish");
    expectExplainable(hit!);
  });

  it("detects large put sell write (sell-side skew)", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:put-write",
      features: {
        option_contract_id: "AAPL-2025-02-21-200-P",
        count: 3,
        window_ms: 300,
        total_size: 850,
        total_premium: 32_000,
        nbbo_coverage_ratio: 0.75,
        nbbo_aggressive_buy_ratio: 0.1,
        nbbo_aggressive_sell_ratio: 0.72
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "large_put_sell_write");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bullish");
    expectExplainable(hit!);
  });

  it("detects far-dated conviction (>=60 DTE)", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:far-dated",
      source_ts: Date.parse("2025-01-01T14:30:00Z"),
      features: {
        option_contract_id: "SPY-2025-04-10-450-C",
        count: 2,
        window_ms: 250,
        total_size: 650,
        total_premium: 28_000,
        nbbo_coverage_ratio: 0.7,
        nbbo_aggressive_buy_ratio: 0.6,
        nbbo_aggressive_sell_ratio: 0.2
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "far_dated_conviction");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bullish");
    expectExplainable(hit!);
  });

  it("detects 0DTE gamma punch when expiry matches packet day and near ATM", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:zero-dte",
      source_ts: Date.parse("2025-01-17T15:30:00Z"),
      features: {
        option_contract_id: "SPY-2025-01-17-450-C",
        count: 3,
        window_ms: 350,
        total_size: 800,
        total_premium: 50_000,
        underlying_mid: 450.5,
        nbbo_coverage_ratio: 0.8,
        nbbo_aggressive_buy_ratio: 0.65,
        nbbo_aggressive_sell_ratio: 0.15
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "zero_dte_gamma_punch");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bullish");
    expectExplainable(hit!);
  });

  it("detects structure straddle and strangle packets", () => {
    const base = {
      packet_kind: "structure",
      structure_legs: 4,
      structure_strikes: 2,
      structure_strike_span: 5,
      total_size: 600,
      total_premium: 30_000,
      nbbo_coverage_ratio: 0.7,
      nbbo_aggressive_buy_ratio: 0.55,
      nbbo_aggressive_sell_ratio: 0.35
    } as const;

    const straddlePacket = buildFlowPacket({
      id: "flowpacket:straddle",
      features: {
        ...base,
        structure_type: "straddle"
      }
    });
    const stranglePacket = buildFlowPacket({
      id: "flowpacket:strangle",
      features: {
        ...base,
        structure_type: "strangle",
        structure_strike_span: 12
      }
    });

    const straddleHits = evaluateClassifiers(straddlePacket, TEST_CLASSIFIER_CONFIG);
    const strangleHits = evaluateClassifiers(stranglePacket, TEST_CLASSIFIER_CONFIG);

    const straddleHit = getHit(straddleHits, "straddle");
    const strangleHit = getHit(strangleHits, "strangle");

    expect(straddleHit).not.toBeNull();
    expect(strangleHit).not.toBeNull();
    expectExplainable(straddleHit!);
    expectExplainable(strangleHit!);
  });

  it("detects vertical spread structure packets and infers direction from aggressor skew", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:vertical",
      features: {
        packet_kind: "structure",
        structure_type: "vertical",
        structure_rights: "C",
        structure_legs: 4,
        structure_strikes: 2,
        structure_strike_span: 10,
        total_size: 900,
        total_premium: 45_000,
        nbbo_coverage_ratio: 0.8,
        nbbo_aggressive_buy_ratio: 0.7,
        nbbo_aggressive_sell_ratio: 0.2
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "vertical_spread");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bullish");
    expectExplainable(hit!);
  });

  it("detects ladder accumulation packets", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:ladder",
      features: {
        packet_kind: "structure",
        structure_type: "ladder",
        structure_rights: "C",
        structure_legs: 6,
        structure_strikes: 4,
        structure_strike_span: 15,
        total_size: 1200,
        total_premium: 55_000,
        nbbo_coverage_ratio: 0.65,
        nbbo_aggressive_buy_ratio: 0.6,
        nbbo_aggressive_sell_ratio: 0.2
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "ladder_accumulation");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bullish");
    expectExplainable(hit!);
  });

  it("detects roll up/down/out structure packets", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:roll",
      features: {
        packet_kind: "structure",
        structure_type: "roll",
        structure_rights: "C",
        underlying_id: "SPY",
        roll_from_expiry: "2025-02-21",
        roll_to_expiry: "2025-03-21",
        roll_from_strike: 440,
        roll_to_strike: 450,
        roll_strike_delta: 10,
        roll_expiry_days_delta: 28,
        total_size: 700,
        total_premium: 38_000,
        nbbo_coverage_ratio: 0.7,
        nbbo_aggressive_buy_ratio: 0.6,
        nbbo_aggressive_sell_ratio: 0.3
      }
    });

    const hits = evaluateClassifiers(packet, TEST_CLASSIFIER_CONFIG);
    const hit = getHit(hits, "roll_up_down_out");
    expect(hit).not.toBeNull();
    expect(hit?.direction).toBe("bullish");
    expectExplainable(hit!);
    expect(hit!.explanations[0]).toMatch(/Consistent with/i);
  });
});

