#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DeployMode = "main" | "current-branch";
type DeployRuntime = "docker" | "native";
type DeployScope = "full" | "web" | "api" | "services" | "workers";

type DeployOptions = {
  mode: DeployMode;
  runtime: DeployRuntime;
  scope: DeployScope;
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
const SSH_OPTIONS = [
  "-i",
  SSH_KEY,
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "BatchMode=yes"
];
const ALLOWED_REMOTE_UNTRACKED = new Set([
  "deployment/docker/signal-cli-0.14.3-Linux-native.tar.gz"
]);
const PUBLIC_APP_URL =
  process.env.DEPLOY_PUBLIC_APP_URL?.trim() || "https://flow.deltaisland.io";
const PUBLIC_API_HEALTH_URL =
  process.env.DEPLOY_PUBLIC_API_HEALTH_URL?.trim() || null;
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
    process.env.DEPLOY_NATIVE_INGEST_EQUITIES_UNIT?.trim() || "islandflow-ingest-equities"
} as const;
const DOCKER_CORE_SERVICES = [
  "api",
  "web",
  "compute",
  "candles",
  "ingest-options",
  "ingest-equities"
] as const;
const DOCKER_BACKEND_SERVICES = [
  "api",
  "compute",
  "candles",
  "ingest-options",
  "ingest-equities"
] as const;
const DOCKER_WORKER_SERVICES = [
  "compute",
  "candles",
  "ingest-options",
  "ingest-equities"
] as const;

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const isLocalServerExecution = !DEPLOY_FORCE_SSH && repoRoot === REMOTE_REPO;

