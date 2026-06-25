const jsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
};

export const isSyntheticAdminFeatureEnabled = (
  value = process.env.NEXT_PUBLIC_SYNTHETIC_ADMIN
): boolean => value === "1";

export const getSyntheticAdminProxyConfig = (
  env: Record<string, string | undefined> = process.env
): { apiBaseUrl: string; token: string } | null => {
  const apiBaseUrl = env.ISLANDFLOW_INTERNAL_API_URL?.trim();
  const token = env.SYNTHETIC_ADMIN_TOKEN?.trim();
  if (!apiBaseUrl || !token) {
    return null;
  }
  return { apiBaseUrl, token };
};

export const proxySyntheticAdminRequest = async (
  path: string,
  init: RequestInit = {},
  env: Record<string, string | undefined> = process.env
): Promise<Response> => {
  if (!isSyntheticAdminFeatureEnabled(env.NEXT_PUBLIC_SYNTHETIC_ADMIN)) {
    return jsonResponse({ error: "not found" }, 404);
  }

  const config = getSyntheticAdminProxyConfig(env);
  if (!config) {
    return jsonResponse(
      {
        error: "synthetic admin proxy misconfigured"
      },
      500
    );
  }

  const url = new URL(path, config.apiBaseUrl);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${config.token}`);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url.toString(), {
    ...init,
    cache: "no-store",
    headers
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json"
    }
  });
};
