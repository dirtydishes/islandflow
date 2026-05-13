import net from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DESKTOP_REMOTE_URL = "https://flow.deltaisland.io";
const DESKTOP_LOCAL_URL = "http://127.0.0.1:3000";
const WEB_PORT = 3000;

type ChildSpec = {
  name: string;
  cmd: string[];
  cwd: string;
  env?: Record<string, string>;
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
const pidFile = path.join(stateDir, "dev-desktop-runner-pids.json");
const remoteMode = process.argv.includes("--remote");

const sleep = (delayMs: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
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

const stopPid = async (pid: number, timeoutMs = 5000): Promise<void> => {
  if (!signalProcess(pid, "SIGINT")) {
    return;
  }

  if (await waitForPidExit(pid, timeoutMs)) {
    return;
  }

  if (!signalProcess(pid, "SIGKILL")) {
    return;
  }

  await waitForPidExit(pid, 2000);
};

const stopChild = async (child: Child, timeoutMs = 5000): Promise<void> => {
  const pid = child.process.pid;
  if (!pid) {
    return;
  }

  await stopPid(pid, timeoutMs);
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
        `[dev:desktop] Cleaning up stale processes from previous run: ${stale
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

const spawnChild = ({ name, cmd, cwd, env }: ChildSpec): void => {
  const proc = Bun.spawn(cmd, {
    cwd,
    detached: true,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...Bun.env,
      ...env
    }
  });

  children.push({ name, process: proc });
  void persistChildren();

  proc.exited.then((code) => {
    if (shuttingDown) {
      return;
    }

    const exitCode = code ?? 0;
    const statusLabel = exitCode === 0 ? "exited" : "failed";
    console.error(`[dev:desktop] ${name} ${statusLabel} (${exitCode})`);
    void shutdown(exitCode);
  });
};

const shutdown = async (code: number): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shuttingDown = true;
  shutdownPromise = (async () => {
    await Promise.all(children.map((child) => stopChild(child)));
    await clearPersistedChildren();
    process.exit(code);
  })();

  return shutdownPromise;
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

const handleSignal = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    if (signal === "SIGINT") {
      console.error("[dev:desktop] Force shutdown requested. Terminating remaining processes.");
      void forceShutdown(130);
    }
    return;
  }

  void shutdown(0);
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

const waitForWebPort = async (): Promise<void> => {
  const deadline = Date.now() + 90_000;
  let lastLog = 0;

  while (Date.now() < deadline) {
    if (await checkTcp("127.0.0.1", WEB_PORT)) {
      console.log(`[dev:desktop] Web UI ready on ${DESKTOP_LOCAL_URL}`);
      return;
    }

    const now = Date.now();
    if (now - lastLog > 5000) {
      console.log(`[dev:desktop] Waiting for local web UI on ${DESKTOP_LOCAL_URL}...`);
      lastLog = now;
    }

    await sleep(1000);
  }

  console.error("[dev:desktop] Web UI did not open port 3000 within 90s.");
  void shutdown(1);
};

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGHUP", () => handleSignal("SIGHUP"));

await cleanupStaleChildren();

if (!remoteMode) {
  spawnChild({
    name: "web",
    cmd: ["bun", "run", "dev"],
    cwd: "apps/web",
    env: {
      NEXT_PUBLIC_API_URL: Bun.env.NEXT_PUBLIC_API_URL ?? DESKTOP_REMOTE_URL
    }
  });
  await waitForWebPort();
}

spawnChild({
  name: "desktop",
  cmd: ["bun", "run", "start"],
  cwd: "apps/desktop",
  env: {
    ISLANDFLOW_DESKTOP_START_URL: remoteMode ? DESKTOP_REMOTE_URL : DESKTOP_LOCAL_URL
  }
});

await new Promise(() => {});
