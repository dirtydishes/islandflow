import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_OPTION_PRINTS,
  STREAM_OPTION_PRINTS,
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureStream,
  subscribeJson
} from "@islandflow/bus";
import { OptionPrintSchema } from "@islandflow/types";
import { z } from "zod";

const service = "compute";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://localhost:4222")
});

const env = readEnv(envSchema);

const run = async () => {
  logger.info("service starting");

  const { nc, js, jsm } = await connectJetStreamWithRetry(
    {
      servers: env.NATS_URL,
      name: service
    },
    { attempts: 20, delayMs: 500 }
  );

  await ensureStream(jsm, {
    name: STREAM_OPTION_PRINTS,
    subjects: [SUBJECT_OPTION_PRINTS],
    retention: "limits",
    storage: "file",
    discard: "old",
    max_msgs_per_subject: -1,
    max_msgs: -1,
    max_bytes: -1,
    max_age: 0,
    num_replicas: 1
  });

  const opts = buildDurableConsumer("compute-option-prints");

  const subscription = await subscribeJson(js, SUBJECT_OPTION_PRINTS, opts);

  const shutdown = async (signal: string) => {
    logger.info("service stopping", { signal });
    await nc.drain();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  for await (const msg of subscription.messages) {
    try {
      const print = OptionPrintSchema.parse(subscription.decode(msg));
      logger.info("received option print", {
        trace_id: print.trace_id,
        seq: print.seq,
        option_contract_id: print.option_contract_id
      });
      msg.ack();
    } catch (error) {
      logger.error("failed to process option print", {
        error: error instanceof Error ? error.message : String(error)
      });
      msg.term();
    }
  }
};

await run();
