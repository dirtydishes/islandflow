#!/usr/bin/env bun

import { runDurableTapesPerfProbe } from "./durable-tapes-perf/runner";

runDurableTapesPerfProbe().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
