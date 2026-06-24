#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type EndpointKind = "optionsSupport" | "optionPrintsByTrace";

type CliOptions = {
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

type ChromeLaunch = {
  browserName: string;
  cdpHttpUrl: string;
  process?: ReturnType<typeof Bun.spawn>;
  userDataDir?: string;
};

type CdpPayload = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type CdpMetricSnapshot = {
  taskDurationSeconds: number | null;
  scriptDurationSeconds: number | null;
  jsHeapUsedSizeBytes: number | null;
  domNodeCount: number | null;
};

type RequestRecord = {
  url: string;
  method: string;
  endpoint: EndpointKind | null;
};

type MetricWindow = {
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

type SanitySnapshot = {
  routePresent: boolean;
  pageTitle: string;
  visibleDurablePaneCount: number;
  visibleRowCount: number;
  paneRows: Array<{ key: string; title: string; visible: boolean; rowCount: number }>;
  bodyTextSample: string;
};

type BudgetResult = {
  name: string;
  actual: number;
  limit: number;
  pass: boolean;
  unit: string;
};

const DEFAULT_TARGET_URL = "http://localhost:3100/durable-tapes";
const DEFAULT_DURATION_MS = 180_000;
const DEFAULT_WARMUP_MS = 30_000;
const DEFAULT_MIN_VISIBLE_PANES = 5;
const DEFAULT_MIN_VISIBLE_ROWS = 1;

const THREE_MINUTE_BUDGETS = {
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

const HELP = `
Durable-tapes browser/CDP performance probe

Usage:
  bun run scripts/probes/durable-tapes-perf.ts [options]

Options:
  --target <url>              Route to probe. Default: ${DEFAULT_TARGET_URL}
  --duration <duration>       Measurement window after warmup. Default: 180s
  --warmup <duration>         Warmup window after initial route render. Default: 30s
  --output <path>             Write JSON report to this path.
  --cdp-url <url>             Reuse an existing CDP HTTP or page WebSocket URL.
  --browser-path <path>       Chrome/Chromium executable path.
  --headful                   Launch browser with a visible window.
  --min-visible-panes <n>     Pane sanity budget. Default: 5
  --min-visible-rows <n>      Row sanity budget. Default: 1
  --no-fail-on-budget         Always exit 0 after writing the report.
  --help                      Show this help.

Duration values accept ms, s, or m suffixes. Examples: 30000ms, 30s, 3m.
Set CHROME_PATH as an alternative to --browser-path.
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseDurationMs = (value: string, label: string): number => {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) {
    throw new Error(`Invalid ${label} duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid ${label} duration: ${value}`);
  }
  if (unit === "m") {
    return Math.round(amount * 60_000);
  }
  if (unit === "s") {
    return Math.round(amount * 1_000);
  }
  return Math.round(amount);
};

const parseInteger = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
};

const readOptionValue = (args: string[], index: number, option: string): [string, number] => {
  const current = args[index];
  const inlinePrefix = `${option}=`;
  if (current.startsWith(inlinePrefix)) {
    return [current.slice(inlinePrefix.length), index];
  }
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return [next, index + 1];
};

const parseArgs = (args: string[]): CliOptions => {
  const options: CliOptions = {
    targetUrl: DEFAULT_TARGET_URL,
    durationMs: DEFAULT_DURATION_MS,
    warmupMs: DEFAULT_WARMUP_MS,
    headful: false,
    failOnBudget: true,
    minVisibleRows: DEFAULT_MIN_VISIBLE_ROWS,
    minVisiblePanes: DEFAULT_MIN_VISIBLE_PANES
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP.trim());
      process.exit(0);
    }
    if (arg === "--headful") {
      options.headful = true;
      continue;
    }
    if (arg === "--no-fail-on-budget") {
      options.failOnBudget = false;
      continue;
    }

    const [value, nextIndex] = arg.includes("=")
      ? readOptionValue(args, index, arg.split("=")[0])
      : readOptionValue(args, index, arg);
    index = nextIndex;

    if (arg.startsWith("--target")) {
      options.targetUrl = value;
    } else if (arg.startsWith("--duration")) {
      options.durationMs = parseDurationMs(value, "--duration");
    } else if (arg.startsWith("--warmup")) {
      options.warmupMs = parseDurationMs(value, "--warmup");
    } else if (arg.startsWith("--output")) {
      options.outputPath = value;
    } else if (arg.startsWith("--cdp-url")) {
      options.cdpUrl = value;
    } else if (arg.startsWith("--browser-path")) {
      options.browserPath = value;
    } else if (arg.startsWith("--min-visible-rows")) {
      options.minVisibleRows = parseInteger(value, "--min-visible-rows");
    } else if (arg.startsWith("--min-visible-panes")) {
      options.minVisiblePanes = parseInteger(value, "--min-visible-panes");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  new URL(options.targetUrl);
  return options;
};

const findFreePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  if (!address || typeof address === "string") {
    throw new Error("Unable to reserve a CDP port.");
  }
  return address.port;
};

const commandPath = (command: string): string | null => {
  const result = spawnSync("command", ["-v", command], {
    shell: true,
    encoding: "utf8"
  });
  if (result.status === 0) {
    const stdout = result.stdout.trim();
    return stdout.length > 0 ? stdout : null;
  }
  return null;
};

const resolveBrowserPath = (requested?: string): string => {
  const candidates = [
    requested,
    process.env.CHROME_PATH,
    process.env.BROWSER_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    commandPath("google-chrome-stable"),
    commandPath("google-chrome"),
    commandPath("chromium"),
    commandPath("chromium-browser"),
    commandPath("microsoft-edge")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "No local Chrome/Chromium executable found. Pass --browser-path, set CHROME_PATH, or run Chrome with --remote-debugging-port and pass --cdp-url."
  );
};

const waitForCdpHttp = async (cdpHttpUrl: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpHttpUrl}/json/version`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for Chrome CDP at ${cdpHttpUrl}: ${String(lastError)}`);
};

const launchChrome = async (options: CliOptions): Promise<ChromeLaunch> => {
  if (options.cdpUrl) {
    const cdpHttpUrl = options.cdpUrl.startsWith("ws")
      ? options.cdpUrl
      : options.cdpUrl.replace(/\/$/, "");
    return {
      browserName: "external-cdp",
      cdpHttpUrl
    };
  }

  const browserPath = resolveBrowserPath(options.browserPath);
  const port = await findFreePort();
  const userDataDir = await mkdtemp(join(tmpdir(), "islandflow-durable-tapes-probe-"));
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--disable-features=Translate,OptimizationHints",
    "about:blank"
  ];
  if (!options.headful) {
    args.unshift("--headless=new", "--disable-gpu");
  }

  const processHandle = Bun.spawn([browserPath, ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const cdpHttpUrl = `http://127.0.0.1:${port}`;
  await waitForCdpHttp(cdpHttpUrl);

  return {
    browserName: browserPath,
    cdpHttpUrl,
    process: processHandle,
    userDataDir
  };
};

const openPageWebSocket = async (cdpUrl: string): Promise<string> => {
  if (cdpUrl.startsWith("ws")) {
    return cdpUrl;
  }

  await waitForCdpHttp(cdpUrl);
  const encoded = encodeURIComponent("about:blank");
  const attempts: Array<[string, RequestInit]> = [
    [`${cdpUrl}/json/new?${encoded}`, { method: "PUT" }],
    [`${cdpUrl}/json/new?${encoded}`, { method: "GET" }]
  ];

  for (const [url, init] of attempts) {
    const response = await fetch(url, init);
    if (!response.ok) {
      continue;
    }
    const target = (await response.json()) as { webSocketDebuggerUrl?: string };
    if (target.webSocketDebuggerUrl) {
      return target.webSocketDebuggerUrl;
    }
  }

  throw new Error(`Unable to create a Chrome page target through ${cdpUrl}.`);
};

class CdpClient {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      method: string;
    }
  >();
  private handlers = new Map<string, Array<(params: unknown) => void>>();

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out connecting to CDP WebSocket.")),
        10_000
      );
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket connection failed."));
      });
    });

    ws.addEventListener("message", (event) => {
      const data =
        typeof event.data === "string"
          ? event.data
          : Buffer.from(event.data as ArrayBuffer).toString("utf8");
      const message = JSON.parse(data) as CdpPayload;
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(`${pending.method}: ${message.error.message ?? "CDP error"}`));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }
      if (message.method) {
        const handlers = this.handlers.get(message.method) ?? [];
        for (const handler of handlers) {
          handler(message.params);
        }
      }
    });
  }

  on(method: string, handler: (params: unknown) => void): void {
    const current = this.handlers.get(method) ?? [];
    current.push(handler);
    this.handlers.set(method, current);
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP WebSocket is not open."));
    }
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params: params ?? {} };
    this.ws.send(JSON.stringify(payload));
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        method
      });
    });
  }

  close(): void {
    this.ws?.close();
  }
}

