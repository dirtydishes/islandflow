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
  startedAtSeconds?: number;
};

export type EndpointLatencySummary = {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
  avg: number | null;
};

export type EndpointFailure = {
  endpoint: EndpointKind;
  status: number;
  method: string;
  url: string;
  origin: string | null;
  contentType: string | null;
};

export type MetricWindow = {
  label: "warmup" | "measurement";
  totalNetworkRequestCount: number;
  optionsSupportRequestCount: number;
  optionPrintsByTraceRequestCount: number;
  abortedRequestCount: number;
  abortedEndpointRequestCount: number;
  supportEvidenceStatusDistribution: Record<EndpointKind, Record<string, number>>;
  supportEvidenceOriginDistribution: Record<EndpointKind, Record<string, number>>;
  supportEvidenceContentTypeDistribution: Record<EndpointKind, Record<string, number>>;
  supportEvidenceHtmlResponseCount: number;
  supportEvidenceNonJsonResponseCount: number;
  endpointResponseLatenciesMs: Record<EndpointKind, number[]>;
  websocketFrameCount: number;
  websocketReceivedFrameCount: number;
  websocketSentFrameCount: number;
  websocketBytes: number;
  websocketReceivedBytes: number;
  websocketSentBytes: number;
  websocketErrorCount: number;
  topRequestCounts: Map<string, number>;
  endpointFailures: EndpointFailure[];
  requestsById: Map<string, RequestRecord>;
};

export type SerializedMetricWindow = {
  totalNetworkRequestCount: number;
  optionsSupportRequestCount: number;
  optionPrintsByTraceRequestCount: number;
  abortedRequestCount: number;
  abortedEndpointRequestCount: number;
  supportEvidenceStatusDistribution: Record<EndpointKind, Record<string, number>>;
  supportEvidenceOriginDistribution: Record<EndpointKind, Record<string, number>>;
  supportEvidenceContentTypeDistribution: Record<EndpointKind, Record<string, number>>;
  supportEvidenceErrorResponses: number;
  supportEvidenceHtmlResponseCount: number;
  supportEvidenceNonJsonResponseCount: number;
  supportEvidenceLatencyMs: Record<EndpointKind, EndpointLatencySummary>;
  websocketFrameCount: number;
  websocketReceivedFrameCount: number;
  websocketSentFrameCount: number;
  websocketBytes: number;
  websocketReceivedBytes: number;
  websocketSentBytes: number;
  websocketErrorCount: number;
  topRequests: Array<{ request: string; count: number }>;
  endpointFailures: EndpointFailure[];
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
