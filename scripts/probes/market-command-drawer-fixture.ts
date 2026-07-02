#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import {
  MARKET_COMMAND_DRAWER_FIXTURE_PARAM,
  MARKET_COMMAND_DRAWER_FIXTURE_VALUE
} from "../../apps/web/features/market-command/browser-fixture";
import { CdpClient } from "./durable-tapes-perf/cdp";
import { launchChrome, openPageWebSocket } from "./durable-tapes-perf/chrome";
import { sleep } from "./durable-tapes-perf/time";
import type { ChromeLaunch, CliOptions } from "./durable-tapes-perf/types";

type ProbeOptions = {
  targetUrl: string;
  timeoutMs: number;
  browserPath?: string;
  cdpUrl?: string;
  headful: boolean;
};

type BrowserCheck = {
  ok: boolean;
  detail: string;
};

type ElementPoint = BrowserCheck & {
  x: number;
  y: number;
};

const HELP = `
Market Command drawer fixture browser probe

Usage:
  bun run scripts/probes/market-command-drawer-fixture.ts [options]

Options:
  --target-url <url>       Market Command root URL. Default: http://127.0.0.1:3000/
  --browser-path <path>    Chrome/Chromium executable. Defaults to PATH/known locations.
  --cdp-url <url>          Use an existing Chrome DevTools endpoint.
  --timeout <ms>           Wait timeout per assertion. Default: 15000
  --headful                Launch a visible browser.
  --help                   Show this help.
`;

const parseArgs = (args: string[]): ProbeOptions => {
  const options: ProbeOptions = {
    targetUrl: "http://127.0.0.1:3000/",
    timeoutMs: 15_000,
    headful: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP.trim());
      process.exit(0);
    }
    if (arg === "--headful") {
      options.headful = true;
      continue;
    }

    const inline = arg.match(/^(--[^=]+)=(.*)$/);
    const option = inline?.[1] ?? arg;
    const value = inline?.[2] ?? args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }
    if (!inline) {
      index += 1;
    }

    if (option === "--target-url") {
      options.targetUrl = value;
    } else if (option === "--browser-path") {
      options.browserPath = value;
    } else if (option === "--cdp-url") {
      options.cdpUrl = value;
    } else if (option === "--timeout") {
      const timeoutMs = Number(value);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid --timeout value: ${value}`);
      }
      options.timeoutMs = Math.round(timeoutMs);
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  return options;
};

const withFixtureQuery = (rawUrl: string): string => {
  const url = new URL(rawUrl);
  url.searchParams.set(MARKET_COMMAND_DRAWER_FIXTURE_PARAM, MARKET_COMMAND_DRAWER_FIXTURE_VALUE);
  return url.toString();
};

const toChromeOptions = (options: ProbeOptions): CliOptions => ({
  targetUrl: options.targetUrl,
  durationMs: 0,
  warmupMs: 0,
  cdpUrl: options.cdpUrl,
  browserPath: options.browserPath,
  headful: options.headful,
  failOnBudget: false,
  minVisibleRows: 0,
  minVisiblePanes: 0
});

const evaluate = async <T>(client: CdpClient, expression: string): Promise<T> => {
  const result = await client.send<{
    result: { value?: T; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Runtime evaluation failed."
    );
  }
  return result.result.value as T;
};

const waitForCheck = async (
  client: CdpClient,
  name: string,
  expression: string,
  timeoutMs: number
): Promise<BrowserCheck> => {
  const deadline = Date.now() + timeoutMs;
  let last: BrowserCheck = { ok: false, detail: "not checked" };
  while (Date.now() < deadline) {
    last = await evaluate<BrowserCheck>(client, expression);
    if (last.ok) {
      console.log(`pass: ${name}`);
      return last;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${name}: ${last.detail}`);
};

