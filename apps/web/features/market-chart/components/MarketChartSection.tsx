"use client";

import type { ReactNode } from "react";

type MarketChartSectionProps = {
  title: string;
  className?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export const MarketChartSection = ({
  title,
  className,
  meta,
  actions,
  children
}: MarketChartSectionProps) => {
  return (
    <section className={["market-chart-section", className].filter(Boolean).join(" ")}>
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
