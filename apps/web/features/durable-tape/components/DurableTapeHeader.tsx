"use client";

import type { ReactNode } from "react";

type DurableTapeHeaderProps = {
  title?: string;
  status?: ReactNode;
  actions?: ReactNode;
};

export const DurableTapeHeader = ({ title, status, actions }: DurableTapeHeaderProps) => {
  if (!title && !status && !actions) {
    return null;
  }

  return (
    <div className="durable-tape-header">
      <div className="durable-tape-title-row">
        {title ? <h2 className="durable-tape-title">{title}</h2> : null}
        {status ? <div className="durable-tape-status">{status}</div> : null}
      </div>
      {actions ? <div className="durable-tape-actions">{actions}</div> : null}
    </div>
  );
};