const textCheck = (text: string): string => `
(() => {
  const bodyText = document.body?.innerText ?? "";
  const fullText = document.body?.textContent ?? "";
  const drawerText = document.querySelector(".drawer")?.textContent ?? "";
  return {
    ok: bodyText.includes(${JSON.stringify(text)}) ||
      fullText.includes(${JSON.stringify(text)}) ||
      drawerText.includes(${JSON.stringify(text)}),
    detail: (drawerText || bodyText || fullText).slice(0, 400)
  };
})()
`;

const visibleSelectorCheck = (selector: string): string => `
(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) {
    return { ok: false, detail: "selector not found: ${selector}" };
  }
  const rect = element.getBoundingClientRect();
  return {
    ok: rect.width > 0 && rect.height > 0,
    detail: element.textContent?.trim().slice(0, 240) ?? ""
  };
})()
`;

const overflowCheck = (): string => `
(() => {
  const documentWidth = document.documentElement.scrollWidth;
  const viewportWidth = document.documentElement.clientWidth;
  const bodyWidth = document.body.scrollWidth;
  const bodyViewport = document.body.clientWidth;
  const ok = documentWidth <= viewportWidth + 1 && bodyWidth <= bodyViewport + 1;
  return {
    ok,
    detail: JSON.stringify({ documentWidth, viewportWidth, bodyWidth, bodyViewport })
  };
})()
`;

const pointForElement = (selector: string, text?: string): string => `
(() => {
  const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
  const element = elements.find((candidate) => {
    if (!(candidate instanceof HTMLElement)) {
      return false;
    }
    if (${JSON.stringify(text ?? null)} === null) {
      return true;
    }
    return (candidate.textContent ?? "").includes(${JSON.stringify(text ?? "")});
  });
  if (!(element instanceof HTMLElement)) {
    return {
      ok: false,
      detail: "target not found: ${selector}${text ? ` contains ${text}` : ""}",
      x: 0,
      y: 0
    };
  }
  element.scrollIntoView({ block: "center", inline: "center" });
  const rect = element.getBoundingClientRect();
  return {
    ok: rect.width > 0 && rect.height > 0 && !element.hasAttribute("disabled"),
    detail: element.textContent?.trim().slice(0, 240) ?? "",
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
})()
`;

const domClickElement = (selector: string, text?: string): string => `
(() => {
  const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
  const element = elements.find((candidate) => {
    if (!(candidate instanceof HTMLElement)) {
      return false;
    }
    if (${JSON.stringify(text ?? null)} === null) {
      return true;
    }
    return (candidate.textContent ?? "").includes(${JSON.stringify(text ?? "")});
  });
  if (!(element instanceof HTMLElement)) {
    return { ok: false, detail: "fallback target not found" };
  }
  element.click();
  if (element.classList.contains("durable-tape-row")) {
    element.focus();
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true
      })
    );
  }
  return {
    ok: true,
    detail: element.textContent?.trim().slice(0, 240) ?? ""
  };
})()
`;

