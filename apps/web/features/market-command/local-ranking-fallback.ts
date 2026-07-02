import type {
  EquityPrint,
  FlowPacket,
  MarketCommandTickerRailItem,
  MarketCommandTickerRailResponse,
  MarketCommandTickerReason,
  NewsStory,
  OptionPrint,
  SmartFlowAlertEvent,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import {
  MARKET_COMMAND_TICKER_RAIL_SCHEMA_VERSION,
  MARKET_COMMAND_TICKER_RAIL_TIMEZONE,
  MarketCommandTickerRailResponseSchema,
  parseOptionContractId
} from "@islandflow/types";

export const DEFAULT_MARKET_COMMAND_WATCHLIST = [
  "SPY",
  "QQQ",
  "NVDA",
  "TSLA",
  "AAPL",
  "MSFT",
  "META",
  "AMZN"
] as const;

export const MARKET_COMMAND_TICKER_RAIL_LIMIT = 16;

const TOP_REASON_COUNT = 3;
const MAX_WATCHLIST_SYMBOLS = 32;
const HALF_LIFE_MS = 45 * 60 * 1000;

const LOCAL_RANKING_WEIGHTS = {
  smartFlowAlert: 50,
  smartFlowProjection: 35,
  flowPacket: 22,
  optionPremium: 18,
  optionPrintCount: 8,
  equityMove: 12,
  news: 10,
  watchlistBoost: 4
} as const;

export type MarketCommandLocalRankingInput = {
  watchlist?: readonly string[];
  limit?: number;
  nowTs?: number;
  optionPrints?: readonly OptionPrint[];
  equityPrints?: readonly EquityPrint[];
  flowPackets?: readonly FlowPacket[];
  alerts?: readonly SmartFlowAlertEvent[];
  smartFlowProjections?: readonly SmartFlowExplainabilityProjection[];
  newsStories?: readonly NewsStory[];
};

type TickerAccumulator = {
  symbol: string;
  score: number;
  price: number | null;
  change: number | null;
  changePct: number | null;
  lastTs: number | null;
  reasons: MarketCommandTickerReason[];
};

type EventReasonInput = {
  kind: MarketCommandTickerReason["kind"];
  label: string;
  weight: number;
  multiplier?: number;
  ts: number | null;
  sourceId?: string | null;
};

const normalizeSymbol = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase();
  return /^[A-Z][A-Z0-9.-]*$/.test(normalized) ? normalized.slice(0, 16) : null;
};

export const normalizeMarketCommandWatchlist = (
  watchlist: readonly string[] = DEFAULT_MARKET_COMMAND_WATCHLIST
): string[] => {
  const symbols: string[] = [];
  const seen = new Set<string>();
  for (const item of watchlist) {
    const symbol = normalizeSymbol(item);
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length >= MAX_WATCHLIST_SYMBOLS) {
      break;
    }
  }
  return symbols.length > 0 ? symbols : [...DEFAULT_MARKET_COMMAND_WATCHLIST];
};

const clampLimit = (limit: number | undefined): number => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return MARKET_COMMAND_TICKER_RAIL_LIMIT;
  }
  return Math.max(1, Math.min(32, Math.floor(limit)));
};

const roundScore = (value: number): number => Number(value.toFixed(4));
const roundPrice = (value: number): number => Number(value.toFixed(4));

const recencyMultiplier = (ts: number | null, nowTs: number): number => {
  if (ts === null) {
    return 0.5;
  }
  const ageMs = Math.max(0, nowTs - ts);
  return Math.max(0.25, Math.pow(0.5, ageMs / HALF_LIFE_MS));
};

const extractContractUnderlying = (contractId: string | null | undefined): string | null => {
  const contract = String(contractId ?? "").trim();
  if (!contract) {
    return null;
  }
  const parsed = parseOptionContractId(contract);
  if (parsed?.root) {
    return normalizeSymbol(parsed.root);
  }
  const match = contract.match(/^(.+)-\d{4}-\d{2}-\d{2}-/);
  return normalizeSymbol(match?.[1] ?? contract.split("-")[0]);
};

