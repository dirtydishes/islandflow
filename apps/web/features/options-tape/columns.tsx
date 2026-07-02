"use client";

import type { OptionPrint } from "@islandflow/types";
import type { ReactNode } from "react";

import type { DurableTapeColumnDefinition, DurableTapeTemplate } from "../durable-tape";
import {
  formatOptionsTapeContractLabel,
  formatOptionsTapeDteLabel,
  formatOptionsTapeNbbo,
  formatOptionsTapePercent,
  formatOptionsTapePremium,
  formatOptionsTapePrice,
  formatOptionsTapeSize,
  formatOptionsTapeTime,
  getOptionsTapePremium,
  getOptionsTapeSide
} from "./format";
import type { OptionsTapeColumnId, OptionsTapeMode, OptionsTapeRowContext } from "./types";

export const OPTIONS_TAPE_COLUMNS: DurableTapeColumnDefinition<OptionPrint, OptionsTapeColumnId>[] =
  [
    {
      id: "info",
      label: "",
      minWidth: 42,
      className: "options-tape-cell-info",
      render: () => ""
    },
    {
      id: "time",
      label: "TIME",
      minWidth: 72,
      className: "options-tape-cell-time durable-tape-cell-number",
      render: (print) => formatOptionsTapeTime(print.ts)
    },
    {
      id: "contract",
      label: "CONTRACT",
      minWidth: 150,
      className: "options-tape-cell-contract",
      render: (print) => formatOptionsTapeContractLabel(print.option_contract_id)
    },
    {
      id: "dte",
      label: "DT",
      minWidth: 56,
      className: "options-tape-cell-dte durable-tape-cell-number",
      render: (print) => formatOptionsTapeDteLabel(print.option_contract_id)
    },
    {
      id: "price",
      label: "PX",
      minWidth: 64,
      align: "end",
      className: "options-tape-cell-price durable-tape-cell-number",
      render: (print) => formatOptionsTapePrice(print.price)
    },
    {
      id: "size",
      label: "SIZE",
      minWidth: 62,
      align: "end",
      className: "options-tape-cell-size durable-tape-cell-number",
      render: (print) => formatOptionsTapeSize(print.size)
    },
    {
      id: "premium",
      label: "PREMIUM",
      minWidth: 92,
      align: "end",
      className: "options-tape-cell-premium durable-tape-cell-number",
      render: (print) => formatOptionsTapePremium(getOptionsTapePremium(print))
    },
    {
      id: "side",
      label: "SIDE",
      minWidth: 62,
      className: "options-tape-cell-side",
      render: (print) => getOptionsTapeSide(print)
    },
    {
      id: "iv",
      label: "IV",
      minWidth: 52,
      align: "end",
      className: "options-tape-cell-iv durable-tape-cell-number",
      render: (print) => formatOptionsTapePercent(print.execution_iv)
    },
    {
      id: "spot",
      label: "SPOT",
      minWidth: 68,
      align: "end",
      className: "options-tape-cell-spot durable-tape-cell-number",
      render: (print) => formatOptionsTapePrice(print.execution_underlying_spot ?? Number.NaN)
    },
    {
      id: "nbbo",
      label: "NBBO",
      minWidth: 112,
      align: "end",
      className: "options-tape-cell-nbbo durable-tape-cell-number",
      render: (print) => formatOptionsTapeNbbo(print)
    },
    {
      id: "exchange",
      label: "EXCH",
      minWidth: 58,
      className: "options-tape-cell-exchange",
      render: (print) => print.exchange || "--"
    }
  ];

export const OPTIONS_TAPE_TEMPLATES_BY_MODE: Record<
  OptionsTapeMode,
  DurableTapeTemplate<OptionsTapeColumnId>[]
> = {
  global: [
    { id: "full", columns: ["info", "time", "contract", "price", "size", "premium", "side"] },
    { id: "twoThirds", columns: ["info", "time", "contract", "price", "premium", "side"] },
    { id: "half", columns: ["info", "time", "contract", "premium", "side"] },
    { id: "oneThird", columns: ["info", "contract", "premium"] },
    { id: "micro", columns: ["info", "contract"] }
  ],
  packet: [
    { id: "full", columns: ["info", "dte", "time", "price", "size", "premium", "side"] },
    { id: "twoThirds", columns: ["info", "time", "price", "size", "premium", "side"] },
    { id: "half", columns: ["info", "time", "price", "premium", "side"] },
    { id: "oneThird", columns: ["info", "time", "premium"] },
    { id: "micro", columns: ["info", "premium"] }
  ],
  contract: [
    {
      id: "full",
      columns: ["info", "time", "price", "size", "premium", "nbbo", "side", "exchange"]
    },
    { id: "twoThirds", columns: ["info", "time", "price", "premium", "nbbo", "side"] },
    { id: "half", columns: ["info", "time", "price", "premium", "side"] },
    { id: "oneThird", columns: ["info", "price", "premium"] },
    { id: "micro", columns: ["info", "premium"] }
  ]
};

const renderSideCell = (content: ReactNode): ReactNode => {
  const side = typeof content === "string" ? content.toLowerCase() : "missing";
  return <span className={`options-tape-side options-tape-side-${side}`}>{content}</span>;
};

export const renderOptionsTapeRow = ({
  context,
  columns,
  onMoreInfo,
  activeDetailTraceId
}: {
  context: OptionsTapeRowContext;
  columns: DurableTapeColumnDefinition<OptionPrint>[];
  onMoreInfo?: (context: OptionsTapeRowContext, trigger: HTMLButtonElement) => void;
  activeDetailTraceId?: string | null;
}): ReactNode =>
  columns.map((column) => {
    if (column.id === "info") {
      const hasSmartFlow = Boolean(context.smartFlow && onMoreInfo);
      return (
        <span
          className={`durable-tape-cell ${column.className ?? ""}`.trim()}
          data-align="center"
          key={column.id}
          role="cell"
        >
          {hasSmartFlow ? (
            <button
              aria-label={`Open smart-flow more info for ${formatOptionsTapeContractLabel(
                context.print.option_contract_id
              )}`}
              className="options-tape-more-info"
              data-active={activeDetailTraceId === context.print.trace_id}
              onClick={(event) => {
                event.stopPropagation();
                onMoreInfo?.(context, event.currentTarget);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
              title="Smart-flow more info"
              type="button"
            >
              i
            </button>
          ) : null}
        </span>
      );
    }
    const rawContent =
      column.id === "nbbo"
        ? formatOptionsTapeNbbo(context.print, context.nbbo)
        : column.render
          ? column.render(context.print)
          : "--";
    const content = column.id === "side" ? renderSideCell(rawContent) : rawContent;
    return (
      <span
        className={`durable-tape-cell ${column.className ?? ""}`.trim()}
        data-align={column.align ?? "start"}
        key={column.id}
        role="cell"
      >
        {content}
      </span>
    );
  });
