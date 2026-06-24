#!/usr/bin/env bun

import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

type DeployMode = "main" | "current-branch" | "branch";
type DeployRuntime = "docker" | "native";
type DeployScope = "full" | "web" | "api" | "services" | "workers";
type DeployPiece =
  | "web"
  | "api"
  | "compute"
  | "candles"
  | "ingest-options"
  | "ingest-equities"
  | "ingest-news";

type DeployOptions = {
  mode: DeployMode;
  branch: string | null;
  runtime: DeployRuntime;
  pieces: DeployPiece[];
  fast: boolean;
  forceRecreate: boolean;
  noBuild: boolean;
};

type PhaseTiming = {
  name: string;
  durationMs: number;
};

const REMOTE_HOST = "delta@152.53.80.229";
const REMOTE_REPO = "/home/delta/islandflow";
const REMOTE_DOCKER_DEPLOYMENT = "/home/delta/islandflow/deployment/docker";
const SSH_KEY =
  process.env.DEPLOY_SSH_KEY_PATH?.trim() ||
  path.join(process.env.HOME ?? "", ".ssh", "delta_ed25519");
const DEPLOY_FORCE_SSH = process.env.DEPLOY_FORCE_SSH?.trim() === "1";
const SSH_OPTIONS = ["-i", SSH_KEY, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"];
const ALLOWED_REMOTE_UNTRACKED = new Set([
  "deployment/docker/signal-cli-0.14.3-Linux-native.tar.gz"
]);
const PUBLIC_APP_URL = process.env.DEPLOY_PUBLIC_APP_URL?.trim() || "https://flow.deltaisland.io";
const PUBLIC_API_HEALTH_URL = process.env.DEPLOY_PUBLIC_API_HEALTH_URL?.trim() || null;
const DEPLOY_GIT_REMOTE_OVERRIDE = process.env.DEPLOY_GIT_REMOTE?.trim() || null;
const DEPLOY_NATIVE_EDGE_READY = process.env.DEPLOY_NATIVE_EDGE_READY?.trim() === "1";
const NATIVE_SYSTEMCTL_PREFIX =
  process.env.DEPLOY_NATIVE_SYSTEMCTL_PREFIX?.trim() || "sudo -n systemctl";
const NATIVE_UNITS = {
  web: process.env.DEPLOY_NATIVE_WEB_UNIT?.trim() || "islandflow-web",
  api: process.env.DEPLOY_NATIVE_API_UNIT?.trim() || "islandflow-api",
  compute: process.env.DEPLOY_NATIVE_COMPUTE_UNIT?.trim() || "islandflow-compute",
  candles: process.env.DEPLOY_NATIVE_CANDLES_UNIT?.trim() || "islandflow-candles",
  ingestOptions:
    process.env.DEPLOY_NATIVE_INGEST_OPTIONS_UNIT?.trim() || "islandflow-ingest-options",
  ingestEquities:
    process.env.DEPLOY_NATIVE_INGEST_EQUITIES_UNIT?.trim() || "islandflow-ingest-equities",
  ingestNews: process.env.DEPLOY_NATIVE_INGEST_NEWS_UNIT?.trim() || "islandflow-ingest-news"
} as const;
const DOCKER_CORE_SERVICES = [
  "api",
  "web",
  "compute",
  "candles",
  "ingest-options",
  "ingest-equities",
  "ingest-news"
] as const;
const DOCKER_BACKEND_SERVICES = [
  "api",
  "compute",
  "candles",
  "ingest-options",
  "ingest-equities",
  "ingest-news"
] as const;
const DOCKER_WORKER_SERVICES = [
  "compute",
  "candles",
  "ingest-options",
  "ingest-equities",
  "ingest-news"
] as const;
const ALL_DEPLOY_PIECES = [...DOCKER_CORE_SERVICES] satisfies DeployPiece[];
const BACKEND_DEPLOY_PIECES = [...DOCKER_BACKEND_SERVICES] satisfies DeployPiece[];
const WORKER_DEPLOY_PIECES = [...DOCKER_WORKER_SERVICES] satisfies DeployPiece[];
const DEPLOY_PIECE_LABELS = {
  web: "web",
  api: "api",
  compute: "compute",
  candles: "candles",
  "ingest-options": "ingest-options",
  "ingest-equities": "ingest-equities",
  "ingest-news": "ingest-news"
} satisfies Record<DeployPiece, string>;

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const isLocalServerExecution = !DEPLOY_FORCE_SSH && repoRoot === REMOTE_REPO;

function usage(exitCode = 1): never {
  console.error(`Usage:
  ./deploy
  ./deploy main [--runtime docker|native] [--web-only|--api-only|--services-only|--workers-only] [--fast] [--no-build] [--force-recreate]
  ./deploy current-branch [--runtime docker|native] [--web-only|--api-only|--services-only|--workers-only] [--fast] [--no-build] [--force-recreate]
  ./deploy current branch [--runtime docker|native] [--web-only|--api-only|--services-only|--workers-only] [--fast] [--no-build] [--force-recreate]
  ./deploy branch <name> [--runtime docker|native] [--pieces api,web,compute] [--fast] [--no-build] [--force-recreate]

Modes:
  no args         Open an interactive deploy prompt.
  main            Deploy <remote>/main to the live server checkout.
  current-branch  Push the current local branch, switch the server to it, and deploy it.
  branch <name>   Deploy another local or remote branch by name.

Runtimes:
  docker          Roll out from deployment/docker with Docker Compose (default, recommended).
  native          Experimental host-native Bun services managed by systemd.

Scopes:
  default              Full rollout (web + API + backend services).
  --pieces <list>      Comma-separated pieces: web, api, compute, candles, ingest-options, ingest-equities, ingest-news.
  --piece <name>       Add one deploy piece. May be repeated.
  --web-only           Deploy only the Next.js web surface.
  --api-only           Deploy only the API service.
  --services-only      Deploy API + backend services without the web service.
  --workers-only       Deploy compute/candles/ingest workers without touching web or API.

Options:
  --runtime <name>     Explicit runtime selector (docker or native).
  --fast               Prefer a quicker rollout profile (defaults all pieces to services for docker and workers for native, and skips the public API route suite when API scope is included).
  --no-build           Skip docker image builds or native bun install/web build steps.
  --force-recreate     Docker-only escalation path for docker compose when a normal refresh is not enough.
  --help               Show this help text.

Environment:
  DEPLOY_GIT_REMOTE                Override git remote used for deploy fetch/pull/push (auto-detected by default).
  DEPLOY_SSH_KEY_PATH              Override the SSH key used for remote execution.
  DEPLOY_FORCE_SSH                 Set to 1 to force SSH even when running from the live server checkout.
  DEPLOY_PUBLIC_APP_URL             Override the public app URL (default: https://flow.deltaisland.io).
  DEPLOY_PUBLIC_API_HEALTH_URL      Optional separate public API health URL for two-origin deployments.
  DEPLOY_NATIVE_EDGE_READY          Set to 1 to allow native rollouts that include the public web or API edge.
  DEPLOY_NATIVE_SYSTEMCTL_PREFIX    Override systemctl invocation for native rollouts (default: sudo -n systemctl).
  DEPLOY_NATIVE_WEB_UNIT            Override native web systemd unit name.
  DEPLOY_NATIVE_API_UNIT            Override native api systemd unit name.
  DEPLOY_NATIVE_COMPUTE_UNIT        Override native compute systemd unit name.
  DEPLOY_NATIVE_CANDLES_UNIT        Override native candles systemd unit name.
  DEPLOY_NATIVE_INGEST_OPTIONS_UNIT Override native ingest-options systemd unit name.
  DEPLOY_NATIVE_INGEST_EQUITIES_UNIT Override native ingest-equities systemd unit name.
  DEPLOY_NATIVE_INGEST_NEWS_UNIT Override native ingest-news systemd unit name.`);
  process.exit(exitCode);
}

function section(title: string): void {
  console.log(`\n== ${title} ==`);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
}

function timedPhase<T>(timings: PhaseTiming[], name: string, fn: () => T): T {
  const startedAt = Date.now();
  try {
    return fn();
  } finally {
    timings.push({ name, durationMs: Date.now() - startedAt });
  }
}

function printTimingSummary(timings: PhaseTiming[]): void {
  section("Deploy Timings");
  const totalMs = timings.reduce((sum, timing) => sum + timing.durationMs, 0);
  for (const timing of timings) {
    console.log(`[deploy] ${timing.name}: ${formatDuration(timing.durationMs)}`);
  }
  console.log(`[deploy] total: ${formatDuration(totalMs)}`);
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function runChecked(command: string, args: string[], options: SpawnSyncOptions = {}): void {
  console.log(`$ ${formatCommand(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function captureChecked(command: string, args: string[], options: SpawnSyncOptions = {}): string {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...options
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }

  return result.stdout ?? "";
}

function tryCapture(
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
): string | null {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...options
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout ?? "";
}

function runRemoteScript(title: string, script: string, args: string[] = []): void {
  section(title);

  if (isLocalServerExecution) {
    const localArgs = ["-s", "--", ...args];
    console.log(`$ ${formatCommand("bash", localArgs)}    # local server execution`);
    const result = spawnSync("bash", localArgs, {
      cwd: repoRoot,
      input: script,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"]
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
    return;
  }

  const sshArgs = [...SSH_OPTIONS, REMOTE_HOST, "bash", "-s", "--", ...args];
  console.log(`$ ${formatCommand("ssh", sshArgs)}`);
  const result = spawnSync("ssh", sshArgs, {
    cwd: repoRoot,
    input: script,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"]
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseRuntime(rawArgs: string[]): DeployRuntime {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--runtime") {
      const value = rawArgs[index + 1];
      if (value === "docker" || value === "native") {
        return value;
      }
      usage();
    }

    if (arg.startsWith("--runtime=")) {
      const value = arg.slice("--runtime=".length);
      if (value === "docker" || value === "native") {
        return value;
      }
      usage();
    }
  }

  return "docker";
}

function piecesForScope(scope: DeployScope): DeployPiece[] {
  switch (scope) {
    case "web":
      return ["web"];
    case "api":
      return ["api"];
    case "services":
      return [...BACKEND_DEPLOY_PIECES];
    case "workers":
      return [...WORKER_DEPLOY_PIECES];
    default:
      return [...ALL_DEPLOY_PIECES];
  }
}

function isDeployPiece(value: string): value is DeployPiece {
  return Object.hasOwn(DEPLOY_PIECE_LABELS, value);
}

function parsePieceList(rawValue: string): DeployPiece[] {
  const pieces = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (pieces.length === 0) {
    console.error("--pieces requires at least one deploy piece.");
    process.exit(1);
  }

  const invalid = pieces.filter((value) => !isDeployPiece(value));
  if (invalid.length > 0) {
    console.error(`Unknown deploy piece${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}`);
    console.error(`Allowed pieces: ${ALL_DEPLOY_PIECES.join(", ")}`);
    process.exit(1);
  }

  return Array.from(new Set(pieces)) as DeployPiece[];
}

function parsePieces(rawArgs: string[]): DeployPiece[] {
  const scopes = [
    rawArgs.includes("--web-only") ? "web" : null,
    rawArgs.includes("--api-only") ? "api" : null,
    rawArgs.includes("--services-only") ? "services" : null,
    rawArgs.includes("--workers-only") ? "workers" : null
  ].filter((value): value is Exclude<DeployScope, "full"> => value !== null);

  if (scopes.length > 1) {
    console.error(
      "Choose only one deploy scope flag: --web-only, --api-only, --services-only, or --workers-only."
    );
    process.exit(1);
  }

  const explicitPieces: DeployPiece[] = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--pieces") {
      explicitPieces.push(...parsePieceList(rawArgs[index + 1] ?? ""));
      continue;
    }

    if (arg.startsWith("--pieces=")) {
      explicitPieces.push(...parsePieceList(arg.slice("--pieces=".length)));
      continue;
    }

    if (arg === "--piece") {
      explicitPieces.push(...parsePieceList(rawArgs[index + 1] ?? ""));
    }
  }

  if (scopes.length > 0 && explicitPieces.length > 0) {
    console.error("Use either a legacy scope flag or --pieces/--piece, not both.");
    process.exit(1);
  }

  if (explicitPieces.length > 0) {
    return Array.from(new Set(explicitPieces));
  }

  return piecesForScope(scopes[0] ?? "full");
}

function parseArgs(rawArgs: string[]): DeployOptions {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    usage(0);
  }

  const runtime = parseRuntime(rawArgs);
  const pieces = parsePieces(rawArgs);
  const fast = rawArgs.includes("--fast");
  const forceRecreate = rawArgs.includes("--force-recreate");
  const noBuild = rawArgs.includes("--no-build");
  const positional = rawArgs.filter(
    (arg, index) =>
      arg !== "--force-recreate" &&
      arg !== "--fast" &&
      arg !== "--no-build" &&
      arg !== "--web-only" &&
      arg !== "--api-only" &&
      arg !== "--services-only" &&
      arg !== "--workers-only" &&
      arg !== "--runtime" &&
      rawArgs[index - 1] !== "--runtime" &&
      !arg.startsWith("--runtime=") &&
      arg !== "--pieces" &&
      rawArgs[index - 1] !== "--pieces" &&
      !arg.startsWith("--pieces=") &&
      arg !== "--piece" &&
      rawArgs[index - 1] !== "--piece"
  );

  if (forceRecreate && runtime !== "docker") {
    console.error("--force-recreate is only supported with --runtime docker.");
    process.exit(1);
  }

  if (positional.length === 1 && positional[0] === "main") {
    return { mode: "main", branch: null, runtime, pieces, fast, forceRecreate, noBuild };
  }

  if (
    (positional.length === 1 && positional[0] === "current-branch") ||
    (positional.length === 2 && positional[0] === "current" && positional[1] === "branch")
  ) {
    return {
      mode: "current-branch",
      branch: null,
      runtime,
      pieces,
      fast,
      forceRecreate,
      noBuild
    };
  }

  if (positional.length === 2 && positional[0] === "branch" && positional[1]) {
    return {
      mode: "branch",
      branch: positional[1],
      runtime,
      pieces,
      fast,
      forceRecreate,
      noBuild
    };
  }

  usage();
}

async function promptLine(
  rl: readline.Interface,
  question: string,
  defaultValue: string | null = null
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

async function promptChoice<T extends string>(
  rl: readline.Interface,
  question: string,
  choices: { value: T; label: string; disabled?: boolean }[],
  defaultValue: T
): Promise<T> {
  console.log(`\n${question}`);
  choices.forEach((choice, index) => {
    const marker = choice.value === defaultValue ? " (default)" : "";
    const disabled = choice.disabled ? " (unavailable)" : "";
    console.log(`  ${index + 1}. ${choice.label}${marker}${disabled}`);
  });

  while (true) {
    const answer = await promptLine(
      rl,
      "Choose",
      String(choices.findIndex((choice) => choice.value === defaultValue) + 1)
    );
    const selectedIndex = Number(answer) - 1;
    const selected = choices[selectedIndex];
    if (selected && !selected.disabled) {
      return selected.value;
    }

    const byValue = choices.find((choice) => choice.value === answer && !choice.disabled);
    if (byValue) {
      return byValue.value;
    }

    console.log("Please choose one of the available options.");
  }
}

async function promptBoolean(
  rl: readline.Interface,
  question: string,
  defaultValue: boolean
): Promise<boolean> {
  const answer = (
    await promptLine(rl, `${question} (${defaultValue ? "Y/n" : "y/N"})`)
  ).toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  return answer === "y" || answer === "yes";
}

function optionalCurrentBranchName(): string | null {
  const branch = tryCapture("git", ["branch", "--show-current"])?.trim();
  return branch || null;
}

function parseInteractivePieces(answer: string): DeployPiece[] | null {
  const normalized = answer.trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return [...ALL_DEPLOY_PIECES];
  }

  if (normalized === "services") {
    return [...BACKEND_DEPLOY_PIECES];
  }

  if (normalized === "workers") {
    return [...WORKER_DEPLOY_PIECES];
  }

  return parsePieceList(normalized);
}

async function promptDeployOptions(): Promise<DeployOptions> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    usage();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log("Islandflow deploy");
    const runtime = await promptChoice<DeployRuntime>(
      rl,
      "Runtime",
      [
        { value: "docker", label: "Docker Compose" },
        { value: "native", label: "Native systemd/Bun" }
      ],
      "docker"
    );

    const currentBranch = optionalCurrentBranchName();
    const mode = await promptChoice<DeployMode>(
      rl,
      "Git target",
      [
        { value: "main", label: "main" },
        {
          value: "current-branch",
          label: currentBranch ? `current branch (${currentBranch})` : "current branch",
          disabled: currentBranch === null
        },
        { value: "branch", label: "another branch" }
      ],
      "main"
    );

    const branch =
      mode === "branch"
        ? await promptLine(rl, "Branch name")
        : mode === "current-branch"
          ? currentBranch
          : null;

    if (mode !== "main" && !branch) {
      console.error("A branch name is required for this deploy target.");
      process.exit(1);
    }

    console.log("\nPieces");
    console.log("  Default: all");
    console.log(
      `  Groups: services (${BACKEND_DEPLOY_PIECES.join(", ")}), workers (${WORKER_DEPLOY_PIECES.join(", ")})`
    );
    console.log(`  Individual pieces: ${ALL_DEPLOY_PIECES.join(", ")}`);
    const piecesAnswer = await promptLine(rl, "Deploy pieces", "all");
    const pieces = parseInteractivePieces(piecesAnswer) ?? [...ALL_DEPLOY_PIECES];

    const fast = await promptBoolean(rl, "Fast mode", false);
    const noBuild = await promptBoolean(rl, "Skip builds/install steps", false);
    const forceRecreate =
      runtime === "docker"
        ? await promptBoolean(rl, "Force recreate Docker containers", false)
        : false;

    console.log(
      `\nReady to deploy ${
        mode === "main" ? "main" : mode === "current-branch" ? `current branch ${branch}` : branch
      } via ${describeRuntime(runtime)} (${describePieces(effectivePieces(pieces, runtime, fast))}).`
    );

    if (!(await promptBoolean(rl, "Continue", false))) {
      console.log("Deploy cancelled.");
      process.exit(0);
    }

    return { mode, branch, runtime, pieces, fast, forceRecreate, noBuild };
  } finally {
    rl.close();
  }
}

