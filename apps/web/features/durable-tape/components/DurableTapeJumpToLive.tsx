"use client";

import { formatDurableTapeNewItemCount } from "../scroll-hold";

type DurableTapeJumpToLiveProps = {
  count: number;
  disabled?: boolean;
  onJump: () => void;
};

export const DurableTapeJumpToLive = ({
  count,
  disabled = false,
  onJump
}: DurableTapeJumpToLiveProps) => {
  const active = count > 0 && !disabled;
  const label = active ? `${formatDurableTapeNewItemCount(count)} new` : "Live";

  return (
    <button
      className={`durable-tape-jump${active ? " is-active" : ""}`}
      type="button"
      disabled={disabled}
      onClick={onJump}
      aria-label={active ? `Jump to live, ${label} rows queued` : "At live head"}
    >
      <span className="durable-tape-jump-icon" aria-hidden="true">
        ^
      </span>
      <span>{label}</span>
    </button>
  );
};
