export const DEV_TAPE_DEBUG = process.env.NODE_ENV !== "production";

export type TapeDebugMetricKey =
  | "anchorRestoreCount"
  | "anchorRestoreFallbackCount"
  | "virtualRowMeasurementCount"
  | "focusSeedRowCount"
  | "scopedQuietTransitions";

export const frontendTapeDebugMetrics: Record<TapeDebugMetricKey, number> = {
  anchorRestoreCount: 0,
  anchorRestoreFallbackCount: 0,
  virtualRowMeasurementCount: 0,
  focusSeedRowCount: 0,
  scopedQuietTransitions: 0
};

export const bumpTapeDebugMetric = (key: TapeDebugMetricKey, count = 1): void => {
  frontendTapeDebugMetrics[key] += count;
  if (DEV_TAPE_DEBUG && typeof window !== "undefined") {
    (
      window as typeof window & { __IF_TAPE_DEBUG__?: Record<TapeDebugMetricKey, number> }
    ).__IF_TAPE_DEBUG__ = frontendTapeDebugMetrics;
  }
};

export const logTapeDebug = (message: string, payload?: Record<string, unknown>): void => {
  if (!DEV_TAPE_DEBUG) {
    return;
  }
  if (payload) {
    console.debug(`[tape] ${message}`, payload);
    return;
  }
  console.debug(`[tape] ${message}`);
};
