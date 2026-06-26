import {
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureKnownStreams,
  publishJson,
  STREAM_EQUITY_JOINS,
  STREAM_EQUITY_PRINTS,
  STREAM_EQUITY_QUOTES,
  STREAM_FLOW_PACKETS,
  STREAM_INFERRED_DARK,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_SIGNAL_PRINTS,
  STREAM_SMART_FLOW,
  STREAM_SMART_FLOW_ALERTS,
  SUBJECT_EQUITY_JOINS,
  SUBJECT_EQUITY_PRINTS,
  SUBJECT_EQUITY_QUOTES,
  SUBJECT_FLOW_PACKETS,
  SUBJECT_INFERRED_DARK,
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_SIGNAL_PRINTS,
  SUBJECT_SMART_FLOW,
  SUBJECT_SMART_FLOW_ALERTS,
  subscribeJson
} from "@islandflow/bus";
import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  ClickHouseBatchWriter,
  createClickHouseClient,
  enqueueEquityPrintJoinInsert,
  enqueueFlowPacketInsert,
  enqueueInferredDarkInsert,
  enqueueSmartFlowAlertInsert,
  enqueueSmartFlowProjectionInsert,
  ensureEquityPrintJoinsTable,
  ensureFlowPacketsTable,
  ensureInferredDarkTable,
  ensureSmartFlowAlertsTable,
  ensureSmartFlowProjectionsTable
} from "@islandflow/storage";
import {
  type EquityPrint,
  type EquityPrintJoin,
  EquityPrintJoinSchema,
  EquityPrintSchema,
  type EquityQuote,
  EquityQuoteSchema,
  type FlowPacket,
  FlowPacketSchema,
  type InferredDarkEvent,
  InferredDarkEventSchema,
  type OptionNBBO,
  OptionNBBOSchema,
  type OptionPrint,
  OptionPrintSchema
} from "@islandflow/types";
import { z } from "zod";
import { parseContractId } from "./contracts";
import {
  createDarkInferenceState,
  type DarkInferenceConfig,
  evaluateDarkInferences
} from "./dark-inference";
import { buildEquityPrintJoin, type EquityQuoteJoin } from "./equity-joins";
import {
  createRedisClient,
  type RollingStatsConfig,
  RollingWindowStore,
  type RollingWindowStoreConfig
} from "./rolling-stats";
import { planSmartFlowAlertEmissions } from "./smart-flow-alerts";
import { type NativeSmartFlowProjectionFlush, NativeSmartFlowRuntime } from "./smart-flow-runtime";
import {
  buildStructureFlowPacket,
  type LegEvidence,
  planStructurePacket,
  shouldEmitStructurePacket
} from "./structure-packets";
import { type ContractLeg, summarizeStructure } from "./structures";

const service = "compute";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  CLUSTER_WINDOW_MS: z.coerce.number().int().positive().default(500),
  ROLLING_WINDOW_SIZE: z.coerce.number().int().positive().default(50),
  ROLLING_TTL_SEC: z.coerce.number().int().nonnegative().default(86400),
  ROLLING_CACHE_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  ROLLING_CACHE_MAX_KEYS: z.coerce.number().int().positive().default(20_000),
  COMPUTE_DELIVER_POLICY: z.enum(["new", "all", "last", "last_per_subject"]).default("new"),
  COMPUTE_CONSUMER_RESET: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) {
          return true;
        }
        if (["0", "false", "no", "off"].includes(normalized)) {
          return false;
        }
      }
      return value;
    }, z.boolean())
    .default(false),
  NBBO_MAX_AGE_MS: z.coerce.number().int().positive().default(1000),
  COMPUTE_NBBO_CACHE_MAX_KEYS: z.coerce.number().int().positive().default(20_000),
  COMPUTE_NBBO_CACHE_TTL_MS: z.coerce.number().int().positive().default(900_000),
  EQUITY_QUOTE_MAX_AGE_MS: z.coerce.number().int().positive().default(1000),
  DARK_INFER_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  DARK_INFER_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(30000),
  DARK_INFER_MIN_BLOCK_SIZE: z.coerce.number().int().positive().default(2000),
  DARK_INFER_MIN_ACCUM_SIZE: z.coerce.number().int().positive().default(3000),
  DARK_INFER_MIN_ACCUM_COUNT: z.coerce.number().int().positive().default(4),
  DARK_INFER_MIN_PRINT_SIZE: z.coerce.number().int().positive().default(200),
  DARK_INFER_MAX_EVIDENCE: z.coerce.number().int().positive().default(20),
  DARK_INFER_MAX_SPREAD_PCT: z.coerce.number().positive().default(0.005)
});

const env = readEnv(envSchema);

const darkInferenceConfig: DarkInferenceConfig = {
  windowMs: env.DARK_INFER_WINDOW_MS,
  cooldownMs: env.DARK_INFER_COOLDOWN_MS,
  minBlockSize: env.DARK_INFER_MIN_BLOCK_SIZE,
  minAccumulationSize: env.DARK_INFER_MIN_ACCUM_SIZE,
  minAccumulationCount: env.DARK_INFER_MIN_ACCUM_COUNT,
  minPrintSize: env.DARK_INFER_MIN_PRINT_SIZE,
  maxEvidence: env.DARK_INFER_MAX_EVIDENCE,
  maxSpreadPct: env.DARK_INFER_MAX_SPREAD_PCT,
  maxQuoteAgeMs: env.EQUITY_QUOTE_MAX_AGE_MS
};

const retry = async <T>(
  label: string,
  attempts: number,
  delayMs: number,
  task: () => Promise<T>
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      logger.warn(`${label} attempt failed`, {
        attempt,
        error: error instanceof Error ? error.message : String(error)
      });

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError ?? new Error(`${label} failed after retries`);
};

const roundTo = (value: number, digits = 4): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
};

const getErrorCode = (error: unknown): string | null => {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  if (error instanceof Error) {
    const match = error.message.match(/\bCONNECTION_(?:DRAINING|CLOSED)\b/);
    if (match?.[0]) {
      return match[0];
    }
  }

  if (typeof error === "string") {
    const match = error.match(/\bCONNECTION_(?:DRAINING|CLOSED)\b/);
    if (match?.[0]) {
      return match[0];
    }
  }

  return null;
};

type NbboPlacement = "AA" | "A" | "B" | "BB" | "MID" | "MISSING" | "STALE";

type NbboPlacementCounts = {
  aa: number;
  a: number;
  b: number;
  bb: number;
  mid: number;
  missing: number;
  stale: number;
};

type ClusterState = {
  contractId: string;
  underlyingId: string | null;
  optionType: string | null;
  isEtf: boolean | null;
  startTs: number;
  endTs: number;
  startSourceTs: number;
  endIngestTs: number;
  endSeq: number;
  members: string[];
  totalSize: number;
  totalPremium: number;
  firstPrice: number;
  lastPrice: number;
  conditions: Set<string>;
  specialPrintCount: number;
  firstExecutionIv: number | null;
  lastExecutionIv: number | null;
  minExecutionIv: number | null;
  maxExecutionIv: number | null;
  firstUnderlyingMid: number | null;
  lastUnderlyingMid: number | null;
  placements: NbboPlacementCounts;
  flushed: boolean;
};

