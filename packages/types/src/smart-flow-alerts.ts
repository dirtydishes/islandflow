import { z } from "zod";
import {
  EquityPrintSchema,
  EquityQuoteSchema,
  EventMetaSchema,
  FlowPacketSchema,
  OptionNBBOSchema,
  OptionPrintSchema,
  SmartFlowDirectionSchema
} from "./events";
import {
  FlowHypothesisTypeSchema,
  SmartFlowContractVersionSchema,
  type SmartFlowExplainabilityProjection,
  SmartFlowExplainabilityProjectionSchema
} from "./smart-flow";

export const SMART_FLOW_ALERT_TRIGGER_KIND = "non_abstained_hypothesis";
export const SMART_FLOW_ALERT_EVIDENCE_LOOKUP_PATH = "/lookup/smart-flow-alert-evidence";

export const SmartFlowAlertTriggerSchema = z
  .object({
    kind: z.literal(SMART_FLOW_ALERT_TRIGGER_KIND),
    projection_trace_id: z.string().min(1),
    projection_version: z.string().min(1),
    source_channel: z.literal("smart-flow")
  })
  .strict();

export type SmartFlowAlertTrigger = z.infer<typeof SmartFlowAlertTriggerSchema>;

export const SmartFlowAlertEvidenceInferredKindSchema = z.enum([
  "flow_packet",
  "option_print",
  "option_nbbo",
  "equity_quote",
  "equity_print",
  "synthetic_label",
  "external_context",
  "unknown"
]);

export type SmartFlowAlertEvidenceInferredKind = z.infer<
  typeof SmartFlowAlertEvidenceInferredKindSchema
>;

export const SmartFlowAlertEvidenceUnresolvedReasonSchema = z.enum([
  "malformed_ref",
  "not_found",
  "unsupported_ref"
]);

export type SmartFlowAlertEvidenceUnresolvedReason = z.infer<
  typeof SmartFlowAlertEvidenceUnresolvedReasonSchema
>;

export const SmartFlowSyntheticLabelPayloadSchema = z
  .object({
    label_type: z.string().min(1),
    label_id: z.string().min(1),
    context: z.array(z.string().min(1))
  })
  .strict();

export type SmartFlowSyntheticLabelPayload = z.infer<typeof SmartFlowSyntheticLabelPayloadSchema>;

export const SmartFlowExternalContextPayloadSchema = z
  .object({
    source: z.enum(["external-context", "news-story", "event-calendar"]),
    id: z.string().min(1)
  })
  .strict();

export type SmartFlowExternalContextPayload = z.infer<typeof SmartFlowExternalContextPayloadSchema>;

export const SmartFlowAlertEvidenceItemSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("flow_packet"),
      ref: z.string().min(1),
      packet: FlowPacketSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("option_print"),
      ref: z.string().min(1),
      print: OptionPrintSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("option_nbbo"),
      ref: z.string().min(1),
      nbbo: OptionNBBOSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("equity_quote"),
      ref: z.string().min(1),
      quote: EquityQuoteSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("equity_print"),
      ref: z.string().min(1),
      print: EquityPrintSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("synthetic_label"),
      ref: z.string().min(1),
      label: SmartFlowSyntheticLabelPayloadSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("external_context"),
      ref: z.string().min(1),
      context: SmartFlowExternalContextPayloadSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("unresolved"),
      ref: z.string().min(1),
      inferred_kind: SmartFlowAlertEvidenceInferredKindSchema,
      reason: SmartFlowAlertEvidenceUnresolvedReasonSchema
    })
    .strict()
]);

export type SmartFlowAlertEvidenceItem = z.infer<typeof SmartFlowAlertEvidenceItemSchema>;

export const SmartFlowAlertEvidenceLookupRequestSchema = z
  .object({
    alert_id: z.string().trim().min(1).optional(),
    refs: z.array(z.string().trim().min(1)).max(100)
  })
  .strict();

