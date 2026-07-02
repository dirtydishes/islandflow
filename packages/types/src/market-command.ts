import { z } from "zod";

export const MARKET_COMMAND_TICKER_RAIL_SCHEMA_VERSION = "market-command.ticker-rail.v1";
export const MARKET_COMMAND_TICKER_RAIL_TIMEZONE = "America/New_York";

export const MarketCommandTickerSymbolSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[A-Z][A-Z0-9.-]*$/);

export type MarketCommandTickerSymbol = z.infer<typeof MarketCommandTickerSymbolSchema>;

export const MarketCommandTickerReasonKindSchema = z.enum([
  "smart_flow_alert",
  "smart_flow_projection",
  "flow_packet",
  "option_premium",
  "option_print_count",
  "equity_move",
  "news",
  "watchlist_boost"
]);

export type MarketCommandTickerReasonKind = z.infer<typeof MarketCommandTickerReasonKindSchema>;

export const MarketCommandTickerReasonSchema = z
  .object({
    kind: MarketCommandTickerReasonKindSchema,
    label: z.string().min(1),
    score: z.number().nonnegative(),
    weight: z.number().nonnegative(),
    ts: z.number().int().nonnegative().nullable(),
    source_id: z.string().min(1).nullable().optional()
  })
  .strict();

export type MarketCommandTickerReason = z.infer<typeof MarketCommandTickerReasonSchema>;

export const MarketCommandTickerRailItemSourceSchema = z.enum(["pinned", "important", "both"]);

export type MarketCommandTickerRailItemSource = z.infer<
  typeof MarketCommandTickerRailItemSourceSchema
>;

export const MarketCommandTickerRailItemSchema = z
  .object({
    symbol: MarketCommandTickerSymbolSchema,
    source: MarketCommandTickerRailItemSourceSchema,
    rank: z.number().int().positive(),
    score: z.number().nonnegative(),
    price: z.number().nonnegative().nullable(),
    change: z.number().nullable(),
    change_pct: z.number().nullable(),
    last_ts: z.number().int().nonnegative().nullable(),
    reasons: z.array(MarketCommandTickerReasonSchema).max(3)
  })
  .strict();

export type MarketCommandTickerRailItem = z.infer<typeof MarketCommandTickerRailItemSchema>;

export const MarketCommandTickerRailSessionSchema = z
  .object({
    timezone: z.literal(MARKET_COMMAND_TICKER_RAIL_TIMEZONE),
    selection: z.enum(["current", "previous_regular"]),
    start_ts: z.number().int().nonnegative(),
    end_ts: z.number().int().nonnegative()
  })
  .strict();

export type MarketCommandTickerRailSession = z.infer<typeof MarketCommandTickerRailSessionSchema>;

export const MarketCommandTickerRailResponseSchema = z
  .object({
    schema_version: z.literal(MARKET_COMMAND_TICKER_RAIL_SCHEMA_VERSION),
    generated_at_ts: z.number().int().nonnegative(),
    session: MarketCommandTickerRailSessionSchema,
    watchlist: z.array(MarketCommandTickerSymbolSchema).max(32),
    limit: z.number().int().positive().max(32),
    degraded: z.boolean(),
    degraded_reasons: z.array(z.string().min(1)),
    pinned: z.array(MarketCommandTickerRailItemSchema).max(32),
    important: z.array(MarketCommandTickerRailItemSchema).max(32)
  })
  .strict();

export type MarketCommandTickerRailResponse = z.infer<typeof MarketCommandTickerRailResponseSchema>;
