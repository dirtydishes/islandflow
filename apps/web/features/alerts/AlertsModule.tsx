"use client";

import type { FlowPacket, OptionPrint, SmartFlowAlertEvent } from "@islandflow/types";
import { useMemo } from "react";

import { DurableTape } from "../durable-tape";
import { toFlowPacketFocusRequest } from "../flow-packets";
import { humanizeSmartFlowToken } from "../smart-flow";
import { ALERTS_COLUMNS, ALERTS_TEMPLATES, renderAlertsRow } from "./columns";
import {
  getAlertFlowPacketRefs,
  getAlertOptionPrintRefs,
  useAlertEvidenceHydration
} from "./evidence";
import {
  formatAlertConfidence,
  formatAlertDateTime,
  formatAlertMoney,
  formatAlertPrice,
  formatAlertSize,
  formatAlertTime,
  getAlertConfidenceEvidenceLabel,
  getAlertCursor,
  getAlertDirectionLabel,
  getAlertEvidenceQualityLabel,
  getAlertKey,
  getAlertName,
  getAlertPrimaryOptionRef,
  getAlertPrimaryPacketRef,
  getAlertSymbol,
  getAlertTriggerReason,
  getFlowPacketContractId,
  inferAlertUnderlying,
  normalizeAlertDirection
} from "./format";
import { normalizeAlertsFilters, normalizeAlertsScope, useAlertsArraySource } from "./source";
import { getSmartFlowAlertRowTintClassName, getSmartFlowAlertRowTintStyle } from "./tinting";
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

export const getAlertDetailFocusTargets = (
  alert: SmartFlowAlertEvent,
  hydration: AlertEvidenceHydration
) => {
  const evidencePrints = hydration.evidence.filter(
    (item): item is Extract<AlertEvidenceItem, { kind: "print" }> => item.kind === "print"
  );
  const print = getActionPrint(hydration.evidence);
  const packet = hydration.flowPacket;
  const underlying = inferAlertUnderlying(
    alert,
    packet,
    evidencePrints.map((item) => item.print)
  );

  return { packet, print, underlying };
};

const renderTriageRow = (label: string, value: string, note?: string) => (
  <div className="alerts-detail-row" key={label}>
    <div>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
    {note ? <p>{note}</p> : null}
  </div>
);

const renderAlertHover = (alert: SmartFlowAlertEvent) => {
  const primaryPacketRef = getAlertPrimaryPacketRef(alert);
  return (
    <div className="alerts-hover" aria-label="Smart-flow alert preview">
      <div className="alerts-hover-head">
        <strong>{getAlertName(alert)}</strong>
        <span>
          {getAlertSymbol(alert)} / {normalizeAlertDirection(alert.direction)}
        </span>
      </div>
      <dl>
        {renderDetailMetric("Confidence", formatAlertConfidence(alert.policy_confidence))}
        {renderDetailMetric("Evidence", getAlertEvidenceQualityLabel(alert))}
        {renderDetailMetric("Refs", alert.evidence_refs.length)}
      </dl>
      <p>{primaryPacketRef ?? getAlertTriggerReason(alert)}</p>
    </div>
  );
};

