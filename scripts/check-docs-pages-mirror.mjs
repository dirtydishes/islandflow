import { promises as fs } from "node:fs";
import path from "node:path";

const ignoredNames = new Set([".DS_Store"]);

function parseArgs(argv) {
  const options = {
    source: "docs",
    payload: "site",
    published: "",
    expectedDocsUrl: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (!(key in options)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options[key] = value;
    index += 1;
  }

  return options;
}

async function assertDirectory(directory, label) {
  const stats = await fs.stat(directory).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`${label} directory is missing: ${directory}`);
  }
}

async function assertFile(filePath, label) {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`${label} file is missing: ${filePath}`);
  }
}

async function collectFiles(rootDir, currentDir = rootDir, files = []) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      await collectFiles(rootDir, absolutePath, files);
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function assertSameFile(sourceFile, mirrorFile, relativePath, label) {
  const [sourceBytes, mirrorBytes] = await Promise.all([
    fs.readFile(sourceFile),
    fs.readFile(mirrorFile).catch(() => null)
  ]);

  if (!mirrorBytes) {
    throw new Error(`${label} is missing ${relativePath}`);
  }

  if (!sourceBytes.equals(mirrorBytes)) {
    throw new Error(`${label} differs from docs/ for ${relativePath}`);
  }
}

async function assertMirror(sourceDir, mirrorDir, label) {
  await assertDirectory(sourceDir, "Source docs");
  await assertDirectory(mirrorDir, label);

  const [sourceFiles, mirrorFiles] = await Promise.all([
    collectFiles(sourceDir),
    collectFiles(mirrorDir)
  ]);

  if (sourceFiles.length === 0) {
    throw new Error("Source docs directory is empty; refusing to publish an empty docs mirror.");
  }

  const sourceSet = new Set(sourceFiles);
  const mirrorSet = new Set(mirrorFiles);
  const missing = sourceFiles.filter((file) => !mirrorSet.has(file));
  const extra = mirrorFiles.filter((file) => !sourceSet.has(file));

  if (missing.length > 0) {
    throw new Error(`${label} is missing docs files: ${missing.join(", ")}`);
  }

  if (extra.length > 0) {
    throw new Error(`${label} has stale files not present in docs/: ${extra.join(", ")}`);
  }

  await Promise.all(
    sourceFiles.map((relativePath) =>
      assertSameFile(
        path.join(sourceDir, relativePath),
        path.join(mirrorDir, relativePath),
        relativePath,
        label
      )
    )
  );

  return sourceFiles.length;
}

async function assertRedirect(indexFile, expectedDocsUrl, label) {
  await assertFile(indexFile, `${label} redirect`);

  if (!expectedDocsUrl) {
    return;
  }

  const html = await fs.readFile(indexFile, "utf8");
  if (!html.includes(expectedDocsUrl)) {
    throw new Error(`${label} redirect does not point at ${expectedDocsUrl}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(options.source);
  const payloadDir = path.resolve(options.payload);
  const payloadDocsDir = path.join(payloadDir, "docs");
  const payloadCount = await assertMirror(sourceDir, payloadDocsDir, "Prepared payload docs");

  await assertRedirect(
    path.join(payloadDir, "index.html"),
    options.expectedDocsUrl,
    "Prepared payload"
  );
  await assertFile(path.join(payloadDir, ".nojekyll"), "Prepared payload .nojekyll");

  if (options.published) {
    const publishedDir = path.resolve(options.published);
    const publishedCount = await assertMirror(
      sourceDir,
      path.join(publishedDir, "docs"),
      "Published Pages docs"
    );

    await assertRedirect(
      path.join(publishedDir, "index.html"),
      options.expectedDocsUrl,
      "Published Pages"
    );
    console.log(
      `Verified ${publishedCount} docs files in published Pages mirror at ${path.relative(
        process.cwd(),
        publishedDir
      )}/docs.`
    );
  }

  console.log(
    `Verified ${payloadCount} docs files in prepared payload at ${path.relative(process.cwd(), payloadDocsDir)}.`
  );
}

main().catch((error) => {
  console.error(`Docs Pages mirror check failed: ${error.message}`);
  process.exitCode = 1;
});
