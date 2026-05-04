import { z } from "zod";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  EquityCandleSchema,
  EquityPrintJoinSchema,
  EquityPrintSchema,
  EquityQuoteSchema,
  FlowPacketSchema,
  InferredDarkEventSchema,
  OptionNBBOSchema,
  OptionPrintSchema
} from "./events";
import {
  OptionFlowFiltersSchema,
  optionFlowFilterKey
} from "./options-flow";

export const CursorSchema = z.object({
  ts: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative()
});

export type Cursor = z.infer<typeof CursorSchema>;

export const LiveGenericChannelSchema = z.enum([
  "options",
  "nbbo",
  "equities",
  "equity-quotes",
  "equity-joins",
  "flow",
  "classifier-hits",
  "alerts",
  "inferred-dark"
]);

export const LiveChannelSchema = z.enum([
  "options",
  "nbbo",
  "equities",
  "equity-quotes",
  "equity-joins",
  "flow",
  "classifier-hits",
  "alerts",
  "inferred-dark",
  "equity-candles",
  "equity-overlay"
]);

export type LiveChannel = z.infer<typeof LiveChannelSchema>;
export type LiveGenericChannel = z.infer<typeof LiveGenericChannelSchema>;

export const LiveSubscriptionSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("options"),
    filters: OptionFlowFiltersSchema.optional(),
    underlying_ids: z.array(z.string().min(1)).optional(),
    option_contract_id: z.string().min(1).optional()
  }),
  z.object({
    channel: z.literal("flow"),
    filters: OptionFlowFiltersSchema.optional()
  }),
  z.object({
    channel: z.enum(["nbbo", "equity-quotes", "equity-joins", "classifier-hits", "alerts", "inferred-dark"])
  }),
  z.object({
    channel: z.literal("equities"),
    underlying_ids: z.array(z.string().min(1)).optional()
  }),
  z.object({
    channel: z.literal("equity-candles"),
    underlying_id: z.string().min(1),
    interval_ms: z.number().int().positive()
  }),
  z.object({
    channel: z.literal("equity-overlay"),
    underlying_id: z.string().min(1)
  })
]);

export type LiveSubscription = z.infer<typeof LiveSubscriptionSchema>;

const livePayloadSchemas = {
  options: OptionPrintSchema,
  nbbo: OptionNBBOSchema,
  equities: EquityPrintSchema,
  "equity-quotes": EquityQuoteSchema,
  "equity-joins": EquityPrintJoinSchema,
  flow: FlowPacketSchema,
  "classifier-hits": ClassifierHitEventSchema,
  alerts: AlertEventSchema,
  "inferred-dark": InferredDarkEventSchema,
  "equity-candles": EquityCandleSchema,
  "equity-overlay": EquityPrintSchema
} as const;

export const FeedSnapshotSchema = z.object({
  subscription: LiveSubscriptionSchema,
  items: z.array(z.unknown()),
  watermark: CursorSchema.nullable(),
  next_before: CursorSchema.nullable()
});

export type FeedSnapshot<T> = {
  subscription: LiveSubscription;
  items: T[];
  watermark: Cursor | null;
  next_before: Cursor | null;
};

export const LiveSubscribeMessageSchema = z.object({
  op: z.literal("subscribe"),
  subscriptions: z.array(LiveSubscriptionSchema).min(1)
});

export type LiveSubscribeMessage = z.infer<typeof LiveSubscribeMessageSchema>;

export const LiveUnsubscribeMessageSchema = z.object({
  op: z.literal("unsubscribe"),
  subscriptions: z.array(LiveSubscriptionSchema).min(1)
});

export type LiveUnsubscribeMessage = z.infer<typeof LiveUnsubscribeMessageSchema>;

export const LivePingMessageSchema = z.object({
  op: z.literal("ping")
});

export type LivePingMessage = z.infer<typeof LivePingMessageSchema>;

export const LiveClientMessageSchema = z.discriminatedUnion("op", [
  LiveSubscribeMessageSchema,
  LiveUnsubscribeMessageSchema,
  LivePingMessageSchema
]);

export type LiveClientMessage = z.infer<typeof LiveClientMessageSchema>;

export const LiveReadyMessageSchema = z.object({
  op: z.literal("ready")
});

export type LiveReadyMessage = z.infer<typeof LiveReadyMessageSchema>;

export const LiveSnapshotMessageSchema = z.object({
  op: z.literal("snapshot"),
  snapshot: FeedSnapshotSchema
});

export type LiveSnapshotMessage = z.infer<typeof LiveSnapshotMessageSchema>;

export const LiveEventMessageSchema = z.object({
  op: z.literal("event"),
  subscription: LiveSubscriptionSchema,
  item: z.unknown(),
  watermark: CursorSchema.nullable()
});

export type LiveEventMessage = z.infer<typeof LiveEventMessageSchema>;

export const LiveHeartbeatMessageSchema = z.object({
  op: z.literal("heartbeat"),
  ts: z.number().int().nonnegative()
});

export type LiveHeartbeatMessage = z.infer<typeof LiveHeartbeatMessageSchema>;

export const LiveErrorMessageSchema = z.object({
  op: z.literal("error"),
  message: z.string().min(1)
});

export type LiveErrorMessage = z.infer<typeof LiveErrorMessageSchema>;

export const LiveServerMessageSchema = z.discriminatedUnion("op", [
  LiveReadyMessageSchema,
  LiveSnapshotMessageSchema,
  LiveEventMessageSchema,
  LiveHeartbeatMessageSchema,
  LiveErrorMessageSchema
]);

export type LiveServerMessage = z.infer<typeof LiveServerMessageSchema>;

export const getSubscriptionKey = (subscription: LiveSubscription): string => {
  switch (subscription.channel) {
    case "options": {
      const underlyings = subscription.underlying_ids?.length
        ? `|underlyings:${[...subscription.underlying_ids].sort().join(",")}`
        : "";
      const contract = subscription.option_contract_id
        ? `|contract:${subscription.option_contract_id}`
        : "";
      return `${subscription.channel}|${optionFlowFilterKey(subscription.filters)}${underlyings}${contract}`;
    }
    case "flow":
      return `${subscription.channel}|${optionFlowFilterKey(subscription.filters)}`;
    case "equities": {
      const underlyings = subscription.underlying_ids?.length
        ? `|underlyings:${[...subscription.underlying_ids].sort().join(",")}`
        : "";
      return `${subscription.channel}${underlyings}`;
    }
    case "equity-candles":
      return `${subscription.channel}|${subscription.underlying_id}|${subscription.interval_ms}`;
    case "equity-overlay":
      return `${subscription.channel}|${subscription.underlying_id}`;
    default:
      return subscription.channel;
  }
};

export const parseLivePayload = (
  channel: LiveChannel,
  item: unknown
): z.infer<(typeof livePayloadSchemas)[typeof channel]> => {
  return livePayloadSchemas[channel].parse(item);
};
