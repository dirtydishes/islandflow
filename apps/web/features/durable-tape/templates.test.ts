import { describe, expect, it } from "bun:test";

import { getDurableTapeTemplateMinWidth, selectDurableTapeTemplate } from "./templates";
import type { DurableTapeColumnDefinition, DurableTapeTemplate } from "./types";

type Row = { id: string };
type ColumnId = "time" | "symbol" | "notional" | "side" | "detail";

const columns: DurableTapeColumnDefinition<Row, ColumnId>[] = [
  { id: "time", label: "Time", minWidth: 80 },
  { id: "symbol", label: "Symbol", minWidth: 70 },
  { id: "notional", label: "Notional", minWidth: 100 },
  { id: "side", label: "Side", minWidth: 60 },
  { id: "detail", label: "Detail", minWidth: 180 }
];

const templates: DurableTapeTemplate<ColumnId>[] = [
  { id: "full", columns: ["time", "symbol", "notional", "side", "detail"] },
  { id: "half", columns: ["time", "symbol", "notional"] },
  { id: "micro", columns: ["time"] }
];

describe("durable tape template selection", () => {
  it("selects the largest template that fits the measured container", () => {
    const selection = selectDurableTapeTemplate({
      templates,
      columns,
      containerWidth: 249,
      requestedTemplate: "auto"
    });

    expect(selection.template.id).toBe("micro");
    expect(selection.fits).toBe(true);
  });

  it("includes exact min-width boundaries as fitting", () => {
    const selection = selectDurableTapeTemplate({
      templates,
      columns,
      containerWidth: 490,
      requestedTemplate: "auto"
    });

    expect(selection.template.id).toBe("full");
    expect(getDurableTapeTemplateMinWidth(selection.template, columns)).toBe(490);
  });

  it("honors pinned templates even when they exceed the container", () => {
    const selection = selectDurableTapeTemplate({
      templates,
      columns,
      containerWidth: 120,
      requestedTemplate: "full"
    });

    expect(selection.template.id).toBe("full");
    expect(selection.pinned).toBe(true);
    expect(selection.fits).toBe(false);
  });

  it("falls back to micro when no automatic template fits", () => {
    const selection = selectDurableTapeTemplate({
      templates,
      columns,
      containerWidth: 20,
      requestedTemplate: "auto"
    });

    expect(selection.template.id).toBe("micro");
    expect(selection.columns.map((column) => column.id)).toEqual(["time"]);
  });

  it("applies column overrides before measuring", () => {
    const selection = selectDurableTapeTemplate({
      templates,
      columns,
      columnOverrides: [{ id: "detail", enabled: false }],
      containerWidth: 310,
      requestedTemplate: "auto"
    });

    expect(selection.template.id).toBe("full");
    expect(selection.columns.map((column) => column.id)).toEqual([
      "time",
      "symbol",
      "notional",
      "side"
    ]);
  });
});