const clusters = new Map<string, ClusterState>();
const nbboCache = new Map<string, OptionNBBO>();
const equityQuoteCache = new Map<string, EquityQuote>();
const darkInferenceState = createDarkInferenceState();
const nbboCacheTouchedAt = new Map<string, number>();
const equityQuoteCacheTouchedAt = new Map<string, number>();
const darkInferenceTouchedAt = new Map<string, number>();
const recentLegsByKey = new Map<string, LegEvidence[]>();
const recentLegsByRoot = new Map<string, LegEvidence[]>();
const recentStructureEmits = new Map<string, number>();
const runtimeState = {
  shuttingDown: false,
  shutdownPromise: null as Promise<void> | null
};

const MAX_RECENT_LEGS = 20;
const EQUITY_QUOTE_CACHE_MAX_KEYS = 2_000;
const EQUITY_QUOTE_CACHE_TTL_MS = 900_000;
const DARK_INFERENCE_TTL_MS = 900_000;
const CACHE_PRUNE_INTERVAL_MS = 60_000;

const emitCounters = {
  flowPackets: 0,
  structurePackets: 0,
  smartFlowProjections: 0,
  smartFlowAbstentions: 0,
  smartFlowAlerts: 0,
  equityJoins: 0,
  darkEvents: 0
};
const nativeSmartFlowRuntime = new NativeSmartFlowRuntime();

const rollingKey = (metric: string, contractId: string): string => {
  return `rolling:${metric}:${contractId}`;
};

const buildPacketId = (cluster: ClusterState): string => {
  return `flowpacket:${cluster.contractId}:${cluster.startTs}:${cluster.endTs}`;
};

const isExpectedShutdownNatsError = (error: unknown): boolean => {
  const code = getErrorCode(error);
  return (
    runtimeState.shuttingDown && (code === "CONNECTION_DRAINING" || code === "CONNECTION_CLOSED")
  );
};

const createPlacementCounts = (): NbboPlacementCounts => ({
  aa: 0,
  a: 0,
  b: 0,
  bb: 0,
  mid: 0,
  missing: 0,
  stale: 0
});

const SPECIAL_PRINT_CONDITIONS = new Set([
  "AUCTION",
  "CROSS",
  "OPENING",
  "CLOSING",
  "COMPLEX",
  "SPREAD"
]);
const SYNTHETIC_EVENT_CONDITION_RE = /^EVENT_(\d+)D$/i;

const normalizeConditions = (conditions: readonly string[] | undefined): string[] =>
  (conditions ?? []).map((condition) => condition.trim().toUpperCase()).filter(Boolean);

const hasSpecialCondition = (conditions: readonly string[] | undefined): boolean =>
  normalizeConditions(conditions).some((condition) => SPECIAL_PRINT_CONDITIONS.has(condition));

const parseSyntheticEventOffsetDays = (conditions: Iterable<string>): number | null => {
  for (const condition of conditions) {
    const match = SYNTHETIC_EVENT_CONDITION_RE.exec(condition);
    if (!match) {
      continue;
    }
    const days = Number(match[1]);
    if (Number.isFinite(days) && days > 0) {
      return days;
    }
  }
  return null;
};

const recordPlacement = (counts: NbboPlacementCounts, placement: NbboPlacement): void => {
  switch (placement) {
    case "AA":
      counts.aa += 1;
      break;
    case "A":
      counts.a += 1;
      break;
    case "B":
      counts.b += 1;
      break;
    case "BB":
      counts.bb += 1;
      break;
    case "MID":
      counts.mid += 1;
      break;
    case "STALE":
      counts.stale += 1;
      break;
    case "MISSING":
    default:
      counts.missing += 1;
      break;
  }
};

const buildLegFromCluster = (cluster: ClusterState): LegEvidence | null => {
  const parsed = parseContractId(cluster.contractId);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    contractId: cluster.contractId,
    startTs: cluster.startTs,
    endTs: cluster.endTs,
    members: cluster.members.slice(),
    totalSize: cluster.totalSize,
    totalPremium: cluster.totalPremium,
    placements: {
      aa: cluster.placements.aa,
      a: cluster.placements.a,
      b: cluster.placements.b,
      bb: cluster.placements.bb,
      mid: cluster.placements.mid,
      missing: cluster.placements.missing,
      stale: cluster.placements.stale
    },
    source_ts: cluster.startSourceTs,
    ingest_ts: cluster.endIngestTs,
    seq: cluster.endSeq
  };
};

const buildLegKey = (leg: ContractLeg): string => {
  return `${leg.root}:${leg.expiry}`;
};

const buildRootKey = (leg: ContractLeg): string => {
  return leg.root;
};

const isWithinStructureWindow = (anchorTs: number, candidateTs: number): boolean => {
  return Math.abs(anchorTs - candidateTs) <= env.CLUSTER_WINDOW_MS;
};

const collectRecentLegs = (key: string, anchorTs: number, excludeId: string): LegEvidence[] => {
  const recent = recentLegsByKey.get(key) ?? [];
  const filtered = recent.filter(
    (leg) => leg.contractId !== excludeId && isWithinStructureWindow(anchorTs, leg.endTs)
  );
  recentLegsByKey.set(key, filtered);
  return filtered;
};

const storeRecentLeg = (leg: LegEvidence, anchorTs: number): void => {
  const key = buildLegKey(leg);
  const recent = collectRecentLegs(key, anchorTs, "");
  const next = [leg, ...recent].slice(0, MAX_RECENT_LEGS);
  recentLegsByKey.set(key, next);
};

const collectRecentRootLegs = (key: string, anchorTs: number, excludeId: string): LegEvidence[] => {
  const recent = recentLegsByRoot.get(key) ?? [];
  const filtered = recent.filter(
    (leg) => leg.contractId !== excludeId && isWithinStructureWindow(anchorTs, leg.endTs)
  );
  recentLegsByRoot.set(key, filtered);
  return filtered;
};

const storeRecentRootLeg = (leg: LegEvidence, anchorTs: number): void => {
  const key = buildRootKey(leg);
  const recent = collectRecentRootLegs(key, anchorTs, "");
  const next = [leg, ...recent].slice(0, MAX_RECENT_LEGS);
  recentLegsByRoot.set(key, next);
};

const collectActiveLegs = (key: string, anchorTs: number, excludeId: string): LegEvidence[] => {
  const legs: LegEvidence[] = [];
  for (const [contractId, cluster] of clusters) {
    if (contractId === excludeId) {
      continue;
    }
    const leg = buildLegFromCluster(cluster);
    if (!leg) {
      continue;
    }
    if (buildLegKey(leg) !== key) {
      continue;
    }
    if (!isWithinStructureWindow(anchorTs, leg.endTs)) {
      continue;
    }
    legs.push(leg);
  }
  return legs;
};

