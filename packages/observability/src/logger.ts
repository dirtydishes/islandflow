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
};

const defaultSink = (record: LogRecord) => {
  console.log(JSON.stringify(record));
};

export const createLogger = ({
  service,
  now = () => new Date().toISOString(),
  sink = defaultSink
}: LoggerOptions): Logger => {
  const write = (level: LogLevel, msg: string, context?: LogContext) => {
    const record: LogRecord = {
      level,
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
