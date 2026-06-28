import type { OptionPrint } from "@islandflow/types";

import type { DurableTapeTemplate } from "../durable-tape";
import type { OptionsTapeColumnId, OptionsTapeMode } from "./types";
import { OPTIONS_TAPE_TEMPLATES_BY_MODE } from "./columns";

export const OPTIONS_TAPE_SETTINGS_STORAGE_KEY = "islandflow.options-tape.settings.v1";
export const OPTIONS_TAPE_SETTINGS_STORAGE_VERSION = 1;

export const OPTIONS_TAPE_DEFAULT_COLUMN_ORDER = [
  "info",
  "time",
  "contract",
  "dte",
  "price",
  "size",
  "premium",
  "side",
  "iv",
  "spot",
  "nbbo",
  "exchange"
] as const satisfies readonly OptionsTapeColumnId[];

const OPTIONS_TAPE_COLUMN_ID_SET = new Set<string>(OPTIONS_TAPE_DEFAULT_COLUMN_ORDER);

export type OptionsTapeSettingsState = {
  smartFlowOnly: boolean;
  columnOrder: OptionsTapeColumnId[];
  hiddenColumns: OptionsTapeColumnId[];
};

export type OptionsTapeSettingsStorage = Pick<Storage, "getItem" | "setItem">;

type StoredOptionsTapeSettings = {
  version: typeof OPTIONS_TAPE_SETTINGS_STORAGE_VERSION;
  settings: OptionsTapeSettingsState;
};

export type OptionsTapeSettingsAction =
  | { type: "set-smart-flow-only"; value: boolean }
  | { type: "toggle-column"; id: OptionsTapeColumnId; visible: boolean }
  | { type: "move-column"; id: OptionsTapeColumnId; direction: "up" | "down" }
  | { type: "reset" };

const isOptionsTapeColumnId = (value: unknown): value is OptionsTapeColumnId =>
  typeof value === "string" && OPTIONS_TAPE_COLUMN_ID_SET.has(value);

const uniqueKnownColumns = (values: unknown): OptionsTapeColumnId[] => {
  const next: OptionsTapeColumnId[] = [];
  if (Array.isArray(values)) {
    for (const value of values) {
      if (isOptionsTapeColumnId(value) && !next.includes(value)) {
        next.push(value);
      }
    }
  }
  return next;
};

export const buildDefaultOptionsTapeSettings = (): OptionsTapeSettingsState => ({
  smartFlowOnly: false,
  columnOrder: [...OPTIONS_TAPE_DEFAULT_COLUMN_ORDER],
  hiddenColumns: []
});

export const normalizeOptionsTapeSettings = (value: unknown): OptionsTapeSettingsState => {
  if (!value || typeof value !== "object") {
    return buildDefaultOptionsTapeSettings();
  }

  const candidate = value as Partial<OptionsTapeSettingsState>;
  const explicitOrder = uniqueKnownColumns(candidate.columnOrder);
  const columnOrder = [
    ...explicitOrder,
    ...OPTIONS_TAPE_DEFAULT_COLUMN_ORDER.filter((id) => !explicitOrder.includes(id))
  ];
  const hiddenColumns = uniqueKnownColumns(candidate.hiddenColumns).filter((id) =>
    columnOrder.includes(id)
  );

  return {
    smartFlowOnly: candidate.smartFlowOnly === true,
    columnOrder,
    hiddenColumns: hiddenColumns.length >= columnOrder.length ? [] : hiddenColumns
  };
};

export const getVisibleOptionsTapeColumnOrder = (
  settings: OptionsTapeSettingsState
): OptionsTapeColumnId[] => {
  const normalized = normalizeOptionsTapeSettings(settings);
  const hidden = new Set(normalized.hiddenColumns);
  const visible = normalized.columnOrder.filter((id) => !hidden.has(id));
  return visible.length > 0 ? visible : [...OPTIONS_TAPE_DEFAULT_COLUMN_ORDER];
};

export const reduceOptionsTapeSettings = (
  state: OptionsTapeSettingsState,
  action: OptionsTapeSettingsAction
): OptionsTapeSettingsState => {
  const current = normalizeOptionsTapeSettings(state);

  if (action.type === "reset") {
    return buildDefaultOptionsTapeSettings();
  }

  if (action.type === "set-smart-flow-only") {
    return { ...current, smartFlowOnly: action.value };
  }

  if (action.type === "toggle-column") {
    if (action.id === "info" && !action.visible) {
      return current;
    }
    const hidden = new Set(current.hiddenColumns);
    const visibleCount = getVisibleOptionsTapeColumnOrder(current).length;
    if (action.visible) {
      hidden.delete(action.id);
    } else if (visibleCount > 1) {
      hidden.add(action.id);
    }
    return normalizeOptionsTapeSettings({ ...current, hiddenColumns: Array.from(hidden) });
  }

  const index = current.columnOrder.indexOf(action.id);
  if (index < 0) {
    return current;
  }
  const targetIndex = action.direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= current.columnOrder.length) {
    return current;
  }
  const columnOrder = [...current.columnOrder];
  const [item] = columnOrder.splice(index, 1);
  if (!item) {
    return current;
  }
  columnOrder.splice(targetIndex, 0, item);
  return normalizeOptionsTapeSettings({ ...current, columnOrder });
};

export const buildOptionsTapeTemplatesForSettings = (
  mode: OptionsTapeMode,
  settings: OptionsTapeSettingsState
): DurableTapeTemplate<OptionsTapeColumnId>[] => {
  const visibleOrder = getVisibleOptionsTapeColumnOrder(settings);
  return OPTIONS_TAPE_TEMPLATES_BY_MODE[mode].map((template) => {
    const allowed = new Set(template.columns);
    const columns = visibleOrder.filter((id) => allowed.has(id));
    const ensuredColumns =
      allowed.has("info") && !columns.includes("info") ? (["info", ...columns] as const) : columns;
    return {
      ...template,
      columns: ensuredColumns.length > 0 ? ensuredColumns : visibleOrder.slice(0, 1)
    };
  });
};

export const filterOptionsTapeSmartFlowRows = <TPrint extends OptionPrint>(
  rows: readonly TPrint[],
  smartFlowOnly: boolean,
  hasSmartFlow: (row: TPrint) => boolean
): TPrint[] => (smartFlowOnly ? rows.filter(hasSmartFlow) : [...rows]);

export const readOptionsTapeSettings = (
  storage: OptionsTapeSettingsStorage | null | undefined
): OptionsTapeSettingsState => {
  if (!storage) {
    return buildDefaultOptionsTapeSettings();
  }

  try {
    const raw = storage.getItem(OPTIONS_TAPE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return buildDefaultOptionsTapeSettings();
    }
    const parsed = JSON.parse(raw) as Partial<StoredOptionsTapeSettings>;
    if (parsed.version !== OPTIONS_TAPE_SETTINGS_STORAGE_VERSION) {
      return buildDefaultOptionsTapeSettings();
    }
    return normalizeOptionsTapeSettings(parsed.settings);
  } catch {
    return buildDefaultOptionsTapeSettings();
  }
};

export const writeOptionsTapeSettings = (
  storage: OptionsTapeSettingsStorage | null | undefined,
  settings: OptionsTapeSettingsState
): void => {
  if (!storage) {
    return;
  }

  const payload: StoredOptionsTapeSettings = {
    version: OPTIONS_TAPE_SETTINGS_STORAGE_VERSION,
    settings: normalizeOptionsTapeSettings(settings)
  };

  try {
    storage.setItem(OPTIONS_TAPE_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Browser storage can be blocked; in-memory settings still apply.
  }
};
