import type { CdpClient } from "./cdp";
import { DEFAULT_MIN_VISIBLE_PANES } from "./constants";
import { sleep } from "./time";
import type {
  EndpointKind,
  EndpointLatencySummary,
  MetricWindow,
  SanitySnapshot,
  SerializedMetricWindow
} from "./types";

export const createMetricWindow = (label: MetricWindow["label"]): MetricWindow => ({
  label,
  totalNetworkRequestCount: 0,
  optionsSupportRequestCount: 0,
  optionPrintsByTraceRequestCount: 0,
  abortedRequestCount: 0,
  abortedEndpointRequestCount: 0,
  supportEvidenceStatusDistribution: {
    optionsSupport: {},
    optionPrintsByTrace: {}
  },
  supportEvidenceOriginDistribution: {
    optionsSupport: {},
    optionPrintsByTrace: {}
  },
  supportEvidenceContentTypeDistribution: {
    optionsSupport: {},
    optionPrintsByTrace: {}
  },
  supportEvidenceHtmlResponseCount: 0,
  supportEvidenceNonJsonResponseCount: 0,
  endpointResponseLatenciesMs: {
    optionsSupport: [],
    optionPrintsByTrace: []
  },
  websocketFrameCount: 0,
  websocketReceivedFrameCount: 0,
  websocketSentFrameCount: 0,
  websocketBytes: 0,
  websocketReceivedBytes: 0,
  websocketSentBytes: 0,
  websocketErrorCount: 0,
  topRequestCounts: new Map(),
  endpointFailures: [],
  requestsById: new Map()
});

const classifyEndpoint = (rawUrl: string): EndpointKind | null => {
  try {
    const url = new URL(rawUrl);
    if (url.pathname.includes("/lookup/options-support")) {
      return "optionsSupport";
    }
    if (url.pathname.includes("/option-prints/by-trace")) {
      return "optionPrintsByTrace";
    }
  } catch {
    return null;
  }
  return null;
};

const requestKey = (rawUrl: string, method: string): string => {
  try {
    const url = new URL(rawUrl);
    return `${method} ${url.origin}${url.pathname}`;
  } catch {
    return `${method} ${rawUrl}`;
  }
};

const countStatus = (distribution: Record<string, number>, status: number): void => {
  const key = String(status);
  distribution[key] = (distribution[key] ?? 0) + 1;
};

const countValue = (distribution: Record<string, number>, value: string): void => {
  distribution[value] = (distribution[value] ?? 0) + 1;
};

const getOrigin = (rawUrl: string): string | null => {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
};

const normalizeContentType = (mimeType?: string): string => {
  const normalized = mimeType?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : "unknown";
};

const countTopRequest = (window: MetricWindow, rawUrl: string, method: string): void => {
  const key = requestKey(rawUrl, method);
  window.topRequestCounts.set(key, (window.topRequestCounts.get(key) ?? 0) + 1);
};

const byteLength = (payloadData?: string): number => {
  if (!payloadData) {
    return 0;
  }
  return Buffer.byteLength(payloadData, "utf8");
};

