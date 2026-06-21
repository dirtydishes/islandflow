"use client";

import { useMarketChartController } from "../hooks/useMarketChartController";
import type { MarketChartProps } from "../types";

export const MarketChart = (props: MarketChartProps) => {
  const { containerRef, preset } = useMarketChartController(props);

  return (
    <div
      className={`market-chart market-chart-${preset.id}`}
      data-status={props.status ?? "idle"}
      style={{ minHeight: preset.minHeight }}
    >
      <div className="market-chart-surface" ref={containerRef} />
    </div>
  );
};
