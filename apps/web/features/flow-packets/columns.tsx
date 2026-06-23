"use client";

import type { FlowPacket } from "@islandflow/types";
import type { ReactNode } from "react";

import type { DurableTapeColumnDefinition, DurableTapeTemplate } from "../durable-tape";
import {
  formatFlowPacketMoney,
  formatFlowPacketTime,
  formatFlowPacketWindow,
  getFlowPacketContractId,
  getFlowPacketNotional,
  getFlowPacketPrintCount,
  getFlowPacketQualityLabel,
  getFlowPacketQuoteState,
  getFlowPacketSideLabel,
  getFlowPacketWindow
} from "./format";
import type { FlowPacketColumnId, FlowPacketFocusRequest, OnPacketFocus } from "./types";

export const FLOW_PACKETS_TAPE_COLUMNS: DurableTapeColumnDefinition<
  FlowPacket,
  FlowPacketColumnId
>[] = [
  {
    id: "time",
    label: "TIME",
    minWidth: 92,
    className: "flow-packets-cell-time durable-tape-cell-number",
    render: (packet) => {
      const { startTs, endTs } = getFlowPacketWindow(packet);
      return `${formatFlowPacketTime(startTs)} ${formatFlowPacketTime(endTs)}`;
    }
  },
  {
    id: "contract",
    label: "CONTRACT",
    minWidth: 150,
    className: "flow-packets-cell-contract"
  },
  {
    id: "prints",
    label: "PRINTS",
    minWidth: 66,
    align: "end",
    className: "flow-packets-cell-prints durable-tape-cell-number",
    render: (packet) => getFlowPacketPrintCount(packet).toLocaleString()
  },
  {
    id: "premium",
    label: "PREMIUM",
    minWidth: 88,
    align: "end",
    className: "flow-packets-cell-premium durable-tape-cell-number",
    render: (packet) => `$${formatFlowPacketMoney(getFlowPacketNotional(packet))}`
  },
  {
    id: "window",
    label: "WINDOW",
    minWidth: 74,
    align: "end",
    className: "flow-packets-cell-window durable-tape-cell-number",
    render: formatFlowPacketWindow
  },
  {
    id: "side",
    label: "SIDE",
    minWidth: 82,
    className: "flow-packets-cell-side",
    render: getFlowPacketSideLabel
  },
  {
    id: "quality",
    label: "QUALITY",
    minWidth: 150,
    className: "flow-packets-cell-quality",
    render: getFlowPacketQualityLabel
  }
];

export const FLOW_PACKETS_TAPE_TEMPLATES: DurableTapeTemplate<FlowPacketColumnId>[] = [
  { id: "full", columns: ["time", "contract", "prints", "premium", "window", "side", "quality"] },
  { id: "twoThirds", columns: ["time", "contract", "prints", "premium", "side"] },
  { id: "oneThird", columns: ["contract", "prints", "premium"] },
  { id: "micro", columns: ["contract", "premium"] }
];

export const toFlowPacketFocusRequest = (
  packet: FlowPacket,
  source: FlowPacketFocusRequest["source"] = "flow-packets"
): FlowPacketFocusRequest => {
  const optionContractId =
    typeof packet.features.option_contract_id === "string" &&
    packet.features.option_contract_id.trim().length > 0
      ? packet.features.option_contract_id.trim()
      : undefined;
  return {
    packetId: packet.id,
    memberTraceIds: packet.members,
    ...(optionContractId ? { optionContractId } : {}),
    source
  };
};

const renderContractCell = (packet: FlowPacket, onPacketFocus?: OnPacketFocus): ReactNode => {
  const contract = getFlowPacketContractId(packet);
  const quoteState = getFlowPacketQuoteState(packet);
  const badge =
    quoteState === "clean" ? null : (
      <span className={`flow-packets-badge flow-packets-badge-${quoteState}`}>
        {quoteState === "missing" ? "Quote missing" : "Quote stale"}
      </span>
    );

  if (!onPacketFocus) {
    return (
      <span className="flow-packets-contract">
        <span>{contract}</span>
        {badge}
      </span>
    );
  }

  return (
    <span className="flow-packets-contract">
      <button
        className="flow-packets-contract-button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onPacketFocus(toFlowPacketFocusRequest(packet));
        }}
      >
        {contract}
      </button>
      {badge}
    </span>
  );
};

export const renderFlowPacketsTapeRow = ({
  packet,
  columns,
  onPacketFocus
}: {
  packet: FlowPacket;
  columns: DurableTapeColumnDefinition<FlowPacket>[];
  onPacketFocus?: OnPacketFocus;
}): ReactNode =>
  columns.map((column) => {
    let content: ReactNode;
    if (column.id === "contract") {
      content = renderContractCell(packet, onPacketFocus);
    } else {
      content = column.render ? column.render(packet) : "--";
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
