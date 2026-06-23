"use client";

import type { AlertEvent, FlowPacket, OptionPrint } from "@islandflow/types";
import { useMemo } from "react";

import { DurableTape } from "../durable-tape";
import { toFlowPacketFocusRequest } from "../flow-packets";
import { ALERTS_COLUMNS, ALERTS_TEMPLATES, renderAlertsRow } from "./columns";
import { getAlertFlowPacketRefs, useAlertEvidenceHydration } from "./evidence";
import {
  deriveAlertDirection,
  formatAlertConfidence,
  formatAlertDateTime,
  formatAlertMoney,
  formatAlertPrice,
  formatAlertScore,
  formatAlertSize,
  formatAlertTime,
  getAlertCursor,
  getAlertKey,
  getAlertName,
  getFlowPacketContractId,
  humanizeAlertClassifierId,
  inferAlertUnderlying,
  normalizeAlertDirection,
  normalizeAlertSeverity
} from "./format";
import { normalizeAlertsFilters, normalizeAlertsScope, useAlertsArraySource } from "./source";
import type {
  AlertActionCallbacks,
  AlertEvidenceHydration,
  AlertEvidenceItem,
  AlertsModuleProps,
  AlertsModuleSourceOptions
} from "./types";

const DEFAULT_TITLE = "Alerts";
const ALERTS_DEFAULT_FEATURES = ["default", { key: "settingsGear", enabled: false }] as const;

