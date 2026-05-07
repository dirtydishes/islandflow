import { readFile } from "node:fs/promises";
import path from "node:path";

type DependencyMap = Record<string, string>;

type LockWorkspace = {
  name?: string;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
};

type BunLock = {
  lockfileVersion?: number;
  configVersion?: number;
  workspaces?: Record<string, LockWorkspace>;
  packages?: Record<string, unknown>;
};

type RootPackageManifest = {
  workspaces?: string[];
};

const repoRoot = path.resolve(import.meta.dir, "..");
const deploymentRoot = path.join(repoRoot, "deployment/docker/workspace-root");

const rootPackagePath = path.join(repoRoot, "package.json");
const deploymentPackagePath = path.join(deploymentRoot, "package.json");
const rootTsconfigPath = path.join(repoRoot, "tsconfig.base.json");
const deploymentTsconfigPath = path.join(deploymentRoot, "tsconfig.base.json");
const rootLockPath = path.join(repoRoot, "bun.lock");
const deploymentLockPath = path.join(deploymentRoot, "bun.lock");

const readUtf8 = async (filePath: string): Promise<string> => {
  return readFile(filePath, "utf8");
};

const parseObjectLiteral = async <T>(filePath: string): Promise<T> => {
  const raw = await readUtf8(filePath);
  try {
    const parsed = Function(`"use strict"; return (${raw});`)() as T;
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${filePath}: ${message}`);
  }
};

const stableSortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stableSortObject(nested)] as const);
    return Object.fromEntries(entries);
  }
  return value;
};

const stableStringify = (value: unknown): string => {
  return JSON.stringify(stableSortObject(value));
};

const listWorkspacePaths = async (workspacePatterns: string[]): Promise<string[]> => {
  const paths = new Set<string>();

  for (const pattern of workspacePatterns) {
    const globPattern = pattern.endsWith("/") ? `${pattern}package.json` : `${pattern}/package.json`;
    const glob = new Bun.Glob(globPattern);
    for await (const match of glob.scan({ cwd: repoRoot })) {
      const normalized = match.replaceAll("\\", "/");
      paths.add(path.posix.dirname(normalized));
    }
  }

  return Array.from(paths).sort((a, b) => a.localeCompare(b));
};

const normalizedDependencyMap = (input: DependencyMap | undefined): DependencyMap => {
  if (!input) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, version]) => [name, version])
  );
};

const formatDependencyDiff = (
  workspacePath: string,
  section: string,
  expected: DependencyMap,
  actual: DependencyMap
): string[] => {
  const issues: string[] = [];
  const expectedKeys = new Set(Object.keys(expected));
  const actualKeys = new Set(Object.keys(actual));

  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) {
      issues.push(`${workspacePath} ${section}: missing ${key}@${expected[key]}`);
      continue;
    }
    if (expected[key] !== actual[key]) {
      issues.push(
        `${workspacePath} ${section}: ${key} expected ${expected[key]} but found ${actual[key]}`
      );
    }
  }

  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      issues.push(`${workspacePath} ${section}: extra ${key}@${actual[key]}`);
    }
  }

  return issues;
};

const check = async (): Promise<number> => {
  const issues: string[] = [];

  const [rootPackage, deploymentPackage, rootTsconfig, deploymentTsconfig, rootLock, deploymentLock] =
    await Promise.all([
      parseObjectLiteral<RootPackageManifest>(rootPackagePath),
      parseObjectLiteral(deploymentPackagePath),
      parseObjectLiteral(rootTsconfigPath),
      parseObjectLiteral(deploymentTsconfigPath),
      parseObjectLiteral<BunLock>(rootLockPath),
      parseObjectLiteral<BunLock>(deploymentLockPath)
    ]);

  const rootPackageSnapshot = stableStringify(rootPackage);
  const deploymentPackageSnapshot = stableStringify(deploymentPackage);
  if (rootPackageSnapshot !== deploymentPackageSnapshot) {
    issues.push(
      "deployment/docker/workspace-root/package.json does not match repo-root package.json"
    );
  }

  const rootTsconfigSnapshot = stableStringify(rootTsconfig);
  const deploymentTsconfigSnapshot = stableStringify(deploymentTsconfig);
  if (rootTsconfigSnapshot !== deploymentTsconfigSnapshot) {
    issues.push(
      "deployment/docker/workspace-root/tsconfig.base.json does not match repo-root tsconfig.base.json"
    );
  }

  const rootWorkspaces = rootLock.workspaces ?? {};
  const deploymentWorkspaces = deploymentLock.workspaces ?? {};

  const workspacePatterns = rootPackage.workspaces ?? [];
  const workspacePackagePaths = await listWorkspacePaths(workspacePatterns);
  for (const workspacePath of workspacePackagePaths) {
    const packageJsonPath = path.join(repoRoot, workspacePath, "package.json");
    const workspacePackage = (await parseObjectLiteral(packageJsonPath)) as LockWorkspace;
    const deploymentWorkspace = deploymentWorkspaces[workspacePath];

    if (!deploymentWorkspace) {
      issues.push(`deployment lock is missing workspace entry: ${workspacePath}`);
      continue;
    }

    const sections: Array<keyof LockWorkspace> = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies"
    ];
    for (const section of sections) {
      const expectedMap = normalizedDependencyMap(workspacePackage[section] as DependencyMap | undefined);
      const actualMap = normalizedDependencyMap(
        deploymentWorkspace[section] as DependencyMap | undefined
      );
      issues.push(...formatDependencyDiff(workspacePath, section, expectedMap, actualMap));
    }
  }

  const workspacePaths = Array.from(
    new Set([...Object.keys(rootWorkspaces), ...Object.keys(deploymentWorkspaces)])
  ).sort((a, b) => a.localeCompare(b));

  for (const workspacePath of workspacePaths) {
    const rootWorkspace = rootWorkspaces[workspacePath];
    const deploymentWorkspace = deploymentWorkspaces[workspacePath];

    if (!rootWorkspace) {
      issues.push(`deployment lock has unexpected workspace entry: ${workspacePath}`);
      continue;
    }
    if (!deploymentWorkspace) {
      issues.push(`deployment lock is missing workspace entry: ${workspacePath}`);
      continue;
    }

    if ((rootWorkspace.name ?? "") !== (deploymentWorkspace.name ?? "")) {
      issues.push(
        `${workspacePath} name mismatch: expected ${rootWorkspace.name ?? "(none)"} but found ${
          deploymentWorkspace.name ?? "(none)"
        }`
      );
    }

    const sections: Array<keyof LockWorkspace> = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies"
    ];
    for (const section of sections) {
      const expectedMap = normalizedDependencyMap(rootWorkspace[section] as DependencyMap | undefined);
      const actualMap = normalizedDependencyMap(
        deploymentWorkspace[section] as DependencyMap | undefined
      );
      issues.push(...formatDependencyDiff(workspacePath, section, expectedMap, actualMap));
    }
  }

  const rootPackagesSnapshot = stableStringify(rootLock.packages ?? {});
  const deploymentPackagesSnapshot = stableStringify(deploymentLock.packages ?? {});
  if (rootPackagesSnapshot !== deploymentPackagesSnapshot) {
    issues.push(
      "deployment/docker/workspace-root/bun.lock package resolutions differ from repo-root bun.lock"
    );
  }

  if (issues.length > 0) {
    console.error("Docker workspace snapshot is out of sync:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    console.error("Run: bun run sync:docker-workspace");
    return 1;
  }

  console.log("Docker workspace snapshot is in sync.");
  return 0;
};

process.exitCode = await check();
