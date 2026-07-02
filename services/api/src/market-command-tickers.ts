import {
  type EquityPrint,
  type FlowPacket,
  isNativeNonAbstainedSmartFlowProjection,
  MARKET_COMMAND_TICKER_RAIL_SCHEMA_VERSION,
  MARKET_COMMAND_TICKER_RAIL_TIMEZONE,
  type MarketCommandTickerRailItem,
  type MarketCommandTickerRailResponse,
  MarketCommandTickerRailResponseSchema,
  type MarketCommandTickerRailSession,
  type MarketCommandTickerReason,
  type MarketCommandTickerReasonKind,
  MarketCommandTickerSymbolSchema,
  type NewsStory,
  type OptionPrint,
  parseOptionContractId,
  type SmartFlowAlertEvent,
  type SmartFlowExplainabilityProjection
} from "@islandflow/types";

const DEFAULT_WATCHLIST = ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "MSFT", "META", "AMZN"];
const MAX_WATCHLIST_SYMBOLS = 32;
const DEFAULT_LIMIT = 16;
const MAX_LIMIT = 32;
const TOP_REASON_COUNT = 3;
const HALF_LIFE_MS = 45 * 60 * 1000;
const CURRENT_SESSION_DECAY_FLOOR = 0.2;
const REGULAR_SESSION_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_SESSION_CLOSE_MINUTES = 16 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MARKET_COMMAND_RANKING_WEIGHTS = {
  smartFlowAlert: 50,
  smartFlowProjection: 35,
  flowPacket: 22,
  optionPremium: 18,
  optionPrintCount: 8,
  equityMove: 12,
  news: 10,
  watchlistBoost: 4
} as const;

export type MarketCommandTickerRailParams = {
  watchlist: string[];
  limit: number;
};

export type MarketCommandTickerRailData = {
  alerts?: readonly SmartFlowAlertEvent[];
  smartFlowProjections?: readonly SmartFlowExplainabilityProjection[];
  flowPackets?: readonly FlowPacket[];
  optionPrints?: readonly OptionPrint[];
  equityPrints?: readonly EquityPrint[];
  news?: readonly NewsStory[];
};

export type BuildMarketCommandTickerRailInput = {
  params: MarketCommandTickerRailParams;
  session: MarketCommandTickerRailSession;
  nowTs: number;
  data: MarketCommandTickerRailData;
  degradedReasons?: readonly string[];
};

type NewYorkDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

type TickerAccumulator = {
  symbol: string;
  score: number;
  reasons: MarketCommandTickerReason[];
  price: number | null;
  change: number | null;
  changePct: number | null;
  lastTs: number | null;
};

export class MarketCommandTickerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketCommandTickerValidationError";
  }
}

