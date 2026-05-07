import { z } from "zod";
import { OptionNbboSideSchema, OptionTypeSchema, OptionsSignalModeSchema } from "./options-flow";

export const EventMetaSchema = z.object({
  source_ts: z.number().int().nonnegative(),
  ingest_ts: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  trace_id: z.string().min(1)
});

export type EventMeta = z.infer<typeof EventMetaSchema>;

export const OptionPrintSchema = EventMetaSchema.merge(
  z.object({
    ts: z.number().int().nonnegative(),
    option_contract_id: z.string().min(1),
    price: z.number().nonnegative(),
    size: z.number().int().positive(),
    exchange: z.string().min(1),
    conditions: z.array(z.string().min(1)).optional(),
    underlying_id: z.preprocess((value) => (value === null ? undefined : value), z.string().min(1).optional()),
    option_type: z.preprocess((value) => (value === null ? undefined : value), OptionTypeSchema.optional()),
    notional: z.preprocess((value) => (value === null ? undefined : value), z.number().nonnegative().optional()),
    nbbo_side: z.preprocess((value) => (value === null ? undefined : value), OptionNbboSideSchema.optional()),
    execution_nbbo_bid: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_nbbo_ask: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_nbbo_mid: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_nbbo_spread: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_nbbo_bid_size: z.preprocess((value) => (value === null ? undefined : value), z.number().int().nonnegative().optional()),
    execution_nbbo_ask_size: z.preprocess((value) => (value === null ? undefined : value), z.number().int().nonnegative().optional()),
    execution_nbbo_ts: z.preprocess((value) => (value === null ? undefined : value), z.number().int().nonnegative().optional()),
    execution_nbbo_age_ms: z.preprocess((value) => (value === null ? undefined : value), z.number().nonnegative().optional()),
    execution_nbbo_side: z.preprocess((value) => (value === null ? undefined : value), OptionNbboSideSchema.optional()),
    execution_underlying_spot: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_underlying_bid: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_underlying_ask: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_underlying_mid: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_underlying_spread: z.preprocess((value) => (value === null ? undefined : value), z.number().optional()),
    execution_underlying_ts: z.preprocess((value) => (value === null ? undefined : value), z.number().int().nonnegative().optional()),
    execution_underlying_age_ms: z.preprocess((value) => (value === null ? undefined : value), z.number().nonnegative().optional()),
    execution_underlying_source: z.preprocess(
      (value) => (value === null ? undefined : value),
      z.literal("equity_quote_mid").optional()
    ),
    execution_iv: z.preprocess((value) => (value === null ? undefined : value), z.number().nonnegative().optional()),
    execution_iv_source: z.preprocess(
      (value) => (value === null ? undefined : value),
      z.enum(["provider", "synthetic_pressure_model"]).optional()
    ),
    is_etf: z.preprocess((value) => (value === null ? undefined : value), z.boolean().optional()),
    signal_pass: z.preprocess((value) => (value === null ? undefined : value), z.boolean().optional()),
    signal_reasons: z.array(z.string().min(1)).optional(),
    signal_profile: z.preprocess(
      (value) => (value === null ? undefined : value),
      OptionsSignalModeSchema.optional()
    )
  })
);

export type OptionPrint = z.infer<typeof OptionPrintSchema>;

export const OptionNBBOSchema = EventMetaSchema.merge(
  z.object({
    ts: z.number().int().nonnegative(),
    option_contract_id: z.string().min(1),
    bid: z.number().nonnegative(),
    ask: z.number().nonnegative(),
    bidSize: z.number().int().nonnegative(),
    askSize: z.number().int().nonnegative()
  })
);

export type OptionNBBO = z.infer<typeof OptionNBBOSchema>;

export const EquityPrintSchema = EventMetaSchema.merge(
  z.object({
    ts: z.number().int().nonnegative(),
    underlying_id: z.string().min(1),
    price: z.number().nonnegative(),
    size: z.number().int().positive(),
    exchange: z.string().min(1),
    offExchangeFlag: z.boolean()
  })
);

export type EquityPrint = z.infer<typeof EquityPrintSchema>;

export const EquityQuoteSchema = EventMetaSchema.merge(
  z.object({
    ts: z.number().int().nonnegative(),
    underlying_id: z.string().min(1),
    bid: z.number().nonnegative(),
    ask: z.number().nonnegative()
  })
);

export type EquityQuote = z.infer<typeof EquityQuoteSchema>;

export const EquityCandleSchema = EventMetaSchema.merge(
  z.object({
    ts: z.number().int().nonnegative(),
    interval_ms: z.number().int().positive(),
    underlying_id: z.string().min(1),
    open: z.number().nonnegative(),
    high: z.number().nonnegative(),
    low: z.number().nonnegative(),
    close: z.number().nonnegative(),
    volume: z.number().int().nonnegative(),
    trade_count: z.number().int().nonnegative()
  })
);

export type EquityCandle = z.infer<typeof EquityCandleSchema>;

export const EquityPrintJoinSchema = EventMetaSchema.merge(
  z.object({
    id: z.string().min(1),
    print_trace_id: z.string().min(1),
    quote_trace_id: z.string(),
    features: z.record(z.union([z.string(), z.number(), z.boolean()])),
    join_quality: z.record(z.number())
  })
);

export type EquityPrintJoin = z.infer<typeof EquityPrintJoinSchema>;

export const FlowPacketSchema = EventMetaSchema.merge(
  z.object({
    id: z.string().min(1),
    members: z.array(z.string().min(1)),
    features: z.record(z.union([z.string(), z.number(), z.boolean()])),
    join_quality: z.record(z.number())
  })
);

