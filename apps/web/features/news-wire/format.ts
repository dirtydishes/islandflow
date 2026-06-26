import type { NewsStory } from "@islandflow/types";
import { formatEasternDateTime, formatEasternTime, isSameEasternDay } from "../time-format";

const NEWS_TEXT_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
};

export const formatNewsTimestamp = (ts: number, now = Date.now()): string => {
  return isSameEasternDay(ts, now)
    ? formatEasternTime(ts, { hour: "numeric", minute: "2-digit" })
    : formatEasternDateTime(ts, {
        month: "short",
        day: "numeric",
        minute: "2-digit",
        hour: "numeric",
        second: undefined,
        year: undefined
      });
};

export const formatNewsDateTime = (ts: number): string => formatEasternDateTime(ts);

export const decodeNewsText = (value: string): string =>
  value.replace(/&(#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
      const rawCodePoint = radix === 16 ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(rawCodePoint, radix);
      if (!Number.isFinite(codePoint)) {
        return match;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }

    return NEWS_TEXT_ENTITIES[entity.toLowerCase()] ?? match;
  });

export type NewsWireStatus = "updated" | "mapped" | "unmapped";

export const getNewsWireStatus = (story: NewsStory): NewsWireStatus => {
  if (story.updated_ts > story.published_ts) {
    return "updated";
  }
  return story.resolved_symbols.length > 0 ? "mapped" : "unmapped";
};

export const formatNewsSymbolsLabel = (story: NewsStory): string => {
  if (story.resolved_symbols.length === 0) {
    return story.symbol_resolution === "none" ? "unmapped" : "market";
  }
  const visible = story.resolved_symbols.slice(0, 4);
  const extra = story.resolved_symbols.length - visible.length;
  return extra > 0 ? `${visible.join(", ")} +${extra}` : visible.join(", ");
};

export const getNewsStoryKey = (story: NewsStory): string => {
  return story.trace_id || `${story.provider}:${story.story_id}:${story.updated_ts}:${story.seq}`;
};

export const getNewsStoryCursor = (story: NewsStory): { ts: number; seq: number } => ({
  ts: story.published_ts,
  seq: story.seq
});

export const formatNewsBodyText = (value: string): string =>
  decodeNewsText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