const createMetricWindow = (label: MetricWindow["label"]): MetricWindow => ({
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

const attachCollectors = (client: CdpClient, getWindow: () => MetricWindow): void => {
  client.on("Network.requestWillBeSent", (params) => {
    const event = params as {
      requestId: string;
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
      endpoint
    });
    countTopRequest(window, event.request.url, event.request.method);
  });

  client.on("Network.responseReceived", (params) => {
    const event = params as {
      requestId: string;
      response: { status: number; url: string };
    };
    const window = getWindow();
    const request = window.requestsById.get(event.requestId);
    const endpoint = request?.endpoint ?? classifyEndpoint(event.response.url);
    if (!endpoint) {
      return;
    }
    countStatus(window.supportEvidenceStatusDistribution[endpoint], event.response.status);
    if (event.response.status >= 400) {
      window.endpointFailures.push({
        endpoint,
        status: event.response.status,
        method: request?.method ?? "GET",
        url: event.response.url
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

const getPerformanceSnapshot = async (client: CdpClient): Promise<CdpMetricSnapshot> => {
  const result = await client.send<{ metrics: Array<{ name: string; value: number }> }>(
    "Performance.getMetrics"
  );
  const metrics = new Map(result.metrics.map((metric) => [metric.name, metric.value]));
  return {
    taskDurationSeconds: metrics.get("TaskDuration") ?? null,
    scriptDurationSeconds: metrics.get("ScriptDuration") ?? null,
    jsHeapUsedSizeBytes: metrics.get("JSHeapUsedSize") ?? null,
    domNodeCount: metrics.get("Nodes") ?? null
  };
};

const diffMetric = (start: number | null, end: number | null): number | null =>
  start === null || end === null ? null : end - start;

const evaluateSanity = async (client: CdpClient): Promise<SanitySnapshot> => {
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

const waitForRoute = async (client: CdpClient): Promise<SanitySnapshot> => {
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

const scaledBudget = (base: number, durationMs: number, minimum: number): number => {
  const scaled = Math.round(base * (durationMs / DEFAULT_DURATION_MS));
  return Math.max(minimum, scaled);
};

const evaluateBudgets = ({
  metrics,
  sanity,
  durationMs,
  minVisiblePanes,
  minVisibleRows
}: {
  metrics: {
    totalNetworkRequestCount: number;
    optionsSupportRequestCount: number;
    optionPrintsByTraceRequestCount: number;
    abortedRequestCount: number;
    abortedEndpointRequestCount: number;
    supportEvidenceErrorResponses: number;
    taskDurationDeltaSeconds: number | null;
    scriptDurationDeltaSeconds: number | null;
    jsHeapUsedSizeDeltaBytes: number | null;
    domNodeCount: number | null;
  };
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

const serializeMetricWindow = (window: MetricWindow) => ({
  totalNetworkRequestCount: window.totalNetworkRequestCount,
  optionsSupportRequestCount: window.optionsSupportRequestCount,
  optionPrintsByTraceRequestCount: window.optionPrintsByTraceRequestCount,
  abortedRequestCount: window.abortedRequestCount,
  abortedEndpointRequestCount: window.abortedEndpointRequestCount,
  supportEvidenceStatusDistribution: window.supportEvidenceStatusDistribution,
  supportEvidenceErrorResponses: endpointErrorCount(window),
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

const run = async () => {
  const options = parseArgs(process.argv.slice(2));
  let launch: ChromeLaunch | null = null;
  let client: CdpClient | null = null;

  try {
    launch = await launchChrome(options);
    const pageWebSocket = await openPageWebSocket(launch.cdpHttpUrl);
    client = new CdpClient(pageWebSocket);
    await client.connect();

    let activeWindow = createMetricWindow("warmup");
    const warmupWindow = activeWindow;
    attachCollectors(client, () => activeWindow);

    await client.send("Page.enable");
    await client.send("Network.enable", {
      maxTotalBufferSize: 100_000_000,
      maxResourceBufferSize: 25_000_000
    });
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("Performance.enable", { timeDomain: "timeTicks" });
    await client.send("Runtime.enable");

    const startedAt = new Date().toISOString();
    console.log(`Navigating to ${options.targetUrl}`);
    await client.send("Page.navigate", { url: options.targetUrl });
    const initialSanity = await waitForRoute(client);
    console.log(
      `Route rendered: panes=${initialSanity.visibleDurablePaneCount}, rows=${initialSanity.visibleRowCount}`
    );

    if (options.warmupMs > 0) {
      console.log(`Warming up for ${Math.round(options.warmupMs / 1000)}s`);
      await sleep(options.warmupMs);
    }

    const measurementWindow = createMetricWindow("measurement");
    activeWindow = measurementWindow;
    const startPerformance = await getPerformanceSnapshot(client);
    console.log(`Measuring for ${Math.round(options.durationMs / 1000)}s`);
    await sleep(options.durationMs);
    const endPerformance = await getPerformanceSnapshot(client);
    const finalSanity = await evaluateSanity(client);
    const endedAt = new Date().toISOString();

    const measurementMetrics = serializeMetricWindow(measurementWindow);
    const cdpMetrics = {
      start: startPerformance,
      end: endPerformance,
      delta: {
        taskDurationSeconds: diffMetric(
          startPerformance.taskDurationSeconds,
          endPerformance.taskDurationSeconds
        ),
        scriptDurationSeconds: diffMetric(
          startPerformance.scriptDurationSeconds,
          endPerformance.scriptDurationSeconds
        ),
        jsHeapUsedSizeBytes: diffMetric(
          startPerformance.jsHeapUsedSizeBytes,
          endPerformance.jsHeapUsedSizeBytes
        ),
        domNodeCount: endPerformance.domNodeCount
      }
    };
    const budgetResults = evaluateBudgets({
      metrics: {
        ...measurementMetrics,
        taskDurationDeltaSeconds: cdpMetrics.delta.taskDurationSeconds,
        scriptDurationDeltaSeconds: cdpMetrics.delta.scriptDurationSeconds,
        jsHeapUsedSizeDeltaBytes: cdpMetrics.delta.jsHeapUsedSizeBytes,
        domNodeCount: cdpMetrics.delta.domNodeCount
      },
      sanity: finalSanity,
      durationMs: options.durationMs,
      minVisiblePanes: options.minVisiblePanes,
      minVisibleRows: options.minVisibleRows
    });
    const passed = budgetResults.every((result) => result.pass);

    const report = {
      schemaVersion: 1,
      probe: "durable-tapes-cdp",
      targetUrl: options.targetUrl,
      startedAt,
      endedAt,
      durationMs: options.durationMs,
      warmupMs: options.warmupMs,
      browser: {
        name: launch.browserName,
        cdp: options.cdpUrl ? "external" : "launched"
      },
      budgets: {
        profile: "durable-tapes-3m-v1",
        baseDurationMs: DEFAULT_DURATION_MS,
        failOnBudget: options.failOnBudget,
        passed,
        results: budgetResults
      },
      metrics: {
        ...measurementMetrics,
        cdp: cdpMetrics,
        sanity: finalSanity
      },
      warmupMetrics: serializeMetricWindow(warmupWindow),
      initialSanity
    };

    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.outputPath) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, json, "utf8");
      console.log(`Wrote ${options.outputPath}`);
    } else {
      console.log(json);
    }

    console.log(`Budget verdict: ${passed ? "pass" : "fail"}`);
    for (const result of budgetResults) {
      const marker = result.pass ? "pass" : "fail";
      console.log(
        `${marker}: ${result.name}: actual=${result.actual} limit=${result.limit} ${result.unit}`
      );
    }

    if (!passed && options.failOnBudget) {
      process.exitCode = 1;
    }
  } finally {
    client?.close();
    if (launch?.process) {
      launch.process.kill();
      await launch.process.exited.catch(() => undefined);
    }
    if (launch?.userDataDir) {
      await rm(launch.userDataDir, { recursive: true, force: true });
    }
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