function usage(exitCode = 1): never {
  console.error(`Usage:
  ./deploy main [--runtime docker|native] [--web-only|--api-only|--services-only|--workers-only] [--fast] [--no-build] [--force-recreate]
  ./deploy current-branch [--runtime docker|native] [--web-only|--api-only|--services-only|--workers-only] [--fast] [--no-build] [--force-recreate]
  ./deploy current branch [--runtime docker|native] [--web-only|--api-only|--services-only|--workers-only] [--fast] [--no-build] [--force-recreate]

Modes:
  main            Deploy <remote>/main to the live server checkout.
  current-branch  Push the current local branch, switch the server to it, and deploy it.

Runtimes:
  docker          Roll out from deployment/docker with Docker Compose (default, recommended).
  native          Experimental host-native Bun services managed by systemd.

Scopes:
  default         Full rollout (web + API + backend services).
  --web-only      Deploy only the Next.js web surface.
  --api-only      Deploy only the API service.
  --services-only Deploy API + backend services without the web service.
  --workers-only  Deploy compute/candles/ingest workers without touching web or API.

Options:
  --runtime <name>     Explicit runtime selector (docker or native).
  --fast               Prefer a quicker rollout profile (defaults full scope to --services-only for docker and --workers-only for native, and skips the public API route suite when API scope is included).
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
  DEPLOY_NATIVE_INGEST_EQUITIES_UNIT Override native ingest-equities systemd unit name.`);
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

function runChecked(
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
): void {
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

function captureChecked(
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
): string {
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

function runRemoteScript(
  title: string,
  script: string,
  args: string[] = []
): void {
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

function parseScope(rawArgs: string[]): DeployScope {
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

  return scopes[0] ?? "full";
}

function parseArgs(rawArgs: string[]): DeployOptions {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    usage(0);
  }

  const runtime = parseRuntime(rawArgs);
  const scope = parseScope(rawArgs);
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
      !arg.startsWith("--runtime=")
  );

  if (forceRecreate && runtime !== "docker") {
    console.error("--force-recreate is only supported with --runtime docker.");
    process.exit(1);
  }

  if (positional.length === 1 && positional[0] === "main") {
    return { mode: "main", runtime, scope, fast, forceRecreate, noBuild };
  }

  if (
    (positional.length === 1 && positional[0] === "current-branch") ||
    (positional.length === 2 && positional[0] === "current" && positional[1] === "branch")
  ) {
    return {
      mode: "current-branch",
      runtime,
      scope,
      fast,
      forceRecreate,
      noBuild
    };
  }

  usage();
}

function assertSshKeyExists(): void {
  if (isLocalServerExecution) {
    return;
  }

  if (!existsSync(SSH_KEY)) {
    console.error(`Missing SSH key: ${SSH_KEY}`);
    console.error("Set DEPLOY_SSH_KEY_PATH or run from the live server checkout without DEPLOY_FORCE_SSH.");
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
  return spawnSync("git", ["remote", "get-url", name], {
    cwd: repoRoot,
    stdio: "ignore"
  }).status === 0;
}

function resolveDeployRemote(mode: DeployMode, branch: string | null): string {
  const candidates: string[] = [];

  if (DEPLOY_GIT_REMOTE_OVERRIDE) {
    candidates.push(DEPLOY_GIT_REMOTE_OVERRIDE);
  }

  if (mode === "current-branch" && branch) {
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

  console.error(
    `Unable to resolve a deploy git remote. Checked candidates: ${deduped.join(", ")}`
  );
  console.error(
    "Set DEPLOY_GIT_REMOTE to a valid remote name or configure branch.<name>.remote."
  );
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

function describeScope(scope: DeployScope): string {
  switch (scope) {
    case "web":
      return "web only";
    case "api":
      return "api only";
    case "services":
      return "api + backend services";
    case "workers":
      return "worker services only";
    default:
      return "full stack";
  }
}

function effectiveScope(scope: DeployScope, runtime: DeployRuntime, fast: boolean): DeployScope {
  if (fast && scope === "full") {
    return runtime === "native" ? "workers" : "services";
  }
  return scope;
}

function scopeIncludesWeb(scope: DeployScope): boolean {
  return scope === "full" || scope === "web";
}

function scopeIncludesApi(scope: DeployScope): boolean {
  return scope === "full" || scope === "api" || scope === "services";
}

function scopeTouchesPublicEdge(scope: DeployScope): boolean {
  return scopeIncludesWeb(scope) || scopeIncludesApi(scope);
}

function dockerServicesForScope(scope: DeployScope): string[] {
  switch (scope) {
    case "web":
      return ["web"];
    case "api":
      return ["api"];
    case "services":
      return [...DOCKER_BACKEND_SERVICES];
    case "workers":
      return [...DOCKER_WORKER_SERVICES];
    default:
      return [];
  }
}

function dockerBuildServicesForScope(scope: DeployScope): string[] {
  switch (scope) {
    case "full":
      return [...DOCKER_CORE_SERVICES];
    default:
      return dockerServicesForScope(scope);
  }
}

function dockerLogServicesForScope(scope: DeployScope): string[] {
  switch (scope) {
    case "web":
      return ["web"];
    case "api":
      return ["api"];
    case "services":
      return [...DOCKER_BACKEND_SERVICES];
    case "workers":
      return [...DOCKER_WORKER_SERVICES];
    default:
      return [...DOCKER_CORE_SERVICES];
  }
}

function nativeUnitsForScope(scope: DeployScope): string[] {
  switch (scope) {
    case "web":
      return [NATIVE_UNITS.web];
    case "api":
      return [NATIVE_UNITS.api];
    case "services":
      return [
        NATIVE_UNITS.api,
        NATIVE_UNITS.compute,
        NATIVE_UNITS.candles,
        NATIVE_UNITS.ingestOptions,
        NATIVE_UNITS.ingestEquities
      ];
    case "workers":
      return [
        NATIVE_UNITS.compute,
        NATIVE_UNITS.candles,
        NATIVE_UNITS.ingestOptions,
        NATIVE_UNITS.ingestEquities
      ];
    default:
      return [
        NATIVE_UNITS.web,
        NATIVE_UNITS.api,
        NATIVE_UNITS.compute,
        NATIVE_UNITS.candles,
        NATIVE_UNITS.ingestOptions,
        NATIVE_UNITS.ingestEquities
      ];
  }
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

function assertNativeEdgeReady(scope: DeployScope): void {
  if (!scopeTouchesPublicEdge(scope) || DEPLOY_NATIVE_EDGE_READY) {
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

function localRuntimePrecheck(runtime: DeployRuntime, scope: DeployScope, noBuild: boolean): void {
  if (runtime === "docker" && !noBuild) {
    localDockerWorkspaceSnapshotPrecheck();
    return;
  }

  if (runtime === "native") {
    assertNativeEdgeReady(scope);
  }
}

function localMainPrecheck(
  remote: string,
  runtime: DeployRuntime,
  scope: DeployScope,
  noBuild: boolean
): void {
  section("Local Precheck");
  runChecked("git", ["fetch", remote]);
  runChecked("git", ["status", "--short", "--branch"]);
  runChecked("git", ["rev-parse", "--verify", "HEAD"]);
  runChecked("git", ["rev-parse", `${remote}/main`]);
  localRuntimePrecheck(runtime, scope, noBuild);
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
  scope: DeployScope,
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

  localRuntimePrecheck(runtime, scope, noBuild);
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

function remoteRuntimePrecheck(runtime: DeployRuntime, scope: DeployScope): void {
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

  const units = nativeUnitsForScope(scope).map((value) => shellEscape(value)).join(" ");
  runRemoteScript(
    "Remote Runtime Precheck",
    `#!/usr/bin/env bash
set -euo pipefail

cd ${shellEscape(REMOTE_REPO)}

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
  scope: DeployScope,
  forceRecreate: boolean,
  noBuild: boolean
): void {
  const rolloutServices = dockerServicesForScope(scope);
  const upArgs = ["up", "-d"];
  if (forceRecreate) {
    upArgs.push("--force-recreate");
  }
  const buildServices = dockerBuildServicesForScope(scope);
  const buildCommand = noBuild
    ? null
    : `docker compose build ${buildServices.join(" ")}`;
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
  scope: DeployScope,
  noBuild: boolean
): void {
  const units = nativeUnitsForScope(scope).map((value) => shellEscape(value)).join(" ");
  const buildSteps: string[] = [];

  if (!noBuild) {
    buildSteps.push("bun install --frozen-lockfile");
    if (scopeIncludesWeb(scope)) {
      buildSteps.push("bun --cwd=apps/web run build");
    }
  }

  buildSteps.push(`${NATIVE_SYSTEMCTL_PREFIX} restart ${nativeUnitsForScope(scope).map((value) => shellEscape(value)).join(" ")}`);

  runRemoteScript(
    "Remote Rollout",
    `#!/usr/bin/env bash
set -euo pipefail

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
  scope: DeployScope,
  forceRecreate: boolean,
  noBuild: boolean
): void {
  if (runtime === "docker") {
    remoteDockerRollout(mode, remote, branch, scope, forceRecreate, noBuild);
    return;
  }

  remoteNativeRollout(mode, remote, branch, scope, noBuild);
}

function remoteDockerVerification(scope: DeployScope, fast: boolean): void {
  const psServices = dockerServicesForScope(scope);
  const logServices = dockerLogServicesForScope(scope);
  const psCommand =
    psServices.length > 0
      ? `docker compose ps ${psServices.join(" ")}`
      : "docker compose ps";
  const logCommand = fast
    ? `echo '[deploy] Fast mode: skipping docker compose logs tail for quicker feedback.'`
    : `docker compose logs --tail=100 ${logServices.join(" ")}`;
  const checks: string[] = [];

  if (scopeIncludesApi(scope)) {
    checks.push(
      `docker compose exec -T api bun -e 'const r = await fetch("http://127.0.0.1:4000/health"); if (!r.ok) throw new Error("api healthcheck failed: " + r.status); console.log(await r.text())'`
    );
  }

  if (scopeIncludesWeb(scope)) {
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

function remoteNativeVerification(scope: DeployScope, fast: boolean): void {
  const units = nativeUnitsForScope(scope).map((value) => shellEscape(value)).join(" ");
  const checks: string[] = [];

  if (scopeIncludesApi(scope)) {
    checks.push('curl -fksS http://127.0.0.1:4000/health');
  }

  if (scopeIncludesWeb(scope)) {
    checks.push('curl -I -fksS http://127.0.0.1:3000/');
  }

  runRemoteScript(
    "Remote Verification",
    `#!/usr/bin/env bash
set -euo pipefail

declare -a units=(${units})
for unit in "\${units[@]}"; do
  ${NATIVE_SYSTEMCTL_PREFIX} is-active --quiet "$unit"
  ${fast ? "echo \"[deploy] Fast mode: skipping unit status and recent journal dump for $unit.\"": `${NATIVE_SYSTEMCTL_PREFIX} status --no-pager "$unit" || true\n  journalctl -u "$unit" -n 50 --no-pager || true`}
done
${checks.join("\n")}
`
  );
}

function remoteVerification(runtime: DeployRuntime, scope: DeployScope, fast: boolean): void {
  if (runtime === "docker") {
    remoteDockerVerification(scope, fast);
    return;
  }

  remoteNativeVerification(scope, fast);
}

function publicVerification(scope: DeployScope, fast: boolean): void {
  section("Public Verification");
  if (!fast || scopeIncludesWeb(scope)) {
    runChecked("curl", ["-I", "-fksS", PUBLIC_APP_URL]);
  } else {
    console.log("[deploy] Fast mode: skipping public app HEAD check because web scope is not included.");
  }

  if (scopeIncludesApi(scope) && PUBLIC_API_HEALTH_URL) {
    runChecked("curl", ["-fksS", PUBLIC_API_HEALTH_URL]);
    return;
  }

  if (scopeIncludesApi(scope)) {
    if (fast) {
      console.log(
        "[deploy] Fast mode: skipping scripts/check-public-api-routes.ts route suite. Set DEPLOY_PUBLIC_API_HEALTH_URL to keep a public API health probe in fast mode."
      );
      return;
    }
    runChecked("bun", ["run", "scripts/check-public-api-routes.ts", PUBLIC_APP_URL]);
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const scope = effectiveScope(options.scope, options.runtime, options.fast);
  const timings: PhaseTiming[] = [];
  const currentBranch = options.mode === "current-branch" ? currentBranchName() : null;
  const deployRemote = resolveDeployRemote(options.mode, currentBranch);
  assertSshKeyExists();
  printRuntimeAdvisory(options.runtime);

  console.log(
    `Deploying ${options.mode === "main" ? `${deployRemote}/main` : "the current local branch"} ` +
      `via ${describeRuntime(options.runtime)} (${describeScope(scope)}${options.fast ? ", fast mode" : ""}).`
  );
  console.log(`[deploy] Using git remote: ${deployRemote}`);
  console.log(
    `[deploy] Execution mode: ${isLocalServerExecution ? "local server checkout" : `ssh to ${REMOTE_HOST}`}`
  );
  if (options.fast && options.scope === "full") {
    console.log(
      `[deploy] Fast mode changed default full scope to ${options.runtime === "native" ? "--workers-only" : "--services-only"}.`
    );
  }

  if (options.mode === "main") {
    timedPhase(timings, "local precheck", () =>
      localMainPrecheck(deployRemote, options.runtime, scope, options.noBuild)
    );
    timedPhase(timings, "remote git precheck", () => remoteGitPrecheck());
    timedPhase(timings, "remote runtime precheck", () =>
      remoteRuntimePrecheck(options.runtime, scope)
    );
    timedPhase(timings, "remote rollout", () =>
      remoteRollout(
        options.mode,
        deployRemote,
        options.runtime,
        null,
        scope,
        options.forceRecreate,
        options.noBuild
      )
    );
  } else {
    const branch = currentBranch;
    if (!branch) {
      console.error("Unable to resolve current branch for current-branch deploy mode.");
      process.exit(1);
    }
    timedPhase(timings, "local precheck", () =>
      localBranchPrecheck(deployRemote, branch, options.runtime, scope, options.noBuild)
    );
    timedPhase(timings, "local publish", () => publishCurrentBranch(deployRemote, branch));
    timedPhase(timings, "remote git precheck", () => remoteGitPrecheck());
    timedPhase(timings, "remote runtime precheck", () =>
      remoteRuntimePrecheck(options.runtime, scope)
    );
    timedPhase(timings, "remote rollout", () =>
      remoteRollout(
        options.mode,
        deployRemote,
        options.runtime,
        branch,
        scope,
        options.forceRecreate,
        options.noBuild
      )
    );
  }

  timedPhase(timings, "remote verification", () =>
    remoteVerification(options.runtime, scope, options.fast)
  );
  timedPhase(timings, "public verification", () =>
    publicVerification(scope, options.fast)
  );
  printTimingSummary(timings);
}

main();
