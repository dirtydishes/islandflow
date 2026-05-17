import { z } from "zod";

export const alertContextTraceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/);

export const isAlertContextPath = (pathname: string): boolean => {
  return /^\/flow\/alerts\/[^/]+\/context$/.test(pathname);
};

export const parseAlertContextTraceIdPath = (pathname: string): string | null => {
  if (!isAlertContextPath(pathname)) {
    return null;
  }

  const encodedTraceId = pathname.slice("/flow/alerts/".length, -"/context".length);
  return alertContextTraceIdSchema.parse(decodeURIComponent(encodedTraceId));
};
