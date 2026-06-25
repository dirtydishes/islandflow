#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type CheckStatus = "pass" | "fail" | "skip";

type SmokeCheck = {
  name: string;
  status: CheckStatus;
  url?: string;
  statusCode?: number;
  latencyMs?: number;
  contentType?: string;
  detail?: string;
};

type SmokeOptions = {
  webTarget: string;
  apiOrigin: string;
  timeoutMs: number;
  maxEndpointLatencyMs: number;
  outputPath?: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ENDPOINT_LATENCY_MS = 5_000;

const HELP = `
Durable-tapes production smoke check

Usage:
  bun run scripts/probes/durable-tapes-production-smoke.ts [options]

Options:
  --web-target <url>             Deployed durable-tapes URL, e.g. <production-app-origin>/durable-tapes.
  --api-origin <origin>          Expected explicit API origin, e.g. <raw-api-origin>.
  --timeout <duration>           Per-request timeout. Default: 10s
  --max-endpoint-latency <ms>    Support/evidence latency budget. Default: 5000ms
  --output <path>                Write JSON report to this path.
  --help                         Show this help.

Duration values accept ms, s, or m suffixes. Examples: 3000ms, 3s, 1m.
`;

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

const normalizeOrigin = (value: string): string => new URL(value).origin;

const parseArgs = (args: string[]): SmokeOptions => {
  const options: Partial<SmokeOptions> = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxEndpointLatencyMs: DEFAULT_MAX_ENDPOINT_LATENCY_MS
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP.trim());
      process.exit(0);
    }

    const [value, nextIndex] = arg.includes("=")
      ? readOptionValue(args, index, arg.split("=")[0])
      : readOptionValue(args, index, arg);
    index = nextIndex;

    if (arg.startsWith("--web-target")) {
      options.webTarget = new URL(value).toString();
    } else if (arg.startsWith("--api-origin")) {
      options.apiOrigin = normalizeOrigin(value);
    } else if (arg.startsWith("--timeout")) {
      options.timeoutMs = parseDurationMs(value, "--timeout");
    } else if (arg.startsWith("--max-endpoint-latency")) {
      options.maxEndpointLatencyMs = parseDurationMs(value, "--max-endpoint-latency");
    } else if (arg.startsWith("--output")) {
      options.outputPath = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.webTarget) {
    throw new Error("Missing --web-target <production-app-origin>/durable-tapes");
  }
  if (!options.apiOrigin) {
    throw new Error("Missing --api-origin <raw-api-origin>");
  }

  new URL(options.webTarget);
  options.apiOrigin = normalizeOrigin(options.apiOrigin);
  return options as SmokeOptions;
};

const isHtmlResponse = (contentType: string, body: string): boolean => {
  const normalized = contentType.toLowerCase();
  const trimmed = body.trimStart();
  return (
    normalized.includes("text/html") ||
    /^<!doctype html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed)
  );
};

const isJsonResponse = (contentType: string): boolean =>
  contentType.toLowerCase().includes("application/json");

const validateOptionPrintMissJson = (body: string): string | null => {
  try {
    const payload = JSON.parse(body) as { data?: unknown[] };
    return Array.isArray(payload.data) ? null : "miss lookup JSON omitted data array";
  } catch {
    return "miss lookup response is not valid JSON";
  }
};

const requestText = async (
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<{ response: Response; body: string; latencyMs: number }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const body = await response.text();
    return {
      response,
      body,
      latencyMs: performance.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
};

const extractScriptUrls = (html: string, baseUrl: string): string[] => {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const src = match[1];
    if (src) {
      urls.add(new URL(src, baseUrl).toString());
    }
  }
  return Array.from(urls);
};

const pushCheck = (checks: SmokeCheck[], check: SmokeCheck): void => {
  checks.push(check);
  const marker = check.status === "pass" ? "pass" : check.status === "skip" ? "skip" : "fail";
  const detail = check.detail ? `: ${check.detail}` : "";
  const latency = typeof check.latencyMs === "number" ? ` (${Math.round(check.latencyMs)}ms)` : "";
  console.log(`${marker}: ${check.name}${latency}${detail}`);
};

