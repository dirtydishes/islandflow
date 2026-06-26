import type { CSSProperties } from "react";

import type {
  DurableTapeRowClassNameGetter,
  DurableTapeRowHookInput,
  DurableTapeRowStyleGetter
} from "./types";

export type DurableTapeRowDecoration = {
  className?: string;
  style?: CSSProperties;
};

export const resolveDurableTapeRowDecoration = <TItem>({
  enabled,
  input,
  getRowClassName,
  getRowStyle
}: {
  enabled: boolean;
  input: DurableTapeRowHookInput<TItem>;
  getRowClassName?: DurableTapeRowClassNameGetter<TItem>;
  getRowStyle?: DurableTapeRowStyleGetter<TItem>;
}): DurableTapeRowDecoration => {
  if (!enabled) {
    return {};
  }

  return {
    className: getRowClassName?.(input),
    style: getRowStyle?.(input)
  };
};
