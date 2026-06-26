import type { SmartFlowAlertEvent } from "@islandflow/types";
import type { CSSProperties } from "react";

import {
  getSmartFlowTint,
  normalizeSmartFlowClassToken,
  type SmartFlowTintMetadata
} from "../smart-flow";

export type AlertRowTint = {
  className: string;
  style: CSSProperties;
  metadata: SmartFlowTintMetadata;
};

export const getSmartFlowAlertRowTint = (alert: SmartFlowAlertEvent): AlertRowTint => {
  const tint = getSmartFlowTint(alert.projection);
  const { metadata } = tint;
  const hypothesisClass = normalizeSmartFlowClassToken(metadata.hypothesisType);

  return {
    className: [
      "alerts-row-tinted",
      "alerts-smart-flow-row",
      `alerts-row-hypothesis-${hypothesisClass}`,
      `alerts-row-direction-${metadata.direction}`,
      `alerts-row-confidence-${metadata.confidenceBand}`,
      `alerts-row-evidence-${metadata.evidenceQualityBand}`,
      `smart-flow-tone-${metadata.tone}`
    ].join(" "),
    style: tint.style,
    metadata
  };
};

export const getSmartFlowAlertRowTintClassName = (alert: SmartFlowAlertEvent): string =>
  getSmartFlowAlertRowTint(alert).className;

export const getSmartFlowAlertRowTintStyle = (alert: SmartFlowAlertEvent): CSSProperties =>
  getSmartFlowAlertRowTint(alert).style;
