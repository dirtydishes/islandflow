import type { LiveSubscription, OptionFlowFilters } from "@islandflow/types";
import { getSubscriptionKey as getLiveSubscriptionKey } from "@islandflow/types";
import { LIVE_HOT_WINDOW, LIVE_OPTIONS_HEAD_LIMIT } from "./config";
import type { EquityScope, OptionScope, RouteFeatures } from "./types";

const CANONICAL_OPTIONS_PATH = "/options";
const TAPE_COMPAT_PATH = "/tape";
const KNOWN_TERMINAL_PATHS = new Set([CANONICAL_OPTIONS_PATH, TAPE_COMPAT_PATH, "/news"]);

export const normalizeTerminalPathname = (pathname: string): string => {
  if (pathname === TAPE_COMPAT_PATH) {
    return CANONICAL_OPTIONS_PATH;
  }
  return KNOWN_TERMINAL_PATHS.has(pathname) ? pathname : "/";
};

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
        smartMoney: false,
        classifierHits: false,
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
        needsClassifierDecor: true,
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
        smartMoney: false,
        classifierHits: false,
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
        needsClassifierDecor: false,
        needsAlertEvidencePrefetch: false,
        needsDarkUnderlying: false
      };
    case "/":
    default:
      return {
        options: true,
        nbbo: false,
        equities: true,
        flow: true,
        news: true,
        alerts: true,
        smartMoney: true,
        classifierHits: false,
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
        needsClassifierDecor: true,
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
    (subscription.channel === "options" || subscription.channel === "equities") &&
    subscription.underlying_ids?.length
  ) {
    params.set("underlying_ids", subscription.underlying_ids.join(","));
  }
  if (subscription.channel === "options" && subscription.option_contract_id) {
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
    subscriptions.push({ channel: "alerts", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.smartMoney) {
    subscriptions.push({ channel: "smart-flow", snapshot_limit: LIVE_HOT_WINDOW });
    subscriptions.push({ channel: "smart-money", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.classifierHits) {
    subscriptions.push({ channel: "classifier-hits", snapshot_limit: LIVE_HOT_WINDOW });
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
      interval_ms: chartIntervalMs
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
