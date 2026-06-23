"use client";

import type {
  AlertEvent,
  ClassifierHitEvent,
  EquityPrintJoin,
  FlowPacket,
  InferredDarkEvent,
  NewsStory,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";

import { AlertDetailDrawer } from "../../alerts";
import { getSmartFlowEvidenceRefs } from "../evidence";
import {
  decodeNewsText,
  deriveAlertDirection,
  formatCompactUsd,
  normalizeAlertSeverity,
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartMoneyProfileLabel
} from "../format";
import type { TerminalDrawersRenderer } from "../shell";
import {
  formatDarkTrace,
  type AlertContextStatus,
  type DarkEvidenceItem,
  type EvidenceItem
} from "../state-helpers";
import {
  formatConfidence,
  formatDateTime,
  formatFlowMetric,
  formatPrice,
  formatSize,
  formatTime,
  formatUsd,
  getJoinBoolean,
  getJoinNumber,
  getJoinString,
  humanizeClassifierId,
  normalizeDirection,
  parseNumber,
  sanitizeNewsHtml,
  smartFlowReasonLabel
} from "./ui-helpers";

type AlertDrawerProps = {
  alert: AlertEvent;
  flowPacket: FlowPacket | null;
  evidence: EvidenceItem[];
  contextStatus: AlertContextStatus;
  onClose: () => void;
};

const formatOptionalMoney = (value: unknown): string | null => {
  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? `$${formatPrice(parsed)}` : null;
};

const formatOptionalMs = (value: unknown): string | null => {
  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? `${Math.round(parsed)}ms` : null;
};

export const AlertDrawer = ({
  alert,
  flowPacket,
  evidence,
  contextStatus,
  onClose
}: AlertDrawerProps) => {
  const primary = alert.hits[0];
  const direction = deriveAlertDirection(alert);
  const severity = normalizeAlertSeverity(alert);
  const evidencePrints = evidence.filter((item) => item.kind === "print");
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;
  const isContextLoading = contextStatus.traceId === alert.trace_id && contextStatus.loading;
  const missingRefs = contextStatus.traceId === alert.trace_id ? contextStatus.missingRefs : [];

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Alert details</p>
          <h3>{primary ? humanizeClassifierId(primary.classifier_id) : "Alert"}</h3>
          <p className="drawer-subtitle">{formatDateTime(alert.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className={`pill severity-${severity}`}>{severity}</span>
        <span className="drawer-chip">Score {Math.round(alert.score)}</span>
        <span className={`pill direction-${direction}`}>{direction}</span>
        {isContextLoading ? <span className="drawer-chip">Loading context</span> : null}
      </div>
      {isContextLoading ? (
        <div
          className="drawer-section drawer-context-loading"
          aria-label="Loading persisted evidence"
        >
          <div className="drawer-skeleton drawer-skeleton-wide" />
          <div className="drawer-skeleton" />
        </div>
      ) : null}
      {contextStatus.traceId === alert.trace_id && contextStatus.error ? (
        <p className="drawer-empty">Persisted context could not be loaded: {contextStatus.error}</p>
      ) : null}

      <div className="drawer-section">
        <h4>Classifier hits</h4>
        {alert.hits.length === 0 ? (
          <p className="drawer-empty">No classifier hits captured.</p>
        ) : (
          <div className="drawer-list">
            {alert.hits.map((hit, index) => (
              <div className="drawer-row" key={`${alert.trace_id}-${hit.classifier_id}-${index}`}>
                <div className="drawer-row-title">{humanizeClassifierId(hit.classifier_id)}</div>
                <div className="drawer-row-meta">
                  <span className={`pill direction-${normalizeDirection(hit.direction)}`}>
                    {normalizeDirection(hit.direction)}
                  </span>
                  <span>Confidence {formatConfidence(hit.confidence)}</span>
                </div>
                {hit.explanations?.[0] ? (
                  <p className="drawer-note">{hit.explanations[0]}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="drawer-section">
        <h4>Flow packet</h4>
        {flowPacket ? (
          <div className="drawer-row">
            <div className="drawer-row-title">
              {String(flowPacket.features.option_contract_id ?? flowPacket.id ?? "Flow packet")}
            </div>
            <div className="drawer-row-meta">
              <span>
                {formatFlowMetric(
                  parseNumber(flowPacket.features.count, flowPacket.members.length)
                )}{" "}
                prints
              </span>
              <span>{formatFlowMetric(parseNumber(flowPacket.features.total_size, 0))} size</span>
              <span>
                Notional $
                {formatUsd(
                  parseNumber(
                    flowPacket.features.total_notional,
                    parseNumber(flowPacket.features.total_premium, 0) * 100
                  )
                )}
              </span>
            </div>
            <p className="drawer-note">
              Window {formatFlowMetric(parseNumber(flowPacket.features.window_ms, 0), "ms")} ·{" "}
              {formatTime(parseNumber(flowPacket.features.start_ts, flowPacket.source_ts))} →{" "}
              {formatTime(parseNumber(flowPacket.features.end_ts, flowPacket.source_ts))}
            </p>
          </div>
        ) : (
          <p className="drawer-empty">Persisted flow packet is not available for this alert.</p>
        )}
      </div>

      <div className="drawer-section">
        <h4>Evidence prints</h4>
        {evidencePrints.length === 0 ? (
          <p className="drawer-empty">
            Persisted evidence prints are not available for this alert.
          </p>
        ) : (
          <div className="drawer-list">
            {evidencePrints.slice(0, 6).map((item) => (
              <div className="drawer-row" key={item.id}>
                <div className="drawer-row-title">{item.print.option_contract_id}</div>
                <div className="drawer-row-meta">
                  <span>${formatPrice(item.print.price)}</span>
                  <span>{formatSize(item.print.size)}x</span>
                  <span>{item.print.exchange}</span>
                  {item.print.execution_nbbo_side ? (
                    <span>Side {item.print.execution_nbbo_side}</span>
                  ) : null}
                  {formatOptionalMs(item.print.execution_nbbo_age_ms) ? (
                    <span>Quote {formatOptionalMs(item.print.execution_nbbo_age_ms)}</span>
                  ) : null}
                </div>
                <div className="drawer-row-meta drawer-evidence-context">
                  {formatOptionalMoney(item.print.execution_nbbo_bid) ? (
                    <span>Bid {formatOptionalMoney(item.print.execution_nbbo_bid)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_nbbo_ask) ? (
                    <span>Ask {formatOptionalMoney(item.print.execution_nbbo_ask)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_nbbo_mid) ? (
                    <span>Mid {formatOptionalMoney(item.print.execution_nbbo_mid)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_nbbo_spread) ? (
                    <span>Spr {formatOptionalMoney(item.print.execution_nbbo_spread)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_underlying_spot) ? (
                    <span>Spot {formatOptionalMoney(item.print.execution_underlying_spot)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_underlying_bid) ? (
                    <span>U Bid {formatOptionalMoney(item.print.execution_underlying_bid)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_underlying_ask) ? (
                    <span>U Ask {formatOptionalMoney(item.print.execution_underlying_ask)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_underlying_mid) ? (
                    <span>U Mid {formatOptionalMoney(item.print.execution_underlying_mid)}</span>
                  ) : null}
                </div>
                <p className="drawer-note">{formatTime(item.print.ts)}</p>
              </div>
            ))}
          </div>
        )}
        {unknownCount > 0 ? (
          <p className="drawer-empty">
            +{unknownCount} evidence refs unresolved in persisted context.
          </p>
        ) : null}
        {missingRefs.length > 0 ? (
          <p className="drawer-empty">Missing refs: {missingRefs.slice(0, 4).join(", ")}</p>
        ) : null}
      </div>
    </aside>
  );
};

type NewsDrawerProps = {
  story: NewsStory;
  onClose: () => void;
};

export const NewsDrawer = ({ story, onClose }: NewsDrawerProps) => {
  const body = sanitizeNewsHtml(story.content_html);
  const headline = decodeNewsText(story.headline);
  const summary = decodeNewsText(story.summary);

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">News wire</p>
          <h3>{headline}</h3>
          <p className="drawer-subtitle">
            {story.source} · Published {formatDateTime(story.published_ts)}
            {story.updated_ts !== story.published_ts
              ? ` · Updated ${formatDateTime(story.updated_ts)}`
              : ""}
          </p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        {story.resolved_symbols.map((symbol) => (
          <span className="drawer-chip" key={`${story.trace_id}-${symbol}`}>
            {symbol}
          </span>
        ))}
        <span className="drawer-chip">{story.symbol_resolution}</span>
      </div>

      {summary ? (
        <div className="drawer-section">
          <h4>Summary</h4>
          <p className="drawer-note">{summary}</p>
        </div>
      ) : null}

      <div className="drawer-section">
        <h4>Story</h4>
        {body.sanitized && body.html ? (
          <div
            className="drawer-note news-drawer-body"
            dangerouslySetInnerHTML={{ __html: body.html }}
          />
        ) : body.fallbackText ? (
          <p className="drawer-note">{body.fallbackText}</p>
        ) : (
          <p className="drawer-empty">Story body unavailable.</p>
        )}
      </div>

      {story.url ? (
        <div className="drawer-section">
          <h4>Source link</h4>
          <a
            className="terminal-button terminal-link-button"
            href={story.url}
            rel="noreferrer"
            target="_blank"
          >
            Open original article
          </a>
        </div>
      ) : null}
    </aside>
  );
};

type ClassifierHitDrawerProps = {
  hit: ClassifierHitEvent;
  flowPacket: FlowPacket | null;
  evidence: EvidenceItem[];
  onClose: () => void;
};

export const ClassifierHitDrawer = ({
  hit,
  flowPacket,
  evidence,
  onClose
}: ClassifierHitDrawerProps) => {
  const direction = normalizeDirection(hit.direction);
  const evidencePrints = evidence.filter((item) => item.kind === "print");
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Classifier hit</p>
          <h3>{humanizeClassifierId(hit.classifier_id)}</h3>
          <p className="drawer-subtitle">{formatDateTime(hit.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className={`pill direction-${direction}`}>{direction}</span>
        <span className="drawer-chip">Confidence {formatConfidence(hit.confidence)}</span>
      </div>

      <div className="drawer-section">
        <h4>Explanation</h4>
        {hit.explanations.length === 0 ? (
          <p className="drawer-empty">No explanation strings captured for this hit.</p>
        ) : (
          <div className="drawer-list">
            {hit.explanations.slice(0, 6).map((text, idx) => (
              <div className="drawer-row" key={`${hit.trace_id}-${hit.seq}-ex-${idx}`}>
                <p className="drawer-note">{text}</p>
              </div>
            ))}
          </div>
        )}
        {hit.explanations.length > 6 ? (
          <p className="drawer-empty">
            +{hit.explanations.length - 6} more explanations not shown.
          </p>
        ) : null}
      </div>

      <div className="drawer-section">
        <h4>Flow packet</h4>
        {flowPacket ? (
          <div className="drawer-row">
            <div className="drawer-row-title">
              {String(flowPacket.features.option_contract_id ?? flowPacket.id ?? "Flow packet")}
            </div>
            <div className="drawer-row-meta">
              <span>
                {formatFlowMetric(
                  parseNumber(flowPacket.features.count, flowPacket.members.length)
                )}{" "}
                prints
              </span>
              <span>{formatFlowMetric(parseNumber(flowPacket.features.total_size, 0))} size</span>
              <span>
                Notional $
                {formatUsd(
                  parseNumber(
                    flowPacket.features.total_notional,
                    parseNumber(flowPacket.features.total_premium, 0) * 100
                  )
                )}
              </span>
            </div>
            <p className="drawer-note">
              Window {formatFlowMetric(parseNumber(flowPacket.features.window_ms, 0), "ms")} ·{" "}
              {formatTime(parseNumber(flowPacket.features.start_ts, flowPacket.source_ts))} →{" "}
              {formatTime(parseNumber(flowPacket.features.end_ts, flowPacket.source_ts))}
            </p>
          </div>
        ) : (
          <p className="drawer-empty">Flow packet not in the current live cache.</p>
        )}
      </div>

      <div className="drawer-section">
        <h4>Evidence prints</h4>
        {evidencePrints.length === 0 ? (
          <p className="drawer-empty">No linked option prints in the live cache yet.</p>
        ) : (
          <div className="drawer-list">
            {evidencePrints.slice(0, 6).map((item) => (
              <div className="drawer-row" key={item.id}>
                <div className="drawer-row-title">{item.print.option_contract_id}</div>
                <div className="drawer-row-meta">
                  <span>${formatPrice(item.print.price)}</span>
                  <span>{formatSize(item.print.size)}x</span>
                  <span>{item.print.exchange}</span>
                </div>
                <p className="drawer-note">{formatTime(item.print.ts)}</p>
              </div>
            ))}
          </div>
        )}
        {unknownCount > 0 ? (
          <p className="drawer-empty">+{unknownCount} evidence prints not in cache.</p>
        ) : null}
      </div>
    </aside>
  );
};

type SmartMoneyDrawerProps = {
  event: SmartMoneyEvent;
  flowPacket: FlowPacket | null;
  evidence: EvidenceItem[];
  onClose: () => void;
};

type SmartFlowDrawerProps = {
  projection: SmartFlowExplainabilityProjection;
  evidence: EvidenceItem[];
  onClose: () => void;
};

export const SmartFlowDrawer = ({ projection, evidence, onClose }: SmartFlowDrawerProps) => {
  const hypothesis = projection.hypothesis;
  const confidence = hypothesis.scores.confidence;
  const directionLabel = smartFlowDirectionLabel(projection);
  const directionTone = smartFlowDirectionTone(projection);
  const evidenceQuality = smartFlowEvidenceQualityLabel(projection.evidence.evidence_quality);
  const evidenceRefs = getSmartFlowEvidenceRefs(projection);
  const visibleEvidence = evidence.slice(0, 12);
  const hiddenEvidenceCount = Math.max(0, evidence.length - visibleEvidence.length);
  const sourceReasons =
    projection.abstention.source_reasons.length > 0
      ? projection.abstention.source_reasons
      : projection.abstention.reasons
          .filter((reason) => reason !== "not_abstained")
          .map(smartFlowReasonLabel);

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Smart-flow hypothesis</p>
          <h3>{smartFlowHypothesisLabel(hypothesis.hypothesis_type)}</h3>
          <p className="drawer-subtitle">
            {hypothesis.underlying_id} / {formatDateTime(projection.source_ts)}
          </p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className={`pill direction-${directionTone}`}>{directionLabel}</span>
        <span className="drawer-chip">
          Confidence {formatConfidence(confidence.policy_confidence)}
        </span>
        <span className="drawer-chip">Conviction {formatConfidence(confidence.conviction)}</span>
        <span className="drawer-chip">
          Evidence {evidenceQuality} {formatConfidence(projection.evidence.evidence_quality)}
        </span>
        {projection.abstention.abstained ? <span className="drawer-chip">Abstained</span> : null}
      </div>

      <div className="drawer-section">
        <h4>Hypothesis read</h4>
        <div className="drawer-row">
          <div className="drawer-row-title">{projection.insight.label}</div>
          <p className="drawer-note">{projection.insight.summary}</p>
          {projection.compatibility?.compatibility_only ? (
            <p className="drawer-note">Compatibility projection from the legacy feed.</p>
          ) : null}
        </div>
      </div>

      <div className="drawer-section">
        <h4>Confidence versus conviction</h4>
        <div className="drawer-list">
          <div className="drawer-row">
            <div className="drawer-row-title">Policy confidence</div>
            <div className="drawer-row-meta">
              <span>{formatConfidence(confidence.policy_confidence)}</span>
              <span>{projection.insight.confidence_band}</span>
            </div>
            <p className="drawer-note">How strongly the current policy supports this hypothesis.</p>
          </div>
          <div className="drawer-row">
            <div className="drawer-row-title">Conviction</div>
            <div className="drawer-row-meta">
              <span>{formatConfidence(confidence.conviction)}</span>
              <span>margin {formatConfidence(confidence.hypothesis_margin)}</span>
            </div>
            <p className="drawer-note">Separated from confidence so weak margin stays visible.</p>
          </div>
          <div className="drawer-row">
            <div className="drawer-row-title">Evidence quality</div>
            <div className="drawer-row-meta">
              <span>{evidenceQuality}</span>
              <span>{formatConfidence(confidence.evidence_quality)}</span>
              <span>{confidence.calibration_version ?? "calibration unavailable"}</span>
            </div>
            <p className="drawer-note">
              Evidence quality is an input, not a participant identity claim.
            </p>
          </div>
        </div>
      </div>

      <div className="drawer-section">
        <h4>Why-not context</h4>
        {sourceReasons.length > 0 ? (
          <div className="drawer-list">
            {sourceReasons.map((reason) => (
              <div className="drawer-row" key={`reason-${reason}`}>
                <div className="drawer-row-title">
                  {projection.abstention.abstained ? "Abstention reason" : "Policy check"}
                </div>
                <p className="drawer-note">{smartFlowReasonLabel(reason)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="drawer-empty">No abstention reason was reported.</p>
        )}
        {projection.evidence.penalties.length > 0 ? (
          <div className="drawer-list">
            {projection.evidence.penalties.map((penalty) => (
              <div className="drawer-row" key={penalty.penalty_id}>
                <div className="drawer-row-title">{smartFlowReasonLabel(penalty.kind)}</div>
                <div className="drawer-row-meta">
                  <span>Penalty {formatConfidence(penalty.score)}</span>
                  <span>{penalty.evidence_refs.length} refs</span>
                </div>
                <p className="drawer-note">{penalty.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="drawer-empty">No active score penalties.</p>
        )}
      </div>

      <div className="drawer-section">
        <h4>Alternatives considered</h4>
        {projection.alternatives.length === 0 ? (
          <p className="drawer-empty">No close alternative was reported by this projection.</p>
        ) : (
          <div className="drawer-list">
            {projection.alternatives.map((alternative) => (
              <div
                className="drawer-row"
                key={`${projection.refs.hypothesis_id}-${alternative.hypothesis_type}`}
              >
                <div className="drawer-row-title">
                  {smartFlowHypothesisLabel(alternative.hypothesis_type)}
                </div>
                <div className="drawer-row-meta">
                  <span className={`pill direction-${normalizeDirection(alternative.direction)}`}>
                    {normalizeDirection(alternative.direction)}
                  </span>
                  <span>{formatConfidence(alternative.score)}</span>
                </div>
                {alternative.reasons[0] ? (
                  <p className="drawer-note">{alternative.reasons[0]}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="drawer-section">
        <h4>Evidence refs</h4>
        {visibleEvidence.length === 0 ? (
          <p className="drawer-empty">No evidence refs attached.</p>
        ) : (
          <div className="drawer-list">
            {visibleEvidence.map((item) => {
              if (item.kind === "flow") {
                return (
                  <div className="drawer-row" key={item.id}>
                    <div className="drawer-row-title">{item.id}</div>
                    <div className="drawer-row-meta">
                      <span>Flow packet</span>
                      <span>{item.packet.members.length} prints</span>
                    </div>
                    <p className="drawer-note">
                      {String(item.packet.features.option_contract_id ?? item.packet.id)}
                    </p>
                  </div>
                );
              }
              if (item.kind === "print") {
                return (
                  <div className="drawer-row" key={item.id}>
                    <div className="drawer-row-title">{item.id}</div>
                    <div className="drawer-row-meta">
                      <span>Option print</span>
                      <span>${formatPrice(item.print.price)}</span>
                      <span>{formatSize(item.print.size)}x</span>
                    </div>
                    <p className="drawer-note">{item.print.option_contract_id}</p>
                  </div>
                );
              }
              return (
                <div className="drawer-row" key={item.id}>
                  <div className="drawer-row-title">{item.id}</div>
                  <p className="drawer-note">Not in the current evidence cache.</p>
                </div>
              );
            })}
          </div>
        )}
        {hiddenEvidenceCount > 0 ? (
          <p className="drawer-empty">+{hiddenEvidenceCount} more evidence refs.</p>
        ) : null}
      </div>

      <div className="drawer-section">
        <h4>Version trace</h4>
        <div className="drawer-row">
          <div className="drawer-row-title">{projection.refs.trace_id}</div>
          <div className="drawer-row-meta">
            <span>{projection.projection_version}</span>
            <span>{projection.versions.policy}</span>
            <span>{projection.versions.model}</span>
          </div>
          <p className="drawer-note">
            Cluster {projection.refs.cluster_id} / {projection.refs.candidate_ids.length} candidates
            / {evidenceRefs.length} refs
          </p>
        </div>
      </div>
    </aside>
  );
};

export const SmartMoneyDrawer = ({
  event,
  flowPacket,
  evidence,
  onClose
}: SmartMoneyDrawerProps) => {
  const primaryScore =
    event.profile_scores.find((score) => score.profile_id === event.primary_profile_id) ??
    event.profile_scores[0];
  const direction = normalizeDirection(event.primary_direction);
  const evidencePrints = evidence.filter((item) => item.kind === "print");
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Compatibility flow profile</p>
          <h3>{smartMoneyProfileLabel(event.primary_profile_id)}</h3>
          <p className="drawer-subtitle">{formatDateTime(event.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className={`pill direction-${direction}`}>{direction}</span>
        <span className="drawer-chip">
          Legacy probability {primaryScore ? formatConfidence(primaryScore.probability) : "--"}
        </span>
        {event.abstained ? <span className="drawer-chip">Abstained</span> : null}
      </div>

      <div className="drawer-section">
        <h4>Compatibility ladder</h4>
        <div className="drawer-list">
          {event.profile_scores.slice(0, 6).map((score) => (
            <div className="drawer-row" key={`${event.event_id}-${score.profile_id}`}>
              <div className="drawer-row-title">{smartMoneyProfileLabel(score.profile_id)}</div>
              <div className="drawer-row-meta">
                <span className={`pill direction-${normalizeDirection(score.direction)}`}>
                  {normalizeDirection(score.direction)}
                </span>
                <span>{formatConfidence(score.probability)}</span>
                <span>{score.confidence_band}</span>
              </div>
              {score.reasons[0] ? <p className="drawer-note">{score.reasons[0]}</p> : null}
            </div>
          ))}
        </div>
        {event.suppressed_reasons.length > 0 ? (
          <p className="drawer-empty">Suppressed: {event.suppressed_reasons.join(", ")}</p>
        ) : null}
      </div>

      <div className="drawer-section">
        <h4>Parent event</h4>
        <div className="drawer-row">
          <div className="drawer-row-title">{event.underlying_id}</div>
          <div className="drawer-row-meta">
            <span>{formatFlowMetric(event.features.print_count)} prints</span>
            <span>{formatFlowMetric(event.features.total_size)} size</span>
            <span>${formatCompactUsd(event.features.total_premium)}</span>
          </div>
          <p className="drawer-note">
            Window {formatFlowMetric(event.event_window_ms, "ms")} · {event.event_kind}
          </p>
        </div>
        {flowPacket ? <p className="drawer-note">Flow packet {flowPacket.id}</p> : null}
      </div>

      <div className="drawer-section">
        <h4>Evidence prints</h4>
        {evidencePrints.length === 0 ? (
          <p className="drawer-empty">No linked option prints in the live cache yet.</p>
        ) : (
          <div className="drawer-list">
            {evidencePrints.slice(0, 6).map((item) => (
              <div className="drawer-row" key={item.id}>
                <div className="drawer-row-title">{item.print.option_contract_id}</div>
                <div className="drawer-row-meta">
                  <span>${formatPrice(item.print.price)}</span>
                  <span>{formatSize(item.print.size)}x</span>
                  <span>{item.print.exchange}</span>
                </div>
                <p className="drawer-note">{formatTime(item.print.ts)}</p>
              </div>
            ))}
          </div>
        )}
        {unknownCount > 0 ? (
          <p className="drawer-empty">+{unknownCount} evidence prints not in cache.</p>
        ) : null}
      </div>
    </aside>
  );
};

type DarkDrawerProps = {
  event: InferredDarkEvent;
  evidence: DarkEvidenceItem[];
  underlying: string | null;
  onClose: () => void;
};

export const DarkDrawer = ({ event, evidence, underlying, onClose }: DarkDrawerProps) => {
  const joinEvidence = evidence.filter(
    (item): item is { kind: "join"; id: string; join: EquityPrintJoin } => item.kind === "join"
  );
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;
  const traceRefs = event.evidence_refs.slice(0, 6);
  const extraRefs = Math.max(0, event.evidence_refs.length - traceRefs.length);

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Inferred dark</p>
          <h3>{humanizeClassifierId(event.type)}</h3>
          <p className="drawer-subtitle">{formatDateTime(event.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className="drawer-chip">Confidence {formatConfidence(event.confidence)}</span>
        {underlying ? <span className="drawer-chip">{underlying}</span> : null}
        <span className="drawer-chip">Evidence {event.evidence_refs.length}</span>
      </div>

      <div className="drawer-section">
        <h4>Trace path</h4>
        <div className="drawer-row">
          <div className="drawer-row-title">Event trace</div>
          <p className="drawer-note">{formatDarkTrace(event.trace_id)}</p>
        </div>
        {traceRefs.length === 0 ? (
          <p className="drawer-empty">No evidence references attached.</p>
        ) : (
          <div className="drawer-list">
            {traceRefs.map((ref) => (
              <div className="drawer-row" key={ref}>
                <div className="drawer-row-title">Evidence ref</div>
                <p className="drawer-note">{formatDarkTrace(ref)}</p>
              </div>
            ))}
          </div>
        )}
        {extraRefs > 0 ? <p className="drawer-empty">+{extraRefs} more evidence refs.</p> : null}
      </div>

      <div className="drawer-section">
        <h4>Evidence joins</h4>
        {joinEvidence.length === 0 ? (
          <p className="drawer-empty">No evidence joins in the current cache.</p>
        ) : (
          <div className="drawer-list">
            {joinEvidence.slice(0, 6).map((item) => {
              const joinUnderlying = getJoinString(item.join, "underlying_id") ?? "Unknown";
              const price = getJoinNumber(item.join, "price");
              const size = getJoinNumber(item.join, "size");
              const placement = getJoinString(item.join, "quote_placement") ?? "MISSING";
              const offExchange = getJoinBoolean(item.join, "off_exchange_flag");
              const bid = getJoinNumber(item.join, "quote_bid");
              const ask = getJoinNumber(item.join, "quote_ask");
              const mid = getJoinNumber(item.join, "quote_mid");
              const spread = getJoinNumber(item.join, "quote_spread");
              const quoteAge = parseNumber(item.join.join_quality.quote_age_ms, Number.NaN);
              const quoteStale = parseNumber(item.join.join_quality.quote_stale, 0) > 0;
              const quoteMissing = parseNumber(item.join.join_quality.quote_missing, 0) > 0;

              return (
                <div className="drawer-row" key={item.id}>
                  <div className="drawer-row-title">{joinUnderlying}</div>
                  <div className="drawer-row-meta">
                    {Number.isFinite(price) ? <span>${formatPrice(price)}</span> : null}
                    {Number.isFinite(size) ? <span>{formatSize(size)}x</span> : null}
                    <span className="pill">{placement}</span>
                    {offExchange ? (
                      <span className="flag">Off-Ex</span>
                    ) : (
                      <span className="flag flag-muted">Lit</span>
                    )}
                    {Number.isFinite(quoteAge) ? <span>{Math.round(quoteAge)}ms</span> : null}
                    {quoteStale ? <span className="pill nbbo-stale">Quote stale</span> : null}
                    {quoteMissing ? <span className="pill nbbo-missing">Quote missing</span> : null}
                  </div>
                  <p className="drawer-note">{item.join.trace_id}</p>
                  {Number.isFinite(bid) && Number.isFinite(ask) ? (
                    <p className="drawer-note">
                      Quote ${formatPrice(bid)} x ${formatPrice(ask)}
                      {Number.isFinite(mid) ? ` · Mid ${formatPrice(mid)}` : ""}
                      {Number.isFinite(spread) ? ` · Spr ${formatPrice(spread)}` : ""}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {unknownCount > 0 ? (
          <p className="drawer-empty">+{unknownCount} evidence refs not in cache.</p>
        ) : null}
      </div>
    </aside>
  );
};

export const renderTerminalDrawers: TerminalDrawersRenderer = (state) => (
  <>
    {state.selectedAlert ? (
      <AlertDetailDrawer
        alert={state.selectedAlert}
        flowPacketById={state.flowPacketMap}
        optionPrintByTraceId={state.optionPrintMap}
        onContractFocus={state.focusAlertContract}
        onEquityFocus={state.focusAlertEquity}
        onPacketFocus={state.focusFlowPacketRequest}
        onClose={() => state.setSelectedAlert(null)}
      />
    ) : null}

    {state.selectedNewsStory ? (
      <NewsDrawer
        story={state.selectedNewsStory}
        onClose={() => state.setSelectedNewsStory(null)}
      />
    ) : null}

    {state.selectedClassifierHit ? (
      <ClassifierHitDrawer
        hit={state.selectedClassifierHit}
        flowPacket={state.selectedClassifierFlowPacket}
        evidence={state.selectedClassifierEvidence}
        onClose={() => state.setSelectedClassifierHit(null)}
      />
    ) : null}

    {state.selectedSmartFlowProjection ? (
      <SmartFlowDrawer
        projection={state.selectedSmartFlowProjection}
        evidence={state.selectedSmartFlowEvidence}
        onClose={() => state.setSelectedSmartFlowProjection(null)}
      />
    ) : null}

    {state.selectedSmartMoneyEvent ? (
      <SmartMoneyDrawer
        event={state.selectedSmartMoneyEvent}
        flowPacket={state.selectedSmartMoneyFlowPacket}
        evidence={state.selectedSmartMoneyEvidence}
        onClose={() => state.setSelectedSmartMoneyEvent(null)}
      />
    ) : null}

    {state.selectedDarkEvent ? (
      <DarkDrawer
        event={state.selectedDarkEvent}
        evidence={state.selectedDarkEvidence}
        underlying={state.selectedDarkUnderlying}
        onClose={() => state.setSelectedDarkEvent(null)}
      />
    ) : null}
  </>
);
