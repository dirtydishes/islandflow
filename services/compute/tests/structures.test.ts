import { describe, expect, test } from "bun:test";
import { summarizeStructure, type ContractLeg } from "../src/structures";

const leg = (contractId: string, right: "C" | "P", strike: number): ContractLeg => ({
  contractId,
  root: "SPY",
  expiry: "2025-01-17",
  right,
  strike,
  startTs: 0,
  endTs: 0
});

describe("structure summaries", () => {
  test("detects verticals", () => {
    const summary = summarizeStructure([leg("c1", "C", 100), leg("c2", "C", 105)]);
    expect(summary?.type).toBe("vertical");
    expect(summary?.legs).toBe(2);
    expect(summary?.strikes).toBe(2);
  });

  test("detects ladders", () => {
    const summary = summarizeStructure([
      leg("c1", "C", 100),
      leg("c2", "C", 105),
      leg("c3", "C", 110)
    ]);
    expect(summary?.type).toBe("ladder");
    expect(summary?.strikes).toBe(3);
  });

  test("detects straddles", () => {
    const summary = summarizeStructure([leg("c1", "C", 100), leg("p1", "P", 100)]);
    expect(summary?.type).toBe("straddle");
    expect(summary?.rights).toBe("C/P");
  });

  test("detects strangles", () => {
    const summary = summarizeStructure([leg("c1", "C", 105), leg("p1", "P", 95)]);
    expect(summary?.type).toBe("strangle");
    expect(summary?.strikes).toBe(2);
  });

  test("detects rolls across expiries", () => {
    const summary = summarizeStructure([
      {
        ...leg("c1", "C", 450),
        expiry: "2025-01-17"
      },
      {
        ...leg("c2", "C", 455),
        expiry: "2025-02-21"
      }
    ]);
    expect(summary?.type).toBe("roll");
    expect(summary?.rights).toBe("C");
    expect(summary?.strikes).toBe(2);
  });
});