export const AlertDetail = ({
  alert,
  hydration,
  callbacks
}: {
  alert: SmartFlowAlertEvent;
  hydration: AlertEvidenceHydration;
  callbacks?: AlertActionCallbacks;
}) => {
  const projection = alert.projection;
  const confidence = projection.hypothesis.scores.confidence;
  const direction = normalizeAlertDirection(alert.direction);
  const evidencePrints = hydration.evidence.filter(
    (item): item is Extract<AlertEvidenceItem, { kind: "print" }> => item.kind === "print"
  );
  const hiddenEvidencePrintCount = Math.max(0, evidencePrints.length - 6);
  const unresolved = hydration.evidence.filter((item) => item.kind === "unknown");
  const contextRefs = hydration.evidence.filter((item) => item.kind === "context");
  const packetRefs = getAlertFlowPacketRefs(alert);
  const optionRefs = getAlertOptionPrintRefs(alert);
  const primaryPacketRef = getAlertPrimaryPacketRef(alert);
  const primaryOptionRef = getAlertPrimaryOptionRef(alert);
  const focusTargets = getAlertDetailFocusTargets(alert, hydration);
  const sourceReasons =
    projection.abstention.source_reasons.length > 0
      ? projection.abstention.source_reasons
      : projection.abstention.reasons.filter((reason) => reason !== "not_abstained");

  return (
    <div className="alerts-detail" aria-label="Smart-flow alert detail">
      <div className="alerts-detail-head">
        <div>
          <span>Smart-flow alert</span>
          <h3>{getAlertName(alert)}</h3>
          <p>{formatAlertDateTime(alert.source_ts)}</p>
        </div>
        <div className="alerts-detail-signal">
          <span>Confidence</span>
          <strong>{formatAlertConfidence(alert.policy_confidence)}</strong>
        </div>
      </div>

      <div className="alerts-detail-chip-row">
        <span className={`pill direction-${direction}`}>{getAlertDirectionLabel(alert)}</span>
        <span className="drawer-chip">{getAlertConfidenceEvidenceLabel(alert)}</span>
        <span className="drawer-chip">{alert.evidence_refs.length} refs</span>
        {hydration.status.traceId === alert.trace_id && hydration.status.loading ? (
          <span className="drawer-chip">Loading evidence</span>
        ) : null}
      </div>

      <section className="alerts-detail-section alerts-detail-triage">
        <h4>Fast triage</h4>
        <div className="alerts-detail-list">
          {renderTriageRow("Symbol", getAlertSymbol(alert))}
          {renderTriageRow("Hypothesis", getAlertName(alert), projection.insight.summary)}
          {renderTriageRow("Direction", getAlertDirectionLabel(alert))}
          {renderTriageRow("Trigger", getAlertTriggerReason(alert), projection.insight.label)}
          {renderTriageRow(
            "Confidence / evidence",
            getAlertConfidenceEvidenceLabel(alert),
            `Conviction ${formatAlertConfidence(confidence.conviction)}, margin ${formatAlertConfidence(
              confidence.hypothesis_margin
            )}.`
          )}
          {renderTriageRow(
            "Primary refs",
            [primaryPacketRef, primaryOptionRef].filter(Boolean).join(" / ") || "No primary ref",
            `${packetRefs.length} packet refs, ${optionRefs.length} option refs.`
          )}
        </div>
      </section>

      <div className="alerts-detail-actions">
        <button
          type="button"
          disabled={!focusTargets.packet || !callbacks?.onPacketFocus}
          onClick={() => {
            if (focusTargets.packet) {
              callbacks?.onPacketFocus?.(toFlowPacketFocusRequest(focusTargets.packet, "alerts"));
            }
          }}
        >
          Focus packet
        </button>
        <button
          type="button"
          disabled={!focusTargets.print || !callbacks?.onContractFocus}
          onClick={() => {
            if (focusTargets.print) {
              callbacks?.onContractFocus?.({ print: focusTargets.print, source: "alerts" });
            }
          }}
        >
          Focus contract
        </button>
        <button
          type="button"
          disabled={!focusTargets.underlying || !callbacks?.onEquityFocus}
          onClick={() => {
            if (focusTargets.underlying) {
              callbacks?.onEquityFocus?.({
                underlyingId: focusTargets.underlying,
                source: "alerts"
              });
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
        <h4>Primary evidence</h4>
        {focusTargets.packet ? (
          <div className="alerts-detail-row">
            <div>
              <strong>
                {getFlowPacketContractId(focusTargets.packet) ?? focusTargets.packet.id}
              </strong>
              <span>{focusTargets.packet.members.length} prints</span>
            </div>
            <p>
              Packet {focusTargets.packet.id}, refs {packetRefs.length}
            </p>
          </div>
        ) : (
          <p className="drawer-empty">Persisted flow packet is not available for this alert.</p>
        )}
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
        {contextRefs.length > 0 ? (
          <p className="drawer-empty">Quote context refs: {contextRefs.length}</p>
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

      <section className="alerts-detail-section">
        <h4>Alternatives considered</h4>
        {projection.alternatives.length === 0 ? (
          <p className="drawer-empty">No close alternative was reported by this projection.</p>
        ) : (
          <div className="alerts-detail-list">
            {projection.alternatives.map((alternative) => (
              <div
                className="alerts-detail-row"
                key={`${alert.alert_id}-${alternative.hypothesis_type}`}
              >
                <div>
                  <strong>{humanizeSmartFlowToken(alternative.hypothesis_type)}</strong>
                  <span>{normalizeAlertDirection(alternative.direction)}</span>
                </div>
                <p>
                  Fit {formatAlertConfidence(alternative.score)}
                  {alternative.reasons[0] ? `, ${alternative.reasons[0]}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="alerts-detail-section">
        <h4>Why-not context</h4>
        {sourceReasons.length === 0 ? (
          <p className="drawer-empty">
            Projection passed alert policy; no abstention context was reported.
          </p>
        ) : (
          <div className="alerts-detail-list">
            {sourceReasons.map((reason) => (
              <div className="alerts-detail-row" key={`${alert.alert_id}-reason-${reason}`}>
                <div>
                  <strong>{projection.abstention.abstained ? "Abstention" : "Policy check"}</strong>
                  <span>{humanizeSmartFlowToken(reason)}</span>
                </div>
                <p>{humanizeSmartFlowToken(reason)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="alerts-detail-section">
        <h4>Policy penalties</h4>
        {projection.evidence.penalties.length === 0 ? (
          <p className="drawer-empty">No active penalties.</p>
        ) : (
          <div className="alerts-detail-list">
            {projection.evidence.penalties.map((penalty) => (
              <div className="alerts-detail-row" key={penalty.penalty_id}>
                <div>
                  <strong>{humanizeSmartFlowToken(penalty.kind)}</strong>
                  <span>Weight {formatAlertConfidence(penalty.score)}</span>
                </div>
                <p>
                  {penalty.reason} / {penalty.evidence_refs.length} refs
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="alerts-detail-section">
        <h4>Version trace</h4>
        <div className="alerts-detail-row">
          <div>
            <strong>{projection.refs.trace_id}</strong>
            <span>{projection.projection_version}</span>
          </div>
          <p>
            Policy {projection.versions.policy} / model {projection.versions.model} / contract{" "}
            {projection.versions.contract}
          </p>
        </div>
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
  alert: SmartFlowAlertEvent;
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
          <p className="drawer-eyebrow">Smart-flow alert</p>
          <h3>{getAlertName(alert)}</h3>
          <p className="drawer-subtitle">
            {getAlertSymbol(alert)} / {formatAlertDateTime(alert.source_ts)}
          </p>
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
        getRowClassName={({ item }) => getSmartFlowAlertRowTintClassName(item)}
        getRowKey={getAlertKey}
        getRowStyle={({ item }) => getSmartFlowAlertRowTintStyle(item)}
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
