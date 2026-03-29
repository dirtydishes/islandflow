import net from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type ChildSpec = {
  name: string;
  cmd: string[];
  cwd?: string;
};

type Child = {
  name: string;
  process: Bun.Subprocess;
};

const children: Child[] = [];
let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;
let forceShutdownPromise: Promise<void> | null = null;
const stateDir = path.join(process.cwd(), ".tmp");
const pidFile = path.join(stateDir, "dev-runner-pids.json");

const sleep = (delayMs: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
};

const waitForExit = async (proc: Bun.Subprocess, timeoutMs: number): Promise<boolean> => {
  const result = await Promise.race([
    proc.exited.then(() => true),
    sleep(timeoutMs).then(() => false)
  ]);
  return result;
};

const isPidRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForPidExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !isPidRunning(pid);
};

const signalProcess = (pid: number, signal: NodeJS.Signals): boolean => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
};

const stopChild = async (child: Child, timeoutMs = 5000): Promise<void> => {
  const pid = child.process.pid;
  if (!pid) {
    return;
  }
  await stopPid(pid, timeoutMs);
};

const stopPid = async (pid: number, timeoutMs = 5000): Promise<void> => {
  if (!signalProcess(pid, "SIGINT")) {
    return;
  }

  const exited = await waitForPidExit(pid, timeoutMs);
  if (exited) {
    return;
  }

  if (!signalProcess(pid, "SIGKILL")) {
    return;
  }

  await waitForPidExit(pid, 2000);
};

const persistChildren = async (): Promise<void> => {
  await mkdir(stateDir, { recursive: true });
  const payload = children
    .map((child) => {
      const pid = child.process.pid;
      return pid ? { name: child.name, pid } : null;
    })
    .filter((value): value is { name: string; pid: number } => value !== null);
  await writeFile(pidFile, JSON.stringify(payload, null, 2));
};

const clearPersistedChildren = async (): Promise<void> => {
  await rm(pidFile, { force: true });
};

const cleanupStaleChildren = async (): Promise<void> => {
  try {
    const raw = await readFile(pidFile, "utf8");
    const recorded = JSON.parse(raw) as Array<{ name?: string; pid?: number }>;
    const stale = recorded.filter(
      (entry): entry is { name: string; pid: number } =>
        typeof entry?.name === "string" && typeof entry?.pid === "number" && isPidRunning(entry.pid)
    );

    if (stale.length > 0) {
      console.log(
        `[dev] Cleaning up stale processes from previous run: ${stale
          .map((entry) => `${entry.name}(${entry.pid})`)
          .join(", ")}`
      );
    }

    for (const entry of stale) {
      await stopPid(entry.pid, 3000);
    }
  } catch {
    // No persisted children from a prior run.
  } finally {
    await clearPersistedChildren();
  }
};

const parseBool = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const parseUrlHostPort = (
  value: string,
  fallbackHost: string,
  fallbackPort: number
): { host: string; port: number } => {
  const candidate = value.split(",")[0]?.trim() ?? "";
  if (!candidate) {
    return { host: fallbackHost, port: fallbackPort };
  }

  try {
    const url = new URL(candidate.includes("://") ? candidate : `tcp://${candidate}`);
    const port = url.port ? Number(url.port) : fallbackPort;
    return { host: url.hostname || fallbackHost, port };
  } catch {
    return { host: fallbackHost, port: fallbackPort };
  }
};

const checkTcp = (host: string, port: number, timeoutMs = 1000): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finalize = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finalize(true));
    socket.once("error", () => finalize(false));
    socket.once("timeout", () => finalize(false));
  });
};

const checkHttp = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
};

const spawnChild = ({ name, cmd, cwd }: ChildSpec): void => {
  const proc = Bun.spawn(cmd, {
    cwd,
    detached: true,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });

  children.push({ name, process: proc });
  void persistChildren();

  proc.exited.then((code) => {
    if (shuttingDown) {
      return;
    }

    const exitCode = code ?? 0;
    const statusLabel = exitCode === 0 ? "exited" : "failed";
    console.error(`[dev] ${name} ${statusLabel} (${exitCode})`);
    if (name === "infra" && exitCode !== 0) {
      console.error(
        "[dev] Infra failed. Ensure Docker is installed and the daemon is running (OrbStack or Docker Desktop), then retry."
      );
    }
    void shutdown(exitCode);
  });
};

