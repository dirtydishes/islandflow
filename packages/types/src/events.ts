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
    evidence_refs: z.array(z.string().min(1))
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
