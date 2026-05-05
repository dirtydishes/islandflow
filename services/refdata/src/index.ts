import { createLogger } from "@islandflow/observability";
import {
  createEmptyEventCalendarProvider,
  fetchAlphaVantageEarningsCalendar,
  loadEventCalendarProviderFromFile,
  writeEventCalendarEntries,
  type AlphaVantageEarningsCalendarOptions
} from "./event-calendar";

const service = "refdata";
const logger = createLogger({ service });

logger.info("service starting");

const eventCalendarPath = process.env.REFDATA_EVENT_CALENDAR_PATH ?? process.env.SMART_MONEY_EVENT_CALENDAR_PATH;
const eventCalendarProvider = process.env.REFDATA_EVENT_CALENDAR_PROVIDER ?? process.env.EVENT_CALENDAR_PROVIDER;
const refreshMs = Math.max(0, Number(process.env.REFDATA_EVENT_CALENDAR_REFRESH_MS ?? 86_400_000) || 0);

const getAlphaVantageOptions = (): AlphaVantageEarningsCalendarOptions | null => {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    logger.warn("alpha vantage event calendar disabled; missing ALPHA_VANTAGE_API_KEY");
    return null;
  }

  const horizon = process.env.ALPHA_VANTAGE_EARNINGS_HORIZON;
  return {
    apiKey,
    horizon: horizon === "6month" || horizon === "12month" ? horizon : "3month",
    symbol: process.env.ALPHA_VANTAGE_EARNINGS_SYMBOL || undefined
  };
};

const refreshEventCalendar = async (): Promise<void> => {
  if (!eventCalendarPath) {
    logger.warn("event calendar refresh disabled; missing SMART_MONEY_EVENT_CALENDAR_PATH or REFDATA_EVENT_CALENDAR_PATH");
    return;
  }
  if (eventCalendarProvider !== "alpha_vantage") {
    return;
  }

  const options = getAlphaVantageOptions();
  if (!options) {
    return;
  }

  const entries = await fetchAlphaVantageEarningsCalendar(options);
  await writeEventCalendarEntries(eventCalendarPath, entries);
  logger.info("event calendar refreshed", {
    provider: "alpha_vantage",
    path: eventCalendarPath,
    count: entries.length,
    horizon: options.horizon,
    symbol: options.symbol ?? "ALL"
  });
};

if (eventCalendarProvider === "alpha_vantage") {
  try {
    await refreshEventCalendar();
  } catch (error) {
    logger.warn("event calendar refresh failed", {
      provider: "alpha_vantage",
      error: error instanceof Error ? error.message : String(error)
    });
  }

  if (refreshMs > 0) {
    setInterval(() => {
      refreshEventCalendar().catch((error) => {
        logger.warn("event calendar refresh failed", {
          provider: "alpha_vantage",
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, refreshMs);
  }
}

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
