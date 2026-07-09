"use client";

import type {
  DurableTapeOptionRowViewModel,
  OptionsSmartFlowTriageDetail
} from "@islandflow/types";
import { useEffect, useRef } from "react";

import { formatEasternTime } from "../time-format";
import { formatOptionsTapeContractLabel } from "./format";
import { getOptionsTapeSmartFlowSummary } from "./tinting";
import type { OptionsTapeRowContext, OptionsTapeSmartFlowContext } from "./types";

type DetailStatus = "loading" | "ready" | "error";

export type OptionsTapeSmartFlowDetailSurfaceProps = {
  status: DetailStatus;
  context: OptionsTapeRowContext;
  detail?: OptionsSmartFlowTriageDetail;
  error?: string;
  pageError?: string;
  packetPageLoading?: boolean;
  contractPageLoading?: boolean;
  onClose: () => void;
  onRetry: () => void;
  onOpenPacketScope: () => void;
  onOpenContractScope: () => void;
  onLoadMorePacketRows: () => void;
  onLoadMoreContractRows: () => void;
};

const humanizeToken = (value: string | null | undefined): string =>
  value
    ? value
        .split(/[_:-]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ")
    : "--";

const formatPercent = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";

const formatRowTime = (row: DurableTapeOptionRowViewModel): string =>
  Number.isFinite(row.ts)
    ? formatEasternTime(row.ts, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : String(row.cells.time ?? "--");

const metricRows = (detail: OptionsSmartFlowTriageDetail | undefined) => {
  const confidence = detail?.projection?.hypothesis.scores.confidence;
  const scores = detail?.projection?.hypothesis.scores;
  return [
    ["Confidence", formatPercent(confidence?.policy_confidence)],
    ["Conviction", formatPercent(confidence?.conviction)],
    ["Evidence quality", formatPercent(confidence?.evidence_quality)],
    ["Margin", formatPercent(confidence?.hypothesis_margin)],
    ["Fit", formatPercent(scores?.fit_score)],
    ["Penalty", formatPercent(scores?.penalty_score)]
  ];
};

const supportSummary = (context: OptionsTapeSmartFlowContext) =>
  getOptionsTapeSmartFlowSummary(context.projection);

const renderRowTable = ({
  rows,
  emptyLabel
}: {
  rows: readonly DurableTapeOptionRowViewModel[];
  emptyLabel: string;
}) => {
  if (rows.length === 0) {
    return <p className="options-tape-triage-empty">{emptyLabel}</p>;
  }

  return (
    <div className="options-tape-triage-rows" role="table">
      <div className="options-tape-triage-row options-tape-triage-row-head" role="row">
        <span role="columnheader">Time</span>
        <span role="columnheader">Contract</span>
        <span role="columnheader">Premium</span>
        <span role="columnheader">Side</span>
        <span role="columnheader">Support</span>
      </div>
      {rows.map((row) => (
        <div className="options-tape-triage-row" key={row.id} role="row">
          <span role="cell">{formatRowTime(row)}</span>
          <span role="cell">{formatOptionsTapeContractLabel(row.option.option_contract_id)}</span>
          <span role="cell">{row.cells.premium ?? "--"}</span>
          <span role="cell">{row.cells.side ?? "--"}</span>
          <span role="cell">{row.cells.support ?? row.support.smart_flow_status}</span>
        </div>
      ))}
    </div>
  );
};

export const OptionsTapeSmartFlowDetailSurface = ({
  status,
  context,
  detail,
  error,
  pageError,
  packetPageLoading = false,
  contractPageLoading = false,
  onClose,
  onRetry,
  onOpenPacketScope,
  onOpenContractScope,
  onLoadMorePacketRows,
  onLoadMoreContractRows
}: OptionsTapeSmartFlowDetailSurfaceProps) => {
  const rootRef = useRef<HTMLElement | null>(null);
  const smartFlow = context.smartFlow;
  const summary = smartFlow ? supportSummary(smartFlow) : null;
  const projection = detail?.projection;
  const packet = detail?.packet ?? context.packet?.packet ?? null;
  const alternatives = projection?.alternatives ?? [];
  const penalties = projection?.evidence.penalties ?? [];
  const sourceReasons = projection?.abstention.source_reasons.length
    ? projection.abstention.source_reasons
    : (projection?.abstention.reasons.map(humanizeToken) ?? []);

  useEffect(() => {
    rootRef.current?.focus();
  }, [detail?.projection_trace_id, status]);

  return (
    <aside
      aria-busy={status === "loading"}
      aria-label="Smart-flow more info"
      className={`options-tape-triage options-tape-triage-${status}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      ref={rootRef}
      tabIndex={-1}
    >
      <div className="options-tape-triage-head">
        <div>
          <span>More info</span>
          <strong>{summary?.hypothesis ?? "Smart-flow context"}</strong>
          <em>{projection?.trace_id ?? context.smartFlow?.support.projection_trace_id ?? "--"}</em>
        </div>
        <div className="options-tape-triage-actions">
          {packet ? (
            <button type="button" onClick={onOpenPacketScope}>
              Packet scope
            </button>
          ) : null}
          <button type="button" onClick={onOpenContractScope}>
            Contract scope
          </button>
          <button type="button" onClick={onClose}>
            Back to tape
          </button>
        </div>
      </div>

      {status === "loading" ? (
        <div className="options-tape-triage-loading">
          <span />
          <span />
          <span />
        </div>
      ) : null}

      {status === "error" ? (
        <div className="options-tape-triage-unavailable" role="alert">
          <strong>Detail unavailable</strong>
          <p>{error ?? "The smart-flow detail request failed."}</p>
          <button type="button" onClick={onRetry}>
            Retry detail
          </button>
        </div>
      ) : null}

      {status === "ready" && detail ? (
        <>
          <div className="options-tape-triage-grid">
            <section>
              <span>Packet</span>
              <dl>
                <div>
                  <dt>ID</dt>
                  <dd>{packet?.id ?? "--"}</dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>{packet ? packet.members.length.toLocaleString() : "--"}</dd>
                </div>
                <div>
                  <dt>Selected</dt>
                  <dd>{detail.option_trace_id}</dd>
                </div>
              </dl>
            </section>

            <section>
              <span>Hypothesis</span>
              <dl>
                <div>
                  <dt>Type</dt>
                  <dd>{humanizeToken(projection?.hypothesis.hypothesis_type)}</dd>
                </div>
                <div>
                  <dt>Direction</dt>
                  <dd>{projection?.hypothesis.direction ?? summary?.direction ?? "--"}</dd>
                </div>
                <div>
                  <dt>Abstention</dt>
                  <dd>
                    {projection?.abstention.abstained
                      ? sourceReasons.join(", ") || "Abstained"
                      : (summary?.abstention ?? "Not abstained")}
                  </dd>
                </div>
              </dl>
            </section>

            <section>
              <span>Scores</span>
              <dl>
                {metricRows(detail).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <div className="options-tape-triage-grid options-tape-triage-grid-secondary">
            <section>
              <span>Alternatives</span>
              {alternatives.length > 0 ? (
                <ul>
                  {alternatives.slice(0, 4).map((alternative) => (
                    <li key={`${alternative.hypothesis_type}:${alternative.direction}`}>
                      <strong>{humanizeToken(alternative.hypothesis_type)}</strong>
                      <em>
                        {alternative.direction} / {formatPercent(alternative.score)}
                      </em>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No competing alternatives in the detail payload.</p>
              )}
            </section>
            <section>
              <span>Penalties / Why not</span>
              {penalties.length > 0 ? (
                <ul>
                  {penalties.slice(0, 5).map((penalty) => (
                    <li key={penalty.penalty_id}>
                      <strong>{humanizeToken(penalty.kind)}</strong>
                      <em>
                        {formatPercent(penalty.score)} / {penalty.reason}
                      </em>
                    </li>
                  ))}
                </ul>
              ) : sourceReasons.length > 0 ? (
                <ul>
                  {sourceReasons.slice(0, 5).map((reason) => (
                    <li key={reason}>
                      <strong>{humanizeToken(reason)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{detail.detail_unavailable_reason ?? "No why-not context in the payload."}</p>
              )}
            </section>
          </div>

          <section className="options-tape-triage-section">
            <div className="options-tape-triage-section-head">
              <div>
                <span>Packet member prints</span>
                <em>{detail.packet_members.row_count} loaded rows</em>
              </div>
              {detail.packet_members.next_before ? (
                <button type="button" disabled={packetPageLoading} onClick={onLoadMorePacketRows}>
                  {packetPageLoading ? "Loading" : "Older packet rows"}
                </button>
              ) : null}
            </div>
            {renderRowTable({
              rows: detail.packet_members.rows,
              emptyLabel: detail.missing.packet
                ? "No packet context is available for this support."
                : "No packet member rows were returned."
            })}
          </section>

          <section className="options-tape-triage-section">
            <div className="options-tape-triage-section-head">
              <div>
                <span>Exact contract context</span>
                <em>{detail.exact_contract.row_count} loaded rows</em>
              </div>
              {detail.exact_contract.next_before ? (
                <button
                  type="button"
                  disabled={contractPageLoading}
                  onClick={onLoadMoreContractRows}
                >
                  {contractPageLoading ? "Loading" : "Older contract rows"}
                </button>
              ) : null}
            </div>
            {renderRowTable({
              rows: detail.exact_contract.rows,
              emptyLabel: "No exact-contract rows were returned."
            })}
          </section>

          {pageError ? (
            <div className="options-tape-triage-unavailable" role="alert">
              <strong>Older rows unavailable</strong>
              <p>{pageError}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  );
};
