import type { LiveSubscription, OptionFlowFilters } from "@islandflow/types";
import { getSubscriptionKey as getLiveSubscriptionKey } from "@islandflow/types";
import { normalizeTimeframeIntervalMs } from "../market-chart";
import { LIVE_HOT_WINDOW, LIVE_OPTIONS_HEAD_LIMIT, SUPPORTED_CANDLE_INTERVAL_MS } from "./config";
import type { EquityScope, OptionScope, RouteFeatures } from "./types";

const CANONICAL_OPTIONS_PATH = "/options";
const DURABLE_TAPES_PATH = "/durable-tapes";
const KNOWN_TERMINAL_PATHS = new Set([CANONICAL_OPTIONS_PATH, "/news", DURABLE_TAPES_PATH]);

export const normalizeTerminalPathname = (pathname: string): string => {
  return KNOWN_TERMINAL_PATHS.has(pathname) ? pathname : "/";
};

export const buildDurableTapesRouteFeatures = (): RouteFeatures => ({
  options: false,
  nbbo: false,
  equities: true,
  flow: true,
  news: true,
  alerts: true,
  durableRows: true,
  smartFlow: false,
  inferredDark: false,
  equityJoins: false,
  equityCandles: false,
  equityOverlay: false,
  showOptionsPane: true,
  showEquitiesPane: true,
  showFlowPane: true,
  showNewsPane: true,
  showAlertsPane: true,
  showDarkPane: false,
  showChartPane: false,
  needsSmartFlowDecor: false,
  needsAlertEvidencePrefetch: false,
  needsDarkUnderlying: false
});

export const getRouteFeatures = (pathname: string): RouteFeatures => {
  const normalizedPath = normalizeTerminalPathname(pathname);

  switch (normalizedPath) {
    case "/options":
      return {
        options: true,
        nbbo: true,
        equities: false,
        flow: true,
        news: false,
        alerts: false,
        durableRows: false,
        smartFlow: true,
        inferredDark: false,
        equityJoins: false,
        equityCandles: false,
        equityOverlay: false,
        showOptionsPane: true,
        showEquitiesPane: false,
        showFlowPane: true,
        showNewsPane: false,
        showAlertsPane: false,
        showDarkPane: false,
        showChartPane: false,
        needsSmartFlowDecor: true,
        needsAlertEvidencePrefetch: false,
        needsDarkUnderlying: false
      };
    case "/news":
      return {
        options: false,
        nbbo: false,
        equities: false,
        flow: false,
        news: true,
        alerts: false,
        durableRows: false,
        smartFlow: false,
        inferredDark: false,
        equityJoins: false,
        equityCandles: false,
        equityOverlay: false,
        showOptionsPane: false,
        showEquitiesPane: false,
        showFlowPane: false,
        showNewsPane: true,
        showAlertsPane: false,
        showDarkPane: false,
        showChartPane: false,
        needsSmartFlowDecor: false,
        needsAlertEvidencePrefetch: false,
        needsDarkUnderlying: false
      };
    case DURABLE_TAPES_PATH:
      return buildDurableTapesRouteFeatures();
    case "/":
    default:
      return {
        options: true,
        nbbo: false,
        equities: true,
        flow: true,
        news: true,
        alerts: true,
        durableRows: false,
        smartFlow: true,
        inferredDark: true,
        equityJoins: true,
        equityCandles: true,
        equityOverlay: true,
        showOptionsPane: true,
        showEquitiesPane: true,
        showFlowPane: true,
        showNewsPane: true,
        showAlertsPane: true,
        showDarkPane: true,
        showChartPane: true,
        needsSmartFlowDecor: true,
        needsAlertEvidencePrefetch: true,
        needsDarkUnderlying: true
      };
  }
};

export const getTerminalNavCurrentHref = (pathname: string): string => {
  return normalizeTerminalPathname(pathname);
};

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/options", label: "Options" },
  { href: "/news", label: "News" }
] as const;

export const appendLiveScopeParams = (
  params: URLSearchParams,
  subscription: LiveSubscription
): void => {
  if (
    (subscription.channel === "options" ||
      subscription.channel === "equities" ||
      subscription.channel === "durable-rows") &&
    subscription.underlying_ids?.length
  ) {
    params.set("underlying_ids", subscription.underlying_ids.join(","));
  }
  if (
    (subscription.channel === "options" || subscription.channel === "durable-rows") &&
    subscription.option_contract_id
  ) {
    params.set("option_contract_id", subscription.option_contract_id);
  }
};

export const dedupeLiveSubscriptions = (subscriptions: LiveSubscription[]): LiveSubscription[] => {
  const seen = new Set<string>();
  return subscriptions.filter((subscription) => {
    const key = getLiveSubscriptionKey(subscription);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const getLiveManifest = (
  pathname: string,
  chartTicker: string,
  chartIntervalMs: number,
  flowFilters: OptionFlowFilters,
  optionScope?: OptionScope,
  equityScope?: EquityScope,
  optionPrintFilters?: OptionFlowFilters
): LiveSubscription[] => {
  const features = getRouteFeatures(pathname);
  const subscriptions: LiveSubscription[] = [];

  if (features.options) {
    subscriptions.push({
      channel: "options",
      filters:
        optionScope?.option_contract_id && optionPrintFilters === undefined
          ? undefined
          : (optionPrintFilters ?? flowFilters),
      ...optionScope,
      snapshot_limit: LIVE_OPTIONS_HEAD_LIMIT
    });
  }
  if (features.durableRows) {
    subscriptions.push({
      channel: "durable-rows",
      lanes: ["options", "alerts"],
      filters: optionPrintFilters ?? flowFilters,
      ...optionScope,
      snapshot_limit: LIVE_OPTIONS_HEAD_LIMIT
    });
  }
  if (features.nbbo) {
    subscriptions.push({ channel: "nbbo", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.equities) {
    subscriptions.push({ channel: "equities", ...equityScope, snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.flow) {
    subscriptions.push({ channel: "flow", filters: flowFilters, snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.news) {
    subscriptions.push({ channel: "news", snapshot_limit: LIVE_OPTIONS_HEAD_LIMIT });
  }
  if (features.alerts) {
    subscriptions.push({ channel: "smart-flow-alerts", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.smartFlow) {
    subscriptions.push({ channel: "smart-flow", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.inferredDark) {
    subscriptions.push({ channel: "inferred-dark", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.equityJoins) {
    subscriptions.push({ channel: "equity-joins", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.equityCandles) {
    subscriptions.push({
      channel: "equity-candles",
      underlying_id: chartTicker,
      interval_ms: normalizeTimeframeIntervalMs(chartIntervalMs, SUPPORTED_CANDLE_INTERVAL_MS)
    });
  }
  if (features.equityOverlay) {
    subscriptions.push({
      channel: "equity-overlay",
      underlying_id: chartTicker
    });
  }

  return dedupeLiveSubscriptions(subscriptions);
};
