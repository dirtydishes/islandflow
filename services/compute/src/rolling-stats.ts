import { createClient } from "redis";

export type RollingStatsConfig = {
  windowSize: number;
  ttlSeconds: number;
};

export type RollingWindowStoreConfig = RollingStatsConfig & {
  flushIntervalMs: number;
  maxKeys: number;
};

export type RollingSnapshot = {
  baselineCount: number;
  mean: number;
  stddev: number;
  zscore: number;
};

type RollingWindowEntry = {
  values: number[];
  updatedAt: number;
  dirty: boolean;
};

const toNumbers = (values: string[]): number[] => {
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
};

export const computeStats = (values: number[]): { mean: number; stddev: number; count: number } => {
  const count = values.length;
  if (count === 0) {
    return { mean: 0, stddev: 0, count: 0 };
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    values.reduce((sum, value) => {
      const delta = value - mean;
      return sum + delta * delta;
    }, 0) / count;

  return { mean, stddev: Math.sqrt(variance), count };
};

export const computeSnapshot = (baseline: number[], value: number): RollingSnapshot => {
  const stats = computeStats(baseline);
  const zscore = stats.stddev === 0 ? 0 : (value - stats.mean) / stats.stddev;
  return {
    baselineCount: stats.count,
    mean: stats.mean,
    stddev: stats.stddev,
    zscore
  };
};

export const createRedisClient = (url: string) => {
  return createClient({ url });
};

const getOldestKey = (store: Map<string, RollingWindowEntry>): string | null => {
  let oldestKey: string | null = null;
  let oldestUpdatedAt = Number.POSITIVE_INFINITY;

  for (const [key, entry] of store) {
    if (entry.updatedAt < oldestUpdatedAt) {
      oldestUpdatedAt = entry.updatedAt;
      oldestKey = key;
    }
  }

  return oldestKey;
};

export class RollingWindowStore {
  private readonly store = new Map<string, RollingWindowEntry>();
  private readonly ttlMs: number;
  private readonly windowSize: number;
  private readonly maxKeys: number;

  constructor(private readonly config: RollingWindowStoreConfig) {
    this.ttlMs = Math.max(0, config.ttlSeconds * 1000);
    this.windowSize = Math.max(1, config.windowSize);
    this.maxKeys = Math.max(1, config.maxKeys);
  }

  get size(): number {
    return this.store.size;
  }

  update(key: string, value: number, now = Date.now()): RollingSnapshot {
    this.prune(now);

    const existing = this.store.get(key);
    const baseline = existing?.values ?? [];
    const snapshot = computeSnapshot(baseline, value);
    const nextValues = [value, ...baseline].slice(0, this.windowSize);

    this.store.set(key, {
      values: nextValues,
      updatedAt: now,
      dirty: true
    });

    this.enforceMaxKeys();
    return snapshot;
  }

  prune(now = Date.now()): number {
    if (this.ttlMs <= 0) {
      return 0;
    }

    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now - entry.updatedAt > this.ttlMs) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async hydrateFromRedis(
    client: ReturnType<typeof createClient>,
    keys: string[],
    now = Date.now()
  ): Promise<void> {
    for (const key of keys) {
      const values = toNumbers(await client.lRange(key, 0, this.windowSize - 1));
      if (values.length === 0) {
        continue;
      }
      this.store.set(key, {
        values,
        updatedAt: now,
        dirty: false
      });
    }
    this.enforceMaxKeys();
  }

  async flushToRedis(client: ReturnType<typeof createClient>): Promise<number> {
    let flushed = 0;
    for (const [key, entry] of this.store) {
      if (!entry.dirty) {
        continue;
      }

      const multi = client.multi();
      multi.lTrim(key, 1, 0);
      for (let idx = entry.values.length - 1; idx >= 0; idx -= 1) {
        const value = entry.values[idx];
        if (typeof value === "number" && Number.isFinite(value)) {
          multi.lPush(key, value.toString());
        }
      }
      if (this.config.ttlSeconds > 0) {
        multi.expire(key, this.config.ttlSeconds);
      }
      await multi.exec();
      entry.dirty = false;
      flushed += 1;
    }
    return flushed;
  }

  private enforceMaxKeys(): void {
    while (this.store.size > this.maxKeys) {
      const oldestKey = getOldestKey(this.store);
      if (!oldestKey) {
        break;
      }
      this.store.delete(oldestKey);
    }
  }
}
