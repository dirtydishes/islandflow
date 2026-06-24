import { z } from "zod";
import { OptionNbboSideSchema, OptionTypeSchema } from "./options-flow";

export const DurableTapeComposedLaneSchema = z.enum(["options", "alerts"]);
export type DurableTapeComposedLane = z.infer<typeof DurableTapeComposedLaneSchema>;

export const DurableTapeRowBadgeSchema = z.object({
  kind: z.string().min(1),
  label: z.string().min(1),
  tone: z.string().min(1).optional()
});
export type DurableTapeRowBadge = z.infer<typeof DurableTapeRowBadgeSchema>;

export const DurableTapeEvidenceSummarySchema = z.object({
  label: z.string().min(1),
  refs: z.array(z.string().min(1)),
  available_refs: z.array(z.string().min(1)).optional(),
  missing_refs: z.array(z.string().min(1)).optional(),
  counts: z
    .object({
      total: z.number().int().nonnegative(),
      flow_packets: z.number().int().nonnegative(),
      option_prints: z.number().int().nonnegative(),
      unresolved: z.number().int().nonnegative()
    })
    .optional()
});
export type DurableTapeEvidenceSummary = z.infer<typeof DurableTapeEvidenceSummarySchema>;

const DurableTapeRowBaseSchema = z.object({
  id: z.string().min(1),
  ts: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  source_ts: z.number().int().nonnegative(),
  ingest_ts: z.number().int().nonnegative(),
  source: z.enum(["server", "fallback"]).default("server"),
  symbol: z.string().min(1).optional(),
  cells: z.record(z.union([z.string(), z.number(), z.null()])),
  badges: z.array(DurableTapeRowBadgeSchema),
  evidence_summary: DurableTapeEvidenceSummarySchema.optional(),
  drilldown_refs: z.array(z.string().min(1)).optional()
});

export const DurableTapeOptionRowViewModelSchema = DurableTapeRowBaseSchema.extend({
  lane: z.literal("options"),
  option: z.object({
    trace_id: z.string().min(1),
    option_contract_id: z.string().min(1),
    underlying_id: z.string().min(1).optional(),
    option_type: OptionTypeSchema.optional(),
    price: z.number().nonnegative(),
    size: z.number().int().positive(),
    premium: z.number().nonnegative().nullable(),
    side: OptionNbboSideSchema.nullable(),
    exchange: z.string().min(1),
    conditions: z.array(z.string().min(1)).optional(),
    signal: z
      .object({
        pass: z.boolean().optional(),
        profile: z.string().min(1).optional(),
        reasons: z.array(z.string().min(1)).optional()
      })
      .optional(),
    execution: z
      .object({
        iv: z.number().nonnegative().nullable(),
        underlying_spot: z.number().nullable(),
        quote_age_ms: z.number().nonnegative().nullable()
      })
      .optional(),
    nbbo: z
      .object({
        bid: z.number().nonnegative(),
        ask: z.number().nonnegative(),
        mid: z.number().nonnegative().nullable(),
        spread: z.number().nonnegative().nullable(),
        source: z.enum(["print", "latest", "missing"]),
        age_ms: z.number().nonnegative().nullable()
      })
      .nullable()
  }),
  support: z.object({
    packet: z
      .object({
        id: z.string().min(1),
        trace_id: z.string().min(1).optional(),
        option_contract_id: z.string().min(1).optional(),
        member_trace_ids: z.array(z.string().min(1)),
        member_count: z.number().int().nonnegative(),
        truncated: z.boolean().optional()
      })
      .nullable(),
    classifier: z
      .object({
        trace_id: z.string().min(1),
        classifier_id: z.string().min(1),
        label: z.string().min(1),
        direction: z.string().min(1).nullable(),
        confidence: z.number().min(0).max(1).nullable(),
        explanation: z.string().min(1).nullable()
      })
      .nullable(),
    smart_money: z
      .object({
        trace_id: z.string().min(1),
        event_id: z.string().min(1),
        profile_id: z.string().min(1).nullable(),
        label: z.string().min(1),
        direction: z.string().min(1).nullable(),
        confidence_band: z.string().min(1).nullable(),
        probability: z.number().min(0).max(1).nullable(),
        abstained: z.boolean(),
        reasons: z.array(z.string().min(1))
      })
      .nullable()
  })
});
export type DurableTapeOptionRowViewModel = z.infer<typeof DurableTapeOptionRowViewModelSchema>;

export const DurableTapeAlertRowViewModelSchema = DurableTapeRowBaseSchema.extend({
  lane: z.literal("alerts"),
  alert: z.object({
    trace_id: z.string().min(1),
    primary_label: z.string().min(1),
    primary_profile_id: z.string().min(1).nullable(),
    score: z.number(),
    severity: z.string().min(1),
    direction: z.string().min(1),
    hit_count: z.number().int().nonnegative(),
    top_hit: z
      .object({
        classifier_id: z.string().min(1),
        label: z.string().min(1),
        direction: z.string().min(1).nullable(),
        confidence: z.number().min(0).max(1).nullable(),
        explanation: z.string().min(1).nullable()
      })
      .nullable()
  }),
  evidence: z.object({
    total_refs: z.number().int().nonnegative(),
    flow_packet_refs: z.array(z.string().min(1)),
    option_print_refs: z.array(z.string().min(1)),
    unresolved_refs: z.array(z.string().min(1)),
    underlying_id: z.string().min(1).nullable(),
    primary_packet: z
      .object({
        id: z.string().min(1),
        option_contract_id: z.string().min(1).optional(),
        member_trace_ids: z.array(z.string().min(1)),
        member_count: z.number().int().nonnegative(),
        truncated: z.boolean().optional()
      })
      .nullable(),
    preview_prints: z.array(
      z.object({
        trace_id: z.string().min(1),
        option_contract_id: z.string().min(1),
        ts: z.number().int().nonnegative(),
        price: z.number().nonnegative(),
        size: z.number().int().positive(),
        premium: z.number().nonnegative().nullable(),
        exchange: z.string().min(1)
      })
    )
  })
});
export type DurableTapeAlertRowViewModel = z.infer<typeof DurableTapeAlertRowViewModelSchema>;

export const DurableTapeRowViewModelSchema = z.discriminatedUnion("lane", [
  DurableTapeOptionRowViewModelSchema,
  DurableTapeAlertRowViewModelSchema
]);
export type DurableTapeRowViewModel = z.infer<typeof DurableTapeRowViewModelSchema>;
