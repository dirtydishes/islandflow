import { copyFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const deploymentRoot = path.join(repoRoot, "deployment/docker/workspace-root");

const filesToSync = ["package.json", "bun.lock", "tsconfig.base.json"] as const;

for (const fileName of filesToSync) {
  const source = path.join(repoRoot, fileName);
  const destination = path.join(deploymentRoot, fileName);
  await copyFile(source, destination);
  console.log(`synced ${fileName}`);
}
