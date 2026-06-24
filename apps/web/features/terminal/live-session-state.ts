import type {
  AlertEvent,
  ClassifierHitEvent,
  DurableTapeRowViewModel,
  EquityCandle,
  EquityPrint,
  EquityPrintJoin,
  EquityQuote,
  FlowPacket,
  InferredDarkEvent,
  LiveSubscription,
  NewsStory,
  OptionNBBO,
  OptionPrint,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";
import { getSubscriptionKey as getLiveSubscriptionKey } from "@islandflow/types";
import type { LiveWindowBuffer, LiveWindowSnapshot } from "../durable-tape";
import { LIVE_HOT_WINDOW, LIVE_OPTIONS_HEAD_LIMIT } from "./config";
import { createLiveWindowBuffer, incrementRetentionMetric } from "./tape";
import type { SortableItem } from "./types";

export type LiveSubscriptionResetChannel =
  | "options"
  | "equities"
  | "durable-rows"
  | "equity-candles"
  | "equity-overlay";

type LiveSessionChannelItems = {
  options: OptionPrint;
  nbbo: OptionNBBO;
  equities: EquityPrint;
  equityQuotes: EquityQuote;
  equityJoins: EquityPrintJoin;
  flow: FlowPacket;
  smartFlow: SmartFlowExplainabilityProjection;
  smartMoney: SmartMoneyEvent;
  classifierHits: ClassifierHitEvent;
  alerts: AlertEvent;
  durableRows: DurableTapeRowViewModel;
  news: NewsStory;
  inferredDark: InferredDarkEvent;
  chartCandles: EquityCandle;
  chartOverlay: EquityPrint;
};

type LiveSessionBufferedChannel = keyof LiveSessionChannelItems;

type LiveSessionBuffers = {
  [Channel in LiveSessionBufferedChannel]: LiveWindowBuffer<LiveSessionChannelItems[Channel]>;
};

const LIVE_SESSION_BUFFER_CHANNELS = [
  "options",
  "nbbo",
  "equities",
  "equityQuotes",
  "equityJoins",
  "flow",
  "smartFlow",
  "smartMoney",
  "classifierHits",
  "alerts",
  "durableRows",
  "news",
  "inferredDark",
  "chartCandles",
  "chartOverlay"
] as const satisfies readonly LiveSessionBufferedChannel[];

const LIVE_SUBSCRIPTION_BUFFER_CHANNELS = {
  options: "options",
  nbbo: "nbbo",
  equities: "equities",
  "equity-quotes": "equityQuotes",
  "equity-joins": "equityJoins",
  flow: "flow",
  "smart-flow": "smartFlow",
  "smart-money": "smartMoney",
  "classifier-hits": "classifierHits",
  alerts: "alerts",
  "durable-rows": "durableRows",
  news: "news",
  "inferred-dark": "inferredDark",
  "equity-candles": "chartCandles",
  "equity-overlay": "chartOverlay"
} as const satisfies Record<LiveSubscription["channel"], LiveSessionBufferedChannel>;

export type LiveSessionChannelBufferRegistry = {
  resetAll: () => void;
  resetSubscriptionChannels: (channels: Iterable<LiveSubscription["channel"]>) => void;
  upsertSubscriptionItems: <TItem extends SortableItem>(
    channel: LiveSubscription["channel"],
    items: readonly TItem[]
  ) => LiveWindowSnapshot<TItem>;
  resetSubscriptionItems: <TItem extends SortableItem>(
    channel: LiveSubscription["channel"],
    items: readonly TItem[]
  ) => LiveWindowSnapshot<TItem>;
};

export type LiveSessionChannelBufferRegistryOptions = {
  onTrim?: (evicted: number) => void;
};

const getLiveSessionBufferedChannel = (
  channel: LiveSubscription["channel"]
): LiveSessionBufferedChannel => LIVE_SUBSCRIPTION_BUFFER_CHANNELS[channel];

const createLiveSessionBuffers = (
  options: LiveSessionChannelBufferRegistryOptions = {}
): LiveSessionBuffers => {
  const onTrim =
    options.onTrim ??
    ((evicted: number) => incrementRetentionMetric("hotWindowEvictions", evicted));

  return {
    options: createLiveWindowBuffer<OptionPrint>({ limit: LIVE_OPTIONS_HEAD_LIMIT, onTrim }),
    nbbo: createLiveWindowBuffer<OptionNBBO>({ limit: LIVE_HOT_WINDOW, onTrim }),
    equities: createLiveWindowBuffer<EquityPrint>({ limit: LIVE_HOT_WINDOW, onTrim }),
    equityQuotes: createLiveWindowBuffer<EquityQuote>({ limit: LIVE_HOT_WINDOW, onTrim }),
    equityJoins: createLiveWindowBuffer<EquityPrintJoin>({ limit: LIVE_HOT_WINDOW, onTrim }),
    flow: createLiveWindowBuffer<FlowPacket>({ limit: LIVE_HOT_WINDOW, onTrim }),
    smartFlow: createLiveWindowBuffer<SmartFlowExplainabilityProjection>({
      limit: LIVE_HOT_WINDOW,
      onTrim
    }),
    smartMoney: createLiveWindowBuffer<SmartMoneyEvent>({ limit: LIVE_HOT_WINDOW, onTrim }),
    classifierHits: createLiveWindowBuffer<ClassifierHitEvent>({
      limit: LIVE_HOT_WINDOW,
      onTrim
    }),
    alerts: createLiveWindowBuffer<AlertEvent>({ limit: LIVE_HOT_WINDOW, onTrim }),
    durableRows: createLiveWindowBuffer<DurableTapeRowViewModel>({
      limit: LIVE_OPTIONS_HEAD_LIMIT,
      onTrim
    }),
    news: createLiveWindowBuffer<NewsStory>({ limit: LIVE_OPTIONS_HEAD_LIMIT, onTrim }),
    inferredDark: createLiveWindowBuffer<InferredDarkEvent>({ limit: LIVE_HOT_WINDOW, onTrim }),
    chartCandles: createLiveWindowBuffer<EquityCandle>({ limit: LIVE_HOT_WINDOW, onTrim }),
    chartOverlay: createLiveWindowBuffer<EquityPrint>({ limit: LIVE_HOT_WINDOW, onTrim })
  };
};

export const createLiveSessionChannelBufferRegistry = (
  options: LiveSessionChannelBufferRegistryOptions = {}
): LiveSessionChannelBufferRegistry => {
  const buffers = createLiveSessionBuffers(options);

  const getBuffer = <TItem extends SortableItem>(
    channel: LiveSubscription["channel"]
  ): LiveWindowBuffer<TItem> =>
    buffers[getLiveSessionBufferedChannel(channel)] as unknown as LiveWindowBuffer<TItem>;

  return {
    resetAll() {
      for (const channel of LIVE_SESSION_BUFFER_CHANNELS) {
        buffers[channel].reset([]);
      }
    },
    resetSubscriptionChannels(channels) {
      for (const channel of channels) {
        getBuffer(channel).reset([]);
      }
    },
    upsertSubscriptionItems<TItem extends SortableItem>(
      channel: LiveSubscription["channel"],
      items: readonly TItem[]
    ) {
      return getBuffer<TItem>(channel).upsertMany(items);
    },
    resetSubscriptionItems<TItem extends SortableItem>(
      channel: LiveSubscription["channel"],
      items: readonly TItem[]
    ) {
      return getBuffer<TItem>(channel).reset(items);
    }
  };
};

export const getLiveSubscriptionResetChannels = (
  currentSubscriptions: Iterable<LiveSubscription>,
  nextSubscriptions: LiveSubscription[]
): Set<LiveSubscriptionResetChannel> => {
  const currentMap = new Map(
    Array.from(currentSubscriptions, (subscription) => [
      getLiveSubscriptionKey(subscription),
      subscription
    ])
  );
  const nextMap = new Map(
    nextSubscriptions.map((subscription) => [getLiveSubscriptionKey(subscription), subscription])
  );
  const nextKeys = new Set(nextMap.keys());
  const currentKeys = new Set(currentMap.keys());
  const changedSubscriptions = [
    ...Array.from(currentKeys)
      .filter((key) => !nextKeys.has(key))
      .map((key) => currentMap.get(key) ?? null),
    ...Array.from(nextKeys)
      .filter((key) => !currentKeys.has(key))
      .map((key) => nextMap.get(key) ?? null)
  ].filter((subscription): subscription is LiveSubscription => subscription !== null);

  const resetChannels = new Set<LiveSubscriptionResetChannel>();
  for (const subscription of changedSubscriptions) {
    if (
      subscription.channel === "options" ||
      subscription.channel === "equities" ||
      subscription.channel === "durable-rows" ||
      subscription.channel === "equity-candles" ||
      subscription.channel === "equity-overlay"
    ) {
      resetChannels.add(subscription.channel);
    }
  }
  return resetChannels;
};

export type LiveSessionEventBatch = {
  subscription: LiveSubscription;
  items: unknown[];
  updateAt: number;
};

export type LiveSessionLastEventUpdates = Map<LiveSubscription["channel"], number>;

export type LiveSessionEventBatcher = {
  queueEvent: (subscription: LiveSubscription, item: unknown) => void;
  flushQueuedEvents: () => LiveSessionLastEventUpdates;
  drainQueuedEventsBeforeSnapshot: () => LiveSessionLastEventUpdates;
  clear: () => void;
};

export type LiveSessionEventBatcherOptions = {
  applyBatch: (batch: LiveSessionEventBatch) => boolean;
  scheduleFlush: (flush: () => void) => number;
  cancelFlush: (handle: number) => void;
  now?: () => number;
  onFlush?: (updates: LiveSessionLastEventUpdates) => void;
};

export const createLiveSessionEventBatcher = (
  options: LiveSessionEventBatcherOptions
): LiveSessionEventBatcher => {
  const pendingBatches = new Map<string, LiveSessionEventBatch>();
  let flushHandle: number | null = null;
  const now = options.now ?? Date.now;

  const cancelScheduledFlush = (): void => {
    if (flushHandle !== null) {
      options.cancelFlush(flushHandle);
      flushHandle = null;
    }
  };

  const flushQueuedEvents = (): LiveSessionLastEventUpdates => {
    cancelScheduledFlush();
    const batches = Array.from(pendingBatches.values());
    pendingBatches.clear();

    const lastEvents: LiveSessionLastEventUpdates = new Map();
    for (const batch of batches) {
      const applied = options.applyBatch(batch);
      if (applied) {
        const current = lastEvents.get(batch.subscription.channel) ?? 0;
        lastEvents.set(batch.subscription.channel, Math.max(current, batch.updateAt));
      }
    }

    if (lastEvents.size > 0) {
      options.onFlush?.(lastEvents);
    }
    return lastEvents;
  };

  const scheduleFlush = (): void => {
    if (flushHandle !== null) {
      return;
    }
    flushHandle = options.scheduleFlush(flushQueuedEvents);
  };

  return {
    queueEvent(subscription, item) {
      const subscriptionKey = getLiveSubscriptionKey(subscription);
      const updateAt = now();
      const current = pendingBatches.get(subscriptionKey);
      if (current) {
        current.items.push(item);
        current.updateAt = updateAt;
      } else {
        pendingBatches.set(subscriptionKey, {
          subscription,
          items: [item],
          updateAt
        });
      }
      scheduleFlush();
    },
    flushQueuedEvents,
    drainQueuedEventsBeforeSnapshot: flushQueuedEvents,
    clear() {
      pendingBatches.clear();
      cancelScheduledFlush();
    }
  };
};
