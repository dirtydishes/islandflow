import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/**
 * Keep dev and production build artifacts separate to avoid chunk/runtime
 * mismatches when `next dev` and `next build` are run in overlapping sessions.
 *
 * @param {string} phase
 * @returns {import("next").NextConfig}
 */
export default function nextConfig(phase) {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    distDir: isDev ? ".next-dev" : ".next"
  };
}
