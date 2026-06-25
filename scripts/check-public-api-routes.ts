#!/usr/bin/env bun

type RouteCheck = {
  path: string;
  expectJson: boolean;
  init?: RequestInit;
};

const routeChecks: RouteCheck[] = [
  { path: "/prints/options?view=signal&limit=1", expectJson: true },
  { path: "/joins/equities?limit=1", expectJson: true },
  {
    path: "/history/options?view=signal&before_ts=4102444800000&before_seq=999999999&limit=1",
    expectJson: true
  },
  {
    path: "/history/news?before_ts=4102444800000&before_seq=999999999&limit=1",
    expectJson: true
  },
  { path: "/replay/options?view=signal&after_ts=0&after_seq=0&limit=1", expectJson: true },
  { path: "/nbbo/options?limit=1", expectJson: true },
  { path: "/quotes/equities?limit=1", expectJson: true },
  { path: "/dark/inferred?limit=1", expectJson: true },
  { path: "/flow/packets?limit=1", expectJson: true },
  { path: "/candles/equities?limit=1", expectJson: true },
  { path: "/news?limit=1", expectJson: true },
  {
    path: "/lookup/options-support",
    expectJson: true,
    init: {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ trace_ids: [], nbbo_context: [] })
    }
  },
  { path: "/option-prints/by-trace?trace_id=public-route-check", expectJson: true },
  { path: "/equity-joins/by-id?id=public-route-check", expectJson: true }
];

const appUrl = process.env.DEPLOY_PUBLIC_APP_URL?.trim() || process.argv[2]?.trim();
if (!appUrl) {
  throw new Error(
    "Set DEPLOY_PUBLIC_APP_URL=<production-app-origin> or pass the app origin as an argument."
  );
}
const baseUrl = appUrl;

const isJsonResponse = (response: Response): boolean => {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
};

const assertPublicApiRoute = async ({ path, expectJson, init }: RouteCheck): Promise<void> => {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, init);
  const responseText = await response.text();

  if (response.status === 404) {
    throw new Error(`${url.pathname} returned 404; route is likely reaching the web app`);
  }

  if (!response.ok) {
    const sample = responseText.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`${url.pathname} returned HTTP ${response.status}: ${sample}`);
  }

  if (expectJson && !isJsonResponse(response)) {
    const sample = responseText.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(
      `${url.pathname} returned non-JSON content (${response.headers.get("content-type") ?? "none"}): ${sample}`
    );
  }
};

for (const check of routeChecks) {
  await assertPublicApiRoute(check);
  console.log(`ok ${check.path}`);
}

const assertPublicWebSocketRoute = async (path: string): Promise<void> => {
  const url = new URL(path, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  await new Promise<void>((resolve, reject) => {
    let socket: WebSocket | null = null;
    const timeout = setTimeout(() => {
      socket?.close();
      reject(new Error(`${url.pathname} websocket timed out`));
    }, 5_000);

    const finish = (error?: Error) => {
      clearTimeout(timeout);
      socket?.close();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    try {
      socket = new WebSocket(url);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    socket.onopen = () => finish();
    socket.onerror = () => finish(new Error(`${url.pathname} websocket failed`));
  });
};

await assertPublicWebSocketRoute("/ws/live");
console.log("ok /ws/live");