const fetchEndpointCheck = async ({
  checks,
  name,
  url,
  timeoutMs,
  maxLatencyMs,
  init,
  validate
}: {
  checks: SmokeCheck[];
  name: string;
  url: string;
  timeoutMs: number;
  maxLatencyMs?: number;
  init?: RequestInit;
  validate?: (body: string) => string | null;
}): Promise<{ ok: boolean; body: string; contentType: string; latencyMs: number }> => {
  try {
    const { response, body, latencyMs } = await requestText(url, timeoutMs, init);
    const contentType = response.headers.get("content-type") ?? "";
    const html = isHtmlResponse(contentType, body);
    const latencyOk = maxLatencyMs === undefined || latencyMs <= maxLatencyMs;
    const validationError = validate?.(body) ?? null;
    const ok =
      response.ok && !html && isJsonResponse(contentType) && latencyOk && validationError === null;
    pushCheck(checks, {
      name,
      status: ok ? "pass" : "fail",
      url,
      statusCode: response.status,
      latencyMs,
      contentType,
      detail:
        validationError ??
        (html
          ? "received HTML instead of JSON"
          : !response.ok
            ? `HTTP ${response.status}`
            : !isJsonResponse(contentType)
              ? "content type is not JSON"
              : !latencyOk
                ? `latency exceeded ${maxLatencyMs}ms`
                : undefined)
    });
    return { ok, body, contentType, latencyMs };
  } catch (error) {
    pushCheck(checks, {
      name,
      status: "fail",
      url,
      detail: error instanceof Error ? error.message : String(error)
    });
    return { ok: false, body: "", contentType: "", latencyMs: Number.POSITIVE_INFINITY };
  }
};

const scanBundleForApiOrigin = async (
  scriptUrls: string[],
  apiOrigin: string,
  timeoutMs: number
): Promise<{ found: boolean; matchedScriptUrl: string | null; scannedScriptCount: number }> => {
  let scannedScriptCount = 0;
  for (const scriptUrl of scriptUrls) {
    try {
      const { response, body } = await requestText(scriptUrl, timeoutMs, {
        headers: { accept: "application/javascript,text/javascript,*/*" }
      });
      if (!response.ok) {
        continue;
      }
      scannedScriptCount += 1;
      if (body.includes(apiOrigin)) {
        return { found: true, matchedScriptUrl: scriptUrl, scannedScriptCount };
      }
    } catch {
      continue;
    }
  }
  return { found: false, matchedScriptUrl: null, scannedScriptCount };
};

