import type { LiveChannel } from "@islandflow/types";

const LEGACY_DERIVED_ROUTE_REPLACEMENTS: Record<string, string> = {
  "/flow/smart-money": "/flow/smart-flow",
  "/history/smart-money": "/history/smart-flow",
  "/replay/smart-money": "/replay/smart-flow",
  "/ws/smart-money": "/ws/smart-flow",
  "/flow/classifier-hits": "/flow/smart-flow",
  "/history/classifier-hits": "/history/smart-flow",
  "/replay/classifier-hits": "/replay/smart-flow",
  "/ws/classifier-hits": "/ws/smart-flow",
  "/flow/alerts": "/flow/smart-flow-alerts",
  "/history/alerts": "/history/smart-flow-alerts",
  "/replay/alerts": "/replay/smart-flow-alerts",
  "/ws/alerts": "/ws/smart-flow-alerts"
};

const LEGACY_DERIVED_LIVE_CHANNEL_REPLACEMENTS: Partial<Record<LiveChannel, LiveChannel>> = {
  "smart-money": "smart-flow",
  "classifier-hits": "smart-flow",
  alerts: "smart-flow-alerts"
};

export const getLegacyDerivedRouteReplacement = (pathname: string): string | null =>
  LEGACY_DERIVED_ROUTE_REPLACEMENTS[pathname] ?? null;

export const createLegacyDerivedRouteResponse = (pathname: string): Response | null => {
  const replacement = getLegacyDerivedRouteReplacement(pathname);
  if (!replacement) {
    return null;
  }
  return new Response(
    JSON.stringify({
      error: "legacy derived route deprecated",
      detail:
        "This transition-only legacy derived route is unavailable after the smart-flow consumer cutover. Use the canonical replacement path.",
      replacement
    }),
    {
      status: 410,
      headers: {
        "content-type": "application/json"
      }
    }
  );
};

export const getLegacyLiveSubscriptionReplacement = (channel: LiveChannel): LiveChannel | null =>
  LEGACY_DERIVED_LIVE_CHANNEL_REPLACEMENTS[channel] ?? null;
