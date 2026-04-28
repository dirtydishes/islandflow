import { z } from "zod";
import type { FlowPacket, OptionNBBO, OptionPrint } from "./events";

export const SyntheticMarketModeSchema = z.enum(["realistic", "active", "firehose"]);
export type SyntheticMarketMode = z.infer<typeof SyntheticMarketModeSchema>;

export const OptionTypeSchema = z.enum(["call", "put"]);
export type OptionType = z.infer<typeof OptionTypeSchema>;

export const OptionNbboSideSchema = z.enum(["AA", "A", "MID", "B", "BB", "MISSING", "STALE"]);
export type OptionNbboSide = z.infer<typeof OptionNbboSideSchema>;

export const OptionFlowViewSchema = z.enum(["signal", "raw"]);
export type OptionFlowView = z.infer<typeof OptionFlowViewSchema>;

export const OptionSecurityTypeSchema = z.enum(["stock", "etf"]);
export type OptionSecurityType = z.infer<typeof OptionSecurityTypeSchema>;

export const OptionsSignalModeSchema = z.enum(["smart-money", "balanced", "all"]);
export type OptionsSignalMode = z.infer<typeof OptionsSignalModeSchema>;

export const OptionFlowFiltersSchema = z.object({
  view: OptionFlowViewSchema.optional(),
  securityTypes: z.array(OptionSecurityTypeSchema).optional(),
  nbboSides: z.array(OptionNbboSideSchema).optional(),
  optionTypes: z.array(OptionTypeSchema).optional(),
  minNotional: z.number().nonnegative().optional()
});

export type OptionFlowFilters = z.infer<typeof OptionFlowFiltersSchema>;

export type ParsedOptionContract = {
  root: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
};

export type SyntheticModeResolution = {
  market: SyntheticMarketMode;
  options: SyntheticMarketMode;
  equities: SyntheticMarketMode;
};

export type OptionsSignalConfig = {
  mode: OptionsSignalMode;
  minNotional: number;
  etfMinNotional: number;
  bidSideMinNotional: number;
  midMinNotional: number;
  missingNbboMinNotional: number;
  largePrintMinSize: number;
  largePrintMinNotional: number;
  sweepMinNotional: number;
  autoKeepMinNotional: number;
  nbboMaxAgeMs: number;
  etfUnderlyings: Set<string>;
};

export type DerivedOptionPrintMetadata = {
  underlying_id?: string;
  option_type?: OptionType;
  notional?: number;
  nbbo_side?: OptionNbboSide;
  is_etf?: boolean;
};

export type OptionSignalDecision = {
  signalPass: boolean;
  signalReasons: string[];
  signalProfile: OptionsSignalMode;
};

const parseDashedContract = (value: string): ParsedOptionContract | null => {
  const parts = value.split("-");
  if (parts.length < 6) {
    return null;
  }

  const rightRaw = parts.at(-1) ?? "";
  if (rightRaw !== "C" && rightRaw !== "P") {
    return null;
  }

  const strikeRaw = parts.at(-2) ?? "";
  const strike = Number(strikeRaw);
  const expiryParts = parts.slice(-5, -2);
  const expiry = expiryParts.join("-");
  const root = parts.slice(0, -5).join("-");

  if (!root || !expiry || !Number.isFinite(strike)) {
    return null;
  }

  return {
    root,
    expiry,
    strike,
    right: rightRaw
  };
};

const parseOccContract = (value: string): ParsedOptionContract | null => {
  if (value.length < 15) {
    return null;
  }

  const tail = value.slice(-15);
  const root = value.slice(0, -15).trim();
  const expiryRaw = tail.slice(0, 6);
  const right = tail.slice(6, 7);
  const strikeRaw = tail.slice(7);

  if (!/^\d{6}$/.test(expiryRaw) || !/^\d{8}$/.test(strikeRaw)) {
    return null;
  }

  if (right !== "C" && right !== "P") {
    return null;
  }

  const year = 2000 + Number(expiryRaw.slice(0, 2));
  const month = Number(expiryRaw.slice(2, 4)) - 1;
  const day = Number(expiryRaw.slice(4, 6));
  const expiryDate = new Date(Date.UTC(year, month, day));
  const expiry = expiryDate.toISOString().slice(0, 10);
  const strike = Number(strikeRaw) / 1000;

  if (!root || !Number.isFinite(strike)) {
    return null;
  }

  return {
    root,
    expiry,
    strike,
    right
  };
};

export const parseOptionContractId = (value: string | undefined): ParsedOptionContract | null => {
  if (!value) {
    return null;
  }

  return parseDashedContract(value) ?? parseOccContract(value);
};