const websocketUrlForApiOrigin = (apiOrigin: string): string => {
  const url = new URL("/ws/live", apiOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const optionPrintsMissUrl = (origin: string, prefix: string): string => {
  const url = new URL("/option-prints/by-trace", origin);
  url.searchParams.set("trace_id", `${prefix}-${Date.now()}`);
  return url.toString();
};

const websocketDataToText = async (data: unknown): Promise<string> => {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString("utf8");
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return String(data);
};

const checkDurableRowsWebSocket = async ({
  checks,
  apiOrigin,
  timeoutMs,
  maxLatencyMs
}: {
  checks: SmokeCheck[];
  apiOrigin: string;
  timeoutMs: number;
  maxLatencyMs: number;
}): Promise<void> => {
  const url = websocketUrlForApiOrigin(apiOrigin);
  const startedAt = performance.now();

  await new Promise<void>((resolve) => {
    let socket: WebSocket | null = null;
    let settled = false;
    const finish = (check: SmokeCheck) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket?.close();
      pushCheck(checks, check);
      resolve();
    };
    const timeout = setTimeout(() => {
      finish({
        name: "durable rows websocket snapshot",
        status: "fail",
        url,
        detail: `timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    try {
      socket = new WebSocket(url);
    } catch (error) {
      finish({
        name: "durable rows websocket snapshot",
        status: "fail",
        url,
        detail: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    socket.onmessage = (event) => {
      void (async () => {
        try {
          const payload = JSON.parse(await websocketDataToText(event.data)) as {
            op?: string;
            message?: string;
            snapshot?: {
              subscription?: { channel?: string };
              items?: unknown[];
            };
          };
          if (payload.op === "ready") {
            socket?.send(
              JSON.stringify({
                op: "subscribe",
                subscriptions: [
                  {
                    channel: "durable-rows",
                    lanes: ["options", "alerts"],
                    snapshot_limit: 10
                  }
                ]
              })
            );
            return;
          }
          if (payload.op === "error") {
            finish({
              name: "durable rows websocket snapshot",
              status: "fail",
              url,
              latencyMs: performance.now() - startedAt,
              detail: payload.message ?? "API returned live socket error"
            });
            return;
          }
          if (
            payload.op === "snapshot" &&
            payload.snapshot?.subscription?.channel === "durable-rows"
          ) {
            const latencyMs = performance.now() - startedAt;
            const latencyOk = latencyMs <= maxLatencyMs;
            finish({
              name: "durable rows websocket snapshot",
              status: latencyOk ? "pass" : "fail",
              url,
              latencyMs,
              detail: latencyOk
                ? `snapshot rows ${payload.snapshot.items?.length ?? 0}`
                : `latency exceeded ${maxLatencyMs}ms`
            });
          }
        } catch (error) {
          finish({
            name: "durable rows websocket snapshot",
            status: "fail",
            url,
            latencyMs: performance.now() - startedAt,
            detail: error instanceof Error ? error.message : String(error)
          });
        }
      })();
    };

    socket.onerror = () => {
      finish({
        name: "durable rows websocket snapshot",
        status: "fail",
        url,
        latencyMs: performance.now() - startedAt,
        detail: "websocket error"
      });
    };
  });
};

const run = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const webOrigin = new URL(options.webTarget).origin;
  const checks: SmokeCheck[] = [];

  console.log(`Smoking ${options.webTarget}`);

  let webHtml = "";
  try {
    const { response, body, latencyMs } = await requestText(options.webTarget, options.timeoutMs, {
      headers: { accept: "text/html,*/*" }
    });
    const contentType = response.headers.get("content-type") ?? "";
    webHtml = body;
    const ok = response.ok && isHtmlResponse(contentType, body);
    pushCheck(checks, {
      name: "native web route",
      status: ok ? "pass" : "fail",
      url: options.webTarget,
      statusCode: response.status,
      latencyMs,
      contentType,
      detail: ok ? `origin ${webOrigin}` : "route did not return successful HTML"
    });
  } catch (error) {
    pushCheck(checks, {
      name: "native web route",
      status: "fail",
      url: options.webTarget,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  const scriptUrls = webHtml ? extractScriptUrls(webHtml, options.webTarget) : [];
  const bundleScan = await scanBundleForApiOrigin(scriptUrls, options.apiOrigin, options.timeoutMs);

  let sameOriginProxyValid = false;
  let sameOriginProxyChecked = false;
  let sameOriginSupportProxyValid = false;
  let sameOriginEvidenceProxyValid = false;
  if (!bundleScan.found) {
    sameOriginProxyChecked = true;
    const sameOriginSupportUrl = new URL("/lookup/options-support", webOrigin).toString();
    const sameOriginCheck = await fetchEndpointCheck({
      checks,
      name: "same-origin support proxy fallback",
      url: sameOriginSupportUrl,
      timeoutMs: options.timeoutMs,
      maxLatencyMs: options.maxEndpointLatencyMs,
      init: {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ trace_ids: [], nbbo_context: [] })
      }
    });
    sameOriginSupportProxyValid = sameOriginCheck.ok;
    const sameOriginEvidenceCheck = await fetchEndpointCheck({
      checks,
      name: "same-origin by-trace proxy fallback",
      url: optionPrintsMissUrl(webOrigin, "phase06-same-origin-smoke-miss"),
      timeoutMs: options.timeoutMs,
      maxLatencyMs: options.maxEndpointLatencyMs,
      init: { headers: { accept: "application/json" } },
      validate: validateOptionPrintMissJson
    });
    sameOriginEvidenceProxyValid = sameOriginEvidenceCheck.ok;
    sameOriginProxyValid = sameOriginSupportProxyValid && sameOriginEvidenceProxyValid;
  } else {
    pushCheck(checks, {
      name: "same-origin support proxy fallback",
      status: "skip",
      detail: "public bundle contains the expected API origin"
    });
    pushCheck(checks, {
      name: "same-origin by-trace proxy fallback",
      status: "skip",
      detail: "public bundle contains the expected API origin"
    });
  }

  const routingOk = bundleScan.found || sameOriginProxyValid;
  pushCheck(checks, {
    name: "browser REST routing",
    status: routingOk ? "pass" : "fail",
    detail: bundleScan.found
      ? `bundle references ${options.apiOrigin}`
      : sameOriginProxyChecked
        ? "expected API origin missing from bundle and same-origin proxy check failed"
        : "expected API origin missing from bundle"
  });

  const healthUrl = new URL("/health", options.apiOrigin).toString();
  await fetchEndpointCheck({
    checks,
    name: "native API health",
    url: healthUrl,
    timeoutMs: options.timeoutMs,
    maxLatencyMs: options.maxEndpointLatencyMs,
    init: { headers: { accept: "application/json" } },
    validate: (body) => {
      try {
        const payload = JSON.parse(body) as { status?: string };
        return payload.status === "ok" ? null : "health JSON did not report ok";
      } catch {
        return "health response is not valid JSON";
      }
    }
  });

  await checkDurableRowsWebSocket({
    checks,
    apiOrigin: options.apiOrigin,
    timeoutMs: options.timeoutMs,
    maxLatencyMs: options.maxEndpointLatencyMs
  });

  const supportUrl = new URL("/lookup/options-support", options.apiOrigin).toString();
  await fetchEndpointCheck({
    checks,
    name: "options support lookup latency",
    url: supportUrl,
    timeoutMs: options.timeoutMs,
    maxLatencyMs: options.maxEndpointLatencyMs,
    init: {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ trace_ids: [], nbbo_context: [] })
    }
  });

  await fetchEndpointCheck({
    checks,
    name: "option prints miss lookup latency",
    url: optionPrintsMissUrl(options.apiOrigin, "phase06-smoke-miss"),
    timeoutMs: options.timeoutMs,
    maxLatencyMs: options.maxEndpointLatencyMs,
    init: { headers: { accept: "application/json" } },
    validate: validateOptionPrintMissJson
  });

  const endedAt = new Date().toISOString();
  const passed = checks.every((check) => check.status !== "fail");
  const report = {
    schemaVersion: 1,
    probe: "durable-tapes-production-smoke",
    startedAt,
    endedAt,
    webTarget: options.webTarget,
    webOrigin,
    apiOrigin: options.apiOrigin,
    timeoutMs: options.timeoutMs,
    maxEndpointLatencyMs: options.maxEndpointLatencyMs,
    routing: {
      bundleApiOriginPresent: bundleScan.found,
      matchedScriptUrl: bundleScan.matchedScriptUrl,
      scannedScriptCount: bundleScan.scannedScriptCount,
      scriptTagCount: scriptUrls.length,
      sameOriginProxyChecked,
      sameOriginProxyValid,
      sameOriginSupportProxyValid,
      sameOriginEvidenceProxyValid
    },
    passed,
    checks
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) {
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, json, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(json);
  }

  console.log(`Smoke verdict: ${passed ? "pass" : "fail"}`);
  if (!passed) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
