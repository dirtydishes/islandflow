import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type ChildSpec = {
  name: string;
  cmd: string[];
  cwd: string;
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
const pidFile = path.join(stateDir, "dev-services-runner-pids.json");

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
        `[dev-services] Cleaning up stale processes from previous run: ${stale
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
    console.error(`[dev-services] ${name} ${statusLabel} (${exitCode})`);
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
    if (children.length > 0) {
      await Promise.all(children.map((child) => stopChild(child)));
    }

    await clearPersistedChildren();
    process.exit(code);
  })();

  return shutdownPromise;
};

const handleSignal = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    if (signal === "SIGINT") {
      console.error("[dev-services] Force shutdown requested. Terminating remaining processes.");
      void forceShutdown(130);
    }
    return;
  }

  void shutdown(0);
};

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGHUP", () => handleSignal("SIGHUP"));

const tasks: ChildSpec[] = [
  { name: "ingest-options", cmd: ["bun", "run", "dev"], cwd: "services/ingest-options" },
  { name: "ingest-equities", cmd: ["bun", "run", "dev"], cwd: "services/ingest-equities" },
  { name: "compute", cmd: ["bun", "run", "dev"], cwd: "services/compute" },
  { name: "candles", cmd: ["bun", "run", "dev"], cwd: "services/candles" },
  { name: "refdata", cmd: ["bun", "run", "dev"], cwd: "services/refdata" },
  { name: "eod-enricher", cmd: ["bun", "run", "dev"], cwd: "services/eod-enricher" },
  { name: "api", cmd: ["bun", "run", "dev"], cwd: "services/api" }
];

await cleanupStaleChildren();
for (const task of tasks) {
  spawnChild(task);
}

await new Promise(() => {});