export const resolveSyntheticMarketModes = (input: {
  syntheticMarketMode?: string | null | undefined;
  syntheticOptionsMode?: string | null | undefined;
  syntheticEquitiesMode?: string | null | undefined;
}): SyntheticModeResolution => {
  const market = SyntheticMarketModeSchema.catch("realistic").parse(
    input.syntheticMarketMode ?? "realistic"
  );
  const options = SyntheticMarketModeSchema.catch(market).parse(
    input.syntheticOptionsMode ?? market
  );
  const equities = SyntheticMarketModeSchema.catch(market).parse(
    input.syntheticEquitiesMode ?? market
  );

  return { market, options, equities };
};

export const classifyOptionNbboSide = (
  price: number,
  quote: Pick<OptionNBBO, "bid" | "ask" | "ts"> | null | undefined,
  tradeTs: number,
  maxAgeMs: number
): OptionNbboSide => {
  if (!quote || !Number.isFinite(price)) {
    return "MISSING";
  }

  const bid = quote.bid;
  const ask = quote.ask;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask <= 0) {
    return "MISSING";
  }

  const ageMs = Math.abs(tradeTs - quote.ts);
  if (ageMs > maxAgeMs) {
    return "STALE";
  }

  const spread = Math.max(0, ask - bid);
  const epsilon = Math.max(0.01, spread * 0.05);

  if (price > ask + epsilon) {
    return "AA";
  }
  if (price >= ask - epsilon) {
    return "A";
  }
  if (price < bid - epsilon) {
    return "BB";
  }
  if (price <= bid + epsilon) {
    return "B";
  }

  return "MID";
};

export const deriveOptionPrintMetadata = (
  print: Pick<OptionPrint, "option_contract_id" | "price" | "size" | "ts">,
  quote: Pick<OptionNBBO, "bid" | "ask" | "ts"> | null | undefined,
  config: Pick<OptionsSignalConfig, "nbboMaxAgeMs" | "etfUnderlyings">
): DerivedOptionPrintMetadata => {
  const parsed = parseOptionContractId(print.option_contract_id);
  const underlying = parsed?.root?.toUpperCase();
  const optionType = parsed?.right === "C" ? "call" : parsed?.right === "P" ? "put" : undefined;
  const notional = Number.isFinite(print.price) && Number.isFinite(print.size)
    ? Number((print.price * print.size * 100).toFixed(2))
    : undefined;

  return {
    underlying_id: underlying,
    option_type: optionType,
    notional,
    nbbo_side: classifyOptionNbboSide(print.price, quote, print.ts, config.nbboMaxAgeMs),
    is_etf: underlying ? config.etfUnderlyings.has(underlying) : undefined
  };
};

const hasCondition = (conditions: string[] | undefined, expected: string): boolean => {
  return (conditions ?? []).some((condition) => condition.toUpperCase() === expected);
};

const balancedThresholds = (config: OptionsSignalConfig): OptionsSignalConfig => ({
  ...config,
  minNotional: Math.min(config.minNotional, 5_000),
  etfMinNotional: Math.min(config.etfMinNotional, 25_000),
  bidSideMinNotional: Math.min(config.bidSideMinNotional, 15_000),
  midMinNotional: Math.min(config.midMinNotional, 12_500),
  missingNbboMinNotional: Math.min(config.missingNbboMinNotional, 25_000),
  sweepMinNotional: Math.min(config.sweepMinNotional, 15_000),
  autoKeepMinNotional: Math.min(config.autoKeepMinNotional, 75_000)
});

export const evaluateOptionSignal = (
  print: Pick<
    OptionPrint,
    "size" | "conditions" | "signal_profile" | "underlying_id" | "option_type" | "notional" | "nbbo_side" | "is_etf"
  >,
  baseConfig: OptionsSignalConfig
): OptionSignalDecision => {
  const mode = print.signal_profile ?? baseConfig.mode;
  if (mode === "all") {
    return {
      signalPass: true,
      signalReasons: ["mode:all"],
      signalProfile: "all"
    };
  }

  const config = mode === "balanced" ? balancedThresholds(baseConfig) : baseConfig;
  const reasons: string[] = [];
  const notional = print.notional ?? 0;
  const side = print.nbbo_side ?? "MISSING";
  const isSweepOrIso = hasCondition(print.conditions, "SWEEP") || hasCondition(print.conditions, "ISO");

  if (notional < config.minNotional) {
    return {
      signalPass: false,
      signalReasons: ["reject:min-notional"],
      signalProfile: mode
    };
  }

  if (notional >= config.autoKeepMinNotional) {
    reasons.push("keep:auto-large");
  }

  if (print.is_etf && notional < config.etfMinNotional) {
    return {
      signalPass: false,
      signalReasons: ["reject:etf-min-notional"],
      signalProfile: mode
    };
  }

  if ((side === "B" || side === "BB") && notional < config.bidSideMinNotional) {
    return {
      signalPass: false,
      signalReasons: ["reject:bid-side-min-notional"],
      signalProfile: mode
    };
  }

  if (side === "MID" && !isSweepOrIso && notional < config.midMinNotional) {
    return {
      signalPass: false,
      signalReasons: ["reject:mid-min-notional"],
      signalProfile: mode
    };
  }

  if ((side === "MISSING" || side === "STALE") && notional < config.missingNbboMinNotional) {
    return {
      signalPass: false,
      signalReasons: ["reject:missing-nbbo-min-notional"],
      signalProfile: mode
    };
  }

  if ((side === "A" || side === "AA") && notional >= config.minNotional) {
    reasons.push("keep:ask-side");
  }

  if (isSweepOrIso && notional >= config.sweepMinNotional) {
    reasons.push("keep:sweep-or-iso");
  }

  if (print.size >= config.largePrintMinSize && notional >= config.largePrintMinNotional) {
    reasons.push("keep:large-contract-count");
  }

  if (reasons.length === 0) {
    return {
      signalPass: false,
      signalReasons: ["reject:no-signal-rule"],
      signalProfile: mode
    };
  }

  return {
    signalPass: true,
    signalReasons: reasons,
    signalProfile: mode
  };
};