export type SmartFlowAlertEvidenceLookupRequest = z.infer<
  typeof SmartFlowAlertEvidenceLookupRequestSchema
>;

export const SmartFlowAlertEvidenceBundleSchema = z
  .object({
    alert_id: z.string().min(1).optional(),
    items: z.array(SmartFlowAlertEvidenceItemSchema)
  })
  .strict();

export type SmartFlowAlertEvidenceBundle = z.infer<typeof SmartFlowAlertEvidenceBundleSchema>;

export const isNativeNonAbstainedSmartFlowProjection = (
  projection: SmartFlowExplainabilityProjection
): boolean =>
  projection.source_channel === "smart-flow" &&
  projection.hypothesis.generated_from === "flow_evidence_cluster" &&
  projection.abstention.abstained === false &&
  projection.hypothesis.abstention.abstained === false &&
  projection.insight.abstention.abstained === false;

const NonAbstainedNativeSmartFlowProjectionSchema = SmartFlowExplainabilityProjectionSchema.refine(
  isNativeNonAbstainedSmartFlowProjection,
  "Smart-flow alerts require a non-abstained native smart-flow projection."
);

const addProjectionMismatch = (
  ctx: z.RefinementCtx,
  path: (string | number)[],
  message: string
) => {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message
  });
};

const arraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const SmartFlowAlertEventSchema = EventMetaSchema.extend({
  schema_version: SmartFlowContractVersionSchema,
  alert_id: z.string().min(1),
  hypothesis_id: z.string().min(1),
  insight_id: z.string().min(1),
  underlying_id: z.string().min(1),
  hypothesis_type: FlowHypothesisTypeSchema,
  direction: SmartFlowDirectionSchema,
  policy_confidence: z.number().min(0).max(1),
  evidence_quality: z.number().min(0).max(1),
  trigger: SmartFlowAlertTriggerSchema,
  projection: NonAbstainedNativeSmartFlowProjectionSchema,
  evidence_refs: z.array(z.string().min(1)).min(1)
})
  .strict()
  .superRefine((alert, ctx) => {
    const confidence = alert.projection.hypothesis.scores.confidence;
    const matches: Array<[boolean, (string | number)[], string]> = [
      [
        alert.schema_version === alert.projection.schema_version,
        ["schema_version"],
        "Alert schema_version must match projection schema_version."
      ],
      [
        alert.hypothesis_id === alert.projection.refs.hypothesis_id,
        ["hypothesis_id"],
        "Alert hypothesis_id must match projection refs.hypothesis_id."
      ],
      [
        alert.hypothesis_id === alert.projection.hypothesis.hypothesis_id,
        ["hypothesis_id"],
        "Alert hypothesis_id must match projection hypothesis.hypothesis_id."
      ],
      [
        alert.hypothesis_id === alert.projection.insight.hypothesis_id,
        ["hypothesis_id"],
        "Alert hypothesis_id must match projection insight.hypothesis_id."
      ],
      [
        alert.insight_id === alert.projection.refs.insight_id,
        ["insight_id"],
        "Alert insight_id must match projection refs.insight_id."
      ],
      [
        alert.insight_id === alert.projection.insight.insight_id,
        ["insight_id"],
        "Alert insight_id must match projection insight.insight_id."
      ],
      [
        alert.underlying_id === alert.projection.hypothesis.underlying_id,
        ["underlying_id"],
        "Alert underlying_id must match projection hypothesis.underlying_id."
      ],
      [
        alert.underlying_id === alert.projection.insight.underlying_id,
        ["underlying_id"],
        "Alert underlying_id must match projection insight.underlying_id."
      ],
      [
        alert.hypothesis_type === alert.projection.hypothesis.hypothesis_type,
        ["hypothesis_type"],
        "Alert hypothesis_type must match projection hypothesis.hypothesis_type."
      ],
      [
        alert.hypothesis_type === alert.projection.hypothesis.scores.hypothesis_type,
        ["hypothesis_type"],
        "Alert hypothesis_type must match projection hypothesis scores.hypothesis_type."
      ],
      [
        alert.direction === alert.projection.hypothesis.direction,
        ["direction"],
        "Alert direction must match projection hypothesis.direction."
      ],
      [
        alert.direction === alert.projection.hypothesis.scores.direction,
        ["direction"],
        "Alert direction must match projection hypothesis scores.direction."
      ],
      [
        alert.direction === alert.projection.insight.direction,
        ["direction"],
        "Alert direction must match projection insight.direction."
      ],
      [
        alert.policy_confidence === confidence.policy_confidence,
        ["policy_confidence"],
        "Alert policy_confidence must match projection confidence.policy_confidence."
      ],
      [
        alert.evidence_quality === confidence.evidence_quality,
        ["evidence_quality"],
        "Alert evidence_quality must match projection confidence.evidence_quality."
      ],
      [
        alert.trigger.projection_trace_id === alert.projection.trace_id,
        ["trigger", "projection_trace_id"],
        "Alert trigger projection_trace_id must match projection trace_id."
      ],
      [
        alert.trigger.projection_version === alert.projection.projection_version,
        ["trigger", "projection_version"],
        "Alert trigger projection_version must match projection projection_version."
      ],
      [
        arraysEqual(alert.evidence_refs, alert.projection.refs.evidence_refs),
        ["evidence_refs"],
        "Alert evidence_refs must match projection refs.evidence_refs."
      ],
      [
        arraysEqual(alert.evidence_refs, alert.projection.evidence.evidence_refs),
        ["evidence_refs"],
        "Alert evidence_refs must match projection evidence.evidence_refs."
      ],
      [
        arraysEqual(alert.evidence_refs, alert.projection.hypothesis.evidence_refs),
        ["evidence_refs"],
        "Alert evidence_refs must match projection hypothesis.evidence_refs."
      ],
      [
        arraysEqual(alert.evidence_refs, alert.projection.insight.evidence_refs),
        ["evidence_refs"],
        "Alert evidence_refs must match projection insight.evidence_refs."
      ]
    ];

    for (const [valid, path, message] of matches) {
      if (!valid) {
        addProjectionMismatch(ctx, path, message);
      }
    }
  });

