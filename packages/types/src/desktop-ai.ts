import { z } from "zod";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  FlowPacketSchema,
  OptionPrintSchema,
  SmartMoneyEventSchema
} from "./events.ts";
import { OptionFlowFiltersSchema } from "./options-flow.ts";

export const IslandflowAiReasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);

export type IslandflowAiReasoningEffort = z.infer<typeof IslandflowAiReasoningEffortSchema>;

export const IslandflowAiPlanTypeSchema = z.enum([
  "free",
  "go",
  "plus",
  "pro",
  "prolite",
  "team",
  "self_serve_business_usage_based",
  "business",
  "enterprise_cbp_usage_based",
  "enterprise",
  "edu",
  "unknown"
]);

export type IslandflowAiPlanType = z.infer<typeof IslandflowAiPlanTypeSchema>;

export const IslandflowAiAuthModeSchema = z.enum([
  "apikey",
  "chatgpt",
  "chatgptAuthTokens",
  "agentIdentity"
]);

export type IslandflowAiAuthMode = z.infer<typeof IslandflowAiAuthModeSchema>;

export const IslandflowAiProfileModeSchema = z.enum([
  "managed-chatgpt",
  "api-key",
  "workspace-provider"
]);

export type IslandflowAiProfileMode = z.infer<typeof IslandflowAiProfileModeSchema>;

export const IslandflowAiTransportStatusSchema = z.enum([
  "starting",
  "ready",
  "error",
  "stopped",
  "restarting"
]);

export type IslandflowAiTransportStatus = z.infer<typeof IslandflowAiTransportStatusSchema>;

export const IslandflowAiTaskKindSchema = z.enum([
  "smart-money-explain",
  "smart-money-skeptic",
  "smart-money-burst-summary",
  "watchlist-synthesis",
  "replay-postmortem",
  "screen-compile"
]);

export type IslandflowAiTaskKind = z.infer<typeof IslandflowAiTaskKindSchema>;

export const IslandflowAiTaskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export type IslandflowAiTaskStatus = z.infer<typeof IslandflowAiTaskStatusSchema>;

export const IslandflowAiTokenBreakdownSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative()
});

export type IslandflowAiTokenBreakdown = z.infer<typeof IslandflowAiTokenBreakdownSchema>;

export const IslandflowAiPricingSchema = z.object({
  inputUsdPer1MTokens: z.number().nonnegative(),
  cachedInputUsdPer1MTokens: z.number().nonnegative(),
  outputUsdPer1MTokens: z.number().nonnegative(),
  sourceLabel: z.string().min(1),
  sourceUrl: z.string().url()
});

export type IslandflowAiPricing = z.infer<typeof IslandflowAiPricingSchema>;

export const IslandflowAiModelSummarySchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  isDefault: z.boolean(),
  supportedReasoningEfforts: z.array(IslandflowAiReasoningEffortSchema),
  defaultReasoningEffort: IslandflowAiReasoningEffortSchema.nullable(),
  pricing: IslandflowAiPricingSchema.nullable()
});

export type IslandflowAiModelSummary = z.infer<typeof IslandflowAiModelSummarySchema>;

export const IslandflowAiRateLimitWindowSchema = z.object({
  usedPercent: z.number().min(0).max(100),
  windowDurationMins: z.number().int().positive().nullable(),
  resetsAt: z.number().int().nullable()
});

export type IslandflowAiRateLimitWindow = z.infer<typeof IslandflowAiRateLimitWindowSchema>;

export const IslandflowAiRateLimitSnapshotSchema = z.object({
  limitId: z.string().nullable(),
  limitName: z.string().nullable(),
  primary: IslandflowAiRateLimitWindowSchema.nullable(),
  secondary: IslandflowAiRateLimitWindowSchema.nullable(),
  planType: IslandflowAiPlanTypeSchema.nullable(),
  reachedType: z.string().nullable(),
  hasCredits: z.boolean().nullable(),
  unlimitedCredits: z.boolean().nullable(),
  creditsBalance: z.string().nullable()
});

export type IslandflowAiRateLimitSnapshot = z.infer<typeof IslandflowAiRateLimitSnapshotSchema>;

export const IslandflowAiSmartMoneyContextSchema = z.object({
  event: SmartMoneyEventSchema,
  flowPacket: FlowPacketSchema.nullable(),
  evidencePrints: z.array(OptionPrintSchema),
  relatedPackets: z.array(FlowPacketSchema).default([])
});

export type IslandflowAiSmartMoneyContext = z.infer<typeof IslandflowAiSmartMoneyContextSchema>;

export const IslandflowAiReplayContextSchema = z.object({
  ticker: z.string().min(1).nullable(),
  flowFilters: OptionFlowFiltersSchema,
  alerts: z.array(AlertEventSchema),
  smartMoneyEvents: z.array(SmartMoneyEventSchema),
  classifierHits: z.array(ClassifierHitEventSchema),
  flowPackets: z.array(FlowPacketSchema),
  optionPrints: z.array(OptionPrintSchema)
});

