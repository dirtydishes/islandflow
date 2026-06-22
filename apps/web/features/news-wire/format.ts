import type { NewsStory } from "@islandflow/types";

const NEWS_TEXT_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
};

const isSameLocalDay = (left: number, right: number): boolean => {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

export const formatNewsTimestamp = (ts: number, now = Date.now()): string => {
  const date = new Date(ts);
  return isSameLocalDay(ts, now)
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        minute: "2-digit",
        hour: "numeric"
      });
};

export const formatNewsDateTime = (ts: number): string => {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

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

export const sanitizeNewsHtml = (
  value: string
): { html: string; fallbackText: string; sanitized: boolean } => {
  const fallbackText = decodeNewsText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  try {
    const sanitized = value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\shref=(["'])javascript:[\s\S]*?\1/gi, ' href="#"')
      .replace(
        /<(?!\/?(p|div|section|article|span|strong|em|b|i|ul|ol|li|br|a|h1|h2|h3|h4|blockquote)\b)[^>]*>/gi,
        ""
      );
    return { html: sanitized, fallbackText, sanitized: true };
  } catch {
    return { html: "", fallbackText, sanitized: false };
  }
};