const collectActiveRootLegs = (key: string, anchorTs: number, excludeId: string): LegEvidence[] => {
  const legs: LegEvidence[] = [];
  for (const [contractId, cluster] of clusters) {
    if (contractId === excludeId) {
      continue;
    }
    const leg = buildLegFromCluster(cluster);
    if (!leg) {
      continue;
    }
    if (buildRootKey(leg) !== key) {
      continue;
    }
    if (!isWithinStructureWindow(anchorTs, leg.endTs)) {
      continue;
    }
    legs.push(leg);
  }
  return legs;
};

const STRUCTURE_TYPES = new Set(["straddle", "strangle", "vertical", "ladder", "roll"]);
const MAX_RECENT_STRUCTURE_EMITS = 2000;

const pruneRecentStructureEmits = (anchorTs: number): void => {
  const ttl = env.CLUSTER_WINDOW_MS * 5;
  for (const [key, ts] of recentStructureEmits) {
    if (anchorTs - ts > ttl) {
      recentStructureEmits.delete(key);
    }
  }

  if (recentStructureEmits.size <= MAX_RECENT_STRUCTURE_EMITS) {
    return;
  }

  const overflow = recentStructureEmits.size - MAX_RECENT_STRUCTURE_EMITS;
  let removed = 0;
  for (const key of recentStructureEmits.keys()) {
    recentStructureEmits.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
};

const emitStructurePacketIfNeeded = async (
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  batchWriter: ClickHouseBatchWriter,
  legs: LegEvidence[],
  summary: ReturnType<typeof summarizeStructure>,
  currentContractId: string
): Promise<void> => {
  if (!summary) {
    return;
  }

  if (!STRUCTURE_TYPES.has(summary.type)) {
    return;
  }

  if (!shouldEmitStructurePacket(legs, currentContractId)) {
    return;
  }

  const plan = planStructurePacket(legs, summary, env.CLUSTER_WINDOW_MS);
  if (!plan) {
    return;
  }

  pruneRecentStructureEmits(plan.endTs);
  const lastEmitTs = recentStructureEmits.get(plan.dedupeKey);
  if (typeof lastEmitTs === "number" && plan.endTs - lastEmitTs <= env.CLUSTER_WINDOW_MS) {
    return;
  }

  recentStructureEmits.set(plan.dedupeKey, plan.endTs);
  const packet = buildStructureFlowPacket(plan, summary);
  const validated = FlowPacketSchema.parse(packet);

  enqueueFlowPacketInsert(batchWriter, validated);
  await publishJson(js, SUBJECT_FLOW_PACKETS, validated);
  emitCounters.flowPackets += 1;
  emitCounters.structurePackets += 1;
  await emitNativeSmartFlow(js, batchWriter, validated);
};

const applyDeliverPolicy = (
  opts: ReturnType<typeof buildDurableConsumer>,
  policy: typeof env.COMPUTE_DELIVER_POLICY
) => {
  switch (policy) {
    case "all":
      opts.deliverAll();
      break;
    case "last":
      opts.deliverLast();
      break;
    case "last_per_subject":
      opts.deliverLastPerSubject();
      break;
    case "new":
    default:
      opts.deliverNew();
      break;
  }
};

const buildCluster = (print: OptionPrint): ClusterState => {
  const placements = createPlacementCounts();
  const normalizedConditions = normalizeConditions(print.conditions);
  const executionIv =
    typeof print.execution_iv === "number" && Number.isFinite(print.execution_iv)
      ? print.execution_iv
      : null;
  const executionUnderlyingMid =
    typeof print.execution_underlying_mid === "number" &&
    Number.isFinite(print.execution_underlying_mid)
      ? print.execution_underlying_mid
      : null;
  recordPlacement(
    placements,
    classifyPlacement(print.price, selectNbbo(print.option_contract_id, print.ts))
  );
  return {
    contractId: print.option_contract_id,
    underlyingId: print.underlying_id ?? null,
    optionType: print.option_type ?? null,
    isEtf: typeof print.is_etf === "boolean" ? print.is_etf : null,
    startTs: print.ts,
    endTs: print.ts,
    startSourceTs: print.source_ts,
    endIngestTs: print.ingest_ts,
    endSeq: print.seq,
    members: [print.trace_id],
    totalSize: print.size,
    totalPremium: print.price * print.size,
    firstPrice: print.price,
    lastPrice: print.price,
    conditions: new Set(normalizedConditions),
    specialPrintCount: hasSpecialCondition(print.conditions) ? 1 : 0,
    firstExecutionIv: executionIv,
    lastExecutionIv: executionIv,
    minExecutionIv: executionIv,
    maxExecutionIv: executionIv,
    firstUnderlyingMid: executionUnderlyingMid,
    lastUnderlyingMid: executionUnderlyingMid,
    placements,
    flushed: false
  };
};

const updateCluster = (cluster: ClusterState, print: OptionPrint): ClusterState => {
  if (!cluster.underlyingId && print.underlying_id) {
    cluster.underlyingId = print.underlying_id;
  }
  if (!cluster.optionType && print.option_type) {
    cluster.optionType = print.option_type;
  }
  if (cluster.isEtf === null && typeof print.is_etf === "boolean") {
    cluster.isEtf = print.is_etf;
  }
  cluster.endTs = Math.max(cluster.endTs, print.ts);
  cluster.endIngestTs = Math.max(cluster.endIngestTs, print.ingest_ts);
  cluster.endSeq = Math.max(cluster.endSeq, print.seq);
  cluster.members.push(print.trace_id);
  cluster.totalSize += print.size;
  cluster.totalPremium += print.price * print.size;
  cluster.lastPrice = print.price;
  for (const condition of normalizeConditions(print.conditions)) {
    cluster.conditions.add(condition);
  }
  if (hasSpecialCondition(print.conditions)) {
    cluster.specialPrintCount += 1;
  }
  if (typeof print.execution_iv === "number" && Number.isFinite(print.execution_iv)) {
    cluster.lastExecutionIv = print.execution_iv;
    cluster.minExecutionIv =
      cluster.minExecutionIv === null
        ? print.execution_iv
        : Math.min(cluster.minExecutionIv, print.execution_iv);
    cluster.maxExecutionIv =
      cluster.maxExecutionIv === null
        ? print.execution_iv
        : Math.max(cluster.maxExecutionIv, print.execution_iv);
  }
  if (
    typeof print.execution_underlying_mid === "number" &&
    Number.isFinite(print.execution_underlying_mid)
  ) {
    if (cluster.firstUnderlyingMid === null) {
      cluster.firstUnderlyingMid = print.execution_underlying_mid;
    }
    cluster.lastUnderlyingMid = print.execution_underlying_mid;
  }
  recordPlacement(
    cluster.placements,
    classifyPlacement(print.price, selectNbbo(print.option_contract_id, print.ts))
  );
  return cluster;
};

type NbboJoin = {
  nbbo: OptionNBBO | null;
  ageMs: number;
  stale: boolean;
};

const updateNbboCache = (nbbo: OptionNBBO): void => {
  const existing = nbboCache.get(nbbo.option_contract_id);
  if (!existing || nbbo.ts > existing.ts || (nbbo.ts === existing.ts && nbbo.seq >= existing.seq)) {
    nbboCache.set(nbbo.option_contract_id, nbbo);
    nbboCacheTouchedAt.set(nbbo.option_contract_id, Date.now());
  }
};

const updateEquityQuoteCache = (quote: EquityQuote): void => {
  const existing = equityQuoteCache.get(quote.underlying_id);
  if (
    !existing ||
    quote.ts > existing.ts ||
    (quote.ts === existing.ts && quote.seq >= existing.seq)
  ) {
    equityQuoteCache.set(quote.underlying_id, quote);
    equityQuoteCacheTouchedAt.set(quote.underlying_id, Date.now());
  }
};

const selectNbbo = (contractId: string, ts: number): NbboJoin => {
  const nbbo = nbboCache.get(contractId) ?? null;
  if (!nbbo) {
    return { nbbo: null, ageMs: env.NBBO_MAX_AGE_MS + 1, stale: true };
  }

  nbboCacheTouchedAt.set(contractId, Date.now());
  const ageMs = Math.abs(ts - nbbo.ts);
  const stale = ageMs > env.NBBO_MAX_AGE_MS;
  return { nbbo, ageMs, stale };
};

const selectEquityQuote = (underlyingId: string, ts: number): EquityQuoteJoin => {
  const quote = equityQuoteCache.get(underlyingId) ?? null;
  if (!quote) {
    return { quote: null, ageMs: env.EQUITY_QUOTE_MAX_AGE_MS + 1, stale: true };
  }

  equityQuoteCacheTouchedAt.set(underlyingId, Date.now());
  const ageMs = Math.abs(ts - quote.ts);
  const stale = ageMs > env.EQUITY_QUOTE_MAX_AGE_MS;
  return { quote, ageMs, stale };
};

const pruneTimedMap = <T>(
  values: Map<string, T>,
  touchedAt: Map<string, number>,
  maxKeys: number,
  ttlMs: number,
  now = Date.now()
): number => {
  let removed = 0;

  for (const [key, touched] of touchedAt) {
    if (now - touched > ttlMs) {
      touchedAt.delete(key);
      values.delete(key);
      removed += 1;
    }
  }

  if (values.size <= maxKeys) {
    return removed;
  }

  const overflow = values.size - maxKeys;
  const oldest = [...touchedAt.entries()].sort((a, b) => a[1] - b[1]).slice(0, overflow);
  for (const [key] of oldest) {
    touchedAt.delete(key);
    values.delete(key);
    removed += 1;
  }

  return removed;
};

const pruneComputeCaches = (rollingStore: RollingWindowStore, now = Date.now()) => {
  const nbboRemoved = pruneTimedMap(
    nbboCache,
    nbboCacheTouchedAt,
    env.COMPUTE_NBBO_CACHE_MAX_KEYS,
    env.COMPUTE_NBBO_CACHE_TTL_MS,
    now
  );
  const quoteRemoved = pruneTimedMap(
    equityQuoteCache,
    equityQuoteCacheTouchedAt,
    EQUITY_QUOTE_CACHE_MAX_KEYS,
    EQUITY_QUOTE_CACHE_TTL_MS,
    now
  );
  const darkRemoved = pruneTimedMap(
    darkInferenceState.lastEmittedByUnderlying,
    darkInferenceTouchedAt,
    EQUITY_QUOTE_CACHE_MAX_KEYS,
    DARK_INFERENCE_TTL_MS,
    now
  );
  const rollingRemoved = rollingStore.prune(now);

  logger.info("compute cache summary", {
    nbbo_cache_size: nbboCache.size,
    equity_quote_cache_size: equityQuoteCache.size,
    dark_inference_cache_size: darkInferenceState.lastEmittedByUnderlying.size,
    rolling_cache_size: rollingStore.size,
    removed: nbboRemoved + quoteRemoved + darkRemoved + rollingRemoved
  });
};

const classifyPlacement = (price: number, join: NbboJoin): NbboPlacement => {
  if (!Number.isFinite(price)) {
    return "MISSING";
  }
  if (!join.nbbo) {
    return "MISSING";
  }
  if (join.stale) {
    return "STALE";
  }

  const bid = join.nbbo.bid;
  const ask = join.nbbo.ask;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask <= 0) {
    return "MISSING";
  }

  const spread = Math.max(0, ask - bid);
  const epsilon = Math.max(0.01, spread * 0.05);

  if (price > ask + epsilon) {
    return "AA";
  }
  if (price >= ask - epsilon) {
    return "A";
  }
  if (price < bid - epsilon) {
    return "BB";
  }
  if (price <= bid + epsilon) {
    return "B";
  }

  return "MID";
};

