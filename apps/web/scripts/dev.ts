import { rm } from "node:fs/promises";
import { resolveWebDevConfig } from "./dev-config";

const run = async () => {
  const config = resolveWebDevConfig(Bun.env);
  const { apiUrl, apiUrlSource, port, portSource } = config;
  const distDir = ".next-dev";
  console.log(`[web] starting Next.js dev server on port ${port} (${portSource})`);
  console.log(`[web] API origin: ${apiUrl} (${apiUrlSource})`);
  if (config.hostedApiCorsWarning) {
    console.warn(`[web] ${config.hostedApiCorsWarning}`);
  }

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
      NEXT_PUBLIC_API_URL: apiUrl,
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
