"use client";

import type {
  DurableTapeAlertRowViewModel,
  DurableTapeOptionRowViewModel,
  DurableTapeRowViewModel,
  OptionPrint
} from "@islandflow/types";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { FlowPacketFocusRequest } from "../flow-packets";
import {
  getOptionsTapeRowTintClassName,
  getOptionsTapeRowTintFromContext,
  getOptionsTapeRowTintStyle,
  getOptionsTapeSmartFlowEvidenceRefs,
  getOptionsTapeSmartFlowOptionPrintRefs,
  getOptionsTapeSmartFlowPacketRefs,
  getOptionsTapeSmartFlowSummary,
  type OptionsTapeRowTint
} from "../options-tape/tinting";
import type { OptionsTapeSmartFlowContext } from "../options-tape/types";
import { DurableTape } from "./components/DurableTape";
import { createDurableTapeInitialHistoryCursor } from "./history";
import {
  type DurableTapeColumnDefinition,
  type DurableTapeFeatureInput,
  type DurableTapeSource,
  type DurableTapeTemplate
} from "./types";

type StaticRowListener<T extends DurableTapeRowViewModel> = {
  listener: (items: readonly T[]) => void;
};

const useStaticRowSource = <T extends DurableTapeRowViewModel>(
  rows: readonly T[]
): DurableTapeSource<T, unknown, unknown> => {
  const rowsRef = useRef<readonly T[]>(rows);
  const listenersRef = useRef(new Set<StaticRowListener<T>>());

  useEffect(() => {
    rowsRef.current = rows;
    for (const entry of listenersRef.current) {
      entry.listener(rows);
    }
  }, [rows]);

  return useMemo(
    () => ({
      subscribe: () => ({
        getSnapshot: () => rowsRef.current,
        listen: (listener) => {
          const entry = { listener };
          listenersRef.current.add(entry);
          listener(rowsRef.current);
          return () => {
            listenersRef.current.delete(entry);
          };
        },
        unsubscribe: () => {
          listenersRef.current.clear();
        }
      }),
      getInitialHistoryCursor: () => createDurableTapeInitialHistoryCursor(),
      loadOlder: async () => ({ items: [], nextCursor: null, exhausted: true })
    }),
    []
  );
};

const getRowKey = (row: DurableTapeRowViewModel): string => row.id;
const getRowCursor = (row: DurableTapeRowViewModel) => ({ ts: row.ts, seq: row.seq });

type OptionRowColumnId =
  | "time"
  | "contract"
  | "price"
  | "size"
  | "premium"
  | "side"
  | "nbbo"
  | "support";

const OPTION_ROW_COLUMNS: DurableTapeColumnDefinition<
  DurableTapeOptionRowViewModel,
  OptionRowColumnId
>[] = [
  {
    id: "time",
    label: "TIME",
    minWidth: 72,
    className: "options-tape-cell-time durable-tape-cell-number",
    render: (row) => row.cells.time ?? "--"
  },
  {
    id: "contract",
    label: "CONTRACT",
    minWidth: 150,
    className: "options-tape-cell-contract",
    render: (row) => row.cells.contract ?? row.option.option_contract_id
  },
  {
    id: "price",
    label: "PX",
    minWidth: 64,
    align: "end",
    className: "options-tape-cell-price durable-tape-cell-number",
    render: (row) => row.cells.price ?? "--"
  },
  {
    id: "size",
    label: "SIZE",
    minWidth: 62,
    align: "end",
    className: "options-tape-cell-size durable-tape-cell-number",
    render: (row) => row.cells.size ?? "--"
  },
  {
    id: "premium",
    label: "PREMIUM",
    minWidth: 92,
    align: "end",
    className: "options-tape-cell-premium durable-tape-cell-number",
    render: (row) => row.cells.premium ?? "--"
  },
  {
    id: "side",
    label: "SIDE",
    minWidth: 62,
    className: "options-tape-cell-side",
    render: (row) => row.cells.side ?? "--"
  },
  {
    id: "nbbo",
    label: "NBBO",
    minWidth: 112,
    align: "end",
    className: "options-tape-cell-nbbo durable-tape-cell-number",
    render: (row) => row.cells.nbbo ?? "--"
  },
  {
    id: "support",
    label: "SUPPORT",
    minWidth: 112,
    className: "options-tape-cell-exchange",
    render: (row) => row.cells.support ?? "--"
  }
];

const OPTION_ROW_TEMPLATES: DurableTapeTemplate<OptionRowColumnId>[] = [
  { id: "full", columns: ["time", "contract", "price", "size", "premium", "side", "support"] },
  { id: "twoThirds", columns: ["time", "contract", "premium", "side", "support"] },
  { id: "half", columns: ["time", "contract", "premium", "side"] },
  { id: "oneThird", columns: ["contract", "premium", "side"] },
  { id: "micro", columns: ["contract", "premium"] }
];