export type SmartFlowAlertEvent = z.infer<typeof SmartFlowAlertEventSchema>;

export const smartFlowAlertFromProjection = (
  projection: SmartFlowExplainabilityProjection,
  options: { alert_id?: string; trace_id?: string } = {}
): SmartFlowAlertEvent | null => {
  if (!isNativeNonAbstainedSmartFlowProjection(projection)) {
    return null;
  }

  const alertId = options.alert_id ?? `smartflow:alert:${projection.refs.hypothesis_id}`;
  const confidence = projection.hypothesis.scores.confidence;

  return SmartFlowAlertEventSchema.parse({
    source_ts: projection.source_ts,
    ingest_ts: projection.ingest_ts,
    seq: projection.seq,
    trace_id: options.trace_id ?? alertId,
    schema_version: projection.schema_version,
    alert_id: alertId,
    hypothesis_id: projection.refs.hypothesis_id,
    insight_id: projection.refs.insight_id,
    underlying_id: projection.hypothesis.underlying_id,
    hypothesis_type: projection.hypothesis.hypothesis_type,
    direction: projection.hypothesis.direction,
    policy_confidence: confidence.policy_confidence,
    evidence_quality: confidence.evidence_quality,
    trigger: {
      kind: SMART_FLOW_ALERT_TRIGGER_KIND,
      projection_trace_id: projection.trace_id,
      projection_version: projection.projection_version,
      source_channel: projection.source_channel
    },
    projection,
    evidence_refs: projection.refs.evidence_refs
  });
};
