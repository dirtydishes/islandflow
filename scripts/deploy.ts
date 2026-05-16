#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DeployMode = "main" | "current-branch";
type DeployRuntime = "docker" | "native";
type DeployScope = "full" | "web" | "api" | "services";

type DeployOptions = {
  mode: DeployMode;
  runtime: DeployRuntime;
  scope: DeployScope;
  forceRecreate: boolean;
  noBuild: boolean;
};

const REMOTE_HOST = "delta@152.53.80.229";
const REMOTE_REPO = "/home/delta/islandflow";
const REMOTE_DOCKER_DEPLOYMENT = "/home/delta/islandflow/deployment/docker";
const SSH_KEY = path.join(process.env.HOME ?? "", ".ssh", "delta_ed25519");
const SSH_OPTIONS = [
  "-i",
  SSH_KEY,
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "BatchMode=yes"
];
const ALLOWED_REMOTE_UNTRACKED = new Set([
  "deployment/docker/signal-cli-0.14.3-Linux-native.tar.gz",
  "deployment/npm/"
]);
const PUBLIC_APP_URL =
  process.env.DEPLOY_PUBLIC_APP_URL?.trim() || "https://flow.deltaisland.io";
const PUBLIC_API_HEALTH_URL =
  process.env.DEPLOY_PUBLIC_API_HEALTH_URL?.trim() || null;
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

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function usage(exitCode = 1): never {
  console.error(`Usage:
  ./deploy main [--runtime docker|native] [--web-only|--api-only|--services-only] [--no-build] [--force-recreate]
  ./deploy current-branch [--runtime docker|native] [--web-only|--api-only|--services-only] [--no-build] [--force-recreate]
  ./deploy current branch [--runtime docker|native] [--web-only|--api-only|--services-only] [--no-build] [--force-recreate]

Modes:
  main            Deploy origin/main to the live server checkout.
  current-branch  Push the current local branch, switch the server to it, and deploy it.

Runtimes:
  docker          Roll out from deployment/docker with Docker Compose (default, recommended).
  native          Experimental host-native Bun services managed by systemd.

Scopes:
  default         Full rollout (web + API + backend services).
  --web-only      Deploy only the Next.js web surface.
  --api-only      Deploy only the API service.
  --services-only Deploy API + backend services without the web service.

Options:
  --runtime <name>     Explicit runtime selector (docker or native).
  --no-build           Skip docker image builds or native bun install/web build steps.
  --force-recreate     Docker-only escalation path for docker compose when a normal refresh is not enough.
  --help               Show this help text.

Environment:
  DEPLOY_PUBLIC_APP_URL             Override the public app URL (default: https://flow.deltaisland.io).
  DEPLOY_PUBLIC_API_HEALTH_URL      Optional separate public API health URL for two-origin deployments.
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

function runRemoteScript(
  title: string,
  script: string,
  args: string[] = []
): void {
  section(title);
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
    rawArgs.includes("--services-only") ? "services" : null
  ].filter((value): value is Exclude<DeployScope, "full"> => value !== null);

  if (scopes.length > 1) {
    console.error("Choose only one deploy scope flag: --web-only, --api-only, or --services-only.");
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
  const forceRecreate = rawArgs.includes("--force-recreate");
  const noBuild = rawArgs.includes("--no-build");
  const positional = rawArgs.filter(
    (arg, index) =>
      arg !== "--force-recreate" &&
      arg !== "--no-build" &&
      arg !== "--web-only" &&
      arg !== "--api-only" &&
      arg !== "--services-only" &&
      arg !== "--runtime" &&
      rawArgs[index - 1] !== "--runtime" &&
      !arg.startsWith("--runtime=")
  );

  if (forceRecreate && runtime !== "docker") {
    console.error("--force-recreate is only supported with --runtime docker.");
    process.exit(1);
  }

  if (positional.length === 1 && positional[0] === "main") {
    return { mode: "main", runtime, scope, forceRecreate, noBuild };
  }

  if (
    (positional.length === 1 && positional[0] === "current-branch") ||
    (positional.length === 2 && positional[0] === "current" && positional[1] === "branch")
  ) {
    return {
      mode: "current-branch",
      runtime,
      scope,
      forceRecreate,
      noBuild
    };
  }

  usage();
}

function assertSshKeyExists(): void {
  if (!existsSync(SSH_KEY)) {
    console.error(`Missing SSH key: ${SSH_KEY}`);
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
    default:
      return "full stack";
  }
}

function scopeIncludesWeb(scope: DeployScope): boolean {
  return scope === "full" || scope === "web";
}

function scopeIncludesApi(scope: DeployScope): boolean {
  return scope === "full" || scope === "api" || scope === "services";
}

function dockerServicesForScope(scope: DeployScope): string[] {
  switch (scope) {
    case "web":
      return ["web"];
    case "api":
      return ["api"];
    case "services":
      return [...DOCKER_BACKEND_SERVICES];
    default:
      return [];
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

function localRuntimePrecheck(runtime: DeployRuntime, noBuild: boolean): void {
  if (runtime === "docker" && !noBuild) {
    localDockerWorkspaceSnapshotPrecheck();
  }
}

function localMainPrecheck(runtime: DeployRuntime, noBuild: boolean): void {
  section("Local Precheck");
  runChecked("git", ["fetch", "origin"]);
  runChecked("git", ["status", "--short", "--branch"]);
  runChecked("git", ["rev-parse", "--verify", "HEAD"]);
  runChecked("git", ["rev-parse", "origin/main"]);
  localRuntimePrecheck(runtime, noBuild);
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
  branch: string,
  runtime: DeployRuntime,
  noBuild: boolean
): void {
  section("Local Precheck");
  runChecked("git", ["branch", "--show-current"]);
  runChecked("git", ["status", "--short", "--branch"]);
  runChecked("git", ["fetch", "origin"]);

  const porcelain = captureChecked("git", ["status", "--porcelain=v1"]).trim();
  if (porcelain) {
    console.error(
      `Refusing to deploy ${branch} with uncommitted local changes. Commit the intended state first.`
    );
    process.exit(1);
  }

  localRuntimePrecheck(runtime, noBuild);
}

function publishCurrentBranch(branch: string): void {
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
    runChecked("git", ["push", "origin", branch]);
    return;
  }

  runChecked("git", ["push", "-u", "origin", branch]);
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

function remoteGitUpdateScript(mode: DeployMode, branch: string | null): string {
  const escapedBranch = branch ? shellEscape(branch) : null;
  const switchCommand =
    mode === "main"
      ? `git switch main\ngit pull --ff-only origin main`
      : `git switch ${escapedBranch} || git switch -c ${escapedBranch} --track origin/${escapedBranch}\ngit pull --ff-only origin ${escapedBranch}`;

  return `cd ${shellEscape(REMOTE_REPO)}\ngit fetch origin\n${switchCommand}`;
}

function remoteDockerRollout(
  mode: DeployMode,
  branch: string | null,
  scope: DeployScope,
  forceRecreate: boolean,
  noBuild: boolean
): void {
  const services = dockerServicesForScope(scope);
  const args = ["up", "-d"];
  if (!noBuild) {
    args.push("--build");
  }
  if (forceRecreate) {
    args.push("--force-recreate");
  }
  const command = `docker compose ${[...args, ...services].join(" ")}`;

  runRemoteScript(
    "Remote Rollout",
    `#!/usr/bin/env bash
set -euo pipefail

${remoteGitUpdateScript(mode, branch)}

cd ${shellEscape(REMOTE_DOCKER_DEPLOYMENT)}
${command}
`
  );
}

function remoteNativeRollout(
  mode: DeployMode,
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

${remoteGitUpdateScript(mode, branch)}

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
  runtime: DeployRuntime,
  branch: string | null,
  scope: DeployScope,
  forceRecreate: boolean,
  noBuild: boolean
): void {
  if (runtime === "docker") {
    remoteDockerRollout(mode, branch, scope, forceRecreate, noBuild);
    return;
  }

  remoteNativeRollout(mode, branch, scope, noBuild);
}

function remoteDockerVerification(scope: DeployScope): void {
  const psServices = dockerServicesForScope(scope);
  const logServices = dockerLogServicesForScope(scope);
  const psCommand =
    psServices.length > 0
      ? `docker compose ps ${psServices.join(" ")}`
      : "docker compose ps";
  const logCommand = `docker compose logs --tail=100 ${logServices.join(" ")}`;
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

function remoteNativeVerification(scope: DeployScope): void {
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
  ${NATIVE_SYSTEMCTL_PREFIX} status --no-pager "$unit" || true
  journalctl -u "$unit" -n 50 --no-pager || true
done
${checks.join("\n")}
`
  );
}

