"use client";

import { useMarketChartController } from "../hooks/useMarketChartController";
import type { MarketChartProps } from "../types";
import { MarketChartTooltip } from "./MarketChartTooltip";

export const MarketChart = (props: MarketChartProps) => {
  const { containerRef, hoverSnapshot, preset } = useMarketChartController(props);
  const containerWidth = containerRef.current?.clientWidth ?? 0;

  return (
    <div
      className={`market-chart market-chart-${preset.id}`}
      data-status={props.status ?? "idle"}
      style={{ minHeight: preset.minHeight }}
    >
      <div className="market-chart-surface" ref={containerRef} />
      <MarketChartTooltip snapshot={hoverSnapshot} containerWidth={containerWidth} />
    </div>
  );
};
