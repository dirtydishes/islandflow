import type {
  DurableTapeSmartFlowSupportResolution,
  FlowPacket,
  OptionNBBO,
  OptionPrint
} from "@islandflow/types";

import { buildApiUrl, readErrorDetail } from "./transport";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Deferred = {
  resolve: () => void;
  reject: (error: unknown) => void;
};
type EndpointName = "optionSupport" | "optionPrints" | "flowPackets";

export type OptionSupportNbboContext = {
  trace_id: string;
  option_contract_id: string;
  ts: number;
};

export type OptionSupportRequest = {
  traceIds?: string[];
  nbboContext?: OptionSupportNbboContext[];
};

export type OptionSmartFlowSupportResolution = DurableTapeSmartFlowSupportResolution;

export type OptionSupportResult = {
  packets: FlowPacket[];
  smartFlowSupportByTraceId: Map<string, OptionSmartFlowSupportResolution>;
  nbboByTraceId: Record<string, OptionNBBO | null>;
};

export type OptionPrintLookupResult = {
  prints: OptionPrint[];
  missingTraceIds: string[];
};

export type FlowPacketLookupResult = {
  packets: FlowPacket[];
  missingPacketIds: string[];
};

type OptionSupportPayload = {
  packets?: FlowPacket[];
  support_by_trace_id?: Record<string, OptionSmartFlowSupportResolution>;
  nbbo_by_trace_id?: Record<string, OptionNBBO | null>;
};

export type HydrationSchedulerConfig = {
  fetcher?: Fetcher;
  now?: () => number;
  batchDelayMs?: number;
  supportBatchDelayMs?: number;
  optionPrintBatchSize?: number;
  flowPacketBatchSize?: number;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  maxEntries?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
};

const DEFAULT_BATCH_DELAY_MS = 25;
const DEFAULT_SUPPORT_BATCH_DELAY_MS = 3_000;
const DEFAULT_OPTION_PRINT_BATCH_SIZE = 100;
const DEFAULT_FLOW_PACKET_BATCH_SIZE = 12;
const DEFAULT_POSITIVE_TTL_MS = 5 * 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 2_000;
const DEFAULT_BACKOFF_BASE_MS = 2_000;
const DEFAULT_BACKOFF_MAX_MS = 30_000;

const supportTraceKey = (traceId: string): string => `trace:${traceId}`;
const supportNbboKey = (traceId: string): string => `nbbo:${traceId}`;

export const normalizeHydrationIds = (ids: Iterable<string | null | undefined>): string[] =>
  Array.from(new Set(Array.from(ids, (id) => id?.trim() ?? "").filter(Boolean))).sort();

const normalizeNbboContext = (
  context: Iterable<OptionSupportNbboContext | null | undefined>
): OptionSupportNbboContext[] => {
  const byTraceId = new Map<string, OptionSupportNbboContext>();
  for (const item of context) {
    const traceId = item?.trace_id.trim() ?? "";
    const contractId = item?.option_contract_id.trim() ?? "";
    const ts = item?.ts;
    if (!traceId || !contractId || typeof ts !== "number" || !Number.isFinite(ts)) {
      continue;
    }
    byTraceId.set(traceId, {
      trace_id: traceId,
      option_contract_id: contractId,
      ts
    });
  }
  return Array.from(byTraceId.values()).sort((left, right) => {
    const traceCompare = left.trace_id.localeCompare(right.trace_id);
    if (traceCompare !== 0) {
      return traceCompare;
    }
    const contractCompare = left.option_contract_id.localeCompare(right.option_contract_id);
    if (contractCompare !== 0) {
      return contractCompare;
    }
    return left.ts - right.ts;
  });
};

export const stableHydrationKey = (ids: Iterable<string | null | undefined>): string =>
  normalizeHydrationIds(ids).join("\n");

export const stableOptionSupportNbboKey = (
  context: Iterable<OptionSupportNbboContext | null | undefined>
): string =>
  normalizeNbboContext(context)
    .map((item) => `${item.trace_id}\t${item.option_contract_id}\t${item.ts}`)
    .join("\n");

