#!/usr/bin/env bun

type RouteCheck = {
  path: string;
  expectJson: boolean;
};

const routeChecks: RouteCheck[] = [
  { path: "/prints/options?view=signal&limit=1", expectJson: true },
  { path: "/history/options?view=signal&before_ts=4102444800000&before_seq=999999999&limit=1", expectJson: true },
  { path: "/replay/options?view=signal&after_ts=0&after_seq=0&limit=1", expectJson: true },
  { path: "/nbbo/options?limit=1", expectJson: true },
  { path: "/ws/live", expectJson: true }
];

const appUrl = process.env.DEPLOY_PUBLIC_APP_URL?.trim() || process.argv[2]?.trim();
const baseUrl = appUrl || "https://flow.deltaisland.io";

const isJsonResponse = (response: Response): boolean => {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
};

const assertPublicApiRoute = async ({ path, expectJson }: RouteCheck): Promise<void> => {
  const url = new URL(path, baseUrl);
  const response = await fetch(url);
  const responseText = await response.text();

  if (response.status === 404) {
    throw new Error(`${url.pathname} returned 404; route is likely reaching the web app`);
  }

  if (expectJson && !isJsonResponse(response)) {
    const sample = responseText.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`${url.pathname} returned non-JSON content (${response.headers.get("content-type") ?? "none"}): ${sample}`);
  }
};

for (const check of routeChecks) {
  await assertPublicApiRoute(check);
  console.log(`ok ${check.path}`);
}