function remoteVerification(runtime: DeployRuntime, scope: DeployScope): void {
  if (runtime === "docker") {
    remoteDockerVerification(scope);
    return;
  }

  remoteNativeVerification(scope);
}

function publicVerification(scope: DeployScope): void {
  section("Public Verification");
  runChecked("curl", ["-I", "-fksS", PUBLIC_APP_URL]);

  if (scopeIncludesApi(scope) && PUBLIC_API_HEALTH_URL) {
    runChecked("curl", ["-fksS", PUBLIC_API_HEALTH_URL]);
    return;
  }

  if (scopeIncludesApi(scope)) {
    console.log(
      "Skipping separate public API health check; same-origin mode relies on the public app check plus runtime-local API verification."
    );
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  assertSshKeyExists();
  printRuntimeAdvisory(options.runtime);

  console.log(
    `Deploying ${options.mode === "main" ? "origin/main" : "the current local branch"} ` +
      `via ${describeRuntime(options.runtime)} (${describeScope(options.scope)}).`
  );

  if (options.mode === "main") {
    localMainPrecheck(options.runtime, options.noBuild);
    remoteGitPrecheck();
    remoteRuntimePrecheck(options.runtime, options.scope);
    remoteRollout(
      options.mode,
      options.runtime,
      null,
      options.scope,
      options.forceRecreate,
      options.noBuild
    );
  } else {
    const branch = currentBranchName();
    localBranchPrecheck(branch, options.runtime, options.noBuild);
    publishCurrentBranch(branch);
    remoteGitPrecheck();
    remoteRuntimePrecheck(options.runtime, options.scope);
    remoteRollout(
      options.mode,
      options.runtime,
      branch,
      options.scope,
      options.forceRecreate,
      options.noBuild
    );
  }

  remoteVerification(options.runtime, options.scope);
  publicVerification(options.scope);
}

main();
