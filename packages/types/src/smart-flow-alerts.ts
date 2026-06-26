import { z } from "zod";
import { EventMetaSchema, SmartMoneyDirectionSchema } from "./events";
import {
  FlowHypothesisTypeSchema,
  SmartFlowContractVersionSchema,
  type SmartFlowExplainabilityProjection,
  SmartFlowExplainabilityProjectionSchema
} from "./smart-flow";

export const SMART_FLOW_ALERT_TRIGGER_KIND = "non_abstained_hypothesis";

export const SmartFlowAlertTriggerSchema = z
  .object({
    kind: z.literal(SMART_FLOW_ALERT_TRIGGER_KIND),
    projection_trace_id: z.string().min(1),
    projection_version: z.string().min(1),
    source_channel: z.literal("smart-flow")
  })
  .strict();

export type SmartFlowAlertTrigger = z.infer<typeof SmartFlowAlertTriggerSchema>;

const NonAbstainedNativeSmartFlowProjectionSchema = SmartFlowExplainabilityProjectionSchema.refine(
  (projection) =>
    projection.source_channel === "smart-flow" &&
    !projection.compatibility?.compatibility_only &&
    projection.abstention.abstained === false,
  "Smart-flow alerts require a non-abstained native smart-flow projection."
);

export const SmartFlowAlertEventSchema = EventMetaSchema.extend({
  schema_version: SmartFlowContractVersionSchema,
  alert_id: z.string().min(1),
  hypothesis_id: z.string().min(1),
  insight_id: z.string().min(1),
  underlying_id: z.string().min(1),
  hypothesis_type: FlowHypothesisTypeSchema,
  direction: SmartMoneyDirectionSchema,
  policy_confidence: z.number().min(0).max(1),
  evidence_quality: z.number().min(0).max(1),
  trigger: SmartFlowAlertTriggerSchema,
  projection: NonAbstainedNativeSmartFlowProjectionSchema,
  evidence_refs: z.array(z.string().min(1)).min(1)
}).strict();

export type SmartFlowAlertEvent = z.infer<typeof SmartFlowAlertEventSchema>;

export const smartFlowAlertFromProjection = (
  projection: SmartFlowExplainabilityProjection,
  options: { alert_id?: string; trace_id?: string } = {}
): SmartFlowAlertEvent | null => {
  if (
    projection.abstention.abstained ||
    projection.source_channel !== "smart-flow" ||
    projection.compatibility?.compatibility_only
  ) {
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
