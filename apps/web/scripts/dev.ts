import { rm } from "node:fs/promises";

const DEFAULT_REMOTE_API_URL = "https://api.flow.deltaisland.io";

const run = async () => {
  const port = 3000;
  const distDir = ".next-dev";
  console.log(`[web] starting Next.js dev server on port ${port}`);
  console.log(
    `[web] API origin: ${Bun.env.NEXT_PUBLIC_API_URL ?? DEFAULT_REMOTE_API_URL}${
      Bun.env.NEXT_PUBLIC_API_URL ? " (from NEXT_PUBLIC_API_URL)" : " (default)"
    }`
  );

  const path = Bun.env.PATH ?? "";
  const cwd = `${import.meta.dir}/..`;
  const distPath = `${cwd}/${distDir}`;

  // Clear potentially stale dev artifacts from interrupted prior runs.
  await rm(distPath, { recursive: true, force: true });
  console.log(`[web] cleared stale Next.js dev artifacts at ${distDir}`);

  const child = Bun.spawn(["next", "dev", "-p", String(port)], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...Bun.env,
      PATH: `${cwd}/node_modules/.bin:${path}`,
      NEXT_PUBLIC_API_URL: Bun.env.NEXT_PUBLIC_API_URL ?? DEFAULT_REMOTE_API_URL,
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
