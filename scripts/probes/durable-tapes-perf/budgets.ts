import { DEFAULT_DURATION_MS, THREE_MINUTE_BUDGETS } from "./constants";
import type { BudgetResult, SanitySnapshot, SerializedMetricWindow } from "./types";

type BudgetMetrics = Pick<
  SerializedMetricWindow,
  | "totalNetworkRequestCount"
  | "optionsSupportRequestCount"
  | "optionPrintsByTraceRequestCount"
  | "abortedRequestCount"
  | "abortedEndpointRequestCount"
  | "supportEvidenceErrorResponses"
> & {
  taskDurationDeltaSeconds: number | null;
  scriptDurationDeltaSeconds: number | null;
  jsHeapUsedSizeDeltaBytes: number | null;
  domNodeCount: number | null;
};

const scaledBudget = (base: number, durationMs: number, minimum: number): number => {
  const scaled = Math.round(base * (durationMs / DEFAULT_DURATION_MS));
  return Math.max(minimum, scaled);
};

export const evaluateBudgets = ({
  metrics,
  sanity,
  durationMs,
  minVisiblePanes,
  minVisibleRows
}: {
  metrics: BudgetMetrics;
  sanity: SanitySnapshot;
  durationMs: number;
  minVisiblePanes: number;
  minVisibleRows: number;
}): BudgetResult[] => {
  const networkBudget = scaledBudget(THREE_MINUTE_BUDGETS.maxTotalNetworkRequests, durationMs, 100);
  const supportBudget = scaledBudget(
    THREE_MINUTE_BUDGETS.maxOptionsSupportRequests,
    durationMs,
    30
  );
  const evidenceBudget = scaledBudget(
    THREE_MINUTE_BUDGETS.maxOptionPrintsByTraceRequests,
    durationMs,
    30
  );
  const abortBudget = scaledBudget(THREE_MINUTE_BUDGETS.maxAbortedRequests, durationMs, 5);
  const endpointAbortBudget = scaledBudget(
    THREE_MINUTE_BUDGETS.maxAbortedEndpointRequests,
    durationMs,
    2
  );
  const endpointErrorBudget = scaledBudget(
    THREE_MINUTE_BUDGETS.maxSupportEvidenceErrorResponses,
    durationMs,
    4
  );
  const taskBudget = scaledBudget(THREE_MINUTE_BUDGETS.maxTaskDurationSeconds, durationMs, 8);
  const scriptBudget = scaledBudget(THREE_MINUTE_BUDGETS.maxScriptDurationSeconds, durationMs, 6);
  const heapBudget = scaledBudget(
    THREE_MINUTE_BUDGETS.maxJsHeapUsedSizeDeltaBytes,
    durationMs,
    48 * 1024 * 1024
  );

  const valueOrInfinity = (value: number | null) => value ?? Number.POSITIVE_INFINITY;

  return [
    {
      name: "total network requests",
      actual: metrics.totalNetworkRequestCount,
      limit: networkBudget,
      pass: metrics.totalNetworkRequestCount <= networkBudget,
      unit: "requests"
    },
    {
      name: "/lookup/options-support requests",
      actual: metrics.optionsSupportRequestCount,
      limit: supportBudget,
      pass: metrics.optionsSupportRequestCount <= supportBudget,
      unit: "requests"
    },
    {
      name: "/option-prints/by-trace requests",
      actual: metrics.optionPrintsByTraceRequestCount,
      limit: evidenceBudget,
      pass: metrics.optionPrintsByTraceRequestCount <= evidenceBudget,
      unit: "requests"
    },
    {
      name: "aborted requests",
      actual: metrics.abortedRequestCount,
      limit: abortBudget,
      pass: metrics.abortedRequestCount <= abortBudget,
      unit: "requests"
    },
    {
      name: "aborted support/evidence requests",
      actual: metrics.abortedEndpointRequestCount,
      limit: endpointAbortBudget,
      pass: metrics.abortedEndpointRequestCount <= endpointAbortBudget,
      unit: "requests"
    },
    {
      name: "support/evidence error responses",
      actual: metrics.supportEvidenceErrorResponses,
      limit: endpointErrorBudget,
      pass: metrics.supportEvidenceErrorResponses <= endpointErrorBudget,
      unit: "responses"
    },
    {
      name: "CDP TaskDuration delta",
      actual: valueOrInfinity(metrics.taskDurationDeltaSeconds),
      limit: taskBudget,
      pass: valueOrInfinity(metrics.taskDurationDeltaSeconds) <= taskBudget,
      unit: "seconds"
    },
    {
      name: "CDP ScriptDuration delta",
      actual: valueOrInfinity(metrics.scriptDurationDeltaSeconds),
      limit: scriptBudget,
      pass: valueOrInfinity(metrics.scriptDurationDeltaSeconds) <= scriptBudget,
      unit: "seconds"
    },
    {
      name: "JSHeapUsedSize delta",
      actual: valueOrInfinity(metrics.jsHeapUsedSizeDeltaBytes),
      limit: heapBudget,
      pass: valueOrInfinity(metrics.jsHeapUsedSizeDeltaBytes) <= heapBudget,
      unit: "bytes"
    },
    {
      name: "DOM node count",
      actual: valueOrInfinity(metrics.domNodeCount),
      limit: THREE_MINUTE_BUDGETS.maxDomNodeCount,
      pass: valueOrInfinity(metrics.domNodeCount) <= THREE_MINUTE_BUDGETS.maxDomNodeCount,
      unit: "nodes"
    },
    {
      name: "visible durable pane count",
      actual: sanity.visibleDurablePaneCount,
      limit: minVisiblePanes,
      pass: sanity.visibleDurablePaneCount >= minVisiblePanes,
      unit: "minimum panes"
    },
    {
      name: "visible durable row count",
      actual: sanity.visibleRowCount,
      limit: minVisibleRows,
      pass: sanity.visibleRowCount >= minVisibleRows,
      unit: "minimum rows"
    }
  ];
};