const flushCluster = async (
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  batchWriter: ClickHouseBatchWriter,
  rollingStore: RollingWindowStore,
  cluster: ClusterState
): Promise<void> => {
  if (cluster.flushed) {
    return;
  }

  cluster.flushed = true;
  const joinQuality: Record<string, number> = {};
  const nbboJoin = selectNbbo(cluster.contractId, cluster.endTs);
  const packetId = buildPacketId(cluster);

  const totalPremium = roundTo(cluster.totalPremium);
  const totalNotional = roundTo(totalPremium * 100, 2);

  const features: Record<string, string | number | boolean> = {
    option_contract_id: cluster.contractId,
    count: cluster.members.length,
    total_size: cluster.totalSize,
    total_premium: totalPremium,
    total_notional: totalNotional,
    first_price: cluster.firstPrice,
    last_price: cluster.lastPrice,
    start_ts: cluster.startTs,
    end_ts: cluster.endTs,
    window_ms: env.CLUSTER_WINDOW_MS
  };

  const parsedContract = parseContractId(cluster.contractId);
  if (parsedContract?.root) {
    features.underlying_id = parsedContract.root;
    const quoteJoin = selectEquityQuote(parsedContract.root, cluster.endTs);
    if (!quoteJoin.quote) {
      joinQuality.underlying_quote_missing = 1;
    } else {
      joinQuality.underlying_quote_age_ms = quoteJoin.ageMs;
      if (quoteJoin.stale) {
        joinQuality.underlying_quote_stale = 1;
      } else {
        const bid = quoteJoin.quote.bid;
        const ask = quoteJoin.quote.ask;
        if (Number.isFinite(bid) && Number.isFinite(ask) && ask > 0) {
          const mid = (bid + ask) / 2;
          const spread = ask - bid;
          features.underlying_quote_ts = quoteJoin.quote.ts;
          features.underlying_bid = bid;
          features.underlying_ask = ask;
          features.underlying_mid = roundTo(mid);
          features.underlying_spread = roundTo(spread);
        } else {
          joinQuality.underlying_quote_missing = 1;
        }
      }
    }
  }
  if (cluster.underlyingId) {
    features.underlying_id = cluster.underlyingId;
  }
  if (cluster.optionType) {
    features.option_type = cluster.optionType;
  }
  if (cluster.isEtf !== null) {
    features.is_etf = cluster.isEtf;
  }
  if (cluster.conditions.size > 0) {
    features.conditions = Array.from(cluster.conditions).sort().join(",");
  }
  if (cluster.specialPrintCount > 0) {
    features.special_print_count = cluster.specialPrintCount;
  }
  if (cluster.lastExecutionIv !== null) {
    features.execution_iv = roundTo(cluster.lastExecutionIv);
  }
  if (cluster.minExecutionIv !== null && cluster.maxExecutionIv !== null) {
    features.execution_iv_shock = roundTo(
      Math.max(0, cluster.maxExecutionIv - cluster.minExecutionIv)
    );
  }
  if (
    cluster.firstUnderlyingMid !== null &&
    cluster.lastUnderlyingMid !== null &&
    cluster.firstUnderlyingMid > 0
  ) {
    const moveBps =
      ((cluster.lastUnderlyingMid - cluster.firstUnderlyingMid) / cluster.firstUnderlyingMid) *
      10_000;
    features.underlying_move_bps = roundTo(moveBps);
  }
  const syntheticEventOffsetDays = parseSyntheticEventOffsetDays(cluster.conditions);
  if (syntheticEventOffsetDays !== null) {
    features.corporate_event_ts = cluster.endTs + syntheticEventOffsetDays * 86_400_000;
  }

  const placementTotal =
    cluster.placements.aa +
    cluster.placements.a +
    cluster.placements.b +
    cluster.placements.bb +
    cluster.placements.mid;
  const aggressiveTotal =
    cluster.placements.aa + cluster.placements.a + cluster.placements.b + cluster.placements.bb;
  const aggressiveBuy = cluster.placements.aa + cluster.placements.a;
  const aggressiveSell = cluster.placements.bb + cluster.placements.b;
  const coverageRatio = cluster.members.length > 0 ? placementTotal / cluster.members.length : 0;
  const aggressiveBuyRatio = aggressiveTotal > 0 ? aggressiveBuy / aggressiveTotal : 0;
  const aggressiveSellRatio = aggressiveTotal > 0 ? aggressiveSell / aggressiveTotal : 0;
  const insideRatio = placementTotal > 0 ? cluster.placements.mid / placementTotal : 0;
  const aggressiveRatio = placementTotal > 0 ? aggressiveTotal / placementTotal : 0;

  features.nbbo_aa_count = cluster.placements.aa;
  features.nbbo_a_count = cluster.placements.a;
  features.nbbo_b_count = cluster.placements.b;
  features.nbbo_bb_count = cluster.placements.bb;
  features.nbbo_mid_count = cluster.placements.mid;
  features.nbbo_missing_count = cluster.placements.missing;
  features.nbbo_stale_count = cluster.placements.stale;
  features.nbbo_coverage_ratio = roundTo(coverageRatio);
  features.nbbo_aggressive_buy_ratio = roundTo(aggressiveBuyRatio);
  features.nbbo_aggressive_sell_ratio = roundTo(aggressiveSellRatio);
  features.nbbo_inside_ratio = roundTo(insideRatio);
  features.nbbo_aggressive_ratio = roundTo(aggressiveRatio);

  joinQuality.nbbo_coverage_ratio = roundTo(coverageRatio);

  const addRollingSnapshot = async (
    metric: string,
    value: number,
    prefix: string
  ): Promise<void> => {
    try {
      const snapshot = rollingStore.update(rollingKey(metric, cluster.contractId), value);
      features[`${prefix}_mean`] = roundTo(snapshot.mean);
      features[`${prefix}_std`] = roundTo(snapshot.stddev);
      features[`${prefix}_z`] = roundTo(snapshot.zscore);
      features[`${prefix}_baseline_n`] = snapshot.baselineCount;
    } catch (error) {
      logger.warn("rolling stats update failed", {
        metric,
        contract: cluster.contractId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  await addRollingSnapshot("premium", totalPremium, "total_premium");
  await addRollingSnapshot("size", cluster.totalSize, "total_size");

  const currentLeg = buildLegFromCluster(cluster);
  if (currentLeg) {
    const key = buildLegKey(currentLeg);
    const anchorTs = cluster.endTs;
    const candidates = [
      ...collectRecentLegs(key, anchorTs, currentLeg.contractId),
      ...collectActiveLegs(key, anchorTs, currentLeg.contractId)
    ];
    const legs = [currentLeg, ...candidates];
    const summary = summarizeStructure(legs);
    if (summary) {
      features.structure_type = summary.type;
      features.structure_legs = summary.legs;
      features.structure_strikes = summary.strikes;
      features.structure_strike_span = roundTo(summary.strikeSpan);
      features.structure_rights = summary.rights;
    }

    try {
      await emitStructurePacketIfNeeded(js, batchWriter, legs, summary, currentLeg.contractId);
    } catch (error) {
      if (isExpectedShutdownNatsError(error)) {
        logger.info("skipped structure packet publish during shutdown", {
          contract: currentLeg.contractId,
          error: getErrorCode(error) ?? (error instanceof Error ? error.message : String(error))
        });
        return;
      }
      cluster.flushed = false;
      throw error;
    }

    const rootKey = buildRootKey(currentLeg);
    const rootCandidates = [
      ...collectRecentRootLegs(rootKey, anchorTs, currentLeg.contractId),
      ...collectActiveRootLegs(rootKey, anchorTs, currentLeg.contractId)
    ];
    const rollLegs = [currentLeg, ...rootCandidates];
    const rollSummary = summarizeStructure(rollLegs);
    if (rollSummary?.type === "roll") {
      try {
        await emitStructurePacketIfNeeded(
          js,
          batchWriter,
          rollLegs,
          rollSummary,
          currentLeg.contractId
        );
      } catch (error) {
        if (isExpectedShutdownNatsError(error)) {
          logger.info("skipped structure roll packet publish during shutdown", {
            contract: currentLeg.contractId,
            error: getErrorCode(error) ?? (error instanceof Error ? error.message : String(error))
          });
          return;
        }
        cluster.flushed = false;
        throw error;
      }
    }

    storeRecentLeg(currentLeg, anchorTs);
    storeRecentRootLeg(currentLeg, anchorTs);
  }

  if (!nbboJoin.nbbo) {
    joinQuality.nbbo_missing = 1;
  } else {
    joinQuality.nbbo_age_ms = nbboJoin.ageMs;
    if (nbboJoin.stale) {
      joinQuality.nbbo_stale = 1;
    } else {
      const mid = (nbboJoin.nbbo.bid + nbboJoin.nbbo.ask) / 2;
      const spread = nbboJoin.nbbo.ask - nbboJoin.nbbo.bid;
      features.nbbo_bid = nbboJoin.nbbo.bid;
      features.nbbo_ask = nbboJoin.nbbo.ask;
      features.nbbo_mid = roundTo(mid);
      features.nbbo_spread = roundTo(spread);
      features.nbbo_bid_size = nbboJoin.nbbo.bidSize;
      features.nbbo_ask_size = nbboJoin.nbbo.askSize;
      await addRollingSnapshot("spread", roundTo(spread), "nbbo_spread");
    }
  }

  const packet: FlowPacket = {
    source_ts: cluster.startSourceTs,
    ingest_ts: cluster.endIngestTs,
    seq: cluster.endSeq,
    trace_id: packetId,
    id: packetId,
    members: cluster.members,
    features,
    join_quality: joinQuality
  };

  const validated = FlowPacketSchema.parse(packet);
  try {
    enqueueFlowPacketInsert(batchWriter, validated);
    await publishJson(js, SUBJECT_FLOW_PACKETS, validated);
    emitCounters.flowPackets += 1;
    await emitNativeSmartFlow(js, batchWriter, validated);
  } catch (error) {
    if (isExpectedShutdownNatsError(error)) {
      logger.info("skipped flow packet publish during shutdown", {
        id: packetId,
        contract: cluster.contractId,
        error: getErrorCode(error) ?? (error instanceof Error ? error.message : String(error))
      });
      return;
    }

    cluster.flushed = false;
    throw error;
  }
};

const emitNativeSmartFlow = async (
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  batchWriter: ClickHouseBatchWriter,
  packet: FlowPacket
): Promise<void> => {
  const flush = nativeSmartFlowRuntime.ingest(packet);
  try {
    await publishNativeSmartFlowFlush(js, batchWriter, flush);
  } catch (error) {
    if (isExpectedShutdownNatsError(error)) {
      throw error;
    }
    logger.error("failed to emit native smart-flow projection", {
      error: error instanceof Error ? error.message : String(error),
      packet_id: packet.id,
      projection_count: flush.projections.length
    });
    throw error;
  }
};

const flushNativeSmartFlow = async (
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  batchWriter: ClickHouseBatchWriter
): Promise<void> => {
  await publishNativeSmartFlowFlush(js, batchWriter, nativeSmartFlowRuntime.collectAll());
};

const publishNativeSmartFlowFlush = async (
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  batchWriter: ClickHouseBatchWriter,
  flush: NativeSmartFlowProjectionFlush
): Promise<void> => {
  const emissions = planSmartFlowAlertEmissions(flush.projections);

  for (const { projection, alert } of emissions) {
    enqueueSmartFlowProjectionInsert(batchWriter, projection);
    await publishJson(js, SUBJECT_SMART_FLOW, projection);
    emitCounters.smartFlowProjections += 1;
    if (projection.abstention.abstained) {
      emitCounters.smartFlowAbstentions += 1;
    }
    if (alert) {
      enqueueSmartFlowAlertInsert(batchWriter, alert);
      await publishJson(js, SUBJECT_SMART_FLOW_ALERTS, alert);
      emitCounters.smartFlowAlerts += 1;
    }
  }
  flush.commit();
};

const emitEquityJoin = async (
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  batchWriter: ClickHouseBatchWriter,
  print: EquityPrint
): Promise<void> => {
  const join = selectEquityQuote(print.underlying_id, print.ts);
  const payload: EquityPrintJoin = EquityPrintJoinSchema.parse(buildEquityPrintJoin(print, join));

  try {
    enqueueEquityPrintJoinInsert(batchWriter, payload);
  } catch (error) {
    if (isExpectedShutdownNatsError(error)) {
      return;
    }

    logger.error("failed to queue equity print join", {
      error: error instanceof Error ? error.message : String(error),
      trace_id: payload.trace_id
    });
    return;
  }

  try {
    await publishJson(js, SUBJECT_EQUITY_JOINS, payload);
    emitCounters.equityJoins += 1;
  } catch (error) {
    if (isExpectedShutdownNatsError(error)) {
      return;
    }
    logger.error("failed to publish equity print join", {
      error: error instanceof Error ? error.message : String(error),
      trace_id: payload.trace_id
    });
  }

  await emitDarkInferences(js, batchWriter, payload);
};

const emitDarkInferences = async (
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  batchWriter: ClickHouseBatchWriter,
  join: EquityPrintJoin
): Promise<void> => {
  const events = evaluateDarkInferences(join, darkInferenceConfig, darkInferenceState);
  for (const event of events) {
    const validated: InferredDarkEvent = InferredDarkEventSchema.parse(event);
    try {
      enqueueInferredDarkInsert(batchWriter, validated);
      await publishJson(js, SUBJECT_INFERRED_DARK, validated);
      emitCounters.darkEvents += 1;
      const underlyingId =
        typeof join.features?.underlying_id === "string" ? join.features.underlying_id : null;
      if (underlyingId) {
        darkInferenceTouchedAt.set(underlyingId, Date.now());
      }
    } catch (error) {
      if (isExpectedShutdownNatsError(error)) {
        continue;
      }
      logger.error("failed to emit inferred dark event", {
        error: error instanceof Error ? error.message : String(error),
        trace_id: validated.trace_id
      });
    }
  }
};

const flushEligibleClusters = async (
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  batchWriter: ClickHouseBatchWriter,
  rollingStore: RollingWindowStore,
  currentTs: number,
  skipContractId: string
): Promise<void> => {
  for (const [contractId, cluster] of clusters) {
    if (contractId === skipContractId) {
      continue;
    }

    if (currentTs - cluster.endTs > env.CLUSTER_WINDOW_MS) {
      await flushCluster(js, batchWriter, rollingStore, cluster);
      clusters.delete(contractId);
    }
  }
};

const run = async () => {
  logger.info("service starting");

  const { nc, js, jsm } = await connectJetStreamWithRetry(
    {
      servers: env.NATS_URL,
      name: service
    },
    { attempts: 120, delayMs: 500 }
  );

  await ensureKnownStreams(
    jsm,
    [
      STREAM_OPTION_SIGNAL_PRINTS,
      STREAM_OPTION_NBBO,
      STREAM_EQUITY_PRINTS,
      STREAM_EQUITY_QUOTES,
      STREAM_FLOW_PACKETS,
      STREAM_SMART_FLOW,
      STREAM_SMART_FLOW_ALERTS,
      STREAM_EQUITY_JOINS,
      STREAM_INFERRED_DARK
    ],
    { logger }
  );

  const clickhouse = createClickHouseClient({
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DATABASE
  });

  const redis = createRedisClient(env.REDIS_URL);
  redis.on("error", (error) => {
    logger.warn("redis client error", {
      error: error instanceof Error ? error.message : String(error)
    });
  });

  await retry("redis connect", 120, 500, async () => {
    await redis.connect();
  });

  const rollingConfig: RollingStatsConfig = {
    windowSize: env.ROLLING_WINDOW_SIZE,
    ttlSeconds: env.ROLLING_TTL_SEC
  };
  const rollingStore = new RollingWindowStore({
    ...rollingConfig,
    flushIntervalMs: env.ROLLING_CACHE_FLUSH_INTERVAL_MS,
    maxKeys: env.ROLLING_CACHE_MAX_KEYS
  } satisfies RollingWindowStoreConfig);
  const batchWriter = new ClickHouseBatchWriter(clickhouse, {
    flushIntervalMs: 100,
    maxRows: 250,
    onError: (table, error, rowCount) => {
      logger.error("batched clickhouse insert failed", {
        table,
        row_count: rowCount,
        error: error instanceof Error ? error.message : String(error),
        action: "dropped"
      });
    }
  });
  const rollingFlushTimer = setInterval(() => {
    void rollingStore.flushToRedis(redis);
  }, env.ROLLING_CACHE_FLUSH_INTERVAL_MS);
  const pruneTimer = setInterval(() => {
    pruneComputeCaches(rollingStore);
  }, CACHE_PRUNE_INTERVAL_MS);
  const summaryTimer = setInterval(() => {
    logger.info("compute minute summary", {
      flow_packets_emitted: emitCounters.flowPackets,
      structure_packets_emitted: emitCounters.structurePackets,
      smart_flow_projections_emitted: emitCounters.smartFlowProjections,
      smart_flow_projections_abstained: emitCounters.smartFlowAbstentions,
      smart_flow_alerts_emitted: emitCounters.smartFlowAlerts,
      equity_joins_emitted: emitCounters.equityJoins,
      dark_events_emitted: emitCounters.darkEvents,
      rolling_stats_cache_size: rollingStore.size
    });
    emitCounters.flowPackets = 0;
    emitCounters.structurePackets = 0;
    emitCounters.smartFlowProjections = 0;
    emitCounters.smartFlowAbstentions = 0;
    emitCounters.smartFlowAlerts = 0;
    emitCounters.equityJoins = 0;
    emitCounters.darkEvents = 0;
  }, 60_000);
  rollingFlushTimer.unref?.();
  pruneTimer.unref?.();
  summaryTimer.unref?.();

  await retry("clickhouse table init", 120, 500, async () => {
    await ensureFlowPacketsTable(clickhouse);
    await ensureSmartFlowProjectionsTable(clickhouse);
    await ensureSmartFlowAlertsTable(clickhouse);
    await ensureEquityPrintJoinsTable(clickhouse);
    await ensureInferredDarkTable(clickhouse);
  });

  const durableName = "compute-option-prints";
  const nbboDurableName = "compute-option-nbbo";
  const equityPrintDurableName = "compute-equity-prints";
  const equityQuoteDurableName = "compute-equity-quotes";

  if (env.COMPUTE_CONSUMER_RESET) {
    try {
      await jsm.consumers.delete(STREAM_OPTION_SIGNAL_PRINTS, durableName);
      logger.warn("reset jetstream consumer", { durable: durableName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to reset jetstream consumer", { durable: durableName, error: message });
      }
    }
  } else {
    try {
      const info = await jsm.consumers.info(STREAM_OPTION_SIGNAL_PRINTS, durableName);
      if (
        info?.config?.deliver_policy &&
        info.config.deliver_policy !== env.COMPUTE_DELIVER_POLICY
      ) {
        logger.warn("resetting consumer due to deliver policy change", {
          durable: durableName,
          current: info.config.deliver_policy,
          desired: env.COMPUTE_DELIVER_POLICY
        });
        await jsm.consumers.delete(STREAM_OPTION_SIGNAL_PRINTS, durableName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to inspect jetstream consumer", {
          durable: durableName,
          error: message
        });
      }
    }
  }

  if (env.COMPUTE_CONSUMER_RESET) {
    try {
      await jsm.consumers.delete(STREAM_OPTION_NBBO, nbboDurableName);
      logger.warn("reset jetstream consumer", { durable: nbboDurableName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to reset jetstream consumer", {
          durable: nbboDurableName,
          error: message
        });
      }
    }
  } else {
    try {
      const info = await jsm.consumers.info(STREAM_OPTION_NBBO, nbboDurableName);
      if (
        info?.config?.deliver_policy &&
        info.config.deliver_policy !== env.COMPUTE_DELIVER_POLICY
      ) {
        logger.warn("resetting consumer due to deliver policy change", {
          durable: nbboDurableName,
          current: info.config.deliver_policy,
          desired: env.COMPUTE_DELIVER_POLICY
        });
        await jsm.consumers.delete(STREAM_OPTION_NBBO, nbboDurableName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to inspect jetstream consumer", {
          durable: nbboDurableName,
          error: message
        });
      }
    }
  }

  if (env.COMPUTE_CONSUMER_RESET) {
    try {
      await jsm.consumers.delete(STREAM_EQUITY_PRINTS, equityPrintDurableName);
      logger.warn("reset jetstream consumer", { durable: equityPrintDurableName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to reset jetstream consumer", {
          durable: equityPrintDurableName,
          error: message
        });
      }
    }
  } else {
    try {
      const info = await jsm.consumers.info(STREAM_EQUITY_PRINTS, equityPrintDurableName);
      if (
        info?.config?.deliver_policy &&
        info.config.deliver_policy !== env.COMPUTE_DELIVER_POLICY
      ) {
        logger.warn("resetting consumer due to deliver policy change", {
          durable: equityPrintDurableName,
          current: info.config.deliver_policy,
          desired: env.COMPUTE_DELIVER_POLICY
        });
        await jsm.consumers.delete(STREAM_EQUITY_PRINTS, equityPrintDurableName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to inspect jetstream consumer", {
          durable: equityPrintDurableName,
          error: message
        });
      }
    }
  }

  if (env.COMPUTE_CONSUMER_RESET) {
    try {
      await jsm.consumers.delete(STREAM_EQUITY_QUOTES, equityQuoteDurableName);
      logger.warn("reset jetstream consumer", { durable: equityQuoteDurableName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to reset jetstream consumer", {
          durable: equityQuoteDurableName,
          error: message
        });
      }
    }
  } else {
    try {
      const info = await jsm.consumers.info(STREAM_EQUITY_QUOTES, equityQuoteDurableName);
      if (
        info?.config?.deliver_policy &&
        info.config.deliver_policy !== env.COMPUTE_DELIVER_POLICY
      ) {
        logger.warn("resetting consumer due to deliver policy change", {
          durable: equityQuoteDurableName,
          current: info.config.deliver_policy,
          desired: env.COMPUTE_DELIVER_POLICY
        });
        await jsm.consumers.delete(STREAM_EQUITY_QUOTES, equityQuoteDurableName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to inspect jetstream consumer", {
          durable: equityQuoteDurableName,
          error: message
        });
      }
    }
  }

  const subscription = await (async () => {
    const opts = buildDurableConsumer(durableName);
    applyDeliverPolicy(opts, env.COMPUTE_DELIVER_POLICY);
    try {
      return await subscribeJson(js, SUBJECT_OPTION_SIGNAL_PRINTS, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldReset =
        message.includes("duplicate subscription") ||
        message.includes("durable requires") ||
        message.includes("subject does not match consumer");

      if (!shouldReset) {
        throw error;
      }

      logger.warn("resetting jetstream consumer", { durable: durableName, error: message });

      try {
        await jsm.consumers.delete(STREAM_OPTION_SIGNAL_PRINTS, durableName);
      } catch (deleteError) {
        const deleteMessage =
          deleteError instanceof Error ? deleteError.message : String(deleteError);
        if (!deleteMessage.includes("not found")) {
          logger.warn("failed to delete jetstream consumer", {
            durable: durableName,
            error: deleteMessage
          });
        }
      }

      const resetOpts = buildDurableConsumer(durableName);
      applyDeliverPolicy(resetOpts, env.COMPUTE_DELIVER_POLICY);
      return await subscribeJson(js, SUBJECT_OPTION_SIGNAL_PRINTS, resetOpts);
    }
  })();

  const nbboSubscription = await (async () => {
    const opts = buildDurableConsumer(nbboDurableName);
    applyDeliverPolicy(opts, env.COMPUTE_DELIVER_POLICY);
    try {
      return await subscribeJson(js, SUBJECT_OPTION_NBBO, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldReset =
        message.includes("duplicate subscription") ||
        message.includes("durable requires") ||
        message.includes("subject does not match consumer");

      if (!shouldReset) {
        throw error;
      }

      logger.warn("resetting jetstream consumer", { durable: nbboDurableName, error: message });

      try {
        await jsm.consumers.delete(STREAM_OPTION_NBBO, nbboDurableName);
      } catch (deleteError) {
        const deleteMessage =
          deleteError instanceof Error ? deleteError.message : String(deleteError);
        if (!deleteMessage.includes("not found")) {
          logger.warn("failed to delete jetstream consumer", {
            durable: nbboDurableName,
            error: deleteMessage
          });
        }
      }

      const resetOpts = buildDurableConsumer(nbboDurableName);
      applyDeliverPolicy(resetOpts, env.COMPUTE_DELIVER_POLICY);
      return await subscribeJson(js, SUBJECT_OPTION_NBBO, resetOpts);
    }
  })();

  const equitySubscription = await (async () => {
    const opts = buildDurableConsumer(equityPrintDurableName);
    applyDeliverPolicy(opts, env.COMPUTE_DELIVER_POLICY);
    try {
      return await subscribeJson(js, SUBJECT_EQUITY_PRINTS, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldReset =
        message.includes("duplicate subscription") ||
        message.includes("durable requires") ||
        message.includes("subject does not match consumer");

      if (!shouldReset) {
        throw error;
      }

      logger.warn("resetting jetstream consumer", {
        durable: equityPrintDurableName,
        error: message
      });

      try {
        await jsm.consumers.delete(STREAM_EQUITY_PRINTS, equityPrintDurableName);
      } catch (deleteError) {
        const deleteMessage =
          deleteError instanceof Error ? deleteError.message : String(deleteError);
        if (!deleteMessage.includes("not found")) {
          logger.warn("failed to delete jetstream consumer", {
            durable: equityPrintDurableName,
            error: deleteMessage
          });
        }
      }

      const resetOpts = buildDurableConsumer(equityPrintDurableName);
      applyDeliverPolicy(resetOpts, env.COMPUTE_DELIVER_POLICY);
      return await subscribeJson(js, SUBJECT_EQUITY_PRINTS, resetOpts);
    }
  })();

  const equityQuoteSubscription = await (async () => {
    const opts = buildDurableConsumer(equityQuoteDurableName);
    applyDeliverPolicy(opts, env.COMPUTE_DELIVER_POLICY);
    try {
      return await subscribeJson(js, SUBJECT_EQUITY_QUOTES, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldReset =
        message.includes("duplicate subscription") ||
        message.includes("durable requires") ||
        message.includes("subject does not match consumer");

      if (!shouldReset) {
        throw error;
      }

      logger.warn("resetting jetstream consumer", {
        durable: equityQuoteDurableName,
        error: message
      });

      try {
        await jsm.consumers.delete(STREAM_EQUITY_QUOTES, equityQuoteDurableName);
      } catch (deleteError) {
        const deleteMessage =
          deleteError instanceof Error ? deleteError.message : String(deleteError);
        if (!deleteMessage.includes("not found")) {
          logger.warn("failed to delete jetstream consumer", {
            durable: equityQuoteDurableName,
            error: deleteMessage
          });
        }
      }

      const resetOpts = buildDurableConsumer(equityQuoteDurableName);
      applyDeliverPolicy(resetOpts, env.COMPUTE_DELIVER_POLICY);
      return await subscribeJson(js, SUBJECT_EQUITY_QUOTES, resetOpts);
    }
  })();

  const nbboLoop = async () => {
    for await (const msg of nbboSubscription.messages) {
      if (runtimeState.shuttingDown) {
        break;
      }

      try {
        const nbbo = OptionNBBOSchema.parse(nbboSubscription.decode(msg));
        updateNbboCache(nbbo);
        msg.ack();
      } catch (error) {
        logger.error("failed to process option nbbo", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const equityQuoteLoop = async () => {
    for await (const msg of equityQuoteSubscription.messages) {
      if (runtimeState.shuttingDown) {
        break;
      }

      try {
        const quote = EquityQuoteSchema.parse(equityQuoteSubscription.decode(msg));
        updateEquityQuoteCache(quote);
        msg.ack();
      } catch (error) {
        logger.error("failed to process equity quote", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const equityPrintLoop = async () => {
    for await (const msg of equitySubscription.messages) {
      if (runtimeState.shuttingDown) {
        break;
      }

      try {
        const print = EquityPrintSchema.parse(equitySubscription.decode(msg));
        await emitEquityJoin(js, batchWriter, print);
        msg.ack();
      } catch (error) {
        logger.error("failed to process equity print", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  void nbboLoop();
  void equityQuoteLoop();
  void equityPrintLoop();

  const shutdown = async (signal: string) => {
    if (runtimeState.shutdownPromise) {
      await runtimeState.shutdownPromise;
      return;
    }

    runtimeState.shuttingDown = true;
    runtimeState.shutdownPromise = (async () => {
      logger.info("service stopping", { signal });
      clearInterval(rollingFlushTimer);
      clearInterval(pruneTimer);
      clearInterval(summaryTimer);

      for (const cluster of [...clusters.values()]) {
        await flushCluster(js, batchWriter, rollingStore, cluster);
      }
      clusters.clear();
      await flushNativeSmartFlow(js, batchWriter);
      await batchWriter.close();
      await rollingStore.flushToRedis(redis);

      try {
        await nc.drain();
      } catch (error) {
        if (!isExpectedShutdownNatsError(error)) {
          throw error;
        }
      }

      await clickhouse.close();
      if (redis.isOpen) {
        await redis.quit();
      }
    })();

    try {
      await runtimeState.shutdownPromise;
      process.exit(0);
    } catch (error) {
      logger.error("service shutdown failed", {
        error: error instanceof Error ? error.message : String(error)
      });

      try {
        await clickhouse.close();
      } catch {}

      try {
        if (redis.isOpen) {
          await redis.quit();
        }
      } catch {}

      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  for await (const msg of subscription.messages) {
    if (runtimeState.shuttingDown) {
      break;
    }

    try {
      const print = OptionPrintSchema.parse(subscription.decode(msg));
      await flushEligibleClusters(
        js,
        batchWriter,
        rollingStore,
        print.ts,
        print.option_contract_id
      );

      if (runtimeState.shuttingDown) {
        break;
      }

      const existing = clusters.get(print.option_contract_id);
      if (!existing) {
        clusters.set(print.option_contract_id, buildCluster(print));
      } else if (print.ts - existing.startTs <= env.CLUSTER_WINDOW_MS) {
        updateCluster(existing, print);
      } else {
        await flushCluster(js, batchWriter, rollingStore, existing);
        clusters.set(print.option_contract_id, buildCluster(print));
      }

      msg.ack();
    } catch (error) {
      logger.error("failed to process option print", {
        error: error instanceof Error ? error.message : String(error)
      });
      msg.term();
    }
  }
};

await run();
