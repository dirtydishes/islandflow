import { describe, expect, it } from "bun:test";
import { nanos, type JetStreamManager, type StreamConfig } from "nats";
import {
  auditStreamConfig,
  buildKnownStreamConfig,
  ensureStream,
  getKnownStreamDefinitions,
  resolveStreamRetention,
  runReconcileStreamsCommand
} from "../src";

const STREAMS = getKnownStreamDefinitions().map((definition) => definition.name);

const buildMockStreamManager = (configs: Record<string, StreamConfig | null>) => {
  const addCalls: StreamConfig[] = [];
  const updateCalls: Array<{ name: string; config: Partial<StreamConfig> }> = [];

  return {
    manager: {
      streams: {
        info: async (name: string) => {
          const config = configs[name];
          if (!config) {
            throw new Error("stream not found");
          }
          return { config };
        },
        add: async (config: StreamConfig) => {
          addCalls.push(config);
          configs[config.name] = config;
          return { config };
        },
        update: async (name: string, config?: Partial<StreamConfig>) => {
          updateCalls.push({ name, config: config ?? {} });
          configs[name] = config as StreamConfig;
          return { config };
        }
      }
    } as unknown as JetStreamManager,
    addCalls,
    updateCalls
  };
};

const buildAllKnownConfigs = (env: Record<string, string | undefined> = {}) => {
  return Object.fromEntries(
    STREAMS.map((name) => [name, buildKnownStreamConfig(name, env)])
  ) as Record<string, StreamConfig>;
};

describe("jetstream retention defaults", () => {
  it("resolves raw defaults to 60m and 512 MiB", () => {
    expect(resolveStreamRetention("raw")).toEqual({
      max_age: nanos(3_600_000),
      max_bytes: 536_870_912
    });
  });

  it("resolves derived defaults to 12h and 256 MiB", () => {
    expect(resolveStreamRetention("derived")).toEqual({
      max_age: nanos(43_200_000),
      max_bytes: 268_435_456
    });
  });

  it("lets env overrides win over defaults", () => {
    expect(
      resolveStreamRetention("raw", {
        STREAM_RAW_MAX_AGE_MS: "1234",
        STREAM_RAW_MAX_BYTES: "5678"
      })
    ).toEqual({
      max_age: nanos(1234),
      max_bytes: 5678
    });
  });
});

describe("ensureStream", () => {
  it("creates a missing stream", async () => {
    const desired = buildKnownStreamConfig("OPTIONS_PRINTS");
    const { manager, addCalls, updateCalls } = buildMockStreamManager({});

    const report = await ensureStream(manager, desired);

    expect(report.state).toBe("missing");
    expect(report.action).toBe("created");
    expect(addCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(0);
  });

  it("does nothing when an existing stream already matches", async () => {
    const desired = buildKnownStreamConfig("OPTIONS_PRINTS");
    const { manager, addCalls, updateCalls } = buildMockStreamManager({
      [desired.name]: desired
    });

    const report = await ensureStream(manager, desired);

    expect(report.state).toBe("match");
    expect(report.action).toBe("none");
    expect(addCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("updates only retention drift in place", async () => {
    const desired = buildKnownStreamConfig("OPTIONS_PRINTS");
    const { manager, addCalls, updateCalls } = buildMockStreamManager({
      [desired.name]: {
        ...desired,
        max_age: 7_200_000,
        max_bytes: 1_073_741_824
      }
    });

    const report = await ensureStream(manager, desired);

    expect(report.state).toBe("retention_drift");
    expect(report.action).toBe("updated");
    expect(addCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.name).toBe(desired.name);
    expect(updateCalls[0]?.config.max_age).toBe(desired.max_age);
    expect(updateCalls[0]?.config.max_bytes).toBe(desired.max_bytes);
  });

  it("throws on structural mismatch instead of mutating", async () => {
    const desired = buildKnownStreamConfig("OPTIONS_PRINTS");
    const { manager, addCalls, updateCalls } = buildMockStreamManager({
      [desired.name]: {
        ...desired,
        subjects: ["options.prints.legacy"]
      }
    });

    await expect(ensureStream(manager, desired)).rejects.toThrow("structural mismatch");
    expect(addCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("auditStreamConfig", () => {
  it("flags structural mismatches before retention drift", () => {
    const desired = buildKnownStreamConfig("OPTIONS_PRINTS");
    const report = auditStreamConfig(
      {
        ...desired,
        subjects: ["options.prints.legacy"],
        max_age: 7_200_000
      },
      desired
    );

    expect(report.state).toBe("structural_mismatch");
    expect(report.structuralMismatch).toHaveLength(1);
    expect(report.retentionDrift).toHaveLength(0);
  });
});

describe("runReconcileStreamsCommand", () => {
  it("returns clean in --check mode when all streams match", async () => {
    const configs = buildAllKnownConfigs();
    const outputs: string[] = [];

    const exitCode = await runReconcileStreamsCommand(["--check"], {
      connect: async () => ({
        nc: { close: async () => {} } as never,
        js: {} as never,
        jsm: buildMockStreamManager(configs).manager
      }),
      stdout: (line) => outputs.push(line)
    });

    expect(exitCode).toBe(0);
    expect(outputs.every((line) => line.startsWith("✓"))).toBe(true);
  });

  it("returns non-zero in --check mode when a stream drifts", async () => {
    const configs = buildAllKnownConfigs();
    configs.OPTIONS_PRINTS = {
      ...configs.OPTIONS_PRINTS,
      max_age: 7_200_000
    };
    const outputs: string[] = [];

    const exitCode = await runReconcileStreamsCommand(["--check"], {
      connect: async () => ({
        nc: { close: async () => {} } as never,
        js: {} as never,
        jsm: buildMockStreamManager(configs).manager
      }),
      stdout: (line) => outputs.push(line)
    });

    expect(exitCode).toBe(1);
    expect(outputs.some((line) => line.includes("OPTIONS_PRINTS") && line.includes("drift"))).toBe(
      true
    );
  });

  it("updates drift in --apply mode and reports actions", async () => {
    const configs = buildAllKnownConfigs();
    configs.OPTIONS_PRINTS = {
      ...configs.OPTIONS_PRINTS,
      max_age: 7_200_000
    };
    const outputs: string[] = [];
    const { manager, updateCalls } = buildMockStreamManager(configs);

    const exitCode = await runReconcileStreamsCommand(["--apply"], {
      connect: async () => ({
        nc: { close: async () => {} } as never,
        js: {} as never,
        jsm: manager
      }),
      stdout: (line) => outputs.push(line)
    });

    expect(exitCode).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(outputs.some((line) => line.includes("OPTIONS_PRINTS updated"))).toBe(true);
  });

  it("returns non-zero on structural mismatch and names the stream", async () => {
    const configs = buildAllKnownConfigs();
    configs.OPTIONS_PRINTS = {
      ...configs.OPTIONS_PRINTS,
      subjects: ["options.prints.legacy"]
    };
    const outputs: string[] = [];
    const errors: string[] = [];

    const exitCode = await runReconcileStreamsCommand(["--apply"], {
      connect: async () => ({
        nc: { close: async () => {} } as never,
        js: {} as never,
        jsm: buildMockStreamManager(configs).manager
      }),
      stdout: (line) => outputs.push(line),
      stderr: (line) => errors.push(line)
    });

    expect(exitCode).toBe(1);
    expect(
      outputs.some(
        (line) => line.includes("OPTIONS_PRINTS") && line.includes("structural-mismatch")
      )
    ).toBe(true);
    expect(errors.some((line) => line.includes("OPTIONS_PRINTS"))).toBe(true);
  });
});
