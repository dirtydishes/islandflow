export const DEFAULT_TARGET_URL = "http://localhost:3100/durable-tapes";
export const DEFAULT_DURATION_MS = 180_000;
export const DEFAULT_WARMUP_MS = 30_000;
export const DEFAULT_MIN_VISIBLE_PANES = 5;
export const DEFAULT_MIN_VISIBLE_ROWS = 1;

export const THREE_MINUTE_BUDGETS = {
  maxTotalNetworkRequests: 500,
  maxOptionsSupportRequests: 150,
  maxOptionPrintsByTraceRequests: 150,
  maxAbortedRequests: 20,
  maxAbortedEndpointRequests: 8,
  maxSupportEvidenceErrorResponses: 20,
  maxTaskDurationSeconds: 45,
  maxScriptDurationSeconds: 35,
  maxJsHeapUsedSizeDeltaBytes: 125 * 1024 * 1024,
  maxDomNodeCount: 35_000
};
