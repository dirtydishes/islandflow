type PortCheck = {
  port: number;
  available: boolean;
};

const DEFAULT_PORTS = [3001, 3002, 3003, 3004, 3005];

const isAvailable = (port: number): PortCheck => {
  try {
    const probe = Bun.serve({
      port,
      fetch: () => new Response("ok")
    });
    probe.stop();
    return { port, available: true };
  } catch {
    return { port, available: false };
  }
};

const parsePort = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const selectPort = (): number => {
  const requested = parsePort(Bun.env.PORT);

  if (requested !== null) {
    const check = isAvailable(requested);
    if (!check.available) {
      throw new Error(`Port ${requested} is already in use. Set PORT to another value.`);
    }
    return requested;
  }

  for (const port of DEFAULT_PORTS) {
    if (isAvailable(port).available) {
      return port;
    }
  }

  throw new Error("No available port found for Next dev server.");
};

const run = async () => {
  const port = selectPort();
  console.log(`[web] starting Next.js dev server on port ${port}`);

  const path = Bun.env.PATH ?? "";
  const cwd = `${import.meta.dir}/..`;

  const child = Bun.spawn(["next", "dev", "-p", String(port)], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...Bun.env,
      PATH: `${cwd}/node_modules/.bin:${path}`,
      PORT: String(port)
    }
  });

  const shutdown = () => {
    child.kill();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const code = await child.exited;
  process.exit(code ?? 0);
};

await run();
