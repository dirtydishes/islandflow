export const DEFAULT_API_CORS_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3100",
  "http://localhost:3100"
].join(",");

const DEFAULT_ALLOWED_HEADERS = "authorization,content-type,x-synthetic-admin-token";
const DEFAULT_ALLOWED_METHODS = "GET,POST,PUT,OPTIONS";

const normalizeOrigin = (origin: string): string | null => {
  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "*") {
    return trimmed;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
};

export const parseCorsAllowedOrigins = (value: string): Set<string> => {
  const origins = new Set<string>();
  for (const entry of value.split(",")) {
    const origin = normalizeOrigin(entry);
    if (origin) {
      origins.add(origin);
    }
  }
  return origins;
};

export const resolveCorsOrigin = (req: Request, allowedOrigins: Set<string>): string | null => {
  const origin = normalizeOrigin(req.headers.get("origin") ?? "");
  if (!origin) {
    return null;
  }
  if (allowedOrigins.has("*")) {
    return "*";
  }
  return allowedOrigins.has(origin) ? origin : null;
};

const appendVaryOrigin = (headers: Headers): void => {
  const vary = headers.get("vary");
  if (!vary) {
    headers.set("vary", "Origin");
    return;
  }
  if (!vary.split(",").some((value) => value.trim().toLowerCase() === "origin")) {
    headers.set("vary", `${vary}, Origin`);
  }
};

export const withCorsHeaders = (
  req: Request,
  response: Response,
  allowedOrigins: Set<string>
): Response => {
  if (response.status === 101) {
    return response;
  }

  const allowedOrigin = resolveCorsOrigin(req, allowedOrigins);
  if (!allowedOrigin) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowedOrigin);
  appendVaryOrigin(headers);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export const createCorsPreflightResponse = (
  req: Request,
  allowedOrigins: Set<string>
): Response => {
  const headers = new Headers();
  const allowedOrigin = resolveCorsOrigin(req, allowedOrigins);
  if (allowedOrigin) {
    headers.set("access-control-allow-origin", allowedOrigin);
    headers.set("access-control-allow-methods", DEFAULT_ALLOWED_METHODS);
    headers.set(
      "access-control-allow-headers",
      req.headers.get("access-control-request-headers") ?? DEFAULT_ALLOWED_HEADERS
    );
    headers.set("access-control-max-age", "86400");
    appendVaryOrigin(headers);
  }

  return new Response(null, {
    status: 204,
    headers
  });
};