const clickElement = async (
  client: CdpClient,
  name: string,
  selector: string,
  timeoutMs: number,
  text?: string
): Promise<void> => {
  const point = await waitForCheck(
    client,
    `target ${name}`,
    pointForElement(selector, text),
    timeoutMs
  );
  const { x, y } = point as ElementPoint;
  console.log(`target-detail: ${name}: ${point.detail}`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await evaluate<BrowserCheck>(client, domClickElement(selector, text));
  if (selector.includes("durable-tape-row")) {
    await evaluate<BrowserCheck>(
      client,
      `
(() => {
  const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
  const element = elements.find((candidate) => {
    if (!(candidate instanceof HTMLElement)) {
      return false;
    }
    if (${JSON.stringify(text ?? null)} === null) {
      return true;
    }
    return (candidate.textContent ?? "").includes(${JSON.stringify(text ?? "")});
  });
  if (!(element instanceof HTMLElement)) {
    return { ok: false, detail: "keyboard target not found" };
  }
  element.focus();
  return {
    ok: document.activeElement === element,
    detail: element.textContent?.trim().slice(0, 240) ?? ""
  };
})()
`
    );
    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
  }
  console.log(`click: ${name}`);
};

const closeDrawer = async (client: CdpClient, timeoutMs: number): Promise<void> => {
  await clickElement(client, "drawer close", ".drawer button", timeoutMs, "Close");
  await waitForCheck(
    client,
    "drawer closed",
    `
(() => {
  const drawer = document.querySelector(".drawer");
  return {
    ok: drawer === null,
    detail: drawer?.textContent?.trim().slice(0, 240) ?? ""
  };
})()
`,
    timeoutMs
  );
};

const runProbe = async (args = process.argv.slice(2)): Promise<void> => {
  const options = parseArgs(args);
  const targetUrl = withFixtureQuery(options.targetUrl);
  let launch: ChromeLaunch | null = null;
  let client: CdpClient | null = null;

  try {
    launch = await launchChrome(toChromeOptions(options));
    const pageWebSocket = await openPageWebSocket(launch.cdpHttpUrl);
    client = new CdpClient(pageWebSocket);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });

    console.log(`Navigating to ${targetUrl}`);
    await client.send("Page.navigate", { url: targetUrl });
    await waitForCheck(
      client,
      "Market Command fixture route",
      visibleSelectorCheck("[data-testid='market-command-layout']"),
      options.timeoutMs
    );
    await waitForCheck(
      client,
      "fixture marker probes",
      visibleSelectorCheck("[data-testid='market-command-fixture-smart-flow-marker']"),
      options.timeoutMs
    );

    await waitForCheck(client, "initial horizontal overflow", overflowCheck(), options.timeoutMs);

    await clickElement(
      client,
      "durable alert row",
      ".market-command-alerts-pane .durable-tape-row",
      options.timeoutMs
    );
    await waitForCheck(
      client,
      "durable alert drawer",
      textCheck("Durable alert row"),
      options.timeoutMs
    );
    await closeDrawer(client, options.timeoutMs);

    await clickElement(
      client,
      "news row",
      ".market-command-news-pane .durable-tape-row",
      options.timeoutMs,
      "Fixture News Opens Drawer"
    );
    await waitForCheck(
      client,
      "news drawer",
      textCheck("Fixture News Opens Drawer"),
      options.timeoutMs
    );
    await closeDrawer(client, options.timeoutMs);

    await clickElement(
      client,
      "smart-flow marker",
      "[data-testid='market-command-fixture-smart-flow-marker']",
      options.timeoutMs
    );
    await waitForCheck(
      client,
      "smart-flow drawer",
      textCheck("Smart-flow hypothesis"),
      options.timeoutMs
    );
    await closeDrawer(client, options.timeoutMs);

    await clickElement(
      client,
      "inferred-dark marker",
      "[data-testid='market-command-fixture-inferred-dark-marker']",
      options.timeoutMs
    );
    await waitForCheck(
      client,
      "inferred-dark drawer",
      textCheck("Inferred dark"),
      options.timeoutMs
    );
    await closeDrawer(client, options.timeoutMs);

    await clickElement(
      client,
      "option row",
      ".market-command-options-pane .durable-tape-row",
      options.timeoutMs,
      "Fixture Option"
    );
    await waitForCheck(client, "option row focus", textCheck("Contract:"), options.timeoutMs);

    await clickElement(
      client,
      "flow packet row",
      ".market-command-flow-pane .durable-tape-row",
      options.timeoutMs,
      "SPY-2026-07-17-550-C"
    );
    await waitForCheck(client, "flow packet focus", textCheck("Contract:"), options.timeoutMs);

    await waitForCheck(client, "final horizontal overflow", overflowCheck(), options.timeoutMs);
    console.log("Market Command drawer fixture probe passed.");
  } finally {
    client?.close();
    if (launch?.process) {
      launch.process.kill();
      await launch.process.exited.catch(() => undefined);
    }
    if (launch?.userDataDir) {
      await rm(launch.userDataDir, { recursive: true, force: true });
    }
  }
};

await runProbe();
