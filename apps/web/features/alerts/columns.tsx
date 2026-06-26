"use client";

import type { SmartFlowAlertEvent } from "@islandflow/types";
import type { ReactNode } from "react";

import type { DurableTapeColumnDefinition, DurableTapeTemplate } from "../durable-tape";
import {
  formatAlertTime,
  getAlertConfidenceEvidenceLabel,
  getAlertDirectionLabel,
  getAlertName,
  getAlertSymbol,
  normalizeAlertDirection
} from "./format";
import type { AlertColumnId } from "./types";

export const ALERTS_COLUMNS: DurableTapeColumnDefinition<SmartFlowAlertEvent, AlertColumnId>[] = [
  {
    id: "time",
    label: "TIME",
    minWidth: 76,
    className: "alerts-cell-time durable-tape-cell-number",
    render: (alert) => formatAlertTime(alert.source_ts)
  },
  {
    id: "symbol",
    label: "SYMBOL",
    minWidth: 76,
    className: "alerts-cell-symbol",
    render: getAlertSymbol
  },
  {
    id: "hypothesis",
    label: "HYPOTHESIS",
    minWidth: 168,
    className: "alerts-cell-hypothesis",
    render: getAlertName
  },
  {
    id: "direction",
    label: "DIR",
    minWidth: 92,
    className: "alerts-cell-direction",
    render: getAlertDirectionLabel
  },
  {
    id: "confidenceEvidence",
    label: "CONF/EVID",
    minWidth: 132,
    className: "alerts-cell-confidence",
    render: getAlertConfidenceEvidenceLabel
  }
];

export const ALERTS_TEMPLATES: DurableTapeTemplate<AlertColumnId>[] = [
  { id: "full", columns: ["time", "symbol", "hypothesis", "direction", "confidenceEvidence"] },
  { id: "twoThirds", columns: ["time", "symbol", "hypothesis", "confidenceEvidence"] },
  { id: "oneThird", columns: ["time", "symbol", "direction"] },
  { id: "micro", columns: ["symbol", "direction"] }
];

const renderDirectionCell = (alert: SmartFlowAlertEvent): ReactNode => {
  const direction = normalizeAlertDirection(alert.direction);
  return (
    <span className={`alerts-state alerts-state-direction direction-${direction}`}>
      {direction}
    </span>
  );
};

export const renderAlertsRow = ({
  alert,
  columns
}: {
  alert: SmartFlowAlertEvent;
  columns: DurableTapeColumnDefinition<SmartFlowAlertEvent>[];
}): ReactNode =>
  columns.map((column) => {
    const content =
      column.id === "direction"
        ? renderDirectionCell(alert)
        : column.render
          ? column.render(alert)
          : "--";
    return (
      <span
        className={`durable-tape-cell ${column.className ?? ""}`.trim()}
        data-align={column.align ?? "start"}
        key={column.id}
        role="cell"
      >
        {content}
      </span>
    );
  });
