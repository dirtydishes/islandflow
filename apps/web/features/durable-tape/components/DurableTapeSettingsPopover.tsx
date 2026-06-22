"use client";

import { useEffect, useRef } from "react";

import type { DurableTapeResolvedFeatures, DurableTapeTemplateId } from "../types";

type DurableTapeSettingsPopoverProps = {
  id?: string;
  open: boolean;
  features: DurableTapeResolvedFeatures;
  template: DurableTapeTemplateId;
  onClose: () => void;
};

export const DurableTapeSettingsPopover = ({
  id,
  open,
  features,
  template,
  onClose
}: DurableTapeSettingsPopoverProps) => {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="durable-tape-settings" id={id} role="dialog" aria-label="Tape settings">
      <div className="durable-tape-settings-head">
        <div>
          <div className="durable-tape-settings-title">Tape Settings</div>
          <div className="durable-tape-settings-copy">Current template: {template}</div>
        </div>
        <button className="terminal-button" type="button" onClick={onClose} ref={closeRef}>
          Close
        </button>
      </div>
      <dl className="durable-tape-settings-list">
        <div>
          <dt>History</dt>
          <dd>{features.clickhouseHistory ? "enabled" : "disabled"}</dd>
        </div>
        <div>
          <dt>Scroll hold</dt>
          <dd>{features.scrollHold ? "enabled" : "disabled"}</dd>
        </div>
        <div>
          <dt>Hover detail</dt>
          <dd>{features.hoverDetails ? "enabled" : "disabled"}</dd>
        </div>
      </dl>
    </div>
  );
};