const renderDetailMetric = (label: string, value: string | number) => (
  <div className="alerts-detail-metric" key={label}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const getPrintNotional = (print: OptionPrint): number =>
  print.notional ?? print.price * print.size * 100;

const getActionPrint = (evidence: AlertEvidenceItem[]): OptionPrint | null => {
  for (const item of evidence) {
    if (item.kind === "print") {
      return item.print;
    }
  }
  return null;
};

const renderAlertHover = (alert: AlertEvent) => {
  const severity = normalizeAlertSeverity(alert);
  const direction = deriveAlertDirection(alert);
  const primary = alert.hits[0];
  return (
    <div className="alerts-hover" aria-label="Alert preview">
      <div className="alerts-hover-head">
        <strong>{getAlertName(alert)}</strong>
        <span>
          {severity} / {direction}
        </span>
      </div>
      <dl>
        {renderDetailMetric("Score", formatAlertScore(alert.score))}
        {renderDetailMetric("Source", formatAlertTime(alert.source_ts))}
        {renderDetailMetric("Evidence", alert.evidence_refs.length)}
      </dl>
      {primary?.explanations?.[0] ? <p>{primary.explanations[0]}</p> : null}
    </div>
  );
};

export const AlertDetail = ({
  alert,
  hydration,
  callbacks
}: {
  alert: AlertEvent;
  hydration: AlertEvidenceHydration;
  callbacks?: AlertActionCallbacks;
}) => {
  const primary = alert.hits[0];
  const severity = normalizeAlertSeverity(alert);
  const direction = deriveAlertDirection(alert);
  const evidencePrints = hydration.evidence.filter(
    (item): item is Extract<AlertEvidenceItem, { kind: "print" }> => item.kind === "print"
  );
  const hiddenEvidencePrintCount = Math.max(0, evidencePrints.length - 6);
  const unresolved = hydration.evidence.filter((item) => item.kind === "unknown");
  const actionPrint = getActionPrint(hydration.evidence);
  const packet = hydration.flowPacket;
  const underlying = inferAlertUnderlying(
    alert,
    packet,
    evidencePrints.map((item) => item.print)
  );

  return (
    <div className="alerts-detail" aria-label="Alert detail">
      <div className="alerts-detail-head">
        <div>
          <span>Alert detail</span>
          <h3>{getAlertName(alert)}</h3>
          <p>{formatAlertDateTime(alert.source_ts)}</p>
        </div>
        <div className="alerts-detail-score">
          <span>Score</span>
          <strong>{formatAlertScore(alert.score)}</strong>
        </div>
      </div>

      <div className="alerts-detail-chip-row">
        <span className={`pill severity-${severity}`}>{severity}</span>
        <span className={`pill direction-${direction}`}>{direction}</span>
        <span className="drawer-chip">{alert.evidence_refs.length} refs</span>
        {hydration.status.traceId === alert.trace_id && hydration.status.loading ? (
          <span className="drawer-chip">Loading evidence</span>
        ) : null}
      </div>

      <div className="alerts-detail-actions">
        <button
          type="button"
          disabled={!packet || !callbacks?.onPacketFocus}
          onClick={() => {
            if (packet) {
              callbacks?.onPacketFocus?.(toFlowPacketFocusRequest(packet, "alerts"));
            }
          }}
        >
          Focus packet
        </button>
        <button
          type="button"
          disabled={!actionPrint || !callbacks?.onContractFocus}
          onClick={() => {
            if (actionPrint) {
              callbacks?.onContractFocus?.({ print: actionPrint, source: "alerts" });
            }
          }}
        >
          Focus contract
        </button>
        <button
          type="button"
          disabled={!underlying || !callbacks?.onEquityFocus}
          onClick={() => {
            if (underlying) {
              callbacks?.onEquityFocus?.({ underlyingId: underlying, source: "alerts" });
            }
          }}
        >
          Focus equity
        </button>
      </div>

      {hydration.status.traceId === alert.trace_id && hydration.status.error ? (
        <p className="drawer-empty">
          Persisted context could not be loaded: {hydration.status.error}
        </p>
      ) : null}

      <section className="alerts-detail-section">
        <h4>Classifier hits</h4>
        {alert.hits.length === 0 ? (
          <p className="drawer-empty">No classifier hits captured.</p>
        ) : (
          <div className="alerts-detail-list">
            {alert.hits.map((hit, index) => (
              <div
                className="alerts-detail-row"
                key={`${alert.trace_id}-${hit.classifier_id}-${index}`}
              >
                <div>
                  <strong>{humanizeAlertClassifierId(hit.classifier_id)}</strong>
                  <span>{normalizeAlertDirection(hit.direction)}</span>
                </div>
                <p>
                  Confidence {formatAlertConfidence(hit.confidence)}
                  {hit.explanations?.[0] ? `, ${hit.explanations[0]}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="alerts-detail-section">
        <h4>Flow packet</h4>
        {packet ? (
          <div className="alerts-detail-row">
            <div>
              <strong>{getFlowPacketContractId(packet) ?? packet.id}</strong>
              <span>{packet.members.length} prints</span>
            </div>
            <p>
              Packet {packet.id}, refs {getAlertFlowPacketRefs(alert).length}
            </p>
          </div>
        ) : (
          <p className="drawer-empty">Persisted flow packet is not available for this alert.</p>
        )}
      </section>

      <section className="alerts-detail-section">
        <h4>Evidence prints</h4>
        {evidencePrints.length === 0 ? (
          <p className="drawer-empty">
            Persisted evidence prints are not available for this alert.
          </p>
        ) : (
          <div className="alerts-detail-list">
            {evidencePrints.slice(0, 6).map(({ id, print }) => (
              <div className="alerts-detail-row" key={id}>
                <div>
                  <strong>{print.option_contract_id}</strong>
                  <span>{formatAlertTime(print.ts)}</span>
                </div>
                <p>
                  ${formatAlertPrice(print.price)} / {formatAlertSize(print.size)}x / $
                  {formatAlertMoney(getPrintNotional(print))} / {print.exchange}
                </p>
              </div>
            ))}
          </div>
        )}
        {hiddenEvidencePrintCount > 0 ? (
          <p className="drawer-empty">+{hiddenEvidencePrintCount} more evidence prints.</p>
        ) : null}
        {unresolved.length > 0 ? (
          <p className="drawer-empty">
            Unresolved refs:{" "}
            {unresolved
              .slice(0, 4)
              .map((item) => item.id)
              .join(", ")}
          </p>
        ) : null}
        {hydration.status.traceId === alert.trace_id && hydration.status.missingRefs.length > 0 ? (
          <p className="drawer-empty">
            Missing refs: {hydration.status.missingRefs.slice(0, 4).join(", ")}
          </p>
        ) : null}
      </section>
    </div>
  );
};

export const AlertDetailDrawer = ({
  alert,
  flowPacketById,
  optionPrintByTraceId,
  sourceOptions,
  onClose,
  ...callbacks
}: AlertActionCallbacks & {
  alert: AlertEvent;
  flowPacketById?: ReadonlyMap<string, FlowPacket>;
  optionPrintByTraceId?: ReadonlyMap<string, OptionPrint>;
  sourceOptions?: AlertsModuleSourceOptions;
  onClose: () => void;
}) => {
  const hydration = useAlertEvidenceHydration({
    alert,
    flowPacketById,
    optionPrintByTraceId,
    sourceOptions
  });

  return (
    <aside className="drawer alerts-detail-drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Alert details</p>
          <h3>{getAlertName(alert)}</h3>
          <p className="drawer-subtitle">{formatAlertDateTime(alert.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <AlertDetail alert={alert} hydration={hydration} callbacks={callbacks} />
    </aside>
  );
};

export const AlertsModule = ({
  title = DEFAULT_TITLE,
  ariaLabel = "Alerts",
  className,
  alerts = [],
  source,
  sourceOptions,
  scope,
  filters,
  features = ALERTS_DEFAULT_FEATURES,
  template = "auto",
  flowPacketById,
  optionPrintByTraceId,
  selectedAlert,
  onSelectAlert,
  onCloseDetail,
  showDetail = true,
  rowHeight = 38,
  overscan = 10,
  ...callbacks
}: AlertsModuleProps) => {
  const normalizedScope = useMemo(() => normalizeAlertsScope(scope), [scope]);
  const normalizedFilters = useMemo(() => normalizeAlertsFilters(filters), [filters]);
  const arraySource = useAlertsArraySource({ alerts, options: sourceOptions });
  const tapeSource = source ?? arraySource;
  const hydration = useAlertEvidenceHydration({
    alert: selectedAlert,
    flowPacketById,
    optionPrintByTraceId,
    sourceOptions
  });

  return (
    <section className={`alerts-module ${className ?? ""}`.trim()}>
      <DurableTape
        ariaLabel={ariaLabel}
        className="alerts-tape"
        columns={ALERTS_COLUMNS}
        features={features}
        filters={normalizedFilters}
        getCursor={getAlertCursor}
        getRowKey={getAlertKey}
        onActivate={(event) => onSelectAlert?.(event.item)}
        renderHover={({ item }) => renderAlertHover(item)}
        renderRow={({ item, columns }) => renderAlertsRow({ alert: item, columns })}
        rowHeight={rowHeight}
        overscan={overscan}
        scope={normalizedScope}
        source={tapeSource}
        template={template}
        templates={ALERTS_TEMPLATES}
        title={title}
      />
      {showDetail && selectedAlert ? (
        <div className="alerts-module-detail">
          <button className="alerts-module-detail-close" type="button" onClick={onCloseDetail}>
            Close detail
          </button>
          <AlertDetail alert={selectedAlert} hydration={hydration} callbacks={callbacks} />
        </div>
      ) : null}
    </section>
  );
};
