export type EndpointKind = "optionsSupport" | "optionPrintsByTrace";

export type CliOptions = {
  targetUrl: string;
  durationMs: number;
  warmupMs: number;
  outputPath?: string;
  cdpUrl?: string;
  browserPath?: string;
  headful: boolean;
  failOnBudget: boolean;
  minVisibleRows: number;
  minVisiblePanes: number;
};

export type ChromeLaunch = {
  browserName: string;
  cdpHttpUrl: string;
  process?: ReturnType<typeof Bun.spawn>;
  userDataDir?: string;
};

export type CdpPayload = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

export type CdpMetricSnapshot = {
  taskDurationSeconds: number | null;
  scriptDurationSeconds: number | null;
  jsHeapUsedSizeBytes: number | null;
  domNodeCount: number | null;
};

export type RequestRecord = {
  url: string;
  method: string;
  endpoint: EndpointKind | null;
};

export type MetricWindow = {
  label: "warmup" | "measurement";
  totalNetworkRequestCount: number;
  optionsSupportRequestCount: number;
  optionPrintsByTraceRequestCount: number;
  abortedRequestCount: number;
  abortedEndpointRequestCount: number;
  supportEvidenceStatusDistribution: Record<EndpointKind, Record<string, number>>;
  websocketFrameCount: number;
  websocketReceivedFrameCount: number;
  websocketSentFrameCount: number;
  websocketBytes: number;
  websocketReceivedBytes: number;
  websocketSentBytes: number;
  websocketErrorCount: number;
  topRequestCounts: Map<string, number>;
  endpointFailures: Array<{ endpoint: EndpointKind; status: number; method: string; url: string }>;
  requestsById: Map<string, RequestRecord>;
};

export type SerializedMetricWindow = {
  totalNetworkRequestCount: number;
  optionsSupportRequestCount: number;
  optionPrintsByTraceRequestCount: number;
  abortedRequestCount: number;
  abortedEndpointRequestCount: number;
  supportEvidenceStatusDistribution: Record<EndpointKind, Record<string, number>>;
  supportEvidenceErrorResponses: number;
  websocketFrameCount: number;
  websocketReceivedFrameCount: number;
  websocketSentFrameCount: number;
  websocketBytes: number;
  websocketReceivedBytes: number;
  websocketSentBytes: number;
  websocketErrorCount: number;
  topRequests: Array<{ request: string; count: number }>;
  endpointFailures: Array<{ endpoint: EndpointKind; status: number; method: string; url: string }>;
};

export type SanitySnapshot = {
  routePresent: boolean;
  pageTitle: string;
  visibleDurablePaneCount: number;
  visibleRowCount: number;
  paneRows: Array<{ key: string; title: string; visible: boolean; rowCount: number }>;
  bodyTextSample: string;
};

export type BudgetResult = {
  name: string;
  actual: number;
  limit: number;
  pass: boolean;
  unit: string;
};
