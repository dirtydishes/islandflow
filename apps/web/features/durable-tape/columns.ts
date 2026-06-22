import type { DurableTapeColumnDefinition, DurableTapeColumnOverride } from "./types";

export const applyDurableTapeColumnOverrides = <TItem, TColumnId extends string = string>(
  columns: readonly DurableTapeColumnDefinition<TItem, TColumnId>[],
  overrides: readonly DurableTapeColumnOverride<TItem, TColumnId>[] = []
): DurableTapeColumnDefinition<TItem, TColumnId>[] => {
  if (overrides.length === 0) {
    return [...columns];
  }

  const overrideById = new Map(overrides.map((override) => [override.id, override]));
  const resolved: DurableTapeColumnDefinition<TItem, TColumnId>[] = [];

  for (const column of columns) {
    const override = overrideById.get(column.id);
    if (override?.enabled === false) {
      continue;
    }
    resolved.push({ ...column, ...override, id: column.id });
  }

  return resolved;
};

export const selectDurableTapeColumns = <TItem, TColumnId extends string = string>(
  columns: readonly DurableTapeColumnDefinition<TItem, TColumnId>[],
  columnIds: readonly TColumnId[]
): DurableTapeColumnDefinition<TItem, TColumnId>[] => {
  const columnById = new Map(columns.map((column) => [column.id, column]));
  return columnIds
    .map((id) => columnById.get(id) ?? null)
    .filter((column): column is DurableTapeColumnDefinition<TItem, TColumnId> => column !== null);
};

export const getDurableTapeColumnsMinWidth = <TItem, TColumnId extends string = string>(
  columns: readonly DurableTapeColumnDefinition<TItem, TColumnId>[]
): number => {
  return columns.reduce((total, column) => total + Math.max(0, column.minWidth), 0);
};