export const attachCollectors = (client: CdpClient, getWindow: () => MetricWindow): void => {
  client.on("Network.requestWillBeSent", (params) => {
    const event = params as {
      requestId: string;
      timestamp?: number;
      request: { url: string; method: string };
    };
    const endpoint = classifyEndpoint(event.request.url);
    const window = getWindow();
    window.totalNetworkRequestCount += 1;
    if (endpoint === "optionsSupport") {
      window.optionsSupportRequestCount += 1;
    }
    if (endpoint === "optionPrintsByTrace") {
      window.optionPrintsByTraceRequestCount += 1;
    }
    window.requestsById.set(event.requestId, {
      url: event.request.url,
      method: event.request.method,
      endpoint,
      startedAtSeconds: event.timestamp
    });
    countTopRequest(window, event.request.url, event.request.method);
  });

  client.on("Network.responseReceived", (params) => {
    const event = params as {
      requestId: string;
      timestamp?: number;
      response: { status: number; url: string; mimeType?: string };
    };
    const window = getWindow();
    const request = window.requestsById.get(event.requestId);
    const endpoint = request?.endpoint ?? classifyEndpoint(event.response.url);
    if (!endpoint) {
      return;
    }
    const method = request?.method ?? "GET";
    const origin = getOrigin(event.response.url);
    const contentType = normalizeContentType(event.response.mimeType);
    const isEndpointDataResponse = method !== "OPTIONS" && event.response.status !== 204;

    countStatus(window.supportEvidenceStatusDistribution[endpoint], event.response.status);
    countValue(window.supportEvidenceOriginDistribution[endpoint], origin ?? "unknown");
    countValue(window.supportEvidenceContentTypeDistribution[endpoint], contentType);

    if (isEndpointDataResponse && contentType.includes("html")) {
      window.supportEvidenceHtmlResponseCount += 1;
    }
    if (isEndpointDataResponse && !contentType.includes("json")) {
      window.supportEvidenceNonJsonResponseCount += 1;
    }
    if (
      isEndpointDataResponse &&
      typeof event.timestamp === "number" &&
      typeof request?.startedAtSeconds === "number"
    ) {
      window.endpointResponseLatenciesMs[endpoint].push(
        Math.max(0, (event.timestamp - request.startedAtSeconds) * 1000)
      );
    }

    if (event.response.status >= 400 || (isEndpointDataResponse && contentType.includes("html"))) {
      window.endpointFailures.push({
        endpoint,
        status: event.response.status,
        method,
        url: event.response.url,
        origin,
        contentType
      });
    }
  });

  client.on("Network.loadingFailed", (params) => {
    const event = params as { requestId: string; canceled?: boolean; errorText?: string };
    const isAbort = event.canceled === true || event.errorText === "net::ERR_ABORTED";
    if (!isAbort) {
      return;
    }
    const window = getWindow();
    window.abortedRequestCount += 1;
    const request = window.requestsById.get(event.requestId);
    if (request?.endpoint) {
      window.abortedEndpointRequestCount += 1;
    }
  });

  client.on("Network.webSocketFrameReceived", (params) => {
    const event = params as { response?: { payloadData?: string } };
    const bytes = byteLength(event.response?.payloadData);
    const window = getWindow();
    window.websocketFrameCount += 1;
    window.websocketReceivedFrameCount += 1;
    window.websocketBytes += bytes;
    window.websocketReceivedBytes += bytes;
  });

  client.on("Network.webSocketFrameSent", (params) => {
    const event = params as { response?: { payloadData?: string } };
    const bytes = byteLength(event.response?.payloadData);
    const window = getWindow();
    window.websocketFrameCount += 1;
    window.websocketSentFrameCount += 1;
    window.websocketBytes += bytes;
    window.websocketSentBytes += bytes;
  });

  client.on("Network.webSocketFrameError", () => {
    getWindow().websocketErrorCount += 1;
  });
};

export const evaluateSanity = async (client: CdpClient): Promise<SanitySnapshot> => {
  const expression = String.raw`
(() => {
  const paneSpecs = [
    ["options", ".durable-tapes-options"],
    ["flow", ".durable-tapes-flow"],
    ["equities", ".durable-tapes-equities"],
    ["alerts", ".durable-tapes-alerts"],
    ["news", ".durable-tapes-news"]
  ];
  const isVisible = (element) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const paneRows = paneSpecs.map(([key, selector]) => {
    const pane = document.querySelector(selector);
    const rows = pane
      ? Array.from(pane.querySelectorAll(".durable-tape-row")).filter(isVisible)
      : [];
    const title =
      pane?.querySelector(".durable-tape-title, h2, h3")?.textContent?.trim() ??
      key;
    return {
      key,
      title,
      visible: isVisible(pane),
      rowCount: rows.length
    };
  });
  return {
    routePresent: Boolean(document.querySelector('[data-route-variant="durable-tapes"]')),
    pageTitle: document.querySelector(".page-title")?.textContent?.trim() ?? document.title,
    visibleDurablePaneCount: paneRows.filter((pane) => pane.visible).length,
    visibleRowCount: paneRows.reduce((sum, pane) => sum + pane.rowCount, 0),
    paneRows,
    bodyTextSample: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 500)
  };
})()
`;

  const result = await client.send<{
    result: { value?: SanitySnapshot };
    exceptionDetails?: { text?: string };
  }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });

  if (result.exceptionDetails) {
    throw new Error(`Sanity evaluation failed: ${result.exceptionDetails.text ?? "unknown error"}`);
  }
  if (!result.result.value) {
    throw new Error("Sanity evaluation returned no value.");
  }
  return result.result.value;
};

