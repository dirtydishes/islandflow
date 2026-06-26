import type { TerminalState } from "./state";
import { EMPTY_FLOW_PACKET_MAP, EMPTY_OPTION_PRINT_MAP } from "./state";

export const selectDurableTapesOptionsPane = (state: TerminalState) => ({
  filters: state.flowFilters,
  flowPacketById: state.flowPacketMap,
  focusedContractId:
    state.selectedInstrument?.kind === "option-contract"
      ? state.selectedInstrument.contractId
      : null,
  nbboByContractId: state.nbboMap,
  onClearFocus: state.clearSelectedInstrument,
  onContractFocus: state.focusOptionContract,
  onFiltersChange: state.setFlowFilters,
  onPacketFocus: state.focusFlowPacketRequest,
  packetIdByOptionTraceId: state.packetIdByOptionTraceId,
  prints: state.filteredOptions,
  rowViewModels: state.filteredDurableOptionRows,
  rowViewModelStatus: state.durableRows.status,
  smartFlowProjections: state.filteredSmartFlowProjections,
  useRowViewModels: true
});

export const selectDurableTapesFlowPane = (state: TerminalState) => ({
  filters: state.flowFilters,
  onPacketFocus: state.focusFlowPacketRequest,
  packets: state.filteredFlow
});

export const selectDurableTapesEquitiesPane = (state: TerminalState) => ({
  onTickerFocus: state.focusEquityTicker,
  prints: state.filteredEquities
});

export const selectDurableTapesAlertsPane = (state: TerminalState) => {
  const selectedAlert = state.selectedAlert;
  return {
    alerts: state.filteredAlerts,
    flowPacketById: selectedAlert ? state.flowPacketMap : EMPTY_FLOW_PACKET_MAP,
    onCloseDetail: state.clearSelectedAlert,
    onContractFocus: state.focusAlertContract,
    onEquityFocus: state.focusAlertEquity,
    onPacketFocus: state.focusFlowPacketRequest,
    onSelectAlert: state.setSelectedAlert,
    optionPrintByTraceId: selectedAlert ? state.optionPrintMap : EMPTY_OPTION_PRINT_MAP,
    rowViewModels: state.filteredDurableAlertRows,
    rowViewModelStatus: state.durableRows.status,
    selectedAlert,
    useRowViewModels: true
  };
};

export const selectDurableTapesNewsPane = (state: TerminalState) => ({
  activeTickers: state.activeTickers,
  lastUpdate: state.news.lastUpdate,
  liveEnabled: state.mode === "live",
  status: state.news.status,
  stories: state.filteredNews
});
