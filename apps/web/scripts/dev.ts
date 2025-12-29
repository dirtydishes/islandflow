const run = async () => {
  const port = 3000;
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