const getAccumulator = (items: Map<string, TickerAccumulator>, symbol: string) => {
  const current = items.get(symbol);
  if (current) {
    return current;
  }
  const next: TickerAccumulator = {
    symbol,
    score: 0,
    price: null,
    change: null,
    changePct: null,
    lastTs: null,
    reasons: []
  };
  items.set(symbol, next);
  return next;
};

const eventReason = ({
  kind,
  label,
  weight,
  multiplier = 1,
  ts,
  sourceId
}: EventReasonInput): MarketCommandTickerReason => ({
  kind,
  label,
  score: roundScore(weight * multiplier),
  weight,
  ts,
  ...(sourceId ? { source_id: sourceId } : {})
});

const addReason = (
  items: Map<string, TickerAccumulator>,
  symbol: string | null,
  reason: MarketCommandTickerReason
): void => {
  if (!symbol || reason.score <= 0) {
    return;
  }
  const accumulator = getAccumulator(items, symbol);
  accumulator.score += reason.score;
  accumulator.reasons.push(reason);
  if (reason.ts !== null) {
    accumulator.lastTs = Math.max(accumulator.lastTs ?? 0, reason.ts);
  }
};

const scoreAlerts = (
  items: Map<string, TickerAccumulator>,
  alerts: readonly SmartFlowAlertEvent[],
  nowTs: number
): void => {
  for (const alert of alerts) {
    const symbol = normalizeSymbol(alert.underlying_id);
    const multiplier =
      recencyMultiplier(alert.source_ts, nowTs) *
      Math.max(0.5, alert.policy_confidence) *
      Math.max(0.5, alert.evidence_quality);
    addReason(
      items,
      symbol,
      eventReason({
        kind: "smart_flow_alert",
        label: "Smart-flow alert",
        weight: LOCAL_RANKING_WEIGHTS.smartFlowAlert,
        multiplier,
        ts: alert.source_ts,
        sourceId: alert.alert_id
      })
    );
  }
};

const scoreSmartFlowProjections = (
  items: Map<string, TickerAccumulator>,
  projections: readonly SmartFlowExplainabilityProjection[],
  nowTs: number
): void => {
  for (const projection of projections) {
    if (projection.abstention.abstained) {
      continue;
    }
    const symbol = normalizeSymbol(projection.hypothesis.underlying_id);
    const confidence = projection.hypothesis.scores.confidence;
    const multiplier =
      recencyMultiplier(projection.source_ts, nowTs) *
      Math.max(0.45, confidence.policy_confidence) *
      Math.max(0.45, confidence.evidence_quality);
    addReason(
      items,
      symbol,
      eventReason({
        kind: "smart_flow_projection",
        label: "Smart-flow projection",
        weight: LOCAL_RANKING_WEIGHTS.smartFlowProjection,
        multiplier,
        ts: projection.source_ts,
        sourceId: projection.refs.hypothesis_id
      })
    );
  }
};

const scoreFlowPackets = (
  items: Map<string, TickerAccumulator>,
  packets: readonly FlowPacket[],
  nowTs: number
): void => {
  for (const packet of packets) {
    const symbol = extractContractUnderlying(String(packet.features.option_contract_id ?? ""));
    addReason(
      items,
      symbol,
      eventReason({
        kind: "flow_packet",
        label: "Flow packet",
        weight: LOCAL_RANKING_WEIGHTS.flowPacket,
        multiplier: recencyMultiplier(packet.source_ts, nowTs),
        ts: packet.source_ts,
        sourceId: packet.id
      })
    );
  }
};

