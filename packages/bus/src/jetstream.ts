import {
  connect,
  consumerOpts,
  type ConsumerOptsBuilder,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  type StreamConfig,
  type StreamUpdateConfig,
  JSONCodec,
  type JsMsg,
  createInbox,
  nanos,
  millis
} from "nats";
import { getKnownStreamDefinitions, getStreamDefinition, type StreamRetentionClass } from "./streams";

export type NatsConnectionOptions = {
  servers: string | string[];
  name?: string;
  timeoutMs?: number;
};

export type JetStreamConnection = {
  nc: NatsConnection;
  js: JetStreamClient;
  jsm: JetStreamManager;
};

export type RetryOptions = {
  attempts: number;
  delayMs: number;
};

export type LoggerLike = {
  info: (msg: string, context?: Record<string, unknown>) => void;
};

export type StreamFieldDelta = {
  field: string;
  current: unknown;
  desired: unknown;
};

export type StreamAuditState = "match" | "missing" | "retention_drift" | "structural_mismatch";

export type StreamReconciliationAction = "none" | "created" | "updated";

export type StreamAuditReport = {
  name: string;
  desired: StreamConfig;
  existing: StreamConfig | null;
  state: StreamAuditState;
  retentionDrift: StreamFieldDelta[];
  structuralMismatch: StreamFieldDelta[];
};

export type StreamReconciliationReport = StreamAuditReport & {
  action: StreamReconciliationAction;
};

export type ReconcileStreamOptions = {
  logger?: LoggerLike;
};

export type KnownStreamOptions = ReconcileStreamOptions & {
  env?: Record<string, string | undefined>;
};

export type ReconcileStreamsCommandDependencies = {
  connect?: typeof connectJetStream;
  env?: Record<string, string | undefined>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

const RETENTION_FIELDS = [
  "retention",
  "discard",
  "max_msgs",
  "max_msgs_per_subject",
  "max_age",
  "max_bytes",
  "num_replicas"
] as const;

const STRUCTURAL_FIELDS = ["name", "subjects", "storage"] as const;

const sleep = (delayMs: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
};

export const connectJetStream = async (
  options: NatsConnectionOptions
): Promise<JetStreamConnection> => {
  const nc = await connect({
    servers: options.servers,
    name: options.name,
    timeout: options.timeoutMs
  });

  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();

  return { nc, js, jsm };
};

export const connectJetStreamWithRetry = async (
  options: NatsConnectionOptions,
  retry: RetryOptions
): Promise<JetStreamConnection> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
    try {
      return await connectJetStream(options);
    } catch (error) {
      lastError = error;
      if (attempt < retry.attempts) {
        await sleep(retry.delayMs);
      }
    }
  }

  throw lastError ?? new Error("Failed to connect to NATS");
};

export const ensureStream = async (
  jsm: JetStreamManager,
  config: StreamConfig,
  options: ReconcileStreamOptions = {}
): Promise<StreamReconciliationReport> => {
  const audit = await auditStream(jsm, config);

  switch (audit.state) {
    case "match":
      return { ...audit, action: "none" };
    case "missing":
      await jsm.streams.add(config);
      return { ...audit, action: "created" };
    case "retention_drift": {
      const updateConfig = buildStreamUpdateConfig(audit.existing!, config);
      await jsm.streams.update(config.name, updateConfig as Partial<StreamUpdateConfig>);
      options.logger?.info("reconciled jetstream retention", {
        stream: config.name,
        drift: audit.retentionDrift
      });
      return { ...audit, action: "updated" };
    }
    case "structural_mismatch":
      throw new Error(formatStructuralMismatchMessage(audit));
  }
};

const parseBoundedNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

export const resolveStreamRetention = (
  streamClass: StreamRetentionClass,
  env: Record<string, string | undefined> = process.env
): Pick<StreamConfig, "max_bytes" | "max_age"> => {
  if (streamClass === "raw") {
    return {
      max_age: nanos(parseBoundedNumber(env.STREAM_RAW_MAX_AGE_MS, 3_600_000)),
      max_bytes: parseBoundedNumber(env.STREAM_RAW_MAX_BYTES, 536_870_912)
    };
  }

  return {
    max_age: nanos(parseBoundedNumber(env.STREAM_DERIVED_MAX_AGE_MS, 43_200_000)),
    max_bytes: parseBoundedNumber(env.STREAM_DERIVED_MAX_BYTES, 268_435_456)
  };
};

export const buildStreamConfig = (
  name: string,
  subject: string,
  streamClass: StreamRetentionClass,
  env: Record<string, string | undefined> = process.env
): StreamConfig => ({
  name,
  subjects: [subject],
  retention: "limits",
  storage: "file",
  discard: "old",
  max_msgs_per_subject: -1,
  max_msgs: -1,
  ...resolveStreamRetention(streamClass, env),
  num_replicas: 1
});

export const buildKnownStreamConfig = (
  name: string,
  env: Record<string, string | undefined> = process.env
): StreamConfig => {
  const definition = getStreamDefinition(name);
  return buildStreamConfig(definition.name, definition.subject, definition.retentionClass, env);
};

