import {
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  SyntheticControlStateSchema,
  normalizeSyntheticControlState,
  type SyntheticControlState
} from "@islandflow/types";
import { JSONCodec, type JetStreamClient, type KV, type KvEntry } from "nats";

export const SYNTHETIC_CONTROL_BUCKET = "synthetic_control";
export const SYNTHETIC_CONTROL_GLOBAL_KEY = "global";

const codec = JSONCodec<SyntheticControlState>();

const decodeSyntheticControlEntry = (
  entry: KvEntry | null | undefined
): SyntheticControlState => {
  if (!entry || entry.operation !== "PUT") {
    return DEFAULT_SYNTHETIC_CONTROL_STATE;
  }
  return SyntheticControlStateSchema.parse(entry.json());
};

export const openSyntheticControlKv = async (
  js: JetStreamClient
): Promise<KV> => {
  return js.views.kv(SYNTHETIC_CONTROL_BUCKET, {
    description: "Hosted synthetic market internal control state",
    history: 8
  });
};

export const readSyntheticControlState = async (
  kv: KV
): Promise<SyntheticControlState> => {
  return decodeSyntheticControlEntry(
    await kv.get(SYNTHETIC_CONTROL_GLOBAL_KEY)
  );
};

export const ensureSyntheticControlState = async (
  kv: KV
): Promise<SyntheticControlState> => {
  const current = await kv.get(SYNTHETIC_CONTROL_GLOBAL_KEY);
  if (current && current.operation === "PUT") {
    return SyntheticControlStateSchema.parse(current.json());
  }

  await kv.put(
    SYNTHETIC_CONTROL_GLOBAL_KEY,
    codec.encode(DEFAULT_SYNTHETIC_CONTROL_STATE)
  );
  return DEFAULT_SYNTHETIC_CONTROL_STATE;
};

export const writeSyntheticControlState = async (
  kv: KV,
  control: Partial<SyntheticControlState>
): Promise<SyntheticControlState> => {
  const normalized = normalizeSyntheticControlState(control);
  await kv.put(
    SYNTHETIC_CONTROL_GLOBAL_KEY,
    codec.encode(normalized)
  );
  return normalized;
};

export const watchSyntheticControlState = async (
  kv: KV,
  onUpdate: (control: SyntheticControlState) => void,
  onError?: (error: unknown) => void
): Promise<() => Promise<void>> => {
  const iterator = await kv.watch({
    key: SYNTHETIC_CONTROL_GLOBAL_KEY,
    ignoreDeletes: true
  });
  let stopped = false;
  const task = (async () => {
    try {
      for await (const entry of iterator) {
        if (stopped || entry.operation !== "PUT") {
          continue;
        }
        onUpdate(SyntheticControlStateSchema.parse(entry.json()));
      }
    } catch (error) {
      if (!stopped) {
        onError?.(error);
      }
    }
  })();

  return async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    iterator.stop();
    await task;
  };
};
