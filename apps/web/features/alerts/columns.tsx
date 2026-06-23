"use client";

import type { AlertEvent } from "@islandflow/types";
import type { ReactNode } from "react";

import type { DurableTapeColumnDefinition, DurableTapeTemplate } from "../durable-tape";
import {
  deriveAlertDirection,
  formatAlertScore,
  formatAlertTime,
  getAlertKind,
  inferAlertUnderlying,
  normalizeAlertSeverity
} from "./format";
import type { AlertColumnId } from "./types";

export const ALERTS_COLUMNS: DurableTapeColumnDefinition<AlertEvent, AlertColumnId>[] = [
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
    render: (alert) => inferAlertUnderlying(alert) ?? "ALERT"
  },
  {
    id: "kind",
    label: "KIND",
    minWidth: 136,
    className: "alerts-cell-kind",
    render: getAlertKind
  },
  {
    id: "score",
    label: "SCORE",
    minWidth: 66,
    align: "end",
    className: "alerts-cell-score durable-tape-cell-number",
    render: (alert) => formatAlertScore(alert.score)
  },
  {
    id: "state",
    label: "STATE",
    minWidth: 86,
    className: "alerts-cell-state",
    render: (alert) => normalizeAlertSeverity(alert)
  }
];

export const ALERTS_TEMPLATES: DurableTapeTemplate<AlertColumnId>[] = [
  { id: "full", columns: ["time", "symbol", "kind", "score", "state"] },
  { id: "twoThirds", columns: ["time", "symbol", "kind", "score"] },
  { id: "oneThird", columns: ["time", "symbol", "state"] },
  { id: "micro", columns: ["symbol", "state"] }
];

const renderStateCell = (alert: AlertEvent): ReactNode => {
  const severity = normalizeAlertSeverity(alert);
  const direction = deriveAlertDirection(alert);
  return (
    <span className={`alerts-state alerts-state-${severity} direction-${direction}`}>
      {severity} / {direction}
    </span>
  );
};

export const renderAlertsRow = ({
  alert,
  columns
}: {
  alert: AlertEvent;
  columns: DurableTapeColumnDefinition<AlertEvent>[];
}): ReactNode =>
  columns.map((column) => {
    const content =
      column.id === "state" ? renderStateCell(alert) : column.render ? column.render(alert) : "--";
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
