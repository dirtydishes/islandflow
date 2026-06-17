import { describe, expect, it } from "bun:test";
import { buildFlowEvidenceCandidateFromPacket } from "../src/smart-flow-evidence";
import { buildFlowPacket } from "./helpers";

describe("smart-flow evidence extraction", () => {
  it("builds accepted evidence facts with raw refs and quote context", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:evidence-accepted",
      trace_id: "trace:packet-accepted",
      members: ["print:1", "print:2"],
      features: {
        option_contract_id: "SPY-2025-02-21-450-C",
        underlying_id: "SPY",
        count: 2,
        total_size: 900,
        total_premium: 75_000,
        start_ts: 1000,
        end_ts: 1100,
        nbbo_bid: 1.2,
        nbbo_ask: 1.24,
        nbbo_mid: 1.22,
        nbbo_spread: 0.04,
        nbbo_coverage_ratio: 1,
        nbbo_aggressive_ratio: 0.8,
        nbbo_aggressive_buy_ratio: 0.8,
        nbbo_aggressive_sell_ratio: 0,
        nbbo_inside_ratio: 0.1,
        underlying_bid: 449.9,
        underlying_ask: 450.1,
        underlying_mid: 450,
        underlying_spread: 0.2
      },
      join_quality: {
        nbbo_age_ms: 25,
        underlying_quote_age_ms: 35
      }
    });

    const extraction = buildFlowEvidenceCandidateFromPacket(packet);

    expect(extraction.candidate.eligibility.status).toBe("accepted");
    expect(extraction.candidate.eligibility.eligible).toBe(true);
    expect(extraction.candidate.member_print_ids).toEqual(["print:1", "print:2"]);
    expect(extraction.candidate.evidence_quality.grade).toBe("strong");
    expect(extraction.candidate.observation_refs.map((ref) => ref.kind)).toContain("option_nbbo");
    expect(extraction.candidate.observation_refs.map((ref) => ref.kind)).toContain("equity_quote");

    const premium = extraction.evidence_facts.find((fact) => fact.kind === "premium_size");
    expect(premium?.value).toBe(75_000);
    expect(premium?.observation_refs.map((ref) => ref.observation_id)).toContain("print:1");

    const quoteFacts = extraction.evidence_facts.filter((fact) => fact.kind === "quote_quality");
    expect(quoteFacts.map((fact) => fact.label)).toContain("NBBO quote age");
    expect(
      quoteFacts.some((fact) => fact.observation_refs.some((ref) => ref.kind === "option_nbbo"))
    ).toBe(true);
  });

  it("rejects stale quote evidence with explicit reasons", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:evidence-stale",
      members: ["print:stale-1", "print:stale-2", "print:stale-3", "print:stale-4"],
      features: {
        option_contract_id: "SPY-2025-02-21-450-C",
        underlying_id: "SPY",
        count: 4,
        total_size: 1200,
        total_premium: 90_000,
        nbbo_coverage_ratio: 0.25,
        nbbo_stale_count: 3,
        nbbo_missing_count: 1
      }
    });

    const extraction = buildFlowEvidenceCandidateFromPacket(packet);

    expect(extraction.candidate.eligibility.status).toBe("rejected");
    expect(extraction.candidate.eligibility.eligible).toBe(false);
    expect(extraction.candidate.eligibility.reasons).toContain("stale_quote_context");
    expect(extraction.candidate.evidence_quality.caveats).toContain("stale_quote_context");

    const staleFact = extraction.evidence_facts.find(
      (fact) => fact.kind === "eligibility_decision" && fact.value === "rejected"
    );
    expect(staleFact?.label).toContain("NBBO coverage is too thin");
    expect(staleFact?.observation_refs.map((ref) => ref.observation_id)).toContain("print:stale-1");
  });

  it("down-weights wide and noisy context without hypothesis language", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:evidence-down-weight",
      members: ["print:noisy-1", "print:noisy-2"],
      features: {
        option_contract_id: "AAPL-2025-03-21-250-P",
        underlying_id: "AAPL",
        count: 2,
        total_size: 500,
        total_premium: 40_000,
        nbbo_bid: 1,
        nbbo_ask: 2,
        nbbo_mid: 1.5,
        nbbo_spread: 1,
        nbbo_coverage_ratio: 1,
        nbbo_aggressive_ratio: 0.2,
        nbbo_inside_ratio: 0.85,
        conditions: "CROSS,SPREAD",
        special_print_count: 1
      }
    });

    const extraction = buildFlowEvidenceCandidateFromPacket(packet);

    expect(extraction.candidate.eligibility.status).toBe("down_weighted");
    expect(extraction.candidate.eligibility.eligible).toBe(true);
    expect(extraction.candidate.eligibility.reasons).toEqual(
      expect.arrayContaining(["wide_quote_context", "noisy_print_context", "inside_market_context"])
    );
    expect(extraction.candidate.feature_vector.option_spread_bps).toBeGreaterThan(800);

    const serializedFacts = JSON.stringify(extraction.evidence_facts);
    expect(serializedFacts.toLowerCase()).not.toContain("smart money");
    expect(serializedFacts.toLowerCase()).not.toContain("hypothesis");
  });
});
