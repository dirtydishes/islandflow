"use client";

import type { EquityPrint } from "@islandflow/types";
import type { ReactNode } from "react";

import type { DurableTapeColumnDefinition, DurableTapeTemplate } from "../durable-tape";
import {
  formatEquityTapeNotional,
  formatEquityTapePrice,
  formatEquityTapeSize,
  formatEquityTapeTime,
  getEquityPrintNotional
} from "./format";
import type { EquitiesTapeColumnId, EquitiesTapeTickerFocusEvent } from "./types";

export const EQUITIES_TAPE_COLUMNS: DurableTapeColumnDefinition<
  EquityPrint,
  EquitiesTapeColumnId
>[] = [
  {
    id: "time",
    label: "TIME",
    minWidth: 88,
    className: "equities-tape-cell-time durable-tape-cell-number",
    render: (print) => formatEquityTapeTime(print.ts)
  },
  {
    id: "ticker",
    label: "TICKER",
    minWidth: 84,
    className: "equities-tape-cell-ticker"
  },
  {
    id: "price",
    label: "PX",
    minWidth: 82,
    align: "end",
    className: "equities-tape-cell-price durable-tape-cell-number",
    render: (print) => formatEquityTapePrice(print.price)
  },
  {
    id: "size",
    label: "SIZE",
    minWidth: 74,
    align: "end",
    className: "equities-tape-cell-size durable-tape-cell-number",
    render: (print) => formatEquityTapeSize(print.size)
  },
  {
    id: "notional",
    label: "NOTIONAL",
    minWidth: 104,
    align: "end",
    className: "equities-tape-cell-notional durable-tape-cell-number",
    render: (print) => formatEquityTapeNotional(getEquityPrintNotional(print))
  },
  {
    id: "venue",
    label: "VENUE",
    minWidth: 92,
    className: "equities-tape-cell-venue"
  }
];

export const EQUITIES_TAPE_TEMPLATES: DurableTapeTemplate<EquitiesTapeColumnId>[] = [
  { id: "full", columns: ["time", "ticker", "price", "size", "notional", "venue"] },
  { id: "twoThirds", columns: ["time", "ticker", "price", "size"] },
  { id: "oneThird", columns: ["ticker", "price", "size"] },
  { id: "micro", columns: ["ticker", "price"] }
];

const renderTickerCell = (
  print: EquityPrint,
  onTickerFocus?: (event: EquitiesTapeTickerFocusEvent) => void,
  eventBase?: Omit<EquitiesTapeTickerFocusEvent, "ticker">
): ReactNode => {
  const ticker = print.underlying_id.toUpperCase();
  const badge = print.offExchangeFlag ? (
    <span className="equities-tape-badge equities-tape-badge-off">OFF</span>
  ) : null;

  if (!onTickerFocus || !eventBase) {
    return (
      <span className="equities-tape-ticker">
        <span>{ticker}</span>
        {badge}
      </span>
    );
  }

  return (
    <span className="equities-tape-ticker">
      <button
        className="equities-tape-ticker-button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onTickerFocus({ ...eventBase, ticker });
        }}
      >
        {ticker}
      </button>
      {badge}
    </span>
  );
};

const renderVenueCell = (print: EquityPrint): ReactNode => {
  const venue = print.exchange || "--";
  if (!print.offExchangeFlag) {
    return venue;
  }
  return (
    <span className="equities-tape-venue">
      <span>{venue}</span>
      <span className="equities-tape-badge equities-tape-badge-off">OFF</span>
    </span>
  );
};

export const renderEquitiesTapeRow = ({
  print,
  rowKey,
  index,
  columns,
  onTickerFocus
}: {
  print: EquityPrint;
  rowKey: string;
  index: number;
  columns: DurableTapeColumnDefinition<EquityPrint>[];
  onTickerFocus?: (event: EquitiesTapeTickerFocusEvent) => void;
}): ReactNode => {
  const eventBase = { print, rowKey, index };

  return columns.map((column) => {
    let content: ReactNode;
    if (column.id === "ticker") {
      content = renderTickerCell(print, onTickerFocus, eventBase);
    } else if (column.id === "venue") {
      content = renderVenueCell(print);
    } else {
      content = column.render ? column.render(print) : "--";
    }

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
};
