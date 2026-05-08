import {
  connect,
  consumerOpts,
  type ConsumerOptsBuilder,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  type StreamConfig,
  JSONCodec,
  type JsMsg,
  createInbox
} from "nats";

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
  config: StreamConfig
): Promise<void> => {
  try {
    await jsm.streams.info(config.name);
    return;
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      await jsm.streams.add(config);
      return;
    }

    throw error;
  }
};

const parseBoundedNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

export type StreamRetentionClass = "raw" | "derived";

export const resolveStreamRetention = (
  streamClass: StreamRetentionClass,
  env: Record<string, string | undefined> = process.env
): Pick<StreamConfig, "max_bytes" | "max_age"> => {
  if (streamClass === "raw") {
    return {
      max_age: parseBoundedNumber(env.STREAM_RAW_MAX_AGE_MS, 7_200_000),
      max_bytes: parseBoundedNumber(env.STREAM_RAW_MAX_BYTES, 1_073_741_824)
    };
  }

  return {
    max_age: parseBoundedNumber(env.STREAM_DERIVED_MAX_AGE_MS, 86_400_000),
    max_bytes: parseBoundedNumber(env.STREAM_DERIVED_MAX_BYTES, 536_870_912)
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
