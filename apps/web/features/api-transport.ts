const DEFAULT_LOCAL_API_ORIGIN = "http://127.0.0.1:4000";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const getPublicApiOverride = (): string | undefined => {
  const value = process.env.NEXT_PUBLIC_API_URL?.trim();
  return value ? value : undefined;
};

const browserOrigin = (): string => {
  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_API_ORIGIN;
  }

  const { protocol, hostname, host } = window.location;
  if (LOCAL_HOSTS.has(hostname)) {
    return `${protocol === "https:" ? "https" : "http"}://${hostname}:4000`;
  }
  return `${protocol === "https:" ? "https" : "http"}://${host}`;
};

const normalizeUrl = (path: string, protocolKind: "http" | "ws", base?: string): string => {
  const origin = base?.trim() || getPublicApiOverride() || browserOrigin();
  const url = new URL(origin);
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  url.protocol = protocolKind === "ws" ? (secure ? "wss:" : "ws:") : secure ? "https:" : "http:";
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
};

export const buildBrowserApiUrl = (path: string, apiBaseUrl?: string): string =>
  normalizeUrl(path, "http", apiBaseUrl);

export const buildBrowserWsUrl = (path: string, wsBaseUrl?: string): string =>
  normalizeUrl(path, "ws", wsBaseUrl);