const scoreOptionPrints = (
  items: Map<string, TickerAccumulator>,
  prints: readonly OptionPrint[],
  nowTs: number
): void => {
  const bySymbol = new Map<
    string,
    { count: number; premium: number; latestTs: number | null; sourceId: string | null }
  >();
  for (const print of prints) {
    if (print.signal_pass === false) {
      continue;
    }
    const symbol =
      normalizeSymbol(print.underlying_id) ?? extractContractUnderlying(print.option_contract_id);
    if (!symbol) {
      continue;
    }
    const bucket = bySymbol.get(symbol) ?? {
      count: 0,
      premium: 0,
      latestTs: null,
      sourceId: null
    };
    bucket.count += 1;
    bucket.premium += print.notional ?? print.price * print.size * 100;
    if (bucket.latestTs === null || print.source_ts > bucket.latestTs) {
      bucket.latestTs = print.source_ts;
      bucket.sourceId = print.trace_id;
    }
    bySymbol.set(symbol, bucket);
  }

  for (const [symbol, bucket] of bySymbol) {
    const premiumMultiplier = Math.min(3, Math.max(0.5, Math.log10(bucket.premium + 10) / 5));
    addReason(
      items,
      symbol,
      eventReason({
        kind: "option_premium",
        label: `Options premium ${formatCompactPremium(bucket.premium)}`,
        weight: LOCAL_RANKING_WEIGHTS.optionPremium,
        multiplier: premiumMultiplier * recencyMultiplier(bucket.latestTs, nowTs),
        ts: bucket.latestTs,
        sourceId: bucket.sourceId
      })
    );
    addReason(
      items,
      symbol,
      eventReason({
        kind: "option_print_count",
        label: `${bucket.count} option ${bucket.count === 1 ? "print" : "prints"}`,
        weight: LOCAL_RANKING_WEIGHTS.optionPrintCount,
        multiplier: Math.min(2, 1 + Math.log2(bucket.count) / 4),
        ts: bucket.latestTs,
        sourceId: bucket.sourceId
      })
    );
  }
};

const scoreEquityMoves = (
  items: Map<string, TickerAccumulator>,
  prints: readonly EquityPrint[],
  nowTs: number
): void => {
  const bySymbol = new Map<string, EquityPrint[]>();
  for (const print of prints) {
    const symbol = normalizeSymbol(print.underlying_id);
    if (!symbol) {
      continue;
    }
    const bucket = bySymbol.get(symbol) ?? [];
    bucket.push(print);
    bySymbol.set(symbol, bucket);
  }

  for (const [symbol, bucket] of bySymbol) {
    const sorted = [...bucket].sort((left, right) => left.source_ts - right.source_ts);
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    if (!latest) {
      continue;
    }
    const accumulator = getAccumulator(items, symbol);
    accumulator.price = roundPrice(latest.price);
    accumulator.lastTs = Math.max(accumulator.lastTs ?? 0, latest.source_ts);
    if (!first || first.price <= 0 || latest.trace_id === first.trace_id) {
      continue;
    }
    const change = latest.price - first.price;
    const changePct = (change / first.price) * 100;
    accumulator.change = roundPrice(change);
    accumulator.changePct = roundScore(changePct);
    addReason(
      items,
      symbol,
      eventReason({
        kind: "equity_move",
        label: `Equity move ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`,
        weight: LOCAL_RANKING_WEIGHTS.equityMove,
        multiplier:
          Math.min(2, Math.max(0.25, Math.abs(changePct))) *
          recencyMultiplier(latest.source_ts, nowTs),
        ts: latest.source_ts,
        sourceId: latest.trace_id
      })
    );
  }
};

const scoreNews = (
  items: Map<string, TickerAccumulator>,
  stories: readonly NewsStory[],
  nowTs: number
): void => {
  const bySymbol = new Map<
    string,
    { count: number; latestTs: number | null; storyId: string | null }
  >();
  for (const story of stories) {
    const symbols = new Set(
      story.resolved_symbols
        .map(normalizeSymbol)
        .filter((symbol): symbol is string => Boolean(symbol))
    );
    for (const symbol of symbols) {
      const bucket = bySymbol.get(symbol) ?? { count: 0, latestTs: null, storyId: null };
      bucket.count += 1;
      if (bucket.latestTs === null || story.published_ts > bucket.latestTs) {
        bucket.latestTs = story.published_ts;
        bucket.storyId = String(story.story_id);
      }
      bySymbol.set(symbol, bucket);
    }
  }

  for (const [symbol, bucket] of bySymbol) {
    addReason(
      items,
      symbol,
      eventReason({
        kind: "news",
        label: `${bucket.count} news ${bucket.count === 1 ? "story" : "stories"}`,
        weight: LOCAL_RANKING_WEIGHTS.news,
        multiplier:
          Math.min(2, 1 + Math.log2(bucket.count) / 4) * recencyMultiplier(bucket.latestTs, nowTs),
        ts: bucket.latestTs,
        sourceId: bucket.storyId
      })
    );
  }
};