const renderOptionSideCell = (content: ReactNode): ReactNode => {
  const side = typeof content === "string" ? content.toLowerCase() : "missing";
  return <span className={`options-tape-side options-tape-side-${side}`}>{content}</span>;
};

const optionPrintFromRow = (row: DurableTapeOptionRowViewModel): OptionPrint => ({
  trace_id: row.option.trace_id,
  source_ts: row.source_ts,
  ingest_ts: row.ingest_ts,
  seq: row.seq,
  ts: row.ts,
  option_contract_id: row.option.option_contract_id,
  underlying_id: row.option.underlying_id,
  option_type: row.option.option_type,
  price: row.option.price,
  size: row.option.size,
  exchange: row.option.exchange,
  conditions: row.option.conditions,
  notional: row.option.premium ?? undefined,
  nbbo_side: row.option.side ?? undefined,
  execution_nbbo_bid: row.option.nbbo?.bid,
  execution_nbbo_ask: row.option.nbbo?.ask,
  execution_nbbo_mid: row.option.nbbo?.mid ?? undefined,
  execution_nbbo_spread: row.option.nbbo?.spread ?? undefined,
  execution_nbbo_age_ms: row.option.nbbo?.age_ms ?? undefined,
  execution_nbbo_side: row.option.side ?? undefined,
  execution_underlying_spot: row.option.execution?.underlying_spot ?? undefined,
  execution_iv: row.option.execution?.iv ?? undefined,
  signal_pass: row.option.signal?.pass,
  signal_reasons: row.option.signal?.reasons,
  signal_profile: row.option.signal?.profile as OptionPrint["signal_profile"]
});

const getDurableOptionRowSmartFlowContext = (
  row: DurableTapeOptionRowViewModel
): OptionsTapeSmartFlowContext | undefined => {
  const projection = row.support.smart_flow;
  if (!projection) {
    return undefined;
  }
  const evidenceRefs = getOptionsTapeSmartFlowEvidenceRefs(projection);
  const directPrintRefs = getOptionsTapeSmartFlowOptionPrintRefs(projection);
  const packetRefs = getOptionsTapeSmartFlowPacketRefs(projection);
  const hasDirectPrintRef = directPrintRefs.includes(row.option.trace_id);
  const hasAttachedPacketRef = Boolean(
    row.support.packet && packetRefs.includes(row.support.packet.id)
  );
  const expandedPacketRefs =
    row.support.packet && hasAttachedPacketRef ? row.support.packet.member_trace_ids : [];
  if (!hasDirectPrintRef && !hasAttachedPacketRef) {
    return undefined;
  }

  return {
    projection,
    source: hasDirectPrintRef ? "direct-print" : "packet-member",
    evidenceRefs,
    directPrintRefs,
    packetRefs,
    expandedPacketRefs
  };
};

export const getDurableOptionRowTint = (
  row: DurableTapeOptionRowViewModel
): OptionsTapeRowTint | undefined =>
  getOptionsTapeRowTintFromContext({
    smartFlow: getDurableOptionRowSmartFlowContext(row)
  });