async function resolveOptions(rawArgs: string[]): Promise<DeployOptions> {
  if (rawArgs.length === 0) {
    return promptDeployOptions();
  }
  return parseArgs(rawArgs);
}

function assertSshKeyExists(): void {
  if (isLocalServerExecution) {
    return;
  }

  if (!existsSync(SSH_KEY)) {
    console.error(`Missing SSH key: ${SSH_KEY}`);
    console.error(
      "Set DEPLOY_SSH_KEY_PATH or run from the live server checkout without DEPLOY_FORCE_SSH."
    );
    process.exit(1);
  }
}

function shellEscape(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellPattern(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseUpstreamRemote(upstreamRef: string | null): string | null {
  if (!upstreamRef) {
    return null;
  }
  const trimmed = upstreamRef.trim();
  if (!trimmed || !trimmed.includes("/")) {
    return null;
  }
  return trimmed.split("/", 1)[0] ?? null;
}

function localGitRemotes(): string[] {
  const raw = tryCapture("git", ["remote"]);
  if (!raw) {
    return [];
  }
  return raw
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function localHasRemote(name: string): boolean {
  return (
    spawnSync("git", ["remote", "get-url", name], {
      cwd: repoRoot,
      stdio: "ignore"
    }).status === 0
  );
}

function resolveDeployRemote(mode: DeployMode, branch: string | null): string {
  const candidates: string[] = [];

  if (DEPLOY_GIT_REMOTE_OVERRIDE) {
    candidates.push(DEPLOY_GIT_REMOTE_OVERRIDE);
  }

  if ((mode === "current-branch" || mode === "branch") && branch) {
    const branchRemote = tryCapture("git", ["config", "--get", `branch.${branch}.remote`])?.trim();
    if (branchRemote) {
      candidates.push(branchRemote);
    }

    const upstreamRef = tryCapture("git", [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}"
    ]);
    const upstreamRemote = parseUpstreamRemote(upstreamRef);
    if (upstreamRemote) {
      candidates.push(upstreamRemote);
    }
  }

  const mainRemote = tryCapture("git", ["config", "--get", "branch.main.remote"])?.trim();
  if (mainRemote) {
    candidates.push(mainRemote);
  }

  candidates.push("forgejo", "origin", "github", ...localGitRemotes());

  const deduped = Array.from(new Set(candidates.filter((value) => value.length > 0)));
  const selected = deduped.find((name) => localHasRemote(name));

  if (selected) {
    return selected;
  }

  console.error(`Unable to resolve a deploy git remote. Checked candidates: ${deduped.join(", ")}`);
  console.error("Set DEPLOY_GIT_REMOTE to a valid remote name or configure branch.<name>.remote.");
  process.exit(1);
}

function describeRuntime(runtime: DeployRuntime): string {
  return runtime === "docker" ? "Docker Compose" : "experimental native systemd/Bun";
}

function printRuntimeAdvisory(runtime: DeployRuntime): void {
  if (runtime !== "native") {
    return;
  }

  console.warn(
    "[deploy] Native runtime is experimental. Use --runtime docker for the current supported VPS path unless Bun, systemd units, and proxy routing have been prepared intentionally."
  );
}

function samePieces(left: DeployPiece[], right: DeployPiece[]): boolean {
  return left.length === right.length && left.every((piece) => right.includes(piece));
}

function describePieces(pieces: DeployPiece[]): string {
  if (samePieces(pieces, ALL_DEPLOY_PIECES)) {
    return "all app pieces";
  }
  if (samePieces(pieces, BACKEND_DEPLOY_PIECES)) {
    return "api + backend services";
  }
  if (samePieces(pieces, WORKER_DEPLOY_PIECES)) {
    return "worker services only";
  }
  if (pieces.length === 1) {
    return `${DEPLOY_PIECE_LABELS[pieces[0]]} only`;
  }
  return pieces.map((piece) => DEPLOY_PIECE_LABELS[piece]).join(", ");
}

function effectivePieces(
  pieces: DeployPiece[],
  runtime: DeployRuntime,
  fast: boolean
): DeployPiece[] {
  if (fast && samePieces(pieces, ALL_DEPLOY_PIECES)) {
    return runtime === "native" ? [...WORKER_DEPLOY_PIECES] : [...BACKEND_DEPLOY_PIECES];
  }
  return pieces;
}

function piecesIncludeWeb(pieces: DeployPiece[]): boolean {
  return pieces.includes("web");
}

function piecesIncludeApi(pieces: DeployPiece[]): boolean {
  return pieces.includes("api");
}

function piecesIncludeWorkers(pieces: DeployPiece[]): boolean {
  return pieces.some((piece) => WORKER_DEPLOY_PIECES.includes(piece));
}

function piecesTouchPublicEdge(pieces: DeployPiece[]): boolean {
  return piecesIncludeWeb(pieces) || piecesIncludeApi(pieces);
}

function dockerServicesForPieces(pieces: DeployPiece[]): string[] {
  return samePieces(pieces, ALL_DEPLOY_PIECES) ? [] : [...pieces];
}

function dockerBuildServicesForPieces(pieces: DeployPiece[]): string[] {
  return [...pieces];
}

function dockerLogServicesForPieces(pieces: DeployPiece[]): string[] {
  return [...pieces];
}

function nativeUnitForPiece(piece: DeployPiece): string {
  switch (piece) {
    case "web":
      return NATIVE_UNITS.web;
    case "api":
      return NATIVE_UNITS.api;
    case "compute":
      return NATIVE_UNITS.compute;
    case "candles":
      return NATIVE_UNITS.candles;
    case "ingest-options":
      return NATIVE_UNITS.ingestOptions;
    case "ingest-equities":
      return NATIVE_UNITS.ingestEquities;
    case "ingest-news":
      return NATIVE_UNITS.ingestNews;
  }
}

function nativeUnitsForPieces(pieces: DeployPiece[]): string[] {
  return pieces.map((piece) => nativeUnitForPiece(piece));
}

function localDockerWorkspaceSnapshotPrecheck(): void {
  console.log("$ bun run check:docker-workspace");
  const result = spawnSync("bun", ["run", "check:docker-workspace"], {
    cwd: repoRoot,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    console.error(
      "Refusing docker deploy: deployment/docker/workspace-root is out of sync. Run `bun run sync:docker-workspace`, commit updated snapshot files, then retry deploy."
    );
    process.exit(result.status ?? 1);
  }
}

function assertNativeEdgeReady(pieces: DeployPiece[]): void {
  if (!piecesTouchPublicEdge(pieces) || DEPLOY_NATIVE_EDGE_READY) {
    return;
  }

  console.error(
    "Refusing native deploy that touches public web/API scope before edge cutover is acknowledged."
  );
  console.error(
    "Set DEPLOY_NATIVE_EDGE_READY=1 only after proxy routing and native units for the public edge are intentionally prepared."
  );
  console.error(
    "For fast iterative backend deploys before cutover, use --runtime native --workers-only or --runtime native --fast."
  );
  process.exit(1);
}

function localRuntimePrecheck(
  runtime: DeployRuntime,
  pieces: DeployPiece[],
  noBuild: boolean
): void {
  if (runtime === "docker" && !noBuild) {
    localDockerWorkspaceSnapshotPrecheck();
    return;
  }

  if (runtime === "native") {
    assertNativeEdgeReady(pieces);
  }
}

function localMainPrecheck(
  remote: string,
  runtime: DeployRuntime,
  pieces: DeployPiece[],
  noBuild: boolean
): void {
  section("Local Precheck");
  runChecked("git", ["fetch", remote]);
  runChecked("git", ["status", "--short", "--branch"]);
  runChecked("git", ["rev-parse", "--verify", "HEAD"]);
  runChecked("git", ["rev-parse", `${remote}/main`]);
  localRuntimePrecheck(runtime, pieces, noBuild);
}

function currentBranchName(): string {
  const branch = captureChecked("git", ["branch", "--show-current"]).trim();
  if (!branch) {
    console.error("Refusing branch deployment from a detached HEAD.");
    process.exit(1);
  }
  return branch;
}

function localBranchPrecheck(
  remote: string,
  branch: string,
  runtime: DeployRuntime,
  pieces: DeployPiece[],
  noBuild: boolean
): void {
  section("Local Precheck");
  runChecked("git", ["branch", "--show-current"]);
  runChecked("git", ["status", "--short", "--branch"]);
  runChecked("git", ["fetch", remote]);

  const porcelain = captureChecked("git", ["status", "--porcelain=v1"]).trim();
  if (porcelain) {
    console.error(
      `Refusing to deploy ${branch} with uncommitted local changes. Commit the intended state first.`
    );
    process.exit(1);
  }

  localRuntimePrecheck(runtime, pieces, noBuild);
}

function localNamedBranchPrecheck(
  remote: string,
  branch: string,
  runtime: DeployRuntime,
  pieces: DeployPiece[],
  noBuild: boolean
): void {
  section("Local Precheck");
  runChecked("git", ["status", "--short", "--branch"]);
  runChecked("git", ["fetch", remote]);

  const localBranchExists =
    spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: repoRoot,
      stdio: "ignore"
    }).status === 0;
  const remoteBranchExists =
    spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`], {
      cwd: repoRoot,
      stdio: "ignore"
    }).status === 0;

  if (!localBranchExists && !remoteBranchExists) {
    console.error(`Refusing to deploy unknown branch ${branch}.`);
    console.error(`Expected local branch ${branch} or remote branch ${remote}/${branch}.`);
    process.exit(1);
  }

  localRuntimePrecheck(runtime, pieces, noBuild);
}

function publishCurrentBranch(remote: string, branch: string): void {
  section("Local Publish");
  const upstreamResult = spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"]
    }
  );

  if (upstreamResult.status === 0) {
    runChecked("git", ["push", remote, branch]);
    return;
  }

  runChecked("git", ["push", "-u", remote, branch]);
}

function publishNamedBranch(remote: string, branch: string): void {
  const localBranchExists =
    spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: repoRoot,
      stdio: "ignore"
    }).status === 0;

  if (!localBranchExists) {
    console.log(
      `[deploy] No local branch named ${branch}; using ${remote}/${branch} already fetched from remote.`
    );
    return;
  }

  section("Local Publish");
  runChecked("git", ["push", remote, `${branch}:${branch}`]);
}

function remoteGitPrecheck(): void {
  const allowedRemoteUntrackedPattern = Array.from(ALLOWED_REMOTE_UNTRACKED)
    .map((value) => shellPattern(value))
    .join("|");

  runRemoteScript(
    "Remote Precheck",
    `#!/usr/bin/env bash
set -euo pipefail

cd ${shellEscape(REMOTE_REPO)}
status="$(git status --porcelain=v1 --branch)"
git status --short --branch
git branch --show-current

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  case "$line" in
    '## '*)
      ;;
    '?? '*)
      path="\${line#?? }"
      case "$path" in
        ${allowedRemoteUntrackedPattern})
          ;;
        *)
          echo "Refusing rollout: unexpected untracked path on server: $path" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      echo "Refusing rollout: tracked local modifications on server: $line" >&2
      exit 1
      ;;
  esac