const itemFromAccumulator = (
  accumulator: TickerAccumulator,
  source: MarketCommandTickerRailItem["source"],
  rank: number
): MarketCommandTickerRailItem => ({
  symbol: accumulator.symbol,
  source,
  rank,
  score: roundScore(accumulator.score),
  price: accumulator.price,
  change: accumulator.change,
  change_pct: accumulator.changePct,
  last_ts: accumulator.lastTs,
  reasons: [...accumulator.reasons]
    .sort((left, right) => right.score - left.score)
    .slice(0, TOP_REASON_COUNT)
});

const formatCompactPremium = (value: number): string => {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
};

export const buildLocalMarketCommandTickerRail = ({
  watchlist,
  limit,
  nowTs = Date.now(),
  optionPrints = [],
  equityPrints = [],
  flowPackets = [],
  alerts = [],
  smartFlowProjections = [],
  newsStories = []
}: MarketCommandLocalRankingInput = {}): MarketCommandTickerRailResponse => {
  const items = new Map<string, TickerAccumulator>();
  const pinnedSymbols = normalizeMarketCommandWatchlist(watchlist);
  const cappedLimit = clampLimit(limit);

  scoreAlerts(items, alerts, nowTs);
  scoreSmartFlowProjections(items, smartFlowProjections, nowTs);
  scoreFlowPackets(items, flowPackets, nowTs);
  scoreOptionPrints(items, optionPrints, nowTs);
  scoreEquityMoves(items, equityPrints, nowTs);
  scoreNews(items, newsStories, nowTs);

  const pinnedSet = new Set(pinnedSymbols);
  const pinned = pinnedSymbols.map((symbol, index) => {
    const accumulator = getAccumulator(items, symbol);
    accumulator.score += LOCAL_RANKING_WEIGHTS.watchlistBoost;
    accumulator.reasons.push({
      kind: "watchlist_boost",
      label: "Pinned watchlist symbol",
      score: LOCAL_RANKING_WEIGHTS.watchlistBoost,
      weight: LOCAL_RANKING_WEIGHTS.watchlistBoost,
      ts: null
    });
    const evidenceReasonCount = accumulator.reasons.filter(
      (reason) => reason.kind !== "watchlist_boost"
    ).length;
    return itemFromAccumulator(accumulator, evidenceReasonCount > 0 ? "both" : "pinned", index + 1);
  });

  const important = [...items.values()]
    .filter((item) => !pinnedSet.has(item.symbol) && item.score > 0)
    .sort((left, right) =>
      right.score === left.score
        ? left.symbol.localeCompare(right.symbol)
        : right.score - left.score
    )
    .slice(0, cappedLimit)
    .map((item, index) => itemFromAccumulator(item, "important", index + 1));

  return MarketCommandTickerRailResponseSchema.parse({
    schema_version: MARKET_COMMAND_TICKER_RAIL_SCHEMA_VERSION,
    generated_at_ts: Math.max(0, Math.floor(nowTs)),
    session: {
      timezone: MARKET_COMMAND_TICKER_RAIL_TIMEZONE,
      selection: "current",
      start_ts: 0,
      end_ts: Math.max(0, Math.floor(nowTs))
    },
    watchlist: pinnedSymbols,
    limit: cappedLimit,
    degraded: true,
    degraded_reasons: ["local_fallback"],
    pinned,
    important
  });
};