const parsePositiveInteger = (value: string, field: string): number => {
  if (!/^\d+$/.test(value.trim())) {
    throw new MarketCommandTickerValidationError(`${field} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MarketCommandTickerValidationError(`${field} must be a positive integer`);
  }

  return parsed;
};

export const normalizeMarketCommandTickerSymbol = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  const parsed = MarketCommandTickerSymbolSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new MarketCommandTickerValidationError(`invalid ticker symbol: ${value}`);
  }
  return parsed.data;
};

export const parseMarketCommandTickerRailParams = (url: URL): MarketCommandTickerRailParams => {
  const rawWatchlist = url.searchParams
    .getAll("watchlist")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const normalizedWatchlist = rawWatchlist.length > 0 ? rawWatchlist : DEFAULT_WATCHLIST;
  const watchlist: string[] = [];
  const seen = new Set<string>();

  for (const raw of normalizedWatchlist) {
    const symbol = normalizeMarketCommandTickerSymbol(raw);
    if (!seen.has(symbol)) {
      seen.add(symbol);
      watchlist.push(symbol);
    }
    if (watchlist.length >= MAX_WATCHLIST_SYMBOLS) {
      break;
    }
  }

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam
    ? Math.min(parsePositiveInteger(limitParam, "limit"), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return { watchlist, limit };
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_COMMAND_TICKER_RAIL_TIMEZONE,
  hourCycle: "h23",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

const getNewYorkParts = (ts: number): NewYorkDateParts => {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(ts)).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: String(parts.weekday)
  };
};

const timeZoneOffsetMs = (ts: number): number => {
  const parts = getNewYorkParts(ts);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - ts;
};

const newYorkLocalTimestamp = (
  year: number,
  month: number,
  day: number,
  minutesAfterMidnight: number
): number => {
  const hour = Math.floor(minutesAfterMidnight / 60);
  const minute = minutesAfterMidnight % 60;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = localAsUtc - timeZoneOffsetMs(localAsUtc);
  return localAsUtc - timeZoneOffsetMs(firstPass);
};

const addLocalDays = (
  date: Pick<NewYorkDateParts, "year" | "month" | "day">,
  days: number
): Pick<NewYorkDateParts, "year" | "month" | "day"> => {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
};

const isRegularWeekday = (weekday: string): boolean => weekday !== "Sat" && weekday !== "Sun";

const previousRegularWeekday = (
  date: Pick<NewYorkDateParts, "year" | "month" | "day">
): Pick<NewYorkDateParts, "year" | "month" | "day"> => {
  let candidate = addLocalDays(date, -1);
  for (let attempts = 0; attempts < 7; attempts += 1) {
    const openTs = newYorkLocalTimestamp(
      candidate.year,
      candidate.month,
      candidate.day,
      REGULAR_SESSION_OPEN_MINUTES
    );
    if (isRegularWeekday(getNewYorkParts(openTs).weekday)) {
      return candidate;
    }
    candidate = addLocalDays(candidate, -1);
  }
  return candidate;
};

export const resolveMarketCommandRegularSession = (
  nowTs: number
): MarketCommandTickerRailSession => {
  const now = getNewYorkParts(nowTs);
  const todayOpen = newYorkLocalTimestamp(
    now.year,
    now.month,
    now.day,
    REGULAR_SESSION_OPEN_MINUTES
  );
  const todayClose = newYorkLocalTimestamp(
    now.year,
    now.month,
    now.day,
    REGULAR_SESSION_CLOSE_MINUTES
  );

  if (isRegularWeekday(now.weekday) && nowTs >= todayOpen) {
    return {
      timezone: MARKET_COMMAND_TICKER_RAIL_TIMEZONE,
      selection: "current",
      start_ts: todayOpen,
      end_ts: Math.min(nowTs, todayClose)
    };
  }

  const previous = previousRegularWeekday(now);
  return {
    timezone: MARKET_COMMAND_TICKER_RAIL_TIMEZONE,
    selection: "previous_regular",
    start_ts: newYorkLocalTimestamp(
      previous.year,
      previous.month,
      previous.day,
      REGULAR_SESSION_OPEN_MINUTES
    ),
    end_ts: newYorkLocalTimestamp(
      previous.year,
      previous.month,
      previous.day,
      REGULAR_SESSION_CLOSE_MINUTES
    )
  };
};

const sessionContains = (session: MarketCommandTickerRailSession, ts: number | null): boolean =>
  typeof ts === "number" && ts >= session.start_ts && ts <= session.end_ts;

const itemTs = (item: { source_ts?: number; ts?: number; published_ts?: number }): number | null =>
  typeof item.source_ts === "number"
    ? item.source_ts
    : typeof item.ts === "number"
      ? item.ts
      : typeof item.published_ts === "number"
        ? item.published_ts
        : null;

const getAccumulator = (
  items: Map<string, TickerAccumulator>,
  symbol: string
): TickerAccumulator => {
  let item = items.get(symbol);
  if (!item) {
    item = {
      symbol,
      score: 0,
      reasons: [],
      price: null,
      change: null,
      changePct: null,
      lastTs: null
    };
    items.set(symbol, item);
  }
  return item;
};

const recencyMultiplier = (
  ts: number | null,
  nowTs: number,
  session: MarketCommandTickerRailSession
): number => {
  if (ts === null || !sessionContains(session, ts)) {
    return 0;
  }

  const ageMs = Math.max(0, nowTs - ts);
  return Math.max(CURRENT_SESSION_DECAY_FLOOR, Math.pow(0.5, ageMs / HALF_LIFE_MS));
};

const addReason = (
  items: Map<string, TickerAccumulator>,
  symbol: string | null,
  reason: MarketCommandTickerReason
): void => {
  if (!symbol || reason.score <= 0) {
    return;
  }

  let normalized: string;
  try {
    normalized = normalizeMarketCommandTickerSymbol(symbol);
  } catch {
    return;
  }
  const item = getAccumulator(items, normalized);
  item.score += reason.score;
  item.reasons.push(reason);
  if (reason.ts !== null && (item.lastTs === null || reason.ts > item.lastTs)) {
    item.lastTs = reason.ts;
  }
};

const roundScore = (value: number): number => Number(value.toFixed(4));

const eventReason = (input: {
  kind: MarketCommandTickerReasonKind;
  label: string;
  weight: number;
  multiplier: number;
  ts: number | null;
  sourceId?: string | null;
}): MarketCommandTickerReason => ({
  kind: input.kind,
  label: input.label,
  score: roundScore(input.weight * input.multiplier),
  weight: input.weight,
  ts: input.ts,
  source_id: input.sourceId ?? undefined
});

const featureString = (packet: FlowPacket, key: string): string | null => {
  const value = packet.features[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const featureNumber = (packet: FlowPacket, key: string): number | null => {
  const value = packet.features[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const symbolFromOptionContract = (contractId: string | null | undefined): string | null => {
  if (!contractId) {
    return null;
  }
  return parseOptionContractId(contractId)?.root?.toUpperCase() ?? null;
};

const symbolFromOptionPrint = (print: OptionPrint): string | null =>
  print.underlying_id?.toUpperCase() ?? symbolFromOptionContract(print.option_contract_id);

const symbolFromFlowPacket = (packet: FlowPacket): string | null =>
  featureString(packet, "underlying_id")?.toUpperCase() ??
  symbolFromOptionContract(featureString(packet, "option_contract_id"));

const symbolsFromNews = (story: NewsStory): string[] => {
  const candidates =
    story.resolved_symbols.length > 0 ? story.resolved_symbols : story.provider_symbols;
  const symbols: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    try {
      const symbol = normalizeMarketCommandTickerSymbol(candidate);
      if (!seen.has(symbol)) {
        seen.add(symbol);
        symbols.push(symbol);
      }
    } catch {
      continue;
    }
  }
  return symbols;
};

const premiumScale = (notional: number | null): number => {
  if (notional === null || notional <= 0) {
    return 0.25;
  }
  return Math.min(2, Math.max(0.25, notional / 250_000));
};

const optionNotional = (print: OptionPrint): number =>
  print.notional ?? Number((print.price * print.size * 100).toFixed(2));

const formatDollar = (value: number): string => {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1_000)}k`;
  }
  return `$${Math.round(value)}`;
};

const dedupeByIdentity = <T>(items: readonly T[], identity: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const id = identity(item);
    if (!seen.has(id)) {
      seen.add(id);
      deduped.push(item);
    }
  }
  return deduped;
};

