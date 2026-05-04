import { describe, expect, it } from "bun:test";
import { createStaticEventCalendarProvider, parseEventCalendarEntries } from "../src/event-calendar";

describe("event calendar refdata", () => {
  it("parses provider rows and filters by timestamp availability", () => {
    const entries = parseEventCalendarEntries([
      {
        symbol: "aapl",
        event_date: "2025-01-31T21:00:00Z",
        event_kind: "earnings",
        announced_ts: "2025-01-20T21:00:00Z",
        source: "fixture"
      },
      {
        symbol: "AAPL",
        event_date: "2025-02-28T21:00:00Z",
        type: "mystery",
        announced_ts: "2025-02-01T21:00:00Z"
      }
    ]);

    const provider = createStaticEventCalendarProvider(entries);
    const beforeAnnouncement = provider.findNextEvent("AAPL", Date.parse("2025-01-15T15:00:00Z"));
    const afterAnnouncement = provider.findNextEvent("aapl", Date.parse("2025-01-21T15:00:00Z"));

    expect(beforeAnnouncement).toBeNull();
    expect(afterAnnouncement?.event_kind).toBe("earnings");
    expect(afterAnnouncement?.underlying_id).toBe("AAPL");
    expect(afterAnnouncement?.days_to_event).toBeGreaterThan(0);
  });
});
