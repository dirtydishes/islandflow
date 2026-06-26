import { describe, expect, it } from "bun:test";
import {
  formatEasternDateTime,
  formatEasternTime,
  formatEasternTimestampWithMs,
  isSameEasternDay
} from "./time-format";

const normalizeSpaces = (value: string): string => value.replace(/\s+/g, " ");

describe("Eastern time formatting", () => {
  it("renders UTC market timestamps in America/New_York time", () => {
    const ts = Date.UTC(2026, 5, 26, 14, 30, 15);

    expect(normalizeSpaces(formatEasternTime(ts, { hour: "2-digit", minute: "2-digit" }))).toBe(
      "10:30 AM"
    );
    expect(
      normalizeSpaces(
        formatEasternTime(ts, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short"
        })
      )
    ).toBe("10:30:15 AM EDT");
  });

  it("uses Eastern calendar days for same-day decisions", () => {
    const lateEveningEastern = Date.UTC(2026, 5, 27, 3, 30);
    const morningEastern = Date.UTC(2026, 5, 26, 14, 30);
    const nextMorningEastern = Date.UTC(2026, 5, 27, 14, 30);

    expect(isSameEasternDay(lateEveningEastern, morningEastern)).toBe(true);
    expect(isSameEasternDay(nextMorningEastern, morningEastern)).toBe(false);
  });

  it("keeps timestamp details in Eastern time with millisecond precision", () => {
    const ts = Date.UTC(2026, 5, 26, 14, 30, 15, 42);

    expect(
      normalizeSpaces(
        formatEasternDateTime(ts, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: undefined,
          year: undefined
        })
      )
    ).toBe("Jun 26, 10:30 AM");
    expect(
      normalizeSpaces(
        formatEasternTimestampWithMs(ts, {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      )
    ).toBe("6/26/2026 10:30:15.042");
  });
});
