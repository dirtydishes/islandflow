export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export type LogRecord = LogContext & {
  level: LogLevel;
  service: string;
  msg: string;
  ts: string;
};

export type LoggerFn = (msg: string, context?: LogContext) => void;

export type Logger = {
  debug: LoggerFn;
  info: LoggerFn;
  warn: LoggerFn;
  error: LoggerFn;
};

export type LoggerOptions = {
  service: string;
  now?: () => string;
  sink?: (record: LogRecord) => void;
  level?: LogLevel;
};

const defaultSink = (record: LogRecord) => {
  console.log(JSON.stringify(record));
};

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const resolveLogLevel = (value: string | undefined): LogLevel => {
  switch ((value ?? "").trim().toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value!.trim().toLowerCase() as LogLevel;
    default:
      return "info";
  }
};

export const createLogger = ({
  service,
  now = () => new Date().toISOString(),
  sink = defaultSink,
  level = resolveLogLevel(process.env.LOG_LEVEL)
}: LoggerOptions): Logger => {
  const levelThreshold = resolveLogLevel(level);

  const write = (recordLevel: LogLevel, msg: string, context?: LogContext) => {
    if (LOG_LEVEL_ORDER[recordLevel] < LOG_LEVEL_ORDER[levelThreshold]) {
      return;
    }
    const record: LogRecord = {
      level: recordLevel,
      service,
      msg,
      ts: now(),
      ...(context ?? {})
    };

    sink(record);
  };

  return {
    debug: (msg, context) => write("debug", msg, context),
    info: (msg, context) => write("info", msg, context),
    warn: (msg, context) => write("warn", msg, context),
    error: (msg, context) => write("error", msg, context)
  };
};
