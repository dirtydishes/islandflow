#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeSyntheticFixture } from "./fixtures";
import type { SeedBundle, SyntheticMarketProfile } from "./index";

export type SyntheticFixtureCliResult = {
  exit_code: number;
  stdout: string;
  stderr: string;
};

type CliOptions = {
  command: "generate";
  profile_path: string;
  seed_bundle_path?: string;
  seed?: number;
  seed_namespace?: string;
  seed_partition?: string;
  run_id?: string;
  run_name: string;
  scenario_id?: string;
  output_dir: string;
  steps?: number;
  start_ts?: number;
};

const USAGE = `Usage:
  bun run packages/synthetic-market/src/cli.ts generate \\
    --profile profile.json \\
    --seed-bundle seed.json \\
    --run-name small-demo \\
    --output-dir .tmp/synthetic-fixture

Required:
  --profile <path>       JSON SyntheticMarketProfile input.
  --output-dir <path>    Directory where manifest and fixture files are written.
  --run-name <name>      Human-readable fixture/run name for the manifest.
  --seed-bundle <path>   JSON SeedBundle input, or use --seed <number>.

Optional:
  --seed <number>        Seed override or inline seed bundle seed.
  --seed-namespace <id>  Seed namespace override.
  --seed-partition <id>  Seed partition override.
  --run-id <id>          Stable trace-id prefix. Defaults to generator-derived id.
  --scenario-id <id>     Profile scenario id override; kept out of market events.
  --steps <number>       Deterministic profile step override.
  --start-ts <ms>        Deterministic profile start timestamp override.
`;

export const runSyntheticMarketCli = async (
  rawArgs = process.argv.slice(2)
): Promise<SyntheticFixtureCliResult> => {
  try {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      return {
        exit_code: 0,
        stdout: USAGE,
        stderr: ""
      };
    }

    const options = parseCliOptions(rawArgs);
    const profile = await readProfile(options);
    const seedBundle = await readSeedBundle(options);
    const written = await writeSyntheticFixture({
      seed_bundle: seedBundle,
      profile,
      run_id: options.run_id,
      run_name: options.run_name,
      output_dir: options.output_dir,
      profile_source_path: path.relative(process.cwd(), path.resolve(options.profile_path))
    });

    return {
      exit_code: 0,
      stdout: [
        `wrote synthetic fixture: ${written.paths.manifest}`,
        `run_id: ${written.manifest.run.run_id}`,
        `events: ${written.manifest.run.event_count}`,
        `parameter_snapshot_hash: ${written.manifest.parameter_snapshot_hash}`
      ].join("\n"),
      stderr: ""
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exit_code: 1,
      stdout: "",
      stderr: `${message}\n\n${USAGE}`
    };
  }
};

const parseCliOptions = (rawArgs: string[]): CliOptions => {
  const args = rawArgs[0] === "generate" ? rawArgs.slice(1) : rawArgs;
  const options: Partial<CliOptions> = {
    command: "generate"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case "--profile":
        options.profile_path = requireFlagValue(args, (index += 1), arg);
        break;
      case "--seed-bundle":
        options.seed_bundle_path = requireFlagValue(args, (index += 1), arg);
        break;
      case "--seed":
        options.seed = parseIntegerFlag(requireFlagValue(args, (index += 1), arg), arg);
        break;
      case "--seed-namespace":
        options.seed_namespace = requireFlagValue(args, (index += 1), arg);
        break;
      case "--seed-partition":
        options.seed_partition = requireFlagValue(args, (index += 1), arg);
        break;
      case "--run-id":
        options.run_id = requireFlagValue(args, (index += 1), arg);
        break;
      case "--run-name":
        options.run_name = requireFlagValue(args, (index += 1), arg);
        break;
      case "--scenario-id":
        options.scenario_id = requireFlagValue(args, (index += 1), arg);
        break;
      case "--output-dir":
        options.output_dir = requireFlagValue(args, (index += 1), arg);
        break;
      case "--steps":
        options.steps = parseIntegerFlag(requireFlagValue(args, (index += 1), arg), arg);
        break;
      case "--start-ts":
        options.start_ts = parseIntegerFlag(requireFlagValue(args, (index += 1), arg), arg);
        break;
      default:
        throw new Error(`Unknown synthetic fixture CLI argument: ${arg}`);
    }
  }

  if (!options.profile_path) {
    throw new Error("Synthetic fixture CLI requires --profile.");
  }
  if (!options.output_dir) {
    throw new Error("Synthetic fixture CLI requires --output-dir.");
  }
  if (!options.run_name?.trim()) {
    throw new Error("Synthetic fixture CLI requires --run-name.");
  }
  if (!options.seed_bundle_path && options.seed === undefined) {
    throw new Error("Synthetic fixture CLI requires --seed-bundle or --seed.");
  }

  return options as CliOptions;
};

const readProfile = async (options: CliOptions): Promise<SyntheticMarketProfile> => {
  const profile = (await readJson(options.profile_path)) as SyntheticMarketProfile;
  return {
    ...profile,
    scenario_id: options.scenario_id ?? profile.scenario_id,
    steps: options.steps ?? profile.steps,
    start_ts: options.start_ts ?? profile.start_ts
  };
};

const readSeedBundle = async (options: CliOptions): Promise<SeedBundle> => {
  const seedBundle = options.seed_bundle_path
    ? ((await readJson(options.seed_bundle_path)) as SeedBundle)
    : ({} as SeedBundle);
  const seed = options.seed ?? seedBundle.seed;

  if (!Number.isInteger(seed)) {
    throw new Error("Synthetic fixture CLI seed bundle must include an integer seed.");
  }

  return {
    ...seedBundle,
    seed,
    namespace: options.seed_namespace ?? seedBundle.namespace,
    partition: options.seed_partition ?? seedBundle.partition
  };
};

const readJson = async (filePath: string): Promise<unknown> => {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
};

const requireFlagValue = (args: string[], index: number, flag: string): string => {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Synthetic fixture CLI flag ${flag} requires a value.`);
  }
  return value;
};

const parseIntegerFlag = (value: string, flag: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Synthetic fixture CLI flag ${flag} must be an integer.`);
  }
  return parsed;
};

if (import.meta.main) {
  const result = await runSyntheticMarketCli();
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
  process.exit(result.exit_code);
}
