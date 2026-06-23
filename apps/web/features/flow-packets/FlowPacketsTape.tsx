"use client";

import type { FlowPacket } from "@islandflow/types";
import { useMemo } from "react";

import { DurableTape, type DurableTapeFocusEvent } from "../durable-tape";
import {
  FLOW_PACKETS_TAPE_COLUMNS,
  FLOW_PACKETS_TAPE_TEMPLATES,
  renderFlowPacketsTapeRow,
  toFlowPacketFocusRequest
} from "./columns";
import {
  formatFlowPacketMoney,
  formatFlowPacketPercent,
  formatFlowPacketPrice,
  formatFlowPacketTimestamp,
  getFlowPacketContractId,
  getFlowPacketCursor,
  getFlowPacketKey,
  getFlowPacketNotional,
  getFlowPacketPrintCount,
  getFlowPacketQualityLabel,
  getFlowPacketQuoteState,
  getFlowPacketSideLabel,
  getFlowPacketStructureLabel,
  getFlowPacketTotalPremium,
  getFlowPacketTotalSize,
  getFlowPacketWindow,
  normalizeFlowPacketsTapeScope,
  parseFlowPacketNumber
} from "./format";
import { createFlowPacketsTapeSource } from "./source";
import type { FlowPacketsTapeInspectEvent, FlowPacketsTapeProps } from "./types";

const DEFAULT_TITLE = "Flow Packets";
const FLOW_PACKETS_TAPE_DEFAULT_FEATURES = [
  "default",
  { key: "settingsGear", enabled: false }
] as const;

const renderDetailRow = (label: string, value: string | number) => (
  <div className="flow-packets-detail-row" key={label}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

const renderFlowPacketsTapeHover = (
  packet: FlowPacket,
  linkedContext?: FlowPacketsTapeProps["renderLinkedContext"],
  onPacketFocus?: FlowPacketsTapeProps["onPacketFocus"]
) => {
  const context = linkedContext?.(packet);
  const { startTs, endTs, windowMs } = getFlowPacketWindow(packet);
  const coverage = parseFlowPacketNumber(packet.features.nbbo_coverage_ratio, Number.NaN);
  const buy = parseFlowPacketNumber(packet.features.nbbo_aggressive_buy_ratio, Number.NaN);
  const sell = parseFlowPacketNumber(packet.features.nbbo_aggressive_sell_ratio, Number.NaN);
  const staleCount = parseFlowPacketNumber(packet.features.nbbo_stale_count, 0);
  const missingCount = parseFlowPacketNumber(packet.features.nbbo_missing_count, 0);
  const quoteState = getFlowPacketQuoteState(packet);
  const rows = [
    renderDetailRow("Packet", packet.id),
    renderDetailRow("Members", getFlowPacketPrintCount(packet)),
    renderDetailRow("Total size", formatFlowPacketMoney(getFlowPacketTotalSize(packet))),
    renderDetailRow("Premium", `$${formatFlowPacketMoney(getFlowPacketTotalPremium(packet))}`),
    renderDetailRow("Notional", `$${formatFlowPacketMoney(getFlowPacketNotional(packet))}`),
    renderDetailRow("Window start", formatFlowPacketTimestamp(startTs)),
    renderDetailRow("Window end", formatFlowPacketTimestamp(endTs)),
    renderDetailRow("Window", windowMs > 0 ? `${Math.round(windowMs)}ms` : "--"),
    renderDetailRow("Structure", getFlowPacketStructureLabel(packet)),
    renderDetailRow("NBBO coverage", formatFlowPacketPercent(coverage)),
    renderDetailRow("Aggressive buy", formatFlowPacketPercent(buy)),
    renderDetailRow("Aggressive sell", formatFlowPacketPercent(sell)),
    renderDetailRow("Quote state", quoteState),
    renderDetailRow("Stale quotes", Math.round(staleCount)),
    renderDetailRow("Missing quotes", Math.round(missingCount)),
    renderDetailRow("Side", getFlowPacketSideLabel(packet)),
    renderDetailRow("Quality", getFlowPacketQualityLabel(packet))
  ];
  const nbboBid = parseFlowPacketNumber(packet.features.nbbo_bid, Number.NaN);
  const nbboAsk = parseFlowPacketNumber(packet.features.nbbo_ask, Number.NaN);
  const nbbo = Number.isFinite(nbboBid) && Number.isFinite(nbboAsk);

  return (
    <div className="flow-packets-detail" aria-label="Flow packet detail">
      <div className="flow-packets-detail-head">
        <strong>{getFlowPacketContractId(packet)}</strong>
        <span>
          {nbbo
            ? `${formatFlowPacketPrice(nbboBid)} x ${formatFlowPacketPrice(nbboAsk)}`
            : "NBBO unavailable"}
        </span>
      </div>
      <dl>{rows}</dl>
      {onPacketFocus ? (
        <button
          className="flow-packets-inspect-button"
          type="button"
          onClick={() => onPacketFocus(toFlowPacketFocusRequest(packet))}
        >
          Inspect member prints
        </button>
      ) : null}
      {context ? <div className="flow-packets-linked-context">{context}</div> : null}
    </div>
  );
};

export const mapFlowPacketsTapeInspectEvent = (
  event: DurableTapeFocusEvent<FlowPacket>
): FlowPacketsTapeInspectEvent => ({
  packet: event.item,
  rowKey: event.rowKey,
  index: event.index
});

export const FlowPacketsTape = ({
  title = DEFAULT_TITLE,
  ariaLabel = "Flow packets",
  className,
  scope,
  filters,
  features = FLOW_PACKETS_TAPE_DEFAULT_FEATURES,
  template = "auto",
  source,
  sourceOptions,
  onInspectPacket,
  onPacketFocus,
  renderLinkedContext,
  rowHeight = 44,
  overscan = 16
}: FlowPacketsTapeProps) => {
  const normalizedScope = useMemo(() => normalizeFlowPacketsTapeScope(scope), [scope]);
  const tapeSource = useMemo(
    () => source ?? createFlowPacketsTapeSource(sourceOptions),
    [source, sourceOptions]
  );

  return (
    <DurableTape
      ariaLabel={ariaLabel}
      className={`flow-packets-tape ${className ?? ""}`.trim()}
      columns={FLOW_PACKETS_TAPE_COLUMNS}
      features={features}
      filters={filters}
      getCursor={getFlowPacketCursor}
      getRowKey={getFlowPacketKey}
      onActivate={(event) => onPacketFocus?.(toFlowPacketFocusRequest(event.item))}
      onFocus={(event) => onInspectPacket?.(mapFlowPacketsTapeInspectEvent(event))}
      renderHover={({ item }) =>
        renderFlowPacketsTapeHover(item, renderLinkedContext, onPacketFocus)
      }
      renderRow={({ item, columns }) =>
        renderFlowPacketsTapeRow({
          packet: item,
          columns,
          onPacketFocus
        })
      }
      rowHeight={rowHeight}
      overscan={overscan}
      scope={normalizedScope}
      source={tapeSource}
      template={template}
      templates={FLOW_PACKETS_TAPE_TEMPLATES}
      title={title}
    />
  );
};
