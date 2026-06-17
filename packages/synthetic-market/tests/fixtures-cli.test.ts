import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SeedBundle, SyntheticMarketProfile } from "../src";
import { runSyntheticMarketCli } from "../src/cli";
import {
  createSyntheticFixtureArtifacts,
  loadSyntheticFixture,
  writeSyntheticFixture
} from "../src/fixtures";
import { parseExpectedOutputManifest, SYNTHETIC_FIXTURE_REPLAY_ORDERING } from "../src/manifest";

const tinyProfile: SyntheticMarketProfile = {
  start_ts: Date.parse("2026-01-02T14:30:00Z"),
  steps: 2,
  scenario_id: "fixture-context-only",
  symbols: [
    {
      id: "spy-fixture",
      underlying_id: "SPY",
      base_price: 501.25,
      exchange: "ARCA"
    }
  ],
  liquidity: {
    id: "tiny-fixture-liquidity",
    equity_spread_bps: 4,
    equity_quote_size: 900,
    equity_trade_size: 180,
    option_spread_bps: 120,
    option_quote_size: 60,
    option_trade_size: 12,
    off_exchange_ratio: 0.2,
    arrival_interval_ms: 100
  },
  volatility: {
    id: "fixture-drift",
    drift_bps_per_step: 2,
    price_noise_bps: 4,
    option_iv: 0.36
  },
  option_chain: {
    id: "tiny-complete-chain",
    expiries_days: [7],
    strike_offsets_bps: [0],
    option_types: ["call"],
    strike_step: 5,
    sparse_contract_ratio: 0
  }
};

const seedBundle: SeedBundle = {
  seed: 202,
  namespace: "phase-02-test",
  partition: "fixture-cli"
};

describe("synthetic fixture manifests and CLI", () => {
  it("builds deterministic expected-output-ready manifests with replay ordering and event hashes", () => {
    const fixtureA = createSyntheticFixtureArtifacts({
      seed_bundle: seedBundle,
      profile: tinyProfile,
      run_id: "phase-02-fixture",
      run_name: "phase-02 fixture"
    });
    const fixtureB = createSyntheticFixtureArtifacts({
      seed_bundle: seedBundle,
      profile: tinyProfile,
      run_id: "phase-02-fixture",
      run_name: "phase-02 fixture"
    });

    expect(fixtureA.files.manifest).toBe(fixtureB.files.manifest);
    expect(fixtureA.files.market_events).toBe(fixtureB.files.market_events);
    expect(fixtureA.manifest.generator.version).toBe("synthetic-market-spine-v1");
    expect(fixtureA.manifest.seed_bundle).toEqual({
      seed: 202,
      namespace: "phase-02-test",
      partition: "fixture-cli"
    });
    expect(fixtureA.manifest.parameter_snapshot_hash).toBe(fixtureA.batch.parameter_snapshot_hash);
    expect(fixtureA.manifest.replay_plan.order_by).toEqual([...SYNTHETIC_FIXTURE_REPLAY_ORDERING]);
    expect(fixtureA.manifest.event_hashes.events).toHaveLength(fixtureA.batch.events.length);
    expect(fixtureA.manifest.expected_output_contract).toEqual({
      hidden_labels_embedded_in_market_events: false,
      labels_path: null,
      smart_flow_outputs_path: null
    });

    const eventBytes = fixtureA.files.market_events;
    expect(eventBytes).not.toContain("fixture-context-only");
    expect(eventBytes).not.toContain("scenario_id");
    expect(eventBytes).not.toContain("source_kind");
  });

  it("writes and loads infra-free fixture artifacts while verifying hashes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "islandflow-synthetic-fixture-"));

    try {
      const written = await writeSyntheticFixture({
        seed_bundle: seedBundle,
        profile: tinyProfile,
        run_id: "phase-02-loadable",
        run_name: "phase-02 loadable",
        output_dir: directory
      });
      const loaded = await loadSyntheticFixture(directory);

      expect(loaded.manifest).toEqual(written.manifest);
      expect(loaded.batch).toEqual(written.batch);
      expect(loaded.manifest.replay_plan.trace_ids).toEqual(
        loaded.batch.events.map((generated) => generated.event.trace_id)
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("generates stable fixture files from CLI profile and seed-bundle inputs", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "islandflow-synthetic-cli-"));

    try {
      const profilePath = path.join(directory, "profile.json");
      const seedPath = path.join(directory, "seed.json");
      const outputA = path.join(directory, "out-a");
      const outputB = path.join(directory, "out-b");
      await writeFile(profilePath, JSON.stringify(tinyProfile), "utf8");
      await writeFile(seedPath, JSON.stringify(seedBundle), "utf8");

      const args = [
        "generate",
        "--profile",
        profilePath,
        "--seed-bundle",
        seedPath,
        "--run-id",
        "phase-02-cli",
        "--run-name",
        "phase-02 cli",
        "--scenario-id",
        "cli-context-only",
        "--output-dir"
      ];
      const resultA = await runSyntheticMarketCli([...args, outputA]);
      const resultB = await runSyntheticMarketCli([...args, outputB]);

      expect(resultA.exit_code).toBe(0);
      expect(resultB.exit_code).toBe(0);
      const manifestA = await readFile(path.join(outputA, "manifest.json"), "utf8");
      const manifestB = await readFile(path.join(outputB, "manifest.json"), "utf8");
      const eventsA = await readFile(path.join(outputA, "market-events.json"), "utf8");
      const eventsB = await readFile(path.join(outputB, "market-events.json"), "utf8");

      expect(manifestA).toBe(manifestB);
      expect(eventsA).toBe(eventsB);
      expect(eventsA).not.toContain("cli-context-only");
      expect(parseExpectedOutputManifest(JSON.parse(manifestA)).run.scenario_id).toBe(
        "cli-context-only"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects CLI generation when core deterministic inputs are missing", async () => {
    const result = await runSyntheticMarketCli(["generate", "--run-name", "missing-inputs"]);

    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("requires --profile");
  });

  it("rejects seed bundle files that omit the integer seed", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "islandflow-synthetic-cli-missing-seed-"));

    try {
      const profilePath = path.join(directory, "profile.json");
      const seedPath = path.join(directory, "seed.json");
      await writeFile(profilePath, JSON.stringify(tinyProfile), "utf8");
      await writeFile(seedPath, JSON.stringify({ namespace: "phase-02-test" }), "utf8");

      const result = await runSyntheticMarketCli([
        "generate",
        "--profile",
        profilePath,
        "--seed-bundle",
        seedPath,
        "--run-name",
        "missing seed",
        "--output-dir",
        path.join(directory, "out")
      ]);

      expect(result.exit_code).toBe(1);
      expect(result.stderr).toContain("must include an integer seed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
