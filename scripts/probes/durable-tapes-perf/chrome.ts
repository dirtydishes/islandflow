import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sleep } from "./time";
import type { ChromeLaunch, CliOptions } from "./types";

const findFreePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  if (!address || typeof address === "string") {
    throw new Error("Unable to reserve a CDP port.");
  }
  return address.port;
};

const commandPath = (command: string): string | null => {
  const result = spawnSync("command", ["-v", command], {
    shell: true,
    encoding: "utf8"
  });
  if (result.status === 0) {
    const stdout = result.stdout.trim();
    return stdout.length > 0 ? stdout : null;
  }
  return null;
};

const resolveBrowserPath = (requested?: string): string => {
  const candidates = [
    requested,
    process.env.CHROME_PATH,
    process.env.BROWSER_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    commandPath("google-chrome-stable"),
    commandPath("google-chrome"),
    commandPath("chromium"),
    commandPath("chromium-browser"),
    commandPath("microsoft-edge")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "No local Chrome/Chromium executable found. Pass --browser-path, set CHROME_PATH, or run Chrome with --remote-debugging-port and pass --cdp-url."
  );
};

const waitForCdpHttp = async (cdpHttpUrl: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpHttpUrl}/json/version`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for Chrome CDP at ${cdpHttpUrl}: ${String(lastError)}`);
};

export const launchChrome = async (options: CliOptions): Promise<ChromeLaunch> => {
  if (options.cdpUrl) {
    const cdpHttpUrl = options.cdpUrl.startsWith("ws")
      ? options.cdpUrl
      : options.cdpUrl.replace(/\/$/, "");
    return {
      browserName: "external-cdp",
      cdpHttpUrl
    };
  }

  const browserPath = resolveBrowserPath(options.browserPath);
  const port = await findFreePort();
  const userDataDir = await mkdtemp(join(tmpdir(), "islandflow-durable-tapes-probe-"));
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--disable-features=Translate,OptimizationHints",
    "about:blank"
  ];
  if (!options.headful) {
    args.unshift("--headless=new", "--disable-gpu");
  }

  const processHandle = Bun.spawn([browserPath, ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const cdpHttpUrl = `http://127.0.0.1:${port}`;
  await waitForCdpHttp(cdpHttpUrl);

  return {
    browserName: browserPath,
    cdpHttpUrl,
    process: processHandle,
    userDataDir
  };
};

export const openPageWebSocket = async (cdpUrl: string): Promise<string> => {
  if (cdpUrl.startsWith("ws")) {
    return cdpUrl;
  }

  await waitForCdpHttp(cdpUrl);
  const encoded = encodeURIComponent("about:blank");
  const attempts: Array<[string, RequestInit]> = [
    [`${cdpUrl}/json/new?${encoded}`, { method: "PUT" }],
    [`${cdpUrl}/json/new?${encoded}`, { method: "GET" }]
  ];

  for (const [url, init] of attempts) {
    const response = await fetch(url, init);
    if (!response.ok) {
      continue;
    }
    const target = (await response.json()) as { webSocketDebuggerUrl?: string };
    if (target.webSocketDebuggerUrl) {
      return target.webSocketDebuggerUrl;
    }
  }

  throw new Error(`Unable to create a Chrome page target through ${cdpUrl}.`);
};
