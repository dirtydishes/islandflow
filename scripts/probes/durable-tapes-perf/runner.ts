import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateBudgets } from "./budgets";
import { CdpClient, diffMetric, getPerformanceSnapshot } from "./cdp";
import { launchChrome, openPageWebSocket } from "./chrome";
import { parseArgs } from "./cli";
import {
  attachCollectors,
  createMetricWindow,
  evaluateSanity,
  serializeMetricWindow,
  waitForRoute
} from "./collector";
import { DEFAULT_DURATION_MS } from "./constants";
import { sleep } from "./time";
import type { ChromeLaunch } from "./types";

export const runDurableTapesPerfProbe = async (args = process.argv.slice(2)): Promise<void> => {
  const options = parseArgs(args);
  let launch: ChromeLaunch | null = null;
  let client: CdpClient | null = null;

  try {
    launch = await launchChrome(options);
    const pageWebSocket = await openPageWebSocket(launch.cdpHttpUrl);
    client = new CdpClient(pageWebSocket);
    await client.connect();

    let activeWindow = createMetricWindow("warmup");
    const warmupWindow = activeWindow;
    attachCollectors(client, () => activeWindow);

    await client.send("Page.enable");
    await client.send("Network.enable", {
      maxTotalBufferSize: 100_000_000,
      maxResourceBufferSize: 25_000_000
    });
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("Performance.enable", { timeDomain: "timeTicks" });
    await client.send("Runtime.enable");

    const startedAt = new Date().toISOString();
    console.log(`Navigating to ${options.targetUrl}`);
    await client.send("Page.navigate", { url: options.targetUrl });
    const initialSanity = await waitForRoute(client);
    console.log(
      `Route rendered: panes=${initialSanity.visibleDurablePaneCount}, rows=${initialSanity.visibleRowCount}`
    );

    if (options.warmupMs > 0) {
      console.log(`Warming up for ${Math.round(options.warmupMs / 1000)}s`);
      await sleep(options.warmupMs);
    }

    const measurementWindow = createMetricWindow("measurement");
    activeWindow = measurementWindow;
    const startPerformance = await getPerformanceSnapshot(client);
    console.log(`Measuring for ${Math.round(options.durationMs / 1000)}s`);
    await sleep(options.durationMs);
    const endPerformance = await getPerformanceSnapshot(client);
    const finalSanity = await evaluateSanity(client);
    const endedAt = new Date().toISOString();

    const measurementMetrics = serializeMetricWindow(measurementWindow);
    const cdpMetrics = {
      start: startPerformance,
      end: endPerformance,
      delta: {
        taskDurationSeconds: diffMetric(
          startPerformance.taskDurationSeconds,
          endPerformance.taskDurationSeconds
        ),
        scriptDurationSeconds: diffMetric(
          startPerformance.scriptDurationSeconds,
          endPerformance.scriptDurationSeconds
        ),
        jsHeapUsedSizeBytes: diffMetric(
          startPerformance.jsHeapUsedSizeBytes,
          endPerformance.jsHeapUsedSizeBytes
        ),
        domNodeCount: endPerformance.domNodeCount
      }
    };
    const budgetResults = evaluateBudgets({
      metrics: {
        ...measurementMetrics,
        taskDurationDeltaSeconds: cdpMetrics.delta.taskDurationSeconds,
        scriptDurationDeltaSeconds: cdpMetrics.delta.scriptDurationSeconds,
        jsHeapUsedSizeDeltaBytes: cdpMetrics.delta.jsHeapUsedSizeBytes,
        domNodeCount: cdpMetrics.delta.domNodeCount
      },
      sanity: finalSanity,
      durationMs: options.durationMs,
      minVisiblePanes: options.minVisiblePanes,
      minVisibleRows: options.minVisibleRows
    });
    const passed = budgetResults.every((result) => result.pass);

    const report = {
      schemaVersion: 1,
      probe: "durable-tapes-cdp",
      targetUrl: options.targetUrl,
      startedAt,
      endedAt,
      durationMs: options.durationMs,
      warmupMs: options.warmupMs,
      browser: {
        name: launch.browserName,
        cdp: options.cdpUrl ? "external" : "launched"
      },
      budgets: {
        profile: "durable-tapes-3m-v1",
        baseDurationMs: DEFAULT_DURATION_MS,
        failOnBudget: options.failOnBudget,
        passed,
        results: budgetResults
      },
      metrics: {
        ...measurementMetrics,
        cdp: cdpMetrics,
        sanity: finalSanity
      },
      warmupMetrics: serializeMetricWindow(warmupWindow),
      initialSanity
    };

    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.outputPath) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, json, "utf8");
      console.log(`Wrote ${options.outputPath}`);
    } else {
      console.log(json);
    }

    console.log(`Budget verdict: ${passed ? "pass" : "fail"}`);
    for (const result of budgetResults) {
      const marker = result.pass ? "pass" : "fail";
      console.log(
        `${marker}: ${result.name}: actual=${result.actual} limit=${result.limit} ${result.unit}`
      );
    }

    if (!passed && options.failOnBudget) {
      process.exitCode = 1;
    }
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