export const waitForRoute = async (client: CdpClient): Promise<SanitySnapshot> => {
  const deadline = Date.now() + 30_000;
  let latest: SanitySnapshot | null = null;
  while (Date.now() < deadline) {
    latest = await evaluateSanity(client);
    if (latest.routePresent && latest.visibleDurablePaneCount >= DEFAULT_MIN_VISIBLE_PANES) {
      return latest;
    }
    await sleep(500);
  }
  if (latest) {
    return latest;
  }
  throw new Error("Timed out waiting for the durable-tapes route to render.");
};

const topRequestsForReport = (window: MetricWindow) =>
  [...window.topRequestCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([request, count]) => ({ request, count }));

const endpointErrorCount = (window: MetricWindow): number =>
  Object.values(window.supportEvidenceStatusDistribution).reduce((sum, distribution) => {
    return (
      sum +
      Object.entries(distribution).reduce((endpointSum, [status, count]) => {
        return Number(status) >= 400 ? endpointSum + count : endpointSum;
      }, 0)
    );
  }, 0);

const percentile = (values: number[], ratio: number): number | null => {
  if (values.length === 0) {
    return null;
  }
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return values[index] ?? null;
};

const latencySummary = (values: number[]): EndpointLatencySummary => {
  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      p50: null,
      p95: null,
      max: null,
      avg: null
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? null,
    avg: sum / sorted.length
  };
};

export const serializeMetricWindow = (window: MetricWindow): SerializedMetricWindow => ({
  totalNetworkRequestCount: window.totalNetworkRequestCount,
  optionsSupportRequestCount: window.optionsSupportRequestCount,
  optionPrintsByTraceRequestCount: window.optionPrintsByTraceRequestCount,
  abortedRequestCount: window.abortedRequestCount,
  abortedEndpointRequestCount: window.abortedEndpointRequestCount,
  supportEvidenceStatusDistribution: window.supportEvidenceStatusDistribution,
  supportEvidenceOriginDistribution: window.supportEvidenceOriginDistribution,
  supportEvidenceContentTypeDistribution: window.supportEvidenceContentTypeDistribution,
  supportEvidenceErrorResponses: endpointErrorCount(window),
  supportEvidenceHtmlResponseCount: window.supportEvidenceHtmlResponseCount,
  supportEvidenceNonJsonResponseCount: window.supportEvidenceNonJsonResponseCount,
  supportEvidenceLatencyMs: {
    optionsSupport: latencySummary(window.endpointResponseLatenciesMs.optionsSupport),
    optionPrintsByTrace: latencySummary(window.endpointResponseLatenciesMs.optionPrintsByTrace)
  },
  websocketFrameCount: window.websocketFrameCount,
  websocketReceivedFrameCount: window.websocketReceivedFrameCount,
  websocketSentFrameCount: window.websocketSentFrameCount,
  websocketBytes: window.websocketBytes,
  websocketReceivedBytes: window.websocketReceivedBytes,
  websocketSentBytes: window.websocketSentBytes,
  websocketErrorCount: window.websocketErrorCount,
  topRequests: topRequestsForReport(window),
  endpointFailures: window.endpointFailures.slice(0, 50)
});
