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

const spawnChild = ({ name, cmd, cwd }: ChildSpec): void => {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });

  children.push({ name, process: proc });

  proc.exited.then((code) => {
    if (shuttingDown) {
      return;
    }

    const exitCode = code ?? 0;
    const statusLabel = exitCode === 0 ? "exited" : "failed";
    console.error(`[dev-services] ${name} ${statusLabel} (${exitCode})`);
    shutdown(exitCode);
  });
};

const shutdown = (code: number): void => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    child.process.kill();
  }

  process.exit(code);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

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
