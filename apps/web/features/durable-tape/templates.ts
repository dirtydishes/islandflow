import {
  applyDurableTapeColumnOverrides,
  getDurableTapeColumnsMinWidth,
  selectDurableTapeColumns
} from "./columns";
import type {
  DurableTapeColumnDefinition,
  DurableTapeColumnOverride,
  DurableTapeTemplate,
  DurableTapeTemplateId,
  DurableTapeTemplateSelection
} from "./types";

export const DURABLE_TAPE_TEMPLATE_ORDER = [
  "full",
  "twoThirds",
  "half",
  "oneThird",
  "micro"
] as const satisfies readonly DurableTapeTemplateId[];

export const getDurableTapeTemplateMinWidth = <TItem, TColumnId extends string = string>(
  template: DurableTapeTemplate<TColumnId>,
  columns: readonly DurableTapeColumnDefinition<TItem, TColumnId>[]
): number => {
  return getDurableTapeColumnsMinWidth(selectDurableTapeColumns(columns, template.columns));
};

const getTemplateRank = (id: DurableTapeTemplateId): number => {
  const index = DURABLE_TAPE_TEMPLATE_ORDER.indexOf(id);
  return index >= 0 ? index : DURABLE_TAPE_TEMPLATE_ORDER.length;
};

export const selectDurableTapeTemplate = <TItem, TColumnId extends string = string>({
  templates,
  columns,
  columnOverrides,
  containerWidth,
  requestedTemplate = "auto"
}: {
  templates: readonly DurableTapeTemplate<TColumnId>[];
  columns: readonly DurableTapeColumnDefinition<TItem, TColumnId>[];
  columnOverrides?: readonly DurableTapeColumnOverride<TItem, TColumnId>[];
  containerWidth: number;
  requestedTemplate?: DurableTapeTemplateId | "auto";
}): DurableTapeTemplateSelection<TItem, TColumnId> => {
  if (templates.length === 0) {
    throw new Error("Durable tape requires at least one template.");
  }

  const resolvedColumns = applyDurableTapeColumnOverrides(columns, columnOverrides);
  const sortedTemplates = [...templates].sort((left, right) => {
    return getTemplateRank(left.id) - getTemplateRank(right.id);
  });
  const templateById = new Map(sortedTemplates.map((template) => [template.id, template]));
  const pinned = requestedTemplate !== "auto";
  const width = Math.max(0, containerWidth);

  const select = (
    template: DurableTapeTemplate<TColumnId>,
    forcePinned: boolean
  ): DurableTapeTemplateSelection<TItem, TColumnId> => {
    const selectedColumns = selectDurableTapeColumns(resolvedColumns, template.columns);
    const minWidth = getDurableTapeColumnsMinWidth(selectedColumns);
    return {
      template,
      columns: selectedColumns,
      minWidth,
      pinned: forcePinned,
      fits: minWidth <= width
    };
  };

  if (pinned) {
    const template = templateById.get(requestedTemplate);
    if (!template) {
      throw new Error(`Unknown durable tape template: ${requestedTemplate}`);
    }
    return select(template, true);
  }

  for (const template of sortedTemplates) {
    const selection = select(template, false);
    if (selection.fits) {
      return selection;
    }
  }

  const micro = templateById.get("micro") ?? sortedTemplates.at(-1);
  if (!micro) {
    throw new Error("Durable tape could not select a fallback template.");
  }
  return select(micro, false);
};
