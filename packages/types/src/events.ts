import { z } from "zod";

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
    conditions: z.array(z.string().min(1)).optional()
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