class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number
  ) {}

  getEntry(key: string): { value: T } | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value };
  }

  has(key: string): boolean {
    return this.getEntry(key) !== null;
  }

  set(key: string, value: T, ttlMs = this.ttlMs): void {
    if (this.maxEntries <= 0 || ttlMs <= 0) {
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (typeof firstKey !== "string") {
        break;
      }
      this.entries.delete(firstKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export class HydrationScheduler {
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly batchDelayMs: number;
  private readonly supportBatchDelayMs: number;
  private readonly optionPrintBatchSize: number;
  private readonly flowPacketBatchSize: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;

  private readonly optionPrintByTraceId: TtlCache<OptionPrint>;
  private readonly optionPrintMisses: TtlCache<true>;
  private readonly flowPacketById: TtlCache<FlowPacket>;
  private readonly flowPacketMisses: TtlCache<true>;
  private readonly supportByTraceId: TtlCache<OptionSmartFlowSupportResolution>;
  private readonly supportUnavailableByTraceId: TtlCache<OptionSmartFlowSupportResolution>;
  private readonly supportPacketByTraceId: TtlCache<FlowPacket>;
  private readonly supportTraceMisses: TtlCache<true>;
  private readonly supportNbboByTraceId: TtlCache<OptionNBBO>;
  private readonly supportNbboMisses: TtlCache<true>;

  private readonly backoff = new Map<EndpointName, { failureCount: number; until: number }>();

  private readonly pendingOptionPrintIds = new Set<string>();
  private readonly optionPrintWaiters = new Map<string, Deferred>();
  private readonly optionPrintInflight = new Map<string, Promise<void>>();
  private optionPrintTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly pendingFlowPacketIds = new Set<string>();
  private readonly flowPacketWaiters = new Map<string, Deferred>();
  private readonly flowPacketInflight = new Map<string, Promise<void>>();
  private flowPacketTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly pendingSupportTraceIds = new Set<string>();
  private readonly pendingSupportNbboContext = new Map<string, OptionSupportNbboContext>();
  private readonly supportWaiters = new Map<string, Deferred>();
  private readonly supportInflight = new Map<string, Promise<void>>();
  private supportTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: HydrationSchedulerConfig = {}) {
    this.fetcher = config.fetcher ?? ((input, init) => fetch(input, init));
    this.now = config.now ?? (() => Date.now());
    this.batchDelayMs = config.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
    this.supportBatchDelayMs =
      config.supportBatchDelayMs ?? config.batchDelayMs ?? DEFAULT_SUPPORT_BATCH_DELAY_MS;
    this.optionPrintBatchSize = config.optionPrintBatchSize ?? DEFAULT_OPTION_PRINT_BATCH_SIZE;
    this.flowPacketBatchSize = config.flowPacketBatchSize ?? DEFAULT_FLOW_PACKET_BATCH_SIZE;
    this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;

    const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const positiveTtlMs = config.positiveTtlMs ?? DEFAULT_POSITIVE_TTL_MS;
    const negativeTtlMs = config.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;

    this.optionPrintByTraceId = new TtlCache(maxEntries, positiveTtlMs, this.now);
    this.optionPrintMisses = new TtlCache(maxEntries, negativeTtlMs, this.now);
    this.flowPacketById = new TtlCache(maxEntries, positiveTtlMs, this.now);
    this.flowPacketMisses = new TtlCache(maxEntries, negativeTtlMs, this.now);
    this.supportByTraceId = new TtlCache(maxEntries, positiveTtlMs, this.now);
    this.supportUnavailableByTraceId = new TtlCache(maxEntries, negativeTtlMs, this.now);
    this.supportPacketByTraceId = new TtlCache(maxEntries, positiveTtlMs, this.now);
    this.supportTraceMisses = new TtlCache(maxEntries, negativeTtlMs, this.now);
    this.supportNbboByTraceId = new TtlCache(maxEntries, positiveTtlMs, this.now);
    this.supportNbboMisses = new TtlCache(maxEntries, negativeTtlMs, this.now);
  }

  async requestOptionSupport(input: OptionSupportRequest): Promise<OptionSupportResult> {
    const traceIds = normalizeHydrationIds(input.traceIds ?? []);
    const nbboContext = normalizeNbboContext(input.nbboContext ?? []);
    const promises = [
      ...traceIds.map((traceId) => this.queueSupportTrace(traceId)),
      ...nbboContext.map((context) => this.queueSupportNbbo(context))
    ];
    await Promise.all(promises);
    return this.collectOptionSupportResult(traceIds, nbboContext);
  }

  async requestOptionPrints(traceIds: string[]): Promise<OptionPrintLookupResult> {
    const ids = normalizeHydrationIds(traceIds);
    await Promise.all(ids.map((traceId) => this.queueOptionPrint(traceId)));

    const prints: OptionPrint[] = [];
    const missingTraceIds: string[] = [];
    for (const traceId of ids) {
      const entry = this.optionPrintByTraceId.getEntry(traceId);
      if (entry) {
        prints.push(entry.value);
      } else {
        missingTraceIds.push(traceId);
      }
    }
    return { prints, missingTraceIds };
  }

  async requestFlowPackets(packetIds: string[]): Promise<FlowPacketLookupResult> {
    const ids = normalizeHydrationIds(packetIds);
    await Promise.all(ids.map((packetId) => this.queueFlowPacket(packetId)));

    const packets: FlowPacket[] = [];
    const missingPacketIds: string[] = [];
    for (const packetId of ids) {
      const entry = this.flowPacketById.getEntry(packetId);
      if (entry) {
        packets.push(entry.value);
      } else {
        missingPacketIds.push(packetId);
      }
    }
    return { packets, missingPacketIds };
  }

  clear(): void {
    this.optionPrintByTraceId.clear();
    this.optionPrintMisses.clear();
    this.flowPacketById.clear();
    this.flowPacketMisses.clear();
    this.supportByTraceId.clear();
    this.supportUnavailableByTraceId.clear();
    this.supportPacketByTraceId.clear();
    this.supportTraceMisses.clear();
    this.supportNbboByTraceId.clear();
    this.supportNbboMisses.clear();
    this.backoff.clear();
  }

  private queueOptionPrint(traceId: string): Promise<void> {
    if (
      this.optionPrintByTraceId.has(traceId) ||
      this.optionPrintMisses.has(traceId) ||
      this.isBackedOff("optionPrints")
    ) {
      return Promise.resolve();
    }
    const existing = this.optionPrintInflight.get(traceId);
    if (existing) {
      return existing;
    }

    const promise = new Promise<void>((resolve, reject) => {
      this.optionPrintWaiters.set(traceId, { resolve, reject });
      this.pendingOptionPrintIds.add(traceId);
      this.scheduleOptionPrintFlush();
    });
    this.optionPrintInflight.set(traceId, promise);
    return promise;
  }

  private scheduleOptionPrintFlush(): void {
    if (this.optionPrintTimer) {
      return;
    }
    this.optionPrintTimer = setTimeout(() => {
      void this.flushOptionPrints();
    }, this.batchDelayMs);
  }

  private async flushOptionPrints(): Promise<void> {
    this.optionPrintTimer = null;
    const ids = Array.from(this.pendingOptionPrintIds);
    this.pendingOptionPrintIds.clear();

    for (let index = 0; index < ids.length; index += this.optionPrintBatchSize) {
      const batch = ids.slice(index, index + this.optionPrintBatchSize);
      if (this.isBackedOff("optionPrints")) {
        this.settleOptionPrints(batch);
        continue;
      }

      try {
        const prints = await this.fetchOptionPrintBatch(batch);
        const returned = new Set<string>();
        for (const print of prints) {
          if (!print.trace_id) {
            continue;
          }
          returned.add(print.trace_id);
          this.optionPrintByTraceId.set(print.trace_id, print);
        }
        for (const traceId of batch) {
          if (!returned.has(traceId)) {
            this.optionPrintMisses.set(traceId, true);
          }
        }
        this.recordEndpointSuccess("optionPrints");
        this.settleOptionPrints(batch);
      } catch (error) {
        this.recordEndpointFailure("optionPrints");
        this.settleOptionPrints(batch, error);
      }
    }
  }

  private settleOptionPrints(ids: string[], error?: unknown): void {
    for (const id of ids) {
      const waiter = this.optionPrintWaiters.get(id);
      if (error) {
        waiter?.reject(error);
      } else {
        waiter?.resolve();
      }
      this.optionPrintWaiters.delete(id);
      this.optionPrintInflight.delete(id);
    }
  }

  private async fetchOptionPrintBatch(traceIds: string[]): Promise<OptionPrint[]> {
    if (traceIds.length === 0) {
      return [];
    }
    const url = new URL(buildApiUrl("/option-prints/by-trace"));
    for (const traceId of traceIds) {
      url.searchParams.append("trace_id", traceId);
    }
    const response = await this.fetcher(url.toString());
    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      throw new Error(await readErrorDetail(response));
    }
    const payload = (await response.json()) as { data?: OptionPrint[] };
    return (payload.data ?? []).filter((item): item is OptionPrint => Boolean(item?.trace_id));
  }

  private queueFlowPacket(packetId: string): Promise<void> {
    if (
      this.flowPacketById.has(packetId) ||
      this.flowPacketMisses.has(packetId) ||
      this.isBackedOff("flowPackets")
    ) {
      return Promise.resolve();
    }
    const existing = this.flowPacketInflight.get(packetId);
    if (existing) {
      return existing;
    }

    const promise = new Promise<void>((resolve, reject) => {
      this.flowPacketWaiters.set(packetId, { resolve, reject });
      this.pendingFlowPacketIds.add(packetId);
      this.scheduleFlowPacketFlush();
    });
    this.flowPacketInflight.set(packetId, promise);
    return promise;
  }

  private scheduleFlowPacketFlush(): void {
    if (this.flowPacketTimer) {
      return;
    }
    this.flowPacketTimer = setTimeout(() => {
      void this.flushFlowPackets();
    }, this.batchDelayMs);
  }

  private async flushFlowPackets(): Promise<void> {
    this.flowPacketTimer = null;
    const ids = Array.from(this.pendingFlowPacketIds);
    this.pendingFlowPacketIds.clear();

    for (let index = 0; index < ids.length; index += this.flowPacketBatchSize) {
      const batch = ids.slice(index, index + this.flowPacketBatchSize);
      if (this.isBackedOff("flowPackets")) {
        this.settleFlowPackets(batch);
        continue;
      }

      const results = await Promise.all(
        batch.map(async (packetId) => {
          try {
            return { packetId, packet: await this.fetchFlowPacket(packetId) };
          } catch (error) {
            return { packetId, error };
          }
        })
      );

      let failed = false;
      for (const result of results) {
        if ("error" in result) {
          failed = true;
          this.settleFlowPacket(result.packetId, result.error);
          continue;
        }
        if (result.packet) {
          this.cacheFlowPacket(result.packet);
        } else {
          this.flowPacketMisses.set(result.packetId, true);
        }
        this.settleFlowPacket(result.packetId);
      }

      if (failed) {
        this.recordEndpointFailure("flowPackets");
      } else {
        this.recordEndpointSuccess("flowPackets");
      }
    }
  }

  private settleFlowPackets(ids: string[], error?: unknown): void {
    for (const id of ids) {
      this.settleFlowPacket(id, error);
    }
  }

  private settleFlowPacket(id: string, error?: unknown): void {
    const waiter = this.flowPacketWaiters.get(id);
    if (error) {
      waiter?.reject(error);
    } else {
      waiter?.resolve();
    }
    this.flowPacketWaiters.delete(id);
    this.flowPacketInflight.delete(id);
  }

  private async fetchFlowPacket(packetId: string): Promise<FlowPacket | null> {
    const response = await this.fetcher(
      buildApiUrl(`/flow/packets/${encodeURIComponent(packetId)}`)
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(await readErrorDetail(response));
    }
    const payload = (await response.json()) as { data?: FlowPacket | null };
    return payload.data ?? null;
  }

  private queueSupportTrace(traceId: string): Promise<void> {
    if (
      this.supportByTraceId.has(traceId) ||
      this.supportUnavailableByTraceId.has(traceId) ||
      this.supportTraceMisses.has(traceId) ||
      this.isBackedOff("optionSupport")
    ) {
      return Promise.resolve();
    }
    return this.queueSupportKey(supportTraceKey(traceId), () => {
      this.pendingSupportTraceIds.add(traceId);
    });
  }

  private queueSupportNbbo(context: OptionSupportNbboContext): Promise<void> {
    if (
      this.supportNbboByTraceId.has(context.trace_id) ||
      this.supportNbboMisses.has(context.trace_id) ||
      this.isBackedOff("optionSupport")
    ) {
      return Promise.resolve();
    }
    return this.queueSupportKey(supportNbboKey(context.trace_id), () => {
      this.pendingSupportNbboContext.set(context.trace_id, context);
    });
  }

  private queueSupportKey(key: string, queue: () => void): Promise<void> {
    const existing = this.supportInflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = new Promise<void>((resolve, reject) => {
      this.supportWaiters.set(key, { resolve, reject });
      queue();
      this.scheduleSupportFlush();
    });
    this.supportInflight.set(key, promise);
    return promise;
  }

  private scheduleSupportFlush(): void {
    if (this.supportTimer) {
      return;
    }
    this.supportTimer = setTimeout(() => {
      void this.flushOptionSupport();
    }, this.supportBatchDelayMs);
  }

  private async flushOptionSupport(): Promise<void> {
    this.supportTimer = null;
    const traceIds = Array.from(this.pendingSupportTraceIds);
    const nbboContext = Array.from(this.pendingSupportNbboContext.values());
    const waiterKeys = [
      ...traceIds.map((traceId) => supportTraceKey(traceId)),
      ...nbboContext.map((context) => supportNbboKey(context.trace_id))
    ];
    this.pendingSupportTraceIds.clear();
    this.pendingSupportNbboContext.clear();

    if (this.isBackedOff("optionSupport")) {
      this.settleSupport(waiterKeys);
      return;
    }

    try {
      const payload = await this.fetchOptionSupportBatch(traceIds, nbboContext);
      this.cacheOptionSupportPayload(payload, traceIds, nbboContext);
      this.recordEndpointSuccess("optionSupport");
      this.settleSupport(waiterKeys);
    } catch (error) {
      this.recordEndpointFailure("optionSupport");
      this.settleSupport(waiterKeys, error);
    }
  }

  private settleSupport(keys: string[], error?: unknown): void {
    for (const key of keys) {
      const waiter = this.supportWaiters.get(key);
      if (error) {
        waiter?.reject(error);
      } else {
        waiter?.resolve();
      }
      this.supportWaiters.delete(key);
      this.supportInflight.delete(key);
    }
  }

  private async fetchOptionSupportBatch(
    traceIds: string[],
    nbboContext: OptionSupportNbboContext[]
  ): Promise<OptionSupportPayload> {
    if (traceIds.length === 0 && nbboContext.length === 0) {
      return {};
    }
    const response = await this.fetcher(buildApiUrl("/lookup/options-support"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trace_ids: traceIds,
        nbbo_context: nbboContext
      })
    });
    if (response.status === 204) {
      return {};
    }
    if (!response.ok) {
      throw new Error(await readErrorDetail(response));
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        `Unexpected content type from /lookup/options-support: ${contentType || "unknown"}`
      );
    }
    return response.json() as Promise<OptionSupportPayload>;
  }

  private cacheOptionSupportPayload(
    payload: OptionSupportPayload,
    requestedTraceIds: string[],
    requestedNbboContext: OptionSupportNbboContext[]
  ): void {
    for (const packet of payload.packets ?? []) {
      this.cacheSupportPacket(packet);
    }

    for (const [traceId, support] of Object.entries(payload.support_by_trace_id ?? {})) {
      const resolution = {
        packet: support.packet ?? null,
        smart_flow_status: support.smart_flow_status,
        ...(support.smart_flow_unavailable_reason
          ? { smart_flow_unavailable_reason: support.smart_flow_unavailable_reason }
          : {}),
        smart_flow: support.smart_flow ?? null
      };
      if (resolution.smart_flow_status === "matched" && resolution.smart_flow) {
        this.supportByTraceId.set(traceId, resolution);
      } else {
        this.supportUnavailableByTraceId.set(traceId, resolution);
      }
      if (support.packet) {
        this.cacheSupportPacket(support.packet, [traceId]);
      }
    }

    const nbboByTraceId = payload.nbbo_by_trace_id ?? {};
    for (const [traceId, quote] of Object.entries(nbboByTraceId)) {
      if (quote) {
        this.supportNbboByTraceId.set(traceId, quote);
      } else {
        this.supportNbboMisses.set(traceId, true);
      }
    }
    for (const context of requestedNbboContext) {
      if (!(context.trace_id in nbboByTraceId)) {
        this.supportNbboMisses.set(context.trace_id, true);
      }
    }

    for (const traceId of requestedTraceIds) {
      if (this.supportByTraceId.has(traceId) || this.supportUnavailableByTraceId.has(traceId)) {
        continue;
      }
      const packet = this.supportPacketByTraceId.getEntry(traceId)?.value ?? null;
      if (packet) {
        this.supportUnavailableByTraceId.set(traceId, {
          packet,
          smart_flow_status: "smart_flow_unavailable",
          smart_flow_unavailable_reason:
            "no compact smart-flow support was returned for this option print",
          smart_flow: null
        });
      } else {
        this.supportTraceMisses.set(traceId, true);
      }
    }
  }

  private cacheSupportPacket(packet: FlowPacket, traceIds: readonly string[] = []): void {
    this.cacheFlowPacket(packet);
    for (const traceId of normalizeHydrationIds([
      packet.id,
      packet.trace_id,
      ...packet.members,
      ...traceIds
    ])) {
      this.supportPacketByTraceId.set(traceId, packet);
    }
  }

  private cacheFlowPacket(packet: FlowPacket): void {
    if (packet.id) {
      this.flowPacketById.set(packet.id, packet);
    }
    if (packet.trace_id) {
      this.flowPacketById.set(packet.trace_id, packet);
    }
  }

  private collectOptionSupportResult(
    traceIds: string[],
    nbboContext: OptionSupportNbboContext[]
  ): OptionSupportResult {
    const packets = new Map<string, FlowPacket>();
    const smartFlowSupportByTraceId = new Map<string, OptionSmartFlowSupportResolution>();
    for (const traceId of traceIds) {
      const support =
        this.supportByTraceId.getEntry(traceId)?.value ??
        this.supportUnavailableByTraceId.getEntry(traceId)?.value;
      if (support) {
        smartFlowSupportByTraceId.set(traceId, support);
      }
      const packet = support?.packet ?? this.supportPacketByTraceId.getEntry(traceId)?.value;
      if (!packet?.id) {
        continue;
      }
      packets.set(packet.id, packet);
    }

    const nbboByTraceId: Record<string, OptionNBBO | null> = {};
    for (const context of nbboContext) {
      const entry = this.supportNbboByTraceId.getEntry(context.trace_id);
      if (entry) {
        nbboByTraceId[context.trace_id] = entry.value;
      } else if (this.supportNbboMisses.has(context.trace_id)) {
        nbboByTraceId[context.trace_id] = null;
      }
    }

    return {
      packets: Array.from(packets.values()),
      smartFlowSupportByTraceId,
      nbboByTraceId
    };
  }

  private isBackedOff(endpoint: EndpointName): boolean {
    const state = this.backoff.get(endpoint);
    return Boolean(state && state.until > this.now());
  }

  private recordEndpointFailure(endpoint: EndpointName): void {
    const current = this.backoff.get(endpoint);
    const failureCount = (current?.failureCount ?? 0) + 1;
    const delay = Math.min(
      this.backoffMaxMs,
      this.backoffBaseMs * 2 ** Math.max(0, failureCount - 1)
    );
    this.backoff.set(endpoint, {
      failureCount,
      until: this.now() + delay
    });
  }

  private recordEndpointSuccess(endpoint: EndpointName): void {
    this.backoff.delete(endpoint);
  }
}

export const terminalHydrationScheduler = new HydrationScheduler();