const arraysEqual = (left: unknown[], right: unknown[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
};

const getFieldValue = (config: StreamConfig, field: string): unknown => {
  switch (field) {
    case "name":
      return config.name;
    case "subjects":
      return config.subjects;
    case "storage":
      return config.storage;
    case "retention":
      return config.retention;
    case "discard":
      return config.discard;
    case "max_msgs":
      return config.max_msgs;
    case "max_msgs_per_subject":
      return config.max_msgs_per_subject;
    case "max_age":
      return config.max_age;
    case "max_bytes":
      return config.max_bytes;
    case "num_replicas":
      return config.num_replicas;
    default:
      return undefined;
  }
};

const diffConfigFields = (
  current: StreamConfig,
  desired: StreamConfig,
  fields: readonly string[]
): StreamFieldDelta[] => {
  const deltas: StreamFieldDelta[] = [];

  for (const field of fields) {
    const currentValue = getFieldValue(current, field);
    const desiredValue = getFieldValue(desired, field);
    const matches = Array.isArray(currentValue) && Array.isArray(desiredValue)
      ? arraysEqual(currentValue, desiredValue)
      : currentValue === desiredValue;

    if (!matches) {
      deltas.push({
        field,
        current: currentValue,
        desired: desiredValue
      });
    }
  }

  return deltas;
};

const isNotFoundError = (error: unknown): boolean => {
  return error instanceof Error && error.message.toLowerCase().includes("not found");
};

export const auditStreamConfig = (
  current: StreamConfig | null,
  desired: StreamConfig
): StreamAuditReport => {
  if (!current) {
    return {
      name: desired.name,
      desired,
      existing: null,
      state: "missing",
      retentionDrift: [],
      structuralMismatch: []
    };
  }

  const structuralMismatch = diffConfigFields(current, desired, STRUCTURAL_FIELDS);
  if (structuralMismatch.length > 0) {
    return {
      name: desired.name,
      desired,
      existing: current,
      state: "structural_mismatch",
      retentionDrift: [],
      structuralMismatch
    };
  }

  const retentionDrift = diffConfigFields(current, desired, RETENTION_FIELDS);
  if (retentionDrift.length > 0) {
    return {
      name: desired.name,
      desired,
      existing: current,
      state: "retention_drift",
      retentionDrift,
      structuralMismatch: []
    };
  }

  return {
    name: desired.name,
    desired,
    existing: current,
    state: "match",
    retentionDrift: [],
    structuralMismatch: []
  };
};

const buildStreamUpdateConfig = (
  current: StreamConfig,
  desired: StreamConfig
): Partial<StreamConfig> => {
  const updateConfig: Partial<StreamConfig> = { ...current };

  for (const field of RETENTION_FIELDS) {
    (updateConfig as Record<string, unknown>)[field] = getFieldValue(desired, field);
  }

  return updateConfig;
};

export const auditStream = async (
  jsm: JetStreamManager,
  desired: StreamConfig
): Promise<StreamAuditReport> => {
  try {
    const info = await jsm.streams.info(desired.name);
    return auditStreamConfig(info.config, desired);
  } catch (error) {
    if (isNotFoundError(error)) {
      return auditStreamConfig(null, desired);
    }

    throw error;
  }
};

export const auditKnownStreams = async (
  jsm: JetStreamManager,
  streamNames: readonly string[],
  options: KnownStreamOptions = {}
): Promise<StreamAuditReport[]> => {
  const reports: StreamAuditReport[] = [];

  for (const name of streamNames) {
    reports.push(await auditStream(jsm, buildKnownStreamConfig(name, options.env)));
  }

  return reports;
};

export const ensureKnownStreams = async (
  jsm: JetStreamManager,
  streamNames: readonly string[],
  options: KnownStreamOptions = {}
): Promise<StreamReconciliationReport[]> => {
  const reports: StreamReconciliationReport[] = [];

  for (const name of streamNames) {
    reports.push(
      await ensureStream(jsm, buildKnownStreamConfig(name, options.env), {
        logger: options.logger
      })
    );
  }

  return reports;
};

const formatStructuredValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.join(",");
  }

  return String(value);
};

const formatStructuralMismatchMessage = (audit: StreamAuditReport): string => {
  const details = audit.structuralMismatch
    .map((delta) => `${delta.field} current=${formatStructuredValue(delta.current)} desired=${formatStructuredValue(delta.desired)}`)
    .join("; ");
  return `Refusing to reconcile stream ${audit.name}: structural mismatch (${details})`;
};

const formatDurationMs = (value: number): string => {
  if (value % 3_600_000 === 0) {
    return `${value / 3_600_000}h`;
  }
  if (value % 60_000 === 0) {
    return `${value / 60_000}m`;
  }
  if (value % 1_000 === 0) {
    return `${value / 1_000}s`;
  }
  return `${value}ms`;
};

