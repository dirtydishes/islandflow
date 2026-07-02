"use client";

import type {
  DurableTapeAlertRowViewModel,
  InferredDarkEvent,
  NewsStory,
  SmartFlowAlertEvent,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { useEffect, useMemo } from "react";

import { AlertDetailDrawer } from "../alerts";
import { renderDurableTapeAlertRowDetail } from "../durable-tape";
import { DarkDrawer, NewsDrawer, SmartFlowDrawer } from "../terminal/components/drawers";
import { getSmartFlowEvidenceRefs } from "../terminal/evidence";
import type { TerminalState } from "../terminal/state";
import {
  type DarkEvidenceItem,
  type EvidenceItem,
  inferDarkUnderlying,
  resolveJoinFromRef
} from "../terminal/state-helpers";

export type MarketCommandDetail =
  | { kind: "durable-alert-row"; row: DurableTapeAlertRowViewModel }
  | { kind: "smart-flow"; projection: SmartFlowExplainabilityProjection }
  | { kind: "inferred-dark"; event: InferredDarkEvent }
  | { kind: "news"; story: NewsStory }
  | { kind: "legacy-alert"; alert: SmartFlowAlertEvent };

const buildSmartFlowEvidence = (
  projection: SmartFlowExplainabilityProjection,
  state: TerminalState
): EvidenceItem[] =>
  getSmartFlowEvidenceRefs(projection).map((id) => {
    const packet = state.flowPacketMap.get(id);
    if (packet) {
      return { kind: "flow", id, packet };
    }
    const print = state.optionPrintMap.get(id);
    if (print) {
      return { kind: "print", id, print };
    }
    return { kind: "unknown", id };
  });

const buildDarkEvidence = (event: InferredDarkEvent, state: TerminalState): DarkEvidenceItem[] =>
  event.evidence_refs.map((id) => {
    const join = resolveJoinFromRef(id, state.equityJoinMap);
    if (join) {
      return { kind: "join", id, join };
    }
    return { kind: "unknown", id };
  });

export const MarketCommandDetailDrawer = ({
  detail,
  state,
  onClose
}: {
  detail: MarketCommandDetail | null;
  state: TerminalState;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!detail) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(".drawer")) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [detail, onClose]);

  const smartFlowEvidence = useMemo(
    () => (detail?.kind === "smart-flow" ? buildSmartFlowEvidence(detail.projection, state) : []),
    [detail, state]
  );
  const darkEvidence = useMemo(
    () => (detail?.kind === "inferred-dark" ? buildDarkEvidence(detail.event, state) : []),
    [detail, state]
  );
  const darkUnderlying = useMemo(
    () =>
      detail?.kind === "inferred-dark"
        ? inferDarkUnderlying(detail.event, state.equityJoinMap)
        : null,
    [detail, state.equityJoinMap]
  );

  if (!detail) {
    return null;
  }

  if (detail.kind === "durable-alert-row") {
    return (
      <aside
        className="drawer market-command-detail-drawer"
        aria-label="Market command detail drawer"
        data-testid="market-command-detail-drawer"
      >
        <div className="drawer-header">
          <div>
            <p className="drawer-eyebrow">Durable alert row</p>
            <h3>{detail.row.alert.primary_label}</h3>
            <p className="drawer-subtitle">
              {detail.row.cells.symbol ?? "ALERT"} / {detail.row.cells.time ?? "--"}
            </p>
          </div>
          <button className="drawer-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {renderDurableTapeAlertRowDetail(detail.row)}
      </aside>
    );
  }

  if (detail.kind === "smart-flow") {
    return (
      <SmartFlowDrawer
        projection={detail.projection}
        evidence={smartFlowEvidence}
        onClose={onClose}
      />
    );
  }

  if (detail.kind === "inferred-dark") {
    return (
      <DarkDrawer
        event={detail.event}
        evidence={darkEvidence}
        underlying={darkUnderlying}
        onClose={onClose}
      />
    );
  }

  if (detail.kind === "news") {
    return <NewsDrawer story={detail.story} onClose={onClose} />;
  }

  return (
    <AlertDetailDrawer
      alert={detail.alert}
      flowPacketById={state.flowPacketMap}
      optionPrintByTraceId={state.optionPrintMap}
      onContractFocus={state.focusAlertContract}
      onEquityFocus={state.focusAlertEquity}
      onPacketFocus={state.focusFlowPacketRequest}
      onClose={onClose}
    />
  );
};
