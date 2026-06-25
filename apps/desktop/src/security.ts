// Product trust-policy constant for the hosted app shell. This is not an API default.
export const DESKTOP_PRODUCTION_URL = "https://flow.deltaisland.io";
export const DESKTOP_LOCAL_DEV_URL = "http://127.0.0.1:3000";

const TRUSTED_ORIGINS = new Set([
  new URL(DESKTOP_PRODUCTION_URL).origin,
  new URL(DESKTOP_LOCAL_DEV_URL).origin,
  "http://localhost:3000"
]);

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

const parseUrl = (candidate: string): URL | null => {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
};

export const isTrustedAppUrl = (candidate: string): boolean => {
  const url = parseUrl(candidate);
  if (!url || !HTTP_PROTOCOLS.has(url.protocol)) {
    return false;
  }

  return TRUSTED_ORIGINS.has(url.origin);
};

export const isSafeExternalUrl = (candidate: string): boolean => {
  const url = parseUrl(candidate);
  if (!url || !HTTP_PROTOCOLS.has(url.protocol)) {
    return false;
  }

  return !TRUSTED_ORIGINS.has(url.origin);
};

export const resolveDesktopStartUrl = (candidate: string | undefined): string => {
  if (candidate && isTrustedAppUrl(candidate)) {
    return candidate;
  }

  return DESKTOP_PRODUCTION_URL;
};
