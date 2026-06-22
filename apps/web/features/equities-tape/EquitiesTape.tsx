"use client";

import type { EquityPrint } from "@islandflow/types";
import { useMemo } from "react";

import { DurableTape, type DurableTapeFocusEvent } from "../durable-tape";
import { EQUITIES_TAPE_COLUMNS, EQUITIES_TAPE_TEMPLATES, renderEquitiesTapeRow } from "./columns";
import { normalizeEquitiesTapeFilters, normalizeEquitiesTapeScope } from "./filters";
import {
  formatEquityTapeNotional,
  formatEquityTapePrice,
  formatEquityTapeSize,
  formatEquityTapeTimestamp,
  getEquityPrintCursor,
  getEquityPrintKey,
  getEquityPrintNotional
} from "./format";
import { createEquitiesTapeSource } from "./source";
import type { EquitiesTapeInspectEvent, EquitiesTapeProps } from "./types";

const DEFAULT_TITLE = "Equities Tape";
const EQUITIES_TAPE_DEFAULT_FEATURES = [
  "default",
  { key: "settingsGear", enabled: false }
] as const;

const renderEvidenceRow = (label: string, value: string | number) => (
  <div className="equities-tape-detail-row" key={label}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

const renderEquitiesTapeHover = (
  print: EquityPrint,
  linkedContext?: EquitiesTapeProps["renderLinkedContext"]
) => {
  const context = linkedContext?.(print);
  const rows = [
    renderEvidenceRow("Timestamp", formatEquityTapeTimestamp(print.ts)),
    renderEvidenceRow("Trace", print.trace_id),
    renderEvidenceRow("Ticker", print.underlying_id.toUpperCase()),
    renderEvidenceRow("Exchange", print.exchange),
    renderEvidenceRow("Off-exchange", print.offExchangeFlag ? "yes" : "no"),
    renderEvidenceRow("Price", formatEquityTapePrice(print.price)),
    renderEvidenceRow("Size", formatEquityTapeSize(print.size)),
    renderEvidenceRow("Notional", formatEquityTapeNotional(getEquityPrintNotional(print))),
    renderEvidenceRow("Seq", print.seq)
  ];

  return (
    <div className="equities-tape-detail" aria-label="Equity print detail">
      <dl>{rows}</dl>
      {context ? <div className="equities-tape-linked-context">{context}</div> : null}
    </div>
  );
};

export const mapEquitiesTapeInspectEvent = (
  event: DurableTapeFocusEvent<EquityPrint>
): EquitiesTapeInspectEvent => ({
  print: event.item,
  rowKey: event.rowKey,
  index: event.index
});

export const EquitiesTape = ({
  title = DEFAULT_TITLE,
  ariaLabel = "Equities tape",
  className,
  scope,
  filters,
  features = EQUITIES_TAPE_DEFAULT_FEATURES,
  template = "auto",
  source,
  sourceOptions,
  onTickerFocus,
  onInspectPrint,
  renderLinkedContext,
  rowHeight = 36,
  overscan = 10
}: EquitiesTapeProps) => {
  const normalizedScope = useMemo(() => normalizeEquitiesTapeScope(scope), [scope]);
  const normalizedFilters = useMemo(() => normalizeEquitiesTapeFilters(filters), [filters]);
  const tapeSource = useMemo(
    () => source ?? createEquitiesTapeSource(sourceOptions),
    [source, sourceOptions]
  );

  return (
    <DurableTape
      ariaLabel={ariaLabel}
      className={`equities-tape ${className ?? ""}`.trim()}
      columns={EQUITIES_TAPE_COLUMNS}
      features={features}
      filters={normalizedFilters}
      getCursor={getEquityPrintCursor}
      getRowKey={getEquityPrintKey}
      onFocus={(event) => onInspectPrint?.(mapEquitiesTapeInspectEvent(event))}
      renderHover={({ item }) => renderEquitiesTapeHover(item, renderLinkedContext)}
      renderRow={({ item, rowKey, index, columns }) =>
        renderEquitiesTapeRow({
          print: item,
          rowKey,
          index,
          columns,
          onTickerFocus
        })
      }
      rowHeight={rowHeight}
      overscan={overscan}
      scope={normalizedScope}
      source={tapeSource}
      template={template}
      templates={EQUITIES_TAPE_TEMPLATES}
      title={title}
    />
  );
};
