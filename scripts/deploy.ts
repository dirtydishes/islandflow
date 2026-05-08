#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DeployMode = "main" | "current-branch";

const REMOTE_HOST = "delta@152.53.80.229";
const REMOTE_REPO = "/home/delta/islandflow";
const REMOTE_DEPLOYMENT = "/home/delta/islandflow/deployment/docker";
const SSH_KEY = path.join(process.env.HOME ?? "", ".ssh", "delta_ed25519");
const SSH_OPTIONS = ["-i", SSH_KEY, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"];
const ALLOWED_REMOTE_UNTRACKED = new Set([
  "deployment/docker/signal-cli-0.14.3-Linux-native.tar.gz",
  "deployment/npm/"
]);
const API_CONTAINER = "islandflow-vps-api-1";
const WEB_CONTAINER = "islandflow-vps-web-1";
const PUBLIC_APP_URL = process.env.DEPLOY_PUBLIC_APP_URL?.trim() || "https://flow.deltaisland.io";
const PUBLIC_API_HEALTH_URL = process.env.DEPLOY_PUBLIC_API_HEALTH_URL?.trim() || null;
const LOG_SERVICES = ["api", "web", "compute", "candles", "ingest-options", "ingest-equities"];

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function usage(exitCode = 1): never {
  console.error(`Usage:
  ./deploy main [--force-recreate]
  ./deploy current-branch [--force-recreate]
  ./deploy current branch [--force-recreate]

Modes:
  main            Deploy origin/main to the live server checkout.
  current-branch  Push the current local branch, switch the server to it, and deploy it.

Options:
  --force-recreate  Escalation path for docker compose when a normal refresh is not enough.
  --help            Show this help text.

Environment:
  DEPLOY_PUBLIC_APP_URL         Override the public app URL (default: https://flow.deltaisland.io).
  DEPLOY_PUBLIC_API_HEALTH_URL  Optional separate public API health URL for two-origin deployments.`);
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

function runRemoteScript(title: string, script: string, args: string[] = []): void {
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

function parseArgs(rawArgs: string[]): { mode: DeployMode; forceRecreate: boolean } {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    usage(0);
  }

  const forceRecreate = rawArgs.includes("--force-recreate");
  const positional = rawArgs.filter((arg) => arg !== "--force-recreate");

  if (positional.length === 1 && positional[0] === "main") {
    return { mode: "main", forceRecreate };
  }

  if (
    (positional.length === 1 && positional[0] === "current-branch") ||
    (positional.length === 2 && positional[0] === "current" && positional[1] === "branch")
  ) {
    return { mode: "current-branch", forceRecreate };
  }

  usage();
}

function assertSshKeyExists(): void {
  if (!existsSync(SSH_KEY)) {
    console.error(`Missing SSH key: ${SSH_KEY}`);
    process.exit(1);
  }
}

function localMainPrecheck(): void {
  section("Local Precheck");
  runChecked("git", ["fetch", "origin"]);
  runChecked("git", ["status", "--short", "--branch"]);
  runChecked("git", ["rev-parse", "--verify", "HEAD"]);
  runChecked("git", ["rev-parse", "origin/main"]);
}

function currentBranchName(): string {
  const branch = captureChecked("git", ["branch", "--show-current"]).trim();
  if (!branch) {
    console.error("Refusing branch deployment from a detached HEAD.");
    process.exit(1);
  }
  return branch;
}

function localBranchPrecheck(branch: string): void {
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

function remotePrecheck(): void {
  const allowedRemoteUntrackedPattern = Array.from(ALLOWED_REMOTE_UNTRACKED)
    .map((path) => shellPattern(path))
    .join("|");

  runRemoteScript(
    "Remote Precheck",
    `#!/usr/bin/env bash
set -euo pipefail

cd "${REMOTE_REPO}"
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

function remoteRollout(mode: DeployMode, branch: string | null, forceRecreate: boolean): void {
  const composeArgs = forceRecreate ? "up -d --build --force-recreate" : "up -d --build";
  const switchCommand =
    mode === "main"
      ? `git switch main
git pull --ff-only origin main`
      : `git switch ${shellEscape(branch!)} || git switch -c ${shellEscape(branch!)} --track origin/${shellEscape(branch!)}
git pull --ff-only origin ${shellEscape(branch!)}`;

  runRemoteScript(
    "Remote Rollout",
    `#!/usr/bin/env bash
set -euo pipefail

cd "${REMOTE_REPO}"
git fetch origin
${switchCommand}

cd "${REMOTE_DEPLOYMENT}"
docker compose ${composeArgs}
`
  );
}

function remoteVerification(): void {
  runRemoteScript(
    "Remote Verification",
    `#!/usr/bin/env bash
set -euo pipefail

cd "${REMOTE_DEPLOYMENT}"
docker compose ps
docker compose logs --tail=100 ${LOG_SERVICES.join(" ")}
docker exec ${API_CONTAINER} bun -e 'const r = await fetch("http://127.0.0.1:4000/health"); console.log(await r.text())'
docker exec ${WEB_CONTAINER} bun -e 'const r = await fetch("http://127.0.0.1:3000/"); console.log(r.status)'
`
  );
}

function publicVerification(): void {
  section("Public Verification");
  runChecked("curl", ["-I", "-fksS", PUBLIC_APP_URL]);

  if (PUBLIC_API_HEALTH_URL) {
    runChecked("curl", ["-fksS", PUBLIC_API_HEALTH_URL]);
    return;
  }

  console.log(
    "Skipping separate public API health check; same-origin mode relies on the public app check plus container-local API verification."
  );
}

function shellEscape(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function shellPattern(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function main(): void {
  const { mode, forceRecreate } = parseArgs(process.argv.slice(2));
  assertSshKeyExists();

  console.log(
    mode === "main"
      ? "Deploying origin/main to the existing Islandflow VPS checkout."
      : "Deploying the current local branch to the existing Islandflow VPS checkout."
  );

  if (mode === "main") {
    localMainPrecheck();
    remotePrecheck();
    remoteRollout(mode, null, forceRecreate);
  } else {
    const branch = currentBranchName();
    localBranchPrecheck(branch);
    publishCurrentBranch(branch);
    remotePrecheck();
    remoteRollout(mode, branch, forceRecreate);
  }

  remoteVerification();
  publicVerification();
}

main();