const forceShutdown = async (code: number): Promise<void> => {
  if (forceShutdownPromise) {
    return forceShutdownPromise;
  }

  shuttingDown = true;
  forceShutdownPromise = (async () => {
    await Promise.all(
      children.map(async (child) => {
        const pid = child.process.pid;
        if (!pid) {
          return;
        }

        if (!signalProcess(pid, "SIGKILL")) {
          return;
        }

        await waitForPidExit(pid, 2000);
      })
    );

    await clearPersistedChildren();
    process.exit(code);
  })();

  return forceShutdownPromise;
};

const shutdown = async (code: number): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shuttingDown = true;
  shutdownPromise = (async () => {
    const infra = children.find((child) => child.name === "infra") ?? null;
    const services = children.filter((child) => child.name !== "infra");

    if (services.length > 0) {
      await Promise.all(services.map((child) => stopChild(child)));
    }

    if (infra) {
      await stopChild(infra, 8000);
    }

    await clearPersistedChildren();
    process.exit(code);
  })();

  return shutdownPromise;
};

const handleSignal = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    if (signal === "SIGINT") {
      console.error("[dev] Force shutdown requested. Terminating remaining processes.");
      void forceShutdown(130);
    }
    return;
  }

  void shutdown(0);
};

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGHUP", () => handleSignal("SIGHUP"));

const waitForInfra = async (): Promise<void> => {
  const natsTarget = parseUrlHostPort(process.env.NATS_URL ?? "", "127.0.0.1", 4222);
  const redisTarget = parseUrlHostPort(process.env.REDIS_URL ?? "", "127.0.0.1", 6379);
  const clickhouseUrl = process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123";
  const deadline = Date.now() + 90_000;
  let lastLog = 0;

  while (Date.now() < deadline) {
    const [natsOk, redisOk, clickhouseOk] = await Promise.all([
      checkTcp(natsTarget.host, natsTarget.port),
      checkTcp(redisTarget.host, redisTarget.port),
      checkHttp(`${clickhouseUrl.replace(/\/$/, "")}/ping`)
    ]);

    if (natsOk && redisOk && clickhouseOk) {
      console.log("[dev] Infra ready");
      return;
    }

    const now = Date.now();
    if (now - lastLog > 5000) {
      console.log(
        `[dev] Waiting for infra... nats=${natsOk ? "up" : "down"} redis=${
          redisOk ? "up" : "down"
        } clickhouse=${clickhouseOk ? "up" : "down"}`
      );
      lastLog = now;
    }

    await sleep(1000);
  }

  console.error("[dev] Infra not ready after 90s. Check Docker/ports and retry.");
  shutdown(1);
};

const infraTask: ChildSpec = { name: "infra", cmd: ["docker", "compose", "up"] };
const serviceTasks: ChildSpec[] = [
  { name: "web", cmd: ["bun", "run", "dev"], cwd: "apps/web" },
  { name: "ingest-options", cmd: ["bun", "run", "dev"], cwd: "services/ingest-options" },
  { name: "ingest-equities", cmd: ["bun", "run", "dev"], cwd: "services/ingest-equities" },
  { name: "compute", cmd: ["bun", "run", "dev"], cwd: "services/compute" },
  { name: "candles", cmd: ["bun", "run", "dev"], cwd: "services/candles" },
  { name: "refdata", cmd: ["bun", "run", "dev"], cwd: "services/refdata" },
  { name: "eod-enricher", cmd: ["bun", "run", "dev"], cwd: "services/eod-enricher" },
  { name: "api", cmd: ["bun", "run", "dev"], cwd: "services/api" }
];

if (parseBool(process.env.REPLAY_ENABLED)) {
  serviceTasks.push({ name: "replay", cmd: ["bun", "run", "dev"], cwd: "services/replay" });
}

await cleanupStaleChildren();
spawnChild(infraTask);
await waitForInfra();

for (const task of serviceTasks) {
  spawnChild(task);
}

await new Promise(() => {});