const renderOptionRow = ({
  row,
  columns
}: {
  row: DurableTapeOptionRowViewModel;
  columns: DurableTapeColumnDefinition<DurableTapeOptionRowViewModel>[];
}): ReactNode =>
  columns.map((column) => {
    const rawContent = column.render ? column.render(row) : "--";
    const content = column.id === "side" ? renderOptionSideCell(rawContent) : rawContent;
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

const renderBadgeList = (row: DurableTapeRowViewModel): ReactNode =>
  row.badges.length > 0 ? (
    <div className="alerts-detail-chip-row">
      {row.badges.map((badge) => (
        <span className={`drawer-chip ${badge.tone ? `tone-${badge.tone}` : ""}`} key={badge.kind}>
          {badge.label}
        </span>
      ))}
    </div>
  ) : null;

const renderOptionHover = (row: DurableTapeOptionRowViewModel) => {
  const smartFlowSummary = row.support.smart_flow
    ? getOptionsTapeSmartFlowSummary(row.support.smart_flow)
    : null;
  return (
    <div className="options-tape-hover-content" aria-label="Server-composed option row detail">
      <dl>
        <div>
          <dt>Contract</dt>
          <dd>{row.option.option_contract_id}</dd>
        </div>
        <div>
          <dt>Trace</dt>
          <dd>{row.option.trace_id}</dd>
        </div>
        <div>
          <dt>NBBO</dt>
          <dd>{row.cells.nbbo ?? "--"}</dd>
        </div>
        <div>
          <dt>Packet</dt>
          <dd>{row.support.packet?.id ?? "--"}</dd>
        </div>
        <div>
          <dt>Smart-flow</dt>
          <dd>{smartFlowSummary?.hypothesis ?? row.cells.support ?? "smart-flow unavailable"}</dd>
        </div>
        {smartFlowSummary ? (
          <>
            <div>
              <dt>Flow hypothesis</dt>
              <dd>{smartFlowSummary.hypothesis}</dd>
            </div>
            <div>
              <dt>Flow confidence</dt>
              <dd>{smartFlowSummary.confidence}</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>Evidence</dt>
          <dd>{row.evidence_summary?.label ?? "--"}</dd>
        </div>
      </dl>
      {renderBadgeList(row)}
    </div>
  );
};

export const DurableTapeOptionRowsPane = ({
  rows,
  title = "Options Tape",
  className,
  features,
  rowHeight = 34,
  onContractFocus,
  onPacketFocus
}: {
  rows: readonly DurableTapeOptionRowViewModel[];
  title?: string;
  className?: string;
  features?: readonly DurableTapeFeatureInput[];
  rowHeight?: number;
  onContractFocus?: (print: OptionPrint) => void;
  onPacketFocus?: (request: FlowPacketFocusRequest) => void;
}) => {
  const source = useStaticRowSource(rows);

  return (
    <section className={`options-tape-module ${className ?? ""}`.trim()} data-row-source="server">
      <DurableTape
        ariaLabel={title}
        className="options-tape options-tape-mode-global"
        columns={OPTION_ROW_COLUMNS}
        features={features}
        getCursor={getRowCursor}
        getRowClassName={({ item }) =>
          getOptionsTapeRowTintClassName(getDurableOptionRowTint(item))
        }
        getRowKey={getRowKey}
        getRowStyle={({ item }) => getOptionsTapeRowTintStyle(getDurableOptionRowTint(item))}
        onActivate={({ item }) => {
          const print = optionPrintFromRow(item);
          onContractFocus?.(print);
          const packet = item.support.packet;
          if (packet) {
            onPacketFocus?.({
              packetId: packet.id,
              memberTraceIds: packet.member_trace_ids,
              optionContractId: packet.option_contract_id ?? item.option.option_contract_id,
              source: "options-tape"
            });
          }
        }}
        renderHover={({ item }) => renderOptionHover(item)}
        renderRow={({ item, columns }) => renderOptionRow({ row: item, columns })}
        rowHeight={rowHeight}
        source={source}
        templates={OPTION_ROW_TEMPLATES}
        title={title}
      />
    </section>
  );
};

type AlertRowColumnId = "time" | "symbol" | "kind" | "confidence" | "state" | "evidence";

const ALERT_ROW_COLUMNS: DurableTapeColumnDefinition<
  DurableTapeAlertRowViewModel,
  AlertRowColumnId
>[] = [
  {
    id: "time",
    label: "TIME",
    minWidth: 76,
    className: "alerts-cell-time durable-tape-cell-number",
    render: (row) => row.cells.time ?? "--"
  },
  {
    id: "symbol",
    label: "SYMBOL",
    minWidth: 76,
    className: "alerts-cell-symbol",
    render: (row) => row.cells.symbol ?? "ALERT"
  },
  {
    id: "kind",
    label: "KIND",
    minWidth: 136,
    className: "alerts-cell-kind",
    render: (row) => row.cells.kind ?? row.alert.primary_label
  },
  {
    id: "confidence",
    label: "CONF",
    minWidth: 66,
    align: "end",
    className: "alerts-cell-confidence durable-tape-cell-number",
    render: (row) => row.cells.confidence ?? `${Math.round(row.alert.policy_confidence * 100)}%`
  },
  {
    id: "state",
    label: "STATE",
    minWidth: 86,
    className: "alerts-cell-state",
    render: (row) => row.cells.state ?? `${row.alert.confidence_band} / ${row.alert.direction}`
  },
  {
    id: "evidence",
    label: "EVID",
    minWidth: 86,
    className: "alerts-cell-state",
    render: (row) => row.cells.evidence ?? row.evidence_summary?.label ?? "--"
  }
];

const ALERT_ROW_TEMPLATES: DurableTapeTemplate<AlertRowColumnId>[] = [
  { id: "full", columns: ["time", "symbol", "kind", "confidence", "state", "evidence"] },
  { id: "twoThirds", columns: ["time", "symbol", "kind", "confidence", "state"] },
  { id: "half", columns: ["time", "symbol", "confidence", "state"] },
  { id: "oneThird", columns: ["time", "symbol", "state"] },
  { id: "micro", columns: ["symbol", "state"] }
];

const renderAlertStateCell = (row: DurableTapeAlertRowViewModel): ReactNode => (
  <span
    className={`alerts-state alerts-state-${row.alert.confidence_band} direction-${row.alert.direction}`}
  >
    {row.alert.confidence_band} / {row.alert.direction}
  </span>
);

const renderAlertRow = ({
  row,
  columns
}: {
  row: DurableTapeAlertRowViewModel;
  columns: DurableTapeColumnDefinition<DurableTapeAlertRowViewModel>[];
}): ReactNode =>
  columns.map((column) => {
    const content =
      column.id === "state" ? renderAlertStateCell(row) : column.render ? column.render(row) : "--";
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

const renderAlertDetail = (row: DurableTapeAlertRowViewModel) => (
  <div className="alerts-detail" aria-label="Server-composed alert detail">
    <div className="alerts-detail-head">
      <div>
        <span>Alert detail</span>
        <h3>{row.alert.primary_label}</h3>
        <p>{row.cells.time}</p>
      </div>
      <div className="alerts-detail-score">
        <span>Confidence</span>
        <strong>{Math.round(row.alert.policy_confidence * 100)}%</strong>
      </div>
    </div>
    {renderBadgeList(row)}
    <section className="alerts-detail-section">
      <h4>Evidence summary</h4>
      <div className="alerts-detail-row">
        <div>
          <strong>{row.evidence_summary?.label ?? "No evidence refs"}</strong>
          <span>{row.evidence.total_refs} refs</span>
        </div>
        <p>
          Flow {row.evidence.flow_packet_refs.length}, prints{" "}
          {row.evidence.option_print_refs.length}, unresolved {row.evidence.unresolved_refs.length}
        </p>
      </div>
    </section>
    <section className="alerts-detail-section">
      <h4>Flow packet</h4>
      {row.evidence.primary_packet ? (
        <div className="alerts-detail-row">
          <div>
            <strong>
              {row.evidence.primary_packet.option_contract_id ?? row.evidence.primary_packet.id}
            </strong>
            <span>{row.evidence.primary_packet.member_count} prints</span>
          </div>
          <p>{row.evidence.primary_packet.id}</p>
        </div>
      ) : (
        <p className="drawer-empty">Persisted flow packet is not available for this alert.</p>
      )}
    </section>
    <section className="alerts-detail-section">
      <h4>Evidence prints</h4>
      {row.evidence.preview_prints.length > 0 ? (
        <div className="alerts-detail-list">
          {row.evidence.preview_prints.map((print) => (
            <div className="alerts-detail-row" key={print.trace_id}>
              <div>
                <strong>{print.option_contract_id}</strong>
                <span>{row.cells.time}</span>
              </div>
              <p>
                ${print.price.toFixed(2)} / {print.size}x /{" "}
                {print.premium ? `$${Math.round(print.premium).toLocaleString()}` : "--"} /{" "}
                {print.exchange}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="drawer-empty">Persisted evidence prints are not available for this alert.</p>
      )}
      {row.evidence.unresolved_refs.length > 0 ? (
        <p className="drawer-empty">
          Missing refs: {row.evidence.unresolved_refs.slice(0, 4).join(", ")}
        </p>
      ) : null}
    </section>
  </div>
);

export const DurableTapeAlertRowsPane = ({
  rows,
  title = "Alerts",
  className,
  features,
  rowHeight = 36
}: {
  rows: readonly DurableTapeAlertRowViewModel[];
  title?: string;
  className?: string;
  features?: readonly DurableTapeFeatureInput[];
  rowHeight?: number;
}) => {
  const source = useStaticRowSource(rows);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const selectedRow = rows.find((row) => row.id === selectedRowId) ?? null;

  useEffect(() => {
    if (selectedRowId && !rows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(null);
    }
  }, [rows, selectedRowId]);

  return (
    <section className={`alerts-module ${className ?? ""}`.trim()} data-row-source="server">
      <DurableTape
        ariaLabel={title}
        className="alerts-tape"
        columns={ALERT_ROW_COLUMNS}
        features={features}
        getCursor={getRowCursor}
        getRowKey={getRowKey}
        onActivate={({ item }) => setSelectedRowId(item.id)}
        renderHover={({ item }) => renderAlertDetail(item)}
        renderRow={({ item, columns }) => renderAlertRow({ row: item, columns })}
        rowHeight={rowHeight}
        source={source}
        templates={ALERT_ROW_TEMPLATES}
        title={title}
      />
      {selectedRow ? (
        <div className="alerts-module-detail">
          <button
            className="alerts-module-detail-close"
            type="button"
            onClick={() => setSelectedRowId(null)}
          >
            Close detail
          </button>
          {renderAlertDetail(selectedRow)}
        </div>
      ) : null}
    </section>
  );
};