const currentSessionItems = <T extends { source_ts?: number; ts?: number; published_ts?: number }>(
  items: readonly T[] | undefined,
  session: MarketCommandTickerRailSession
): T[] => (items ?? []).filter((item) => sessionContains(session, itemTs(item)));

const scoreAlerts = (
  items: Map<string, TickerAccumulator>,
  alerts: readonly SmartFlowAlertEvent[],
  nowTs: number,
  session: MarketCommandTickerRailSession
): void => {
  for (const alert of dedupeByIdentity(alerts, (item) => item.alert_id)) {
    const multiplier =
      recencyMultiplier(alert.source_ts, nowTs, session) *
      Math.max(0.5, alert.policy_confidence) *
      Math.max(0.5, alert.evidence_quality);
    addReason(
      items,
      alert.underlying_id,
      eventReason({
        kind: "smart_flow_alert",
        label: `Smart-flow alert ${alert.direction} ${alert.hypothesis_type}`,
        weight: MARKET_COMMAND_RANKING_WEIGHTS.smartFlowAlert,
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
  nowTs: number,
  session: MarketCommandTickerRailSession
): void => {
  for (const projection of dedupeByIdentity(projections, (item) => item.trace_id)) {
    if (!isNativeNonAbstainedSmartFlowProjection(projection)) {
      continue;
    }
    const confidence = projection.hypothesis.scores.confidence;
    const multiplier =
      recencyMultiplier(projection.source_ts, nowTs, session) *
      Math.max(0.5, confidence.policy_confidence) *
      Math.max(0.5, confidence.evidence_quality);
    addReason(
      items,
      projection.hypothesis.underlying_id,
      eventReason({
        kind: "smart_flow_projection",
        label: `Smart-flow projection ${projection.hypothesis.direction} ${projection.hypothesis.hypothesis_type}`,
        weight: MARKET_COMMAND_RANKING_WEIGHTS.smartFlowProjection,
        multiplier,
        ts: projection.source_ts,
        sourceId: projection.trace_id
      })
    );
  }
};

const scoreFlowPackets = (
  items: Map<string, TickerAccumulator>,
  packets: readonly FlowPacket[],
  nowTs: number,
  session: MarketCommandTickerRailSession
): void => {
  for (const packet of dedupeByIdentity(packets, (item) => item.id)) {
    const symbol = symbolFromFlowPacket(packet);
    const premium =
      featureNumber(packet, "total_premium") ?? featureNumber(packet, "total_notional");
    const multiplier = recencyMultiplier(packet.source_ts, nowTs, session) * premiumScale(premium);
    addReason(
      items,
      symbol,
      eventReason({
        kind: "flow_packet",
        label: premium ? `Flow packet ${formatDollar(premium)}` : "Flow packet",
        weight: MARKET_COMMAND_RANKING_WEIGHTS.flowPacket,
        multiplier,
        ts: packet.source_ts,
        sourceId: packet.id
      })
    );
  }
};

const scoreOptionPrints = (
  items: Map<string, TickerAccumulator>,
  prints: readonly OptionPrint[],
  nowTs: number,
  session: MarketCommandTickerRailSession
): void => {
  const bySymbol = new Map<
    string,
    { count: number; premium: number; latestTs: number; ids: string[] }
  >();

  for (const print of dedupeByIdentity(prints, (item) => item.trace_id)) {
    const symbol = symbolFromOptionPrint(print);
    if (!symbol) {
      continue;
    }
    const normalized = normalizeMarketCommandTickerSymbol(symbol);
    const bucket = bySymbol.get(normalized) ?? { count: 0, premium: 0, latestTs: 0, ids: [] };
    bucket.count += 1;
    bucket.premium += optionNotional(print);
    bucket.latestTs = Math.max(bucket.latestTs, print.ts);
    bucket.ids.push(print.trace_id);
    bySymbol.set(normalized, bucket);
  }

  for (const [symbol, bucket] of bySymbol) {
    const recency = recencyMultiplier(bucket.latestTs, nowTs, session);
    addReason(
      items,
      symbol,
      eventReason({
        kind: "option_premium",
        label: `Signal option premium ${formatDollar(bucket.premium)}`,
        weight: MARKET_COMMAND_RANKING_WEIGHTS.optionPremium,
        multiplier: recency * premiumScale(bucket.premium),
        ts: bucket.latestTs,
        sourceId: bucket.ids[0] ?? null
      })
    );
    addReason(
      items,
      symbol,
      eventReason({
        kind: "option_print_count",
        label: `${bucket.count} signal option print${bucket.count === 1 ? "" : "s"}`,
        weight: MARKET_COMMAND_RANKING_WEIGHTS.optionPrintCount,
        multiplier: recency * Math.min(2, Math.log2(bucket.count + 1)),
        ts: bucket.latestTs,
        sourceId: bucket.ids[0] ?? null
      })
    );
  }
};

const scoreEquityMoves = (
  items: Map<string, TickerAccumulator>,
  prints: readonly EquityPrint[],
  nowTs: number,
  session: MarketCommandTickerRailSession
): void => {
  const bySymbol = new Map<string, EquityPrint[]>();
  for (const print of dedupeByIdentity(prints, (item) => item.trace_id)) {
    const symbol = normalizeMarketCommandTickerSymbol(print.underlying_id);
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), print]);
  }

  for (const [symbol, symbolPrints] of bySymbol) {
    const ordered = [...symbolPrints].sort((left, right) =>
      left.ts === right.ts ? left.seq - right.seq : left.ts - right.ts
    );
    const latest = ordered.at(-1) ?? null;
    const first = ordered[0] ?? null;
    const fallbackPrevious = ordered.length >= 2 ? (ordered.at(-2) ?? null) : null;
    const baseline =
      first && latest && first.trace_id !== latest.trace_id ? first : fallbackPrevious;
    const accumulator = getAccumulator(items, symbol);
    accumulator.price = latest?.price ?? accumulator.price;
    accumulator.lastTs = latest ? Math.max(accumulator.lastTs ?? 0, latest.ts) : accumulator.lastTs;

    if (!latest || !baseline || baseline.price <= 0) {
      continue;
    }

    const change = latest.price - baseline.price;
    const changePct = (change / baseline.price) * 100;
    accumulator.change = Number(change.toFixed(4));
    accumulator.changePct = Number(changePct.toFixed(4));

    const multiplier =
      recencyMultiplier(latest.ts, nowTs, session) *
      Math.min(2, Math.max(0.25, Math.abs(changePct)));
    addReason(
      items,
      symbol,
      eventReason({
        kind: "equity_move",
        label: `Equity move ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`,
        weight: MARKET_COMMAND_RANKING_WEIGHTS.equityMove,
        multiplier,
        ts: latest.ts,
        sourceId: latest.trace_id
      })
    );
  }
};

const scoreNews = (
  items: Map<string, TickerAccumulator>,
  stories: readonly NewsStory[],
  nowTs: number,
  session: MarketCommandTickerRailSession
): void => {
  const bySymbol = new Map<string, { count: number; latestTs: number; storyId: string }>();
  for (const story of dedupeByIdentity(stories, (item) => String(item.story_id))) {
    for (const symbol of symbolsFromNews(story)) {
      const bucket = bySymbol.get(symbol) ?? {
        count: 0,
        latestTs: 0,
        storyId: String(story.story_id)
      };
      bucket.count += 1;
      if (story.published_ts > bucket.latestTs) {
        bucket.latestTs = story.published_ts;
        bucket.storyId = String(story.story_id);
      }
      bySymbol.set(symbol, bucket);
    }
  }

  for (const [symbol, bucket] of bySymbol) {
    const multiplier =
      recencyMultiplier(bucket.latestTs, nowTs, session) *
      Math.min(2, 1 + Math.log2(bucket.count) / 4);
    addReason(
      items,
      symbol,
      eventReason({
        kind: "news",
        label: `${bucket.count} news ${bucket.count === 1 ? "story" : "stories"}`,
        weight: MARKET_COMMAND_RANKING_WEIGHTS.news,
        multiplier,
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

export const buildMarketCommandTickerRail = (
  input: BuildMarketCommandTickerRailInput
): MarketCommandTickerRailResponse => {
  const items = new Map<string, TickerAccumulator>();
  const sessionData = {
    alerts: currentSessionItems(input.data.alerts, input.session),
    smartFlowProjections: currentSessionItems(input.data.smartFlowProjections, input.session),
    flowPackets: currentSessionItems(input.data.flowPackets, input.session),
    optionPrints: currentSessionItems(input.data.optionPrints, input.session),
    equityPrints: currentSessionItems(input.data.equityPrints, input.session),
    news: currentSessionItems(input.data.news, input.session)
  };

  scoreAlerts(items, sessionData.alerts, input.nowTs, input.session);
  scoreSmartFlowProjections(items, sessionData.smartFlowProjections, input.nowTs, input.session);
  scoreFlowPackets(items, sessionData.flowPackets, input.nowTs, input.session);
  scoreOptionPrints(items, sessionData.optionPrints, input.nowTs, input.session);
  scoreEquityMoves(items, sessionData.equityPrints, input.nowTs, input.session);
  scoreNews(items, sessionData.news, input.nowTs, input.session);

  const pinnedSymbols = input.params.watchlist.map(normalizeMarketCommandTickerSymbol);
  const pinnedSet = new Set(pinnedSymbols);
  const pinned = pinnedSymbols.map((symbol, index) => {
    const accumulator = getAccumulator(items, symbol);
    accumulator.score += MARKET_COMMAND_RANKING_WEIGHTS.watchlistBoost;
    accumulator.reasons.push({
      kind: "watchlist_boost",
      label: "Pinned watchlist symbol",
      score: MARKET_COMMAND_RANKING_WEIGHTS.watchlistBoost,
      weight: MARKET_COMMAND_RANKING_WEIGHTS.watchlistBoost,
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
    .slice(0, input.params.limit)
    .map((item, index) => itemFromAccumulator(item, "important", index + 1));

  return MarketCommandTickerRailResponseSchema.parse({
    schema_version: MARKET_COMMAND_TICKER_RAIL_SCHEMA_VERSION,
    generated_at_ts: Math.max(0, Math.floor(input.nowTs)),
    session: input.session,
    watchlist: pinnedSymbols,
    limit: input.params.limit,
    degraded: Boolean(input.degradedReasons?.length),
    degraded_reasons: [...(input.degradedReasons ?? [])],
    pinned,
    important
  });
};
