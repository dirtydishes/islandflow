"use client";

import type { CSSProperties } from "react";
import type { MarketChartHoverRow, MarketChartHoverSnapshot } from "../types";

type MarketChartTooltipProps = {
  snapshot: MarketChartHoverSnapshot | null;
  containerWidth: number;
};

type TooltipSection = {
  id: string;
  label?: string;
  rows: MarketChartHoverRow[];
};

const groupRows = (rows: readonly MarketChartHoverRow[], fallbackLabel: string): TooltipSection[] => {
  const groups = new Map<string, MarketChartHoverRow[]>();
  for (const row of rows) {
    const group = row.group ?? fallbackLabel;
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return [...groups.entries()].map(([label, groupedRows]) => ({
    id: label,
    label,
    rows: groupedRows
  }));
};

const tooltipStyle = (
  snapshot: MarketChartHoverSnapshot,
  containerWidth: number
): CSSProperties => {
  const point = snapshot.point;
  if (!point || containerWidth <= 0) {
    return { top: 8, right: 8 };
  }
  if (containerWidth < 520) {
    return { top: 8, right: 8, left: 8 };
  }

  const offset = 16;
  const top = Math.max(8, point.y - 44);
  if (point.x > containerWidth * 0.56) {
    return { top, right: Math.max(8, containerWidth - point.x + offset) };
  }
  return { top, left: Math.max(8, point.x + offset) };
};

const MarketChartTooltipRows = ({ rows }: { rows: MarketChartHoverRow[] }) => (
  <div className="market-chart-tooltip-rows">
    {rows.map((row) => (
      <div
        className={`market-chart-tooltip-row market-chart-tooltip-row-${row.tone ?? "default"}`}
        key={row.id}
      >
        <span className="market-chart-tooltip-label">{row.label}</span>
        <span className="market-chart-tooltip-value">{row.value}</span>
      </div>
    ))}
  </div>
);

export const MarketChartTooltip = ({ snapshot, containerWidth }: MarketChartTooltipProps) => {
  if (!snapshot) {
    return null;
  }

  const sections: TooltipSection[] = [
    { id: "core", rows: snapshot.coreRows },
    ...groupRows(snapshot.extensionRows, "Extensions"),
    ...(snapshot.lowerRows.length ? [{ id: "lower", label: "Lower pane", rows: snapshot.lowerRows }] : []),
    ...(snapshot.overlayRows.length ? [{ id: "overlays", label: "Overlays", rows: snapshot.overlayRows }] : [])
  ];

  return (
    <aside
      aria-label={`${snapshot.symbol} chart hover readout`}
      className="market-chart-tooltip"
      role="status"
      style={tooltipStyle(snapshot, containerWidth)}
    >
      <div className="market-chart-tooltip-head">
        <span>{snapshot.symbol}</span>
        <span>{snapshot.candle?.direction ?? "neutral"} candle</span>
      </div>
      {sections.map((section) => (
        <section className="market-chart-tooltip-section" key={section.id}>
          {section.label ? <div className="market-chart-tooltip-group">{section.label}</div> : null}
          <MarketChartTooltipRows rows={section.rows} />
        </section>
      ))}
    </aside>
  );
};
