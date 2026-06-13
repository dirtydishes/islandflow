import { networkInterfaces } from "node:os";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const configuredAllowedDevOrigins = () => {
  return (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const localIpv4DevOrigins = () => {
  return Object.values(networkInterfaces())
    .flat()
    .filter((address) => address?.family === "IPv4")
    .map((address) => address.address);
};

const allowedDevOrigins = () => {
  return Array.from(
    new Set(["localhost", "127.0.0.1", ...localIpv4DevOrigins(), ...configuredAllowedDevOrigins()])
  );
};

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
    allowedDevOrigins: isDev ? allowedDevOrigins() : undefined,
    distDir: isDev ? ".next-dev" : ".next"
  };
}
