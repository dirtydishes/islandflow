import type { NewsStory } from "@islandflow/types";

import type { DurableTapeColumnDefinition, DurableTapeTemplate } from "../durable-tape";

export type NewsWireColumnId = "time" | "source" | "symbols" | "headline";

export const NEWS_WIRE_COLUMNS: DurableTapeColumnDefinition<NewsStory, NewsWireColumnId>[] = [
  { id: "time", label: "Time", minWidth: 84, className: "news-wire-time-cell" },
  { id: "source", label: "Source", minWidth: 100, className: "news-wire-source-cell" },
  { id: "symbols", label: "Symbols", minWidth: 124, className: "news-wire-symbols-cell" },
  { id: "headline", label: "Headline", minWidth: 260, className: "news-wire-headline-cell" }
];

export const NEWS_WIRE_TEMPLATES: DurableTapeTemplate<NewsWireColumnId>[] = [
  { id: "full", columns: ["time", "source", "symbols", "headline"] },
  { id: "twoThirds", columns: ["time", "symbols", "headline"] },
  { id: "oneThird", columns: ["time", "headline"] },
  { id: "micro", columns: ["headline"] }
];
