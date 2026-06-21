"use client";

import type { ReactNode } from "react";

type MarketChartSectionProps = {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export const MarketChartSection = ({ title, meta, actions, children }: MarketChartSectionProps) => {
  return (
    <section className="market-chart-section">
      <div className="market-chart-section-head">
        <div>
          <h2>{title}</h2>
          {meta ? <div className="market-chart-section-meta">{meta}</div> : null}
        </div>
        {actions ? <div className="market-chart-section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
};
