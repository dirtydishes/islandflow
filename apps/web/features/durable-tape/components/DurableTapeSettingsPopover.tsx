"use client";

import type { DurableTapeResolvedFeatures, DurableTapeTemplateId } from "../types";

type DurableTapeSettingsPopoverProps = {
  open: boolean;
  features: DurableTapeResolvedFeatures;
  template: DurableTapeTemplateId;
  onClose: () => void;
};

export const DurableTapeSettingsPopover = ({
  open,
  features,
  template,
  onClose
}: DurableTapeSettingsPopoverProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="durable-tape-settings" role="dialog" aria-label="Tape settings">
      <div className="durable-tape-settings-head">
        <div>
          <div className="durable-tape-settings-title">Tape Settings</div>
          <div className="durable-tape-settings-copy">Current template: {template}</div>
        </div>
        <button className="terminal-button" type="button" onClick={onClose}>
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
