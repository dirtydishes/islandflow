"use client";

import type { ReactNode } from "react";

type DurableTapeHoverSurfaceProps = {
  children: ReactNode;
  open: boolean;
};

export const DurableTapeHoverSurface = ({ children, open }: DurableTapeHoverSurfaceProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="durable-tape-hover" role="status">
      {children}
    </div>
  );
};