const sortStrings = (values: string[] | undefined): string[] | undefined => {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values)].sort();
};

export const normalizeOptionFlowFilters = (
  filters: OptionFlowFilters | undefined
): OptionFlowFilters | undefined => {
  if (!filters) {
    return undefined;
  }

  return {
    view: filters.view,
    securityTypes: sortStrings(filters.securityTypes) as OptionSecurityType[] | undefined,
    nbboSides: sortStrings(filters.nbboSides) as OptionNbboSide[] | undefined,
    optionTypes: sortStrings(filters.optionTypes) as OptionType[] | undefined,
    minNotional:
      typeof filters.minNotional === "number" && Number.isFinite(filters.minNotional)
        ? filters.minNotional
        : undefined
  };
};

export const optionFlowFilterKey = (filters: OptionFlowFilters | undefined): string => {
  return JSON.stringify(normalizeOptionFlowFilters(filters) ?? {});
};

export const matchesOptionPrintFilters = (
  print: Pick<OptionPrint, "is_etf" | "nbbo_side" | "option_type" | "notional" | "signal_pass">,
  filters: OptionFlowFilters | undefined
): boolean => {
  if (!filters) {
    return true;
  }

  const view = filters.view ?? "signal";
  if (view === "signal" && print.signal_pass === false) {
    return false;
  }

  if (filters.securityTypes?.length) {
    const securityType: OptionSecurityType = print.is_etf ? "etf" : "stock";
    if (!filters.securityTypes.includes(securityType)) {
      return false;
    }
  }

  if (filters.nbboSides?.length) {
    const side = print.nbbo_side ?? "MISSING";
    if (!filters.nbboSides.includes(side)) {
      return false;
    }
  }

  if (filters.optionTypes?.length) {
    const optionType = print.option_type;
    if (!optionType || !filters.optionTypes.includes(optionType)) {
      return false;
    }
  }

  if (typeof filters.minNotional === "number" && (print.notional ?? 0) < filters.minNotional) {
    return false;
  }

  return true;
};

export const matchesFlowPacketFilters = (
  packet: FlowPacket,
  filters: OptionFlowFilters | undefined
): boolean => {
  if (!filters) {
    return true;
  }

  const features = packet.features ?? {};
  const totalNotional = typeof features.total_notional === "number" ? features.total_notional : Number(features.total_notional ?? 0);
  if (typeof filters.minNotional === "number" && (!Number.isFinite(totalNotional) || totalNotional < filters.minNotional)) {
    return false;
  }

  if (filters.securityTypes?.length) {
    const isEtf = typeof features.is_etf === "boolean" ? features.is_etf : features.is_etf === 1;
    const securityType: OptionSecurityType = isEtf ? "etf" : "stock";
    if (!filters.securityTypes.includes(securityType)) {
      return false;
    }
  }

  if (filters.optionTypes?.length) {
    const optionType =
      typeof features.option_type === "string"
        ? features.option_type
        : typeof features.structure_rights === "string"
          ? features.structure_rights.toLowerCase()
          : null;
    if (
      !optionType ||
      !filters.optionTypes.some((selected) => optionType.includes(selected))
    ) {
      return false;
    }
  }

  if (filters.nbboSides?.length) {
    const sideToFeature: Record<OptionNbboSide, string> = {
      AA: "nbbo_aa_count",
      A: "nbbo_a_count",
      MID: "nbbo_mid_count",
      B: "nbbo_b_count",
      BB: "nbbo_bb_count",
      MISSING: "nbbo_missing_count",
      STALE: "nbbo_stale_count"
    };
    const matchesSide = filters.nbboSides.some((side) => {
      const value = features[sideToFeature[side]];
      return typeof value === "number" ? value > 0 : Number(value ?? 0) > 0;
    });
    if (!matchesSide) {
      return false;
    }
  }

  return true;
};
