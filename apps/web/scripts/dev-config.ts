export const DEFAULT_REMOTE_API_URL = "https://api.flow.deltaisland.io";
export const DEFAULT_WEB_DEV_PORT = 3000;
export const HOSTED_API_QA_WEB_DEV_PORT = 3100;

export type WebDevConfig = {
  apiUrl: string;
  apiUrlSource: "default" | "NEXT_PUBLIC_API_URL";
  hostedApiCorsWarning: string | null;
  port: number;
  portSource: "default" | "PORT" | "WEB_DEV_PORT";
};

const firstConfiguredValue = (
  entries: Array<[WebDevConfig["portSource"], string | undefined]>
): { source: WebDevConfig["portSource"]; value: string } | null => {
  for (const [source, value] of entries) {
    const trimmed = value?.trim();
    if (trimmed) {
      return { source, value: trimmed };
    }
  }
  return null;
};

const resolveApiUrl = (
  env: Record<string, string | undefined>
): Pick<WebDevConfig, "apiUrl" | "apiUrlSource"> => {
  const configuredApiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredApiUrl) {
    return { apiUrl: configuredApiUrl, apiUrlSource: "NEXT_PUBLIC_API_URL" };
  }
  return { apiUrl: DEFAULT_REMOTE_API_URL, apiUrlSource: "default" };
};

export const parseWebDevPort = (value: string, source: WebDevConfig["portSource"]): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${source} must be an integer port between 1 and 65535`);
  }
  return port;
};

const isHostedApiUrl = (apiUrl: string): boolean => {
  try {
    return new URL(apiUrl).origin === DEFAULT_REMOTE_API_URL;
  } catch {
    return false;
  }
};

const resolveHostedApiCorsWarning = (apiUrl: string, port: number): string | null => {
  if (
    !isHostedApiUrl(apiUrl) ||
    [DEFAULT_WEB_DEV_PORT, HOSTED_API_QA_WEB_DEV_PORT].includes(port)
  ) {
    return null;
  }

  return [
    `hosted API CORS currently supports localhost ports ${DEFAULT_WEB_DEV_PORT}`,
    `and ${HOSTED_API_QA_WEB_DEV_PORT}; use WEB_DEV_PORT=${HOSTED_API_QA_WEB_DEV_PORT}`,
    "when port 3000 is occupied, or point NEXT_PUBLIC_API_URL at an API with matching CORS"
  ].join(" ");
};

export const resolveWebDevConfig = (env: Record<string, string | undefined>): WebDevConfig => {
  const configuredPort = firstConfiguredValue([
    ["WEB_DEV_PORT", env.WEB_DEV_PORT],
    ["PORT", env.PORT]
  ]);
  const portSource = configuredPort?.source ?? "default";
  const port = configuredPort
    ? parseWebDevPort(configuredPort.value, configuredPort.source)
    : DEFAULT_WEB_DEV_PORT;
  const { apiUrl, apiUrlSource } = resolveApiUrl(env);

  return {
    apiUrl,
    apiUrlSource,
    hostedApiCorsWarning: resolveHostedApiCorsWarning(apiUrl, port),
    port,
    portSource
  };
};
