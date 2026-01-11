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

  if (!signalProcess(pid, "SIGINT")) {
    return;
  }

  const exited = await waitForExit(child.process, timeoutMs);
  if (exited) {
    return;
  }

  if (!signalProcess(pid, "SIGKILL")) {
    return;
  }

  await waitForExit(child.process, 2000);
};

const spawnChild = ({ name, cmd, cwd }: ChildSpec): void => {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    detached: true
  });

  children.push({ name, process: proc });

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

const shutdown = async (code: number): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (children.length > 0) {
    await Promise.all(children.map((child) => stopChild(child)));
  }

  process.exit(code);
};

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

const tasks: ChildSpec[] = [
  { name: "ingest-options", cmd: ["bun", "run", "dev"], cwd: "services/ingest-options" },
  { name: "ingest-equities", cmd: ["bun", "run", "dev"], cwd: "services/ingest-equities" },
  { name: "compute", cmd: ["bun", "run", "dev"], cwd: "services/compute" },
  { name: "candles", cmd: ["bun", "run", "dev"], cwd: "services/candles" },
  { name: "refdata", cmd: ["bun", "run", "dev"], cwd: "services/refdata" },
  { name: "eod-enricher", cmd: ["bun", "run", "dev"], cwd: "services/eod-enricher" },
  { name: "api", cmd: ["bun", "run", "dev"], cwd: "services/api" }
];

for (const task of tasks) {
  spawnChild(task);
}

await new Promise(() => {});
