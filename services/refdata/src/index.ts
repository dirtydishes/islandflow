import { createLogger } from "@islandflow/observability";
import { createEmptyEventCalendarProvider, loadEventCalendarProviderFromFile } from "./event-calendar";

const service = "refdata";
const logger = createLogger({ service });

logger.info("service starting");

const eventCalendarPath = process.env.REFDATA_EVENT_CALENDAR_PATH ?? process.env.SMART_MONEY_EVENT_CALENDAR_PATH;

if (eventCalendarPath) {
  try {
    await loadEventCalendarProviderFromFile(eventCalendarPath);
    logger.info("event calendar loaded", { path: eventCalendarPath });
  } catch (error) {
    logger.warn("event calendar unavailable", {
      path: eventCalendarPath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
} else {
  createEmptyEventCalendarProvider();
  logger.info("event calendar disabled");
}

const shutdown = (signal: string) => {
  logger.info("service stopping", { signal });
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Keep the process alive until real listeners are wired.
setInterval(() => {}, 60_000);