done <<< "$status"
`
  );
}

function remoteRuntimePrecheck(runtime: DeployRuntime, pieces: DeployPiece[]): void {
  if (runtime === "docker") {
    runRemoteScript(
      "Remote Runtime Precheck",
      `#!/usr/bin/env bash
set -euo pipefail

cd ${shellEscape(REMOTE_DOCKER_DEPLOYMENT)}
command -v docker >/dev/null 2>&1

docker compose version >/dev/null

if docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}}' | grep -q '^islandflow-.* islandflow$'; then
  echo '[deploy] Warning: found an additional compose project named "islandflow" on the server.' >&2
  echo '[deploy] The live VPS should normally use only the deployment/docker stack (compose project "islandflow-vps").' >&2
  echo '[deploy] The repo-root docker-compose.yml is for local infra and can create duplicate exposed NATS, ClickHouse, and Redis services on the VPS.' >&2
fi
`
    );
    return;
  }

  const units = nativeUnitsForPieces(pieces)
    .map((value) => shellEscape(value))
    .join(" ");
  runRemoteScript(
    "Remote Runtime Precheck",
    `#!/usr/bin/env bash
set -euo pipefail

cd ${shellEscape(REMOTE_REPO)}

if [[ -x "$HOME/.bun/bin/bun" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Refusing native rollout: bun is not installed on the server." >&2
  echo "The current supported VPS path remains --runtime docker." >&2
  echo "See deployment/native/README.md for native prerequisites." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "Refusing native rollout: systemctl is not available on the server." >&2
  echo "See deployment/native/README.md for native prerequisites." >&2
  exit 1
fi

if ! ${NATIVE_SYSTEMCTL_PREFIX} --version >/dev/null 2>&1; then
  echo "Refusing native rollout: cannot run ${NATIVE_SYSTEMCTL_PREFIX}." >&2
  echo "If the server uses user units, try DEPLOY_NATIVE_SYSTEMCTL_PREFIX='systemctl --user'." >&2
  echo "If the server uses system units, ensure passwordless sudo for this command or use --runtime docker." >&2
  exit 1
fi

declare -a units=(${units})
for unit in "\${units[@]}"; do
  load_state="$(${NATIVE_SYSTEMCTL_PREFIX} show --property=LoadState --value "$unit" 2>/dev/null || true)"
  if [[ -z "$load_state" || "$load_state" == "not-found" ]]; then
    echo "Refusing native rollout: missing systemd unit $unit" >&2
    echo "See deployment/native/README.md for expected unit names and overrides." >&2
    echo "Use --runtime docker for the current supported VPS path." >&2
    exit 1
  fi
done
`
  );
}

function remoteGitUpdateScript(mode: DeployMode, remote: string, branch: string | null): string {
  const escapedBranch = branch ? shellEscape(branch) : null;
  const escapedRemote = shellEscape(remote);
  const switchCommand =
    mode === "main"
      ? `git switch main\ngit pull --ff-only ${escapedRemote} main`
      : `git switch ${escapedBranch} || git switch -c ${escapedBranch} --track ${escapedRemote}/${escapedBranch}\ngit pull --ff-only ${escapedRemote} ${escapedBranch}`;

  return `cd ${shellEscape(REMOTE_REPO)}\ngit remote get-url ${escapedRemote} >/dev/null\ngit fetch ${escapedRemote}\n${switchCommand}`;
}

function remoteDockerRollout(
  mode: DeployMode,
  remote: string,
  branch: string | null,
  pieces: DeployPiece[],
  forceRecreate: boolean,
  noBuild: boolean
): void {
  const rolloutServices = dockerServicesForPieces(pieces);
  const upArgs = ["up", "-d"];
  if (forceRecreate) {
    upArgs.push("--force-recreate");
  }
  const buildServices = dockerBuildServicesForPieces(pieces);
  const buildCommand = noBuild ? null : `docker compose build ${buildServices.join(" ")}`;
  const upCommand = `docker compose ${[...upArgs, ...rolloutServices].join(" ")}`;

  runRemoteScript(
    "Remote Rollout",
    `#!/usr/bin/env bash
set -euo pipefail

${remoteGitUpdateScript(mode, remote, branch)}

cd ${shellEscape(REMOTE_DOCKER_DEPLOYMENT)}
${buildCommand ? `${buildCommand}\n` : ""}${upCommand}
`
  );
}

function remoteNativeRollout(
  mode: DeployMode,
  remote: string,
  branch: string | null,
  pieces: DeployPiece[],
  noBuild: boolean
): void {
  const units = nativeUnitsForPieces(pieces)
    .map((value) => shellEscape(value))
    .join(" ");
  const buildSteps: string[] = [];

  if (!noBuild) {
    buildSteps.push("bun install --frozen-lockfile");
    if (piecesIncludeWeb(pieces)) {
      buildSteps.push(
        // Native web builds run from apps/web, but public build-time env lives in the repo root.
        `bun --env-file=${shellEscape(`${REMOTE_REPO}/.env`)} --cwd=apps/web run build`,
        // Next rewrites this generated file for the production distDir. Keep the live checkout clean.
        "git restore --source=HEAD -- apps/web/next-env.d.ts"
      );
    }
  }

  buildSteps.push(
    `${NATIVE_SYSTEMCTL_PREFIX} restart ${nativeUnitsForPieces(pieces)
      .map((value) => shellEscape(value))
      .join(" ")}`
  );

  runRemoteScript(
    "Remote Rollout",
    `#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$HOME/.bun/bin/bun" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi

${remoteGitUpdateScript(mode, remote, branch)}

cd ${shellEscape(REMOTE_REPO)}
${buildSteps.join("\n")}

declare -a units=(${units})
for unit in "\${units[@]}"; do
  ${NATIVE_SYSTEMCTL_PREFIX} is-active --quiet "$unit"
done
`
  );
}

function remoteRollout(
  mode: DeployMode,
  remote: string,
  runtime: DeployRuntime,
  branch: string | null,
  pieces: DeployPiece[],
  forceRecreate: boolean,
  noBuild: boolean
): void {
  if (runtime === "docker") {
    remoteDockerRollout(mode, remote, branch, pieces, forceRecreate, noBuild);
    return;
  }

  remoteNativeRollout(mode, remote, branch, pieces, noBuild);
}

function remoteDockerVerification(pieces: DeployPiece[], fast: boolean): void {
  const psServices = dockerServicesForPieces(pieces);
  const logServices = dockerLogServicesForPieces(pieces);
  const psCommand =
    psServices.length > 0 ? `docker compose ps ${psServices.join(" ")}` : "docker compose ps";
  const logCommand = fast
    ? `echo '[deploy] Fast mode: skipping docker compose logs tail for quicker feedback.'`
    : `docker compose logs --tail=100 ${logServices.join(" ")}`;
  const checks: string[] = [];

  if (piecesIncludeApi(pieces)) {
    checks.push(
      `docker compose exec -T api bun -e 'const r = await fetch("http://127.0.0.1:4000/health"); if (!r.ok) throw new Error("api healthcheck failed: " + r.status); console.log(await r.text())'`
    );
  }

  if (piecesIncludeWeb(pieces)) {
    checks.push(
      `docker compose exec -T web bun -e 'const r = await fetch("http://127.0.0.1:3000/"); if (!r.ok) throw new Error("web healthcheck failed: " + r.status); console.log(r.status)'`
    );
  }

  runRemoteScript(
    "Remote Verification",
    `#!/usr/bin/env bash
set -euo pipefail

cd ${shellEscape(REMOTE_DOCKER_DEPLOYMENT)}
${psCommand}
${logCommand}
${checks.join("\n")}
`
  );
}

function remoteNativeVerification(pieces: DeployPiece[], fast: boolean): void {
  const units = nativeUnitsForPieces(pieces)
    .map((value) => shellEscape(value))
    .join(" ");
  const checks: string[] = [];

  if (piecesIncludeApi(pieces) || piecesIncludeWorkers(pieces)) {
    checks.push("./deployment/native/check-native-infra.sh");
  }

  if (piecesIncludeApi(pieces)) {
    checks.push("curl -fksS http://127.0.0.1:4000/health");
  }

  if (piecesIncludeWeb(pieces)) {
    checks.push("curl -I -fksS http://127.0.0.1:3000/");
  }

  runRemoteScript(
    "Remote Verification",
    `#!/usr/bin/env bash
set -euo pipefail

cd ${shellEscape(REMOTE_REPO)}

if [[ -x "$HOME/.bun/bin/bun" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi

declare -a units=(${units})
for unit in "\${units[@]}"; do
  ${NATIVE_SYSTEMCTL_PREFIX} is-active --quiet "$unit"
  ${fast ? 'echo "[deploy] Fast mode: skipping unit status and recent journal dump for $unit."' : `${NATIVE_SYSTEMCTL_PREFIX} status --no-pager "$unit" || true\n  journalctl -u "$unit" -n 50 --no-pager || true`}
done
${checks.join("\n")}
`
  );
}

function remoteVerification(runtime: DeployRuntime, pieces: DeployPiece[], fast: boolean): void {
  if (runtime === "docker") {
    remoteDockerVerification(pieces, fast);
    return;
  }

  remoteNativeVerification(pieces, fast);
}

function publicVerification(pieces: DeployPiece[], fast: boolean): void {
  section("Public Verification");
  if (piecesIncludeWeb(pieces)) {
    runChecked("curl", ["-I", "-fksS", PUBLIC_APP_URL]);
  } else {
    console.log("[deploy] Skipping public app HEAD check because web scope is not included.");
  }

  if (piecesIncludeApi(pieces) && PUBLIC_API_HEALTH_URL) {
    runChecked("curl", ["-fksS", PUBLIC_API_HEALTH_URL]);
    return;
  }

  if (piecesIncludeApi(pieces)) {
    if (fast) {
      console.log(
        "[deploy] Fast mode: skipping scripts/check-public-api-routes.ts route suite. Set DEPLOY_PUBLIC_API_HEALTH_URL to keep a public API health probe in fast mode."
      );
      return;
    }
    runChecked("bun", ["run", "scripts/check-public-api-routes.ts", PUBLIC_APP_URL]);
  }
}

async function main(): Promise<void> {
  const options = await resolveOptions(process.argv.slice(2));
  const pieces = effectivePieces(options.pieces, options.runtime, options.fast);
  const timings: PhaseTiming[] = [];
  const branch = options.mode === "current-branch" ? currentBranchName() : options.branch;
  const deployRemote = resolveDeployRemote(options.mode, branch);
  assertSshKeyExists();
  printRuntimeAdvisory(options.runtime);

  console.log(
    `Deploying ${
      options.mode === "main"
        ? `${deployRemote}/main`
        : options.mode === "current-branch"
          ? `current local branch ${branch}`
          : `${deployRemote}/${branch}`
    } via ${describeRuntime(options.runtime)} (${describePieces(pieces)}${options.fast ? ", fast mode" : ""}).`
  );
  console.log(`[deploy] Using git remote: ${deployRemote}`);
  console.log(
    `[deploy] Execution mode: ${isLocalServerExecution ? "local server checkout" : `ssh to ${REMOTE_HOST}`}`
  );
  if (options.fast && samePieces(options.pieces, ALL_DEPLOY_PIECES)) {
    console.log(
      `[deploy] Fast mode changed default full scope to ${options.runtime === "native" ? "--workers-only" : "--services-only"}.`
    );
  }

  if (options.mode === "main") {
    timedPhase(timings, "local precheck", () =>
      localMainPrecheck(deployRemote, options.runtime, pieces, options.noBuild)
    );
    timedPhase(timings, "remote git precheck", () => remoteGitPrecheck());
    timedPhase(timings, "remote runtime precheck", () =>
      remoteRuntimePrecheck(options.runtime, pieces)
    );
    timedPhase(timings, "remote rollout", () =>
      remoteRollout(
        options.mode,
        deployRemote,
        options.runtime,
        null,
        pieces,
        options.forceRecreate,
        options.noBuild
      )
    );
  } else if (options.mode === "current-branch") {
    if (!branch) {
      console.error("Unable to resolve current branch for current-branch deploy mode.");
      process.exit(1);
    }
    timedPhase(timings, "local precheck", () =>
      localBranchPrecheck(deployRemote, branch, options.runtime, pieces, options.noBuild)
    );
    timedPhase(timings, "local publish", () => publishCurrentBranch(deployRemote, branch));
    timedPhase(timings, "remote git precheck", () => remoteGitPrecheck());
    timedPhase(timings, "remote runtime precheck", () =>
      remoteRuntimePrecheck(options.runtime, pieces)
    );
    timedPhase(timings, "remote rollout", () =>
      remoteRollout(
        options.mode,
        deployRemote,
        options.runtime,
        branch,
        pieces,
        options.forceRecreate,
        options.noBuild
      )
    );
  } else {
    if (!branch) {
      console.error("Unable to resolve branch for deploy mode.");
      process.exit(1);
    }
    timedPhase(timings, "local precheck", () =>
      localNamedBranchPrecheck(deployRemote, branch, options.runtime, pieces, options.noBuild)
    );
    timedPhase(timings, "local publish", () => publishNamedBranch(deployRemote, branch));
    timedPhase(timings, "remote git precheck", () => remoteGitPrecheck());
    timedPhase(timings, "remote runtime precheck", () =>
      remoteRuntimePrecheck(options.runtime, pieces)
    );
    timedPhase(timings, "remote rollout", () =>
      remoteRollout(
        options.mode,
        deployRemote,
        options.runtime,
        branch,
        pieces,
        options.forceRecreate,
        options.noBuild
      )
    );
  }

  timedPhase(timings, "remote verification", () =>
    remoteVerification(options.runtime, pieces, options.fast)
  );
  timedPhase(timings, "public verification", () => publicVerification(pieces, options.fast));
  printTimingSummary(timings);
}

await main();
