#!/usr/bin/env bun

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const workspaceRoots = ["apps", "services", "packages"];

const findTsconfigs = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const tsconfigs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspacePath = join(dir, entry.name);
    const tsconfigPath = join(workspacePath, "tsconfig.json");

    if (statSync(tsconfigPath, { throwIfNoEntry: false })?.isFile()) {
      tsconfigs.push(tsconfigPath);
    }
  }

  return tsconfigs;
};

const tsconfigs = workspaceRoots.flatMap((root) => findTsconfigs(root)).sort();

if (tsconfigs.length === 0) {
  console.log("No workspace tsconfig.json files found.");
  process.exit(0);
}

let failed = false;
const bunExecutable = process.execPath;

for (const tsconfig of tsconfigs) {
  const label = relative(process.cwd(), tsconfig);
  console.log(`\nTypechecking ${label}`);

  const result = Bun.spawnSync(
    [
      bunExecutable,
      "x",
      "tsc",
      "-p",
      tsconfig,
      "--noEmit",
      "--incremental",
      "false",
      "--pretty",
      "false"
    ],
    {
      stdout: "inherit",
      stderr: "inherit"
    }
  );

  if (result.exitCode !== 0) {
    failed = true;
  }
}

if (failed) {
  console.error("\nTypecheck failed.");
  process.exit(1);
}

console.log("\nTypecheck passed.");