export type FlowPacket = z.infer<typeof FlowPacketSchema>;

export const SmartMoneyProfileIdSchema = z.enum([
  "institutional_directional",
  "retail_whale",
  "event_driven",
  "vol_seller",
  "arbitrage",
  "hedge_reactive"
]);

export type SmartMoneyProfileId = z.infer<typeof SmartMoneyProfileIdSchema>;

export const SmartMoneyDirectionSchema = z.enum(["bullish", "bearish", "neutral", "mixed", "unknown"]);

export type SmartMoneyDirection = z.infer<typeof SmartMoneyDirectionSchema>;

export const SmartMoneyEventKindSchema = z.enum(["single_leg_event", "multi_leg_event"]);

export type SmartMoneyEventKind = z.infer<typeof SmartMoneyEventKindSchema>;

export const SmartMoneyConfidenceBandSchema = z.enum(["low", "medium", "high"]);

export type SmartMoneyConfidenceBand = z.infer<typeof SmartMoneyConfidenceBandSchema>;

export const SmartMoneyFeaturesSchema = z.object({
  contract_count: z.number().int().nonnegative(),
  print_count: z.number().int().nonnegative(),
  total_size: z.number().nonnegative(),
  total_premium: z.number().nonnegative(),
  total_notional: z.number().nonnegative(),
  start_ts: z.number().int().nonnegative(),
  end_ts: z.number().int().nonnegative(),
  window_ms: z.number().int().nonnegative(),
  option_contract_id: z.string().min(1).optional(),
  option_type: z.enum(["C", "P"]).optional(),
  dte_days: z.number().nonnegative().nullable(),
  moneyness: z.number().nullable(),
  atm_proximity: z.number().nullable(),
  aggressor_buy_ratio: z.number().min(0).max(1),
  aggressor_sell_ratio: z.number().min(0).max(1),
  aggressor_ratio: z.number().min(0).max(1),
  nbbo_coverage_ratio: z.number().min(0).max(1),
  nbbo_inside_ratio: z.number().min(0).max(1),
  nbbo_stale_ratio: z.number().min(0).max(1),
  quote_age_ms: z.number().nonnegative().nullable(),
  venue_count: z.number().int().nonnegative(),
  inter_fill_ms_mean: z.number().nonnegative().nullable(),
  strike_count: z.number().int().nonnegative(),
  strike_concentration: z.number().min(0).max(1),
  structure_type: z.string().optional(),
  structure_legs: z.number().int().nonnegative(),
  same_size_leg_symmetry: z.number().min(0).max(1),
  net_directional_bias: z.number().min(-1).max(1),
  synthetic_iv_shock: z.number().nullable(),
  spread_widening: z.number().nullable(),
  underlying_move_bps: z.number().nullable(),
  days_to_event: z.number().nullable(),
  expiry_after_event: z.boolean().nullable(),
  pre_event_concentration: z.number().min(0).max(1).nullable(),
  special_print_ratio: z.number().min(0).max(1)
});

export type SmartMoneyFeatures = z.infer<typeof SmartMoneyFeaturesSchema>;

export const SmartMoneyProfileScoreSchema = z.object({
  profile_id: SmartMoneyProfileIdSchema,
  probability: z.number().min(0).max(1),
  confidence_band: SmartMoneyConfidenceBandSchema,
  direction: SmartMoneyDirectionSchema,
  reasons: z.array(z.string().min(1))
});

export type SmartMoneyProfileScore = z.infer<typeof SmartMoneyProfileScoreSchema>;

export const SmartMoneyEventSchema = EventMetaSchema.merge(
  z.object({
    event_id: z.string().min(1),
    packet_ids: z.array(z.string().min(1)),
    member_print_ids: z.array(z.string().min(1)),
    underlying_id: z.string().min(1),
    event_kind: SmartMoneyEventKindSchema,
    event_window_ms: z.number().int().nonnegative(),
    features: SmartMoneyFeaturesSchema,
    profile_scores: z.array(SmartMoneyProfileScoreSchema),
    primary_profile_id: SmartMoneyProfileIdSchema.nullable(),
    primary_direction: SmartMoneyDirectionSchema,
    abstained: z.boolean(),
    suppressed_reasons: z.array(z.string().min(1))
  })
);

export type SmartMoneyEvent = z.infer<typeof SmartMoneyEventSchema>;

export const ClassifierHitSchema = z.object({
  classifier_id: z.string().min(1),
  confidence: z.number().min(0).max(1),
  direction: z.string().min(1),
  explanations: z.array(z.string().min(1))
});

export type ClassifierHit = z.infer<typeof ClassifierHitSchema>;

export const ClassifierHitEventSchema = EventMetaSchema.merge(ClassifierHitSchema);

export type ClassifierHitEvent = z.infer<typeof ClassifierHitEventSchema>;

export const AlertEventSchema = EventMetaSchema.merge(
  z.object({
    score: z.number(),
    severity: z.string().min(1),
    hits: z.array(ClassifierHitSchema),
    evidence_refs: z.array(z.string().min(1)),
    primary_profile_id: SmartMoneyProfileIdSchema.optional(),
    profile_scores: z.array(SmartMoneyProfileScoreSchema).optional()
  })
);

export type AlertEvent = z.infer<typeof AlertEventSchema>;

export const InferredDarkEventSchema = EventMetaSchema.merge(
  z.object({
    type: z.string().min(1),
    confidence: z.number().min(0).max(1),
    evidence_refs: z.array(z.string().min(1))
  })
);

export type InferredDarkEvent = z.infer<typeof InferredDarkEventSchema>;
