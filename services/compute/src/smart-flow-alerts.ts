import {
  type SmartFlowAlertEvent,
  type SmartFlowExplainabilityProjection,
  smartFlowAlertFromProjection
} from "@islandflow/types";

export type SmartFlowAlertEmissionPlan = {
  projection: SmartFlowExplainabilityProjection;
  alert: SmartFlowAlertEvent | null;
};

export const planSmartFlowAlertEmissions = (
  projections: readonly SmartFlowExplainabilityProjection[]
): SmartFlowAlertEmissionPlan[] =>
  projections.map((projection) => ({
    projection,
    alert: smartFlowAlertFromProjection(projection)
  }));
