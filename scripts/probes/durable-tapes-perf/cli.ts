import {
  DEFAULT_DURATION_MS,
  DEFAULT_MIN_VISIBLE_PANES,
  DEFAULT_MIN_VISIBLE_ROWS,
  DEFAULT_TARGET_URL,
  DEFAULT_WARMUP_MS
} from "./constants";
import type { CliOptions } from "./types";

const HELP = `
Durable-tapes browser/CDP performance probe

Usage:
  bun run scripts/probes/durable-tapes-perf.ts [options]

Options:
  --target <url>              Route to probe. Default: ${DEFAULT_TARGET_URL}
  --duration <duration>       Measurement window after warmup. Default: 180s
  --warmup <duration>         Warmup window after initial route render. Default: 30s
  --output <path>             Write JSON report to this path.
  --cdp-url <url>             Reuse an existing CDP HTTP or page WebSocket URL.
  --browser-path <path>       Chrome/Chromium executable path.
  --headful                   Launch browser with a visible window.
  --min-visible-panes <n>     Pane sanity budget. Default: 5
  --min-visible-rows <n>      Row sanity budget. Default: 1
  --no-fail-on-budget         Always exit 0 after writing the report.
  --help                      Show this help.

Duration values accept ms, s, or m suffixes. Examples: 30000ms, 30s, 3m.
Set CHROME_PATH as an alternative to --browser-path.
`;

const parseDurationMs = (value: string, label: string): number => {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) {
    throw new Error(`Invalid ${label} duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid ${label} duration: ${value}`);
  }
  if (unit === "m") {
    return Math.round(amount * 60_000);
  }
  if (unit === "s") {
    return Math.round(amount * 1_000);
  }
  return Math.round(amount);
};

const parseInteger = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
};

const readOptionValue = (args: string[], index: number, option: string): [string, number] => {
  const current = args[index];
  const inlinePrefix = `${option}=`;
  if (current.startsWith(inlinePrefix)) {
    return [current.slice(inlinePrefix.length), index];
  }
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return [next, index + 1];
};

export const parseArgs = (args: string[]): CliOptions => {
  const options: CliOptions = {
    targetUrl: DEFAULT_TARGET_URL,
    durationMs: DEFAULT_DURATION_MS,
    warmupMs: DEFAULT_WARMUP_MS,
    headful: false,
    failOnBudget: true,
    minVisibleRows: DEFAULT_MIN_VISIBLE_ROWS,
    minVisiblePanes: DEFAULT_MIN_VISIBLE_PANES
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP.trim());
      process.exit(0);
    }
    if (arg === "--headful") {
      options.headful = true;
      continue;
    }
    if (arg === "--no-fail-on-budget") {
      options.failOnBudget = false;
      continue;
    }

    const [value, nextIndex] = arg.includes("=")
      ? readOptionValue(args, index, arg.split("=")[0])
      : readOptionValue(args, index, arg);
    index = nextIndex;

    if (arg.startsWith("--target")) {
      options.targetUrl = value;
    } else if (arg.startsWith("--duration")) {
      options.durationMs = parseDurationMs(value, "--duration");
    } else if (arg.startsWith("--warmup")) {
      options.warmupMs = parseDurationMs(value, "--warmup");
    } else if (arg.startsWith("--output")) {
      options.outputPath = value;
    } else if (arg.startsWith("--cdp-url")) {
      options.cdpUrl = value;
    } else if (arg.startsWith("--browser-path")) {
      options.browserPath = value;
    } else if (arg.startsWith("--min-visible-rows")) {
      options.minVisibleRows = parseInteger(value, "--min-visible-rows");
    } else if (arg.startsWith("--min-visible-panes")) {
      options.minVisiblePanes = parseInteger(value, "--min-visible-panes");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  new URL(options.targetUrl);
  return options;
};
