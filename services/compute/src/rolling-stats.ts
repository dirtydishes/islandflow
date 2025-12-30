import { createClient } from "redis";

export type RollingStatsConfig = {
  windowSize: number;
  ttlSeconds: number;
};

export type RollingSnapshot = {
  baselineCount: number;
  mean: number;
  stddev: number;
  zscore: number;
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

export const updateRollingStats = async (
  client: ReturnType<typeof createClient>,
  key: string,
  value: number,
  config: RollingStatsConfig
): Promise<RollingSnapshot> => {
  const limit = Math.max(0, config.windowSize - 1);
  const existing = await client.lRange(key, 0, limit);
  const baseline = toNumbers(existing);
  const snapshot = computeSnapshot(baseline, value);

  const multi = client.multi();
  multi.lPush(key, value.toString());
  if (config.windowSize > 0) {
    multi.lTrim(key, 0, config.windowSize - 1);
  }
  if (config.ttlSeconds > 0) {
    multi.expire(key, config.ttlSeconds);
  }
  await multi.exec();

  return snapshot;
};