const formatBytes = (value: number): string => {
  if (value < 0) {
    return String(value);
  }

  const mib = 1024 * 1024;
  if (value % mib === 0) {
    return `${value / mib} MiB`;
  }

  return `${value} B`;
};

const formatRetentionSummary = (config: StreamConfig): string => {
  return `age=${formatDurationMs(millis(Number(config.max_age)))} bytes=${formatBytes(config.max_bytes)} replicas=${config.num_replicas} retention=${config.retention} discard=${config.discard}`;
};

const formatReportLine = (
  report: StreamAuditReport | StreamReconciliationReport,
  mode: "check" | "apply"
): string => {
  if ("action" in report && report.action === "created") {
    return `✓ ${report.name} created ${formatRetentionSummary(report.desired)}`;
  }

  if ("action" in report && report.action === "updated") {
    const fields = report.retentionDrift.map((delta) => delta.field).join(",");
    return `✓ ${report.name} updated fields=${fields} ${formatRetentionSummary(report.desired)}`;
  }

  switch (report.state) {
    case "match":
      return `✓ ${report.name} ${formatRetentionSummary(report.desired)}`;
    case "missing":
      return `${mode === "check" ? "○" : "◐"} ${report.name} missing desired ${formatRetentionSummary(report.desired)}`;
    case "retention_drift": {
      const details = report.retentionDrift
        .map((delta) => {
          const desiredValue = delta.field === "max_age"
            ? formatDurationMs(millis(Number(delta.desired)))
            : delta.field === "max_bytes"
              ? formatBytes(Number(delta.desired))
              : formatStructuredValue(delta.desired);
          const currentValue = delta.field === "max_age"
            ? formatDurationMs(millis(Number(delta.current)))
            : delta.field === "max_bytes"
              ? formatBytes(Number(delta.current))
              : formatStructuredValue(delta.current);
          return `${delta.field}:${currentValue}->${desiredValue}`;
        })
        .join(" ");
      return `◐ ${report.name} drift ${details}`;
    }
    case "structural_mismatch": {
      const details = report.structuralMismatch
        .map((delta) => `${delta.field}:${formatStructuredValue(delta.current)}->${formatStructuredValue(delta.desired)}`)
        .join(" ");
      return `● ${report.name} structural-mismatch ${details}`;
    }
  }
};

export const runReconcileStreamsCommand = async (
  args: string[],
  dependencies: ReconcileStreamsCommandDependencies = {}
): Promise<number> => {
  const connectFn = dependencies.connect ?? connectJetStream;
  const stdout = dependencies.stdout ?? ((line: string) => console.log(line));
  const stderr = dependencies.stderr ?? ((line: string) => console.error(line));
  const env = dependencies.env ?? process.env;
  const apply = args.includes("--apply");
  const check = args.includes("--check");

  if (apply === check) {
    stderr("Usage: bun packages/bus/src/reconcile-streams.ts --check|--apply");
    return 2;
  }

  let connection: JetStreamConnection | null = null;

  try {
    connection = await connectFn({
      servers: env.NATS_URL ?? "nats://127.0.0.1:4222",
      name: "bus-reconcile-streams"
    });

    const streamNames = getKnownStreamDefinitions().map((definition) => definition.name);
    const mode = apply ? "apply" : "check";
    let exitCode = 0;

    if (check) {
      const reports = await auditKnownStreams(connection.jsm, streamNames, { env });
      for (const report of reports) {
        stdout(formatReportLine(report, mode));
        if (report.state !== "match") {
          exitCode = 1;
        }
      }
      return exitCode;
    }

    for (const name of streamNames) {
      const desired = buildKnownStreamConfig(name, env);
      try {
        const report = await ensureStream(connection.jsm, desired);
        stdout(formatReportLine(report, mode));
      } catch (error) {
        const audit = await auditStream(connection.jsm, desired);
        if (audit.state === "structural_mismatch") {
          stdout(formatReportLine(audit, mode));
        }
        stderr(error instanceof Error ? error.message : String(error));
        exitCode = 1;
        break;
      }
    }

    return exitCode;
  } finally {
    await connection?.nc.close();
  }
};

export const buildDurableConsumer = (
  durableName: string,
  deliverSubject: string = createInbox()
): ConsumerOptsBuilder => {
  const opts = consumerOpts();
  opts.durable(durableName);
  opts.manualAck();
  opts.ackExplicit();
  opts.deliverTo(deliverSubject);
  return opts;
};

export const publishJson = async <T>(
  js: JetStreamClient,
  subject: string,
  payload: T
): Promise<void> => {
  const codec = JSONCodec<T>();
  await js.publish(subject, codec.encode(payload));
};

export type JsonSubscription<T> = {
  messages: AsyncIterable<JsMsg>;
  decode: (msg: JsMsg) => T;
};

export const subscribeJson = async <T>(
  js: JetStreamClient,
  subject: string,
  opts: ConsumerOptsBuilder
): Promise<JsonSubscription<T>> => {
  const codec = JSONCodec<T>();
  const sub = await js.subscribe(subject, opts);

  return {
    messages: sub,
    decode: (msg) => codec.decode(msg.data)
  };
};
