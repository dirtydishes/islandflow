import type { ParsedContract } from "./contracts";

export type ContractLeg = ParsedContract & {
  contractId: string;
  startTs: number;
  endTs: number;
};

export type StructureSummary = {
  type: string;
  legs: number;
  strikes: number;
  strikeSpan: number;
  rights: string;
  contractIds: string[];
};

export const summarizeStructure = (legs: ContractLeg[]): StructureSummary | null => {
  if (legs.length < 2) {
    return null;
  }

  const strikes = Array.from(new Set(legs.map((leg) => leg.strike))).sort((a, b) => a - b);
  const rights = new Set(legs.map((leg) => leg.right));
  const strikeSpan = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : 0;

  let type = "multi_leg";
  if (rights.size === 2 && strikes.length === 1) {
    type = "straddle";
  } else if (rights.size === 2 && strikes.length >= 2) {
    type = "strangle";
  } else if (rights.size === 1 && strikes.length === 2) {
    type = "vertical";
  } else if (rights.size === 1 && strikes.length >= 3) {
    type = "ladder";
  }

  return {
    type,
    legs: legs.length,
    strikes: strikes.length,
    strikeSpan,
    rights: rights.size === 2 ? "C/P" : Array.from(rights)[0] ?? "",
    contractIds: legs.map((leg) => leg.contractId).slice().sort()
  };
};
