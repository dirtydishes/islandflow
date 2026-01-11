import net from "node:net";

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
    console.error(`[dev] ${name} ${statusLabel} (${exitCode})`);
    if (name === "infra" && exitCode !== 0) {
      console.error(
        "[dev] Infra failed. Ensure Docker is installed and the daemon is running (OrbStack or Docker Desktop), then retry."
      );
    }
    void shutdown(exitCode);
  });
};

const shutdown = async (code: number): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  const infra = children.find((child) => child.name === "infra") ?? null;
  const services = children.filter((child) => child.name !== "infra");

  if (services.length > 0) {
    await Promise.all(services.map((child) => stopChild(child)));
  }

  if (infra) {
    await stopChild(infra, 8000);
  }

  process.exit(code);
};

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

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

spawnChild(infraTask);
await waitForInfra();

for (const task of serviceTasks) {
  spawnChild(task);
}

await new Promise(() => {});
