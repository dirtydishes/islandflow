"use client";

import type { ReactNode } from "react";

import {
  ChartPane,
  CommandDecisionLevels,
  CommandDeckHeader,
  CommandMetricsStrip,
  CommandPriorityBoard,
  CommandSymbolRail,
  EventContextPane,
  FeedHealthPane,
  HomeReplayRail
} from "../features/terminal/components/charts";
import { renderTerminalDrawers } from "../features/terminal/components/drawers";
import { NewsControlRails, NewsPane } from "../features/terminal/components/news";
import { FlowPane, OpraIntakeRail, OptionsPane } from "../features/terminal/components/opra";
import { FlowFilterPopover, PageFrame } from "../features/terminal/components/primitives";
import { TerminalAppShell as TerminalFeatureAppShell } from "../features/terminal/shell";
import { useTerminal } from "../features/terminal/state";

export { getChartFlowMarkerItems } from "../features/terminal/charts/markers";
export type { ChartFlowMarkerItem } from "../features/terminal/charts/markers";
export {
  getTapeVirtualConfig,
  isSyntheticAdminVisible,
  shouldIncludeEquitiesForDarkUnderlyingFallback
} from "../features/terminal/config";
export {
  buildAlertContextPath,
  collectAlertContextEvidence,
  getAlertFlowPacketRefs,
  getSmartFlowEvidenceRefs,
  getSmartFlowOptionPrintRefs,
  getSmartFlowPacketRefs,
  getSmartFlowPinnedFlowKeys,
  getSmartFlowPinnedOptionKeys,
  prunePinnedEntries,
  resolveAlertFlowPacket
} from "../features/terminal/evidence";
export {
  buildDefaultFlowFilters,
  buildOptionTapeQueryParams,
  countActiveFlowFilterGroups,
  filterOptionTapeItems,
  getEffectiveOptionPrintFilters,
  getOptionScope,
  nextFlowFilterPopoverState,
  normalizeTickerFilterInput,
  parseTickerFilterInput,
  shouldClearOptionFocusSeed,
  shouldRetainLiveSnapshotHistory,
  shouldShowEquitiesSilentFeedWarning,
  toggleFilterValue
} from "../features/terminal/filters";
export {
  classifierToneForFamily,
  decodeNewsText,
  deriveAlertDirection,
  formatCompactUsd,
  formatNewsTimestamp,
  formatOptionContractLabel,
  getAlertWindowAnchorTs,
  getOptionTableSnapshot,
  normalizeAlertSeverity,
  selectPrimaryClassifierHit,
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartFlowWhyNotLabel,
  smartMoneyProfileLabel,
  smartMoneyToneForProfile,
  statusLabel
} from "../features/terminal/format";
export {
  NAV_ITEMS,
  getLiveManifest,
  getRouteFeatures,
  getTerminalNavCurrentHref,
  normalizeTerminalPathname
} from "../features/terminal/routes";
export {
  appendHistoryTail,
  composeTapeItems,
  findAnchorRestoreIndex,
  flushPausableTapeData,
  getHotChannelFeedStatus,
  getLiveFeedStatus,
  getLiveHistoryRetentionCap,
  mergeHeldTapeHistory,
  mergeNewestWithOverflow,
  projectPausableTapeState,
  reducePausableTapeData
} from "../features/terminal/tape";
export { FlowFilterPopover };

export function TerminalAppShell({ children }: { children: ReactNode }) {
  return (
    <TerminalFeatureAppShell renderDrawers={renderTerminalDrawers}>
      {children}
    </TerminalFeatureAppShell>
  );
}

export function OverviewRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Market Command" eyebrow="Dashboard" variant="dashboard">
      <div className="market-command-shell">
        <CommandDeckHeader state={state} />
        <CommandMetricsStrip state={state} />
        <CommandSymbolRail state={state} />
        <div className="market-command-grid">
          <CommandPriorityBoard state={state} />
          <ChartPane state={state} title="Chart Context" />
          <CommandDecisionLevels state={state} />
          <OptionsPane
            state={state}
            limit={12}
            title="Recent Contracts"
            className="command-contracts-pane"
          />
          <FeedHealthPane state={state} />
          <EventContextPane state={state} />
          <HomeReplayRail state={state} />
        </div>
      </div>
    </PageFrame>
  );
}

export function NewsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Newswire" eyebrow="News" variant="news">
      <div className="wire-control-shell">
        <NewsControlRails state={state} />
        <NewsPane state={state} className="news-pane-full" />
      </div>
    </PageFrame>
  );
}

export function OptionsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="OPRA Intake" eyebrow="Options" variant="options">
      <div className="opra-intake-shell">
        <OpraIntakeRail state={state} />
        <div className="opra-intake-grid">
          <OptionsPane state={state} title="OPRA Tape" className="opra-options-pane" />
          <FlowPane state={state} title="Packet Fit" className="opra-flow-pane" />
        </div>
      </div>
    </PageFrame>
  );
}
