import { createLogger } from "@islandflow/observability";

const service = "refdata";
const logger = createLogger({ service });

logger.info("service starting");

const shutdown = (signal: string) => {
  logger.info("service stopping", { signal });
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Keep the process alive until real listeners are wired.
setInterval(() => {}, 60_000);
