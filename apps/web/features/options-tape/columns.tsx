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
    { id: "full", columns: ["time", "contract", "price", "size", "premium", "side", "iv"] },
    { id: "twoThirds", columns: ["time", "contract", "price", "size", "premium", "side"] },
    { id: "half", columns: ["time", "contract", "premium", "side"] },
    { id: "oneThird", columns: ["contract", "premium", "side"] },
    { id: "micro", columns: ["contract", "premium"] }
  ],
  packet: [
    { id: "full", columns: ["dte", "time", "price", "size", "premium", "side", "spot"] },
    { id: "twoThirds", columns: ["time", "price", "size", "premium", "side", "spot"] },
    { id: "half", columns: ["time", "price", "premium", "side"] },
    { id: "oneThird", columns: ["time", "premium", "side"] },
    { id: "micro", columns: ["premium", "side"] }
  ],
  contract: [
    { id: "full", columns: ["time", "price", "size", "premium", "nbbo", "side", "exchange", "iv"] },
    { id: "twoThirds", columns: ["time", "price", "size", "premium", "nbbo", "side"] },
    { id: "half", columns: ["time", "price", "premium", "side"] },
    { id: "oneThird", columns: ["price", "premium", "side"] },
    { id: "micro", columns: ["price", "premium"] }
  ]
};

const renderSideCell = (content: ReactNode): ReactNode => {
  const side = typeof content === "string" ? content.toLowerCase() : "missing";
  return <span className={`options-tape-side options-tape-side-${side}`}>{content}</span>;
};

export const renderOptionsTapeRow = ({
  context,
  columns
}: {
  context: OptionsTapeRowContext;
  columns: DurableTapeColumnDefinition<OptionPrint>[];
}): ReactNode =>
  columns.map((column) => {
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