export type IslandflowAiReplayContext = z.infer<typeof IslandflowAiReplayContextSchema>;

export const IslandflowAiScreenCompileContextSchema = z.object({
  prompt: z.string().min(1).max(4_000),
  currentFilters: OptionFlowFiltersSchema
});

export type IslandflowAiScreenCompileContext = z.infer<typeof IslandflowAiScreenCompileContextSchema>;

export const IslandflowAiTaskRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("smart-money-explain"),
    context: IslandflowAiSmartMoneyContextSchema
  }),
  z.object({
    kind: z.literal("smart-money-skeptic"),
    context: IslandflowAiSmartMoneyContextSchema
  }),
  z.object({
    kind: z.literal("smart-money-burst-summary"),
    context: IslandflowAiSmartMoneyContextSchema
  }),
  z.object({
    kind: z.literal("watchlist-synthesis"),
    context: IslandflowAiSmartMoneyContextSchema
  }),
  z.object({
    kind: z.literal("replay-postmortem"),
    context: IslandflowAiReplayContextSchema
  }),
  z.object({
    kind: z.literal("screen-compile"),
    context: IslandflowAiScreenCompileContextSchema
  })
]);

export type IslandflowAiTaskRequest = z.infer<typeof IslandflowAiTaskRequestSchema>;

export const IslandflowAiCompiledScreenSchema = z.object({
  compiledFilters: OptionFlowFiltersSchema.nullable(),
  rationale: z.string().min(1),
  unhandledClauses: z.array(z.string()),
  sanitizedPrompt: z.string().min(1)
});

export type IslandflowAiCompiledScreen = z.infer<typeof IslandflowAiCompiledScreenSchema>;

export type IslandflowAiProfileSlot = {
  id: string;
  label: string;
  description: string;
  mode: IslandflowAiProfileMode;
  enabled: boolean;
  selected: boolean;
  statusLabel: string;
};

export type IslandflowAiLoginState =
  | { status: "idle"; message: string | null }
  | { status: "browser_pending"; message: string | null; loginId: string; authUrl: string }
  | {
      status: "device_code_pending";
      message: string | null;
      loginId: string;
      verificationUrl: string;
      userCode: string;
    }
  | { status: "error"; message: string; loginId: string | null };

export type IslandflowAiPreferences = {
  model: string | null;
  reasoningEffort: IslandflowAiReasoningEffort | null;
};

export type IslandflowAiUsageTurnRecord = {
  threadId: string;
  turnId: string;
  taskId: string | null;
  taskKind: IslandflowAiTaskKind | null;
  taskTitle: string | null;
  dayKey: string;
  profileId: string;
  accountEmail: string | null;
  planType: IslandflowAiPlanType | null;
  model: string | null;
  breakdown: IslandflowAiTokenBreakdown;
  normalizedCostUsd: number | null;
  updatedAt: number;
};

export type IslandflowAiUsageRollup = {
  breakdown: IslandflowAiTokenBreakdown;
  normalizedCostUsd: number | null;
  turnCount: number;
  activeDays: number;
};

export type IslandflowAiUsageDashboard = {
  today: IslandflowAiUsageRollup;
  lifetime: IslandflowAiUsageRollup;
  recentTurns: IslandflowAiUsageTurnRecord[];
};

export type IslandflowAiTaskSnapshot = {
  taskId: string;
  kind: IslandflowAiTaskKind;
  title: string;
  subtitle: string;
  status: IslandflowAiTaskStatus;
  createdAt: number;
  updatedAt: number;
  threadId: string | null;
  turnId: string | null;
  model: string | null;
  reasoningEffort: IslandflowAiReasoningEffort | null;
  text: string;
  error: string | null;
  compiledScreen: IslandflowAiCompiledScreen | null;
};

export type IslandflowAiAccountState = {
  loggedIn: boolean;
  email: string | null;
  planType: IslandflowAiPlanType | null;
  authMode: IslandflowAiAuthMode | null;
  requiresOpenaiAuth: boolean;
  login: IslandflowAiLoginState;
};

export type IslandflowAiState = {
  desktopAvailable: boolean;
  transportStatus: IslandflowAiTransportStatus;
  transportError: string | null;
  profiles: IslandflowAiProfileSlot[];
  selectedProfileId: string;
  account: IslandflowAiAccountState;
  preferences: IslandflowAiPreferences;
  models: IslandflowAiModelSummary[];
  rateLimitsByLimitId: Record<string, IslandflowAiRateLimitSnapshot>;
  usage: IslandflowAiUsageDashboard;
  tasks: IslandflowAiTaskSnapshot[];
  updatedAt: number;
};
