import { describe, expect, it } from "bun:test";
import type { LiveChannel } from "@islandflow/types";
import {
  createLegacyDerivedRouteResponse,
  getLegacyDerivedRouteReplacement,
  getLegacyLiveSubscriptionReplacement
} from "../src/legacy-derived-routes";

describe("legacy derived route cutover helpers", () => {
  it("returns explicit deprecation responses for retired derived routes", async () => {
    const response = createLegacyDerivedRouteResponse("/history/classifier-hits");
    if (!response) {
      throw new Error("expected classifier-hits history route to return a deprecation response");
    }

    expect(response.status).toBe(410);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "legacy derived route deprecated",
      detail:
        "This transition-only legacy derived route is unavailable after the smart-flow consumer cutover. Use the canonical replacement path.",
      replacement: "/history/smart-flow"
    });
  });

  it("maps legacy derived routes and live channels to canonical replacements only", () => {
    expect(getLegacyDerivedRouteReplacement("/flow/smart-money")).toBe("/flow/smart-flow");
    expect(getLegacyDerivedRouteReplacement("/ws/alerts")).toBe("/ws/smart-flow-alerts");
    expect(getLegacyDerivedRouteReplacement("/flow/smart-flow")).toBeNull();

    expect(getLegacyLiveSubscriptionReplacement("smart-money")).toBe("smart-flow");
    expect(getLegacyLiveSubscriptionReplacement("classifier-hits")).toBe("smart-flow");
    expect(getLegacyLiveSubscriptionReplacement("alerts")).toBe("smart-flow-alerts");
    expect(getLegacyLiveSubscriptionReplacement("smart-flow" as LiveChannel)).toBeNull();
  });
});
