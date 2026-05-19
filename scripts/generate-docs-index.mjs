import { promises as fs } from "node:fs";
import path from "node:path";

const docsDir = path.resolve(process.cwd(), "docs");
const outputFile = path.join(docsDir, "index.html");

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function docsHref(relativePath) {
  const encoded = relativePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `./${encoded}`;
}

async function collectDocsFiles(rootDir, currentDir = rootDir, acc = []) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sortedEntries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");

    if (relativePath === "index.html") {
      continue;
    }

    if (entry.isDirectory()) {
      await collectDocsFiles(rootDir, absolutePath, acc);
      continue;
    }

    if (entry.isFile()) {
      const stats = await fs.stat(absolutePath);

      acc.push({
        relativePath,
        category: relativePath.includes("/") ? relativePath.split("/")[0] : "root",
        sizeBytes: stats.size,
        modifiedAt: stats.mtime,
      });
    }
  }

  return acc;
}

function groupByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.category)) {
      groups.set(item.category, []);
    }
    groups.get(item.category).push(item);
  }
  return groups;
}

function sortedCategories(groups) {
  const preferredOrder = ["turns", "daily-git", "general", "plans", "root"];
  const groupNames = [...groups.keys()];
  return groupNames.sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);

    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }

    return a.localeCompare(b);
  });
}

function renderDocument(items) {
  const sortedItems = [...items].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  const groups = groupByCategory(sortedItems);
  const categories = sortedCategories(groups);
  const totalCount = sortedItems.length;

  const categoryChips = categories
    .map((category) => {
      const count = groups.get(category).length;
      return `<a class="chip" href="#category-${escapeHtml(category)}">${escapeHtml(
        category
      )} <span>${count}</span></a>`;
    })
    .join("\n");

  const groupsMarkup = categories
    .map((category) => {
      const entries = groups.get(category);
      const entryMarkup = entries
        .map((entry) => {
          const extension = path.extname(entry.relativePath).replace(".", "") || "file";
          const searchable = `${entry.relativePath} ${category}`.toLowerCase();
          return `
            <li class="doc-item" data-search="${escapeHtml(searchable)}">
              <a class="doc-link" href="${docsHref(entry.relativePath)}">${escapeHtml(
                entry.relativePath
              )}</a>
              <div class="meta">
                <span class="tag">${escapeHtml(extension)}</span>
                <span>${escapeHtml(formatBytes(entry.sizeBytes))}</span>
                <span>${escapeHtml(dateFormatter.format(entry.modifiedAt))}</span>
              </div>
            </li>
          `;
        })
        .join("\n");

      return `
        <section class="group" id="category-${escapeHtml(category)}">
          <h2>${escapeHtml(category)} <span>${entries.length}</span></h2>
          <ul class="doc-list">
            ${entryMarkup}
          </ul>
        </section>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Islandflow Docs</title>
    <style>
      :root {
        --bg: #f4f6f8;
        --surface: #ffffff;
        --surface-muted: #e8edf2;
        --text: #1a2433;
        --muted: #5b6a80;
        --border: #ccd5df;
        --accent: #0f766e;
        --accent-soft: #d1fae5;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top right, #e2f8f2, var(--bg) 35%);
        color: var(--text);
      }

      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 32px 16px 48px;
      }

      .header {
        display: grid;
        gap: 12px;
      }

      h1 {
        margin: 0;
        font-size: clamp(1.8rem, 2.3vw, 2.4rem);
        font-weight: 760;
      }

      .subtitle {
        margin: 0;
        color: var(--muted);
        max-width: 60ch;
      }

      .toolbar {
        margin-top: 10px;
        padding: 14px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        display: grid;
        gap: 12px;
      }

      .stats {
        font-size: 0.95rem;
        color: var(--muted);
      }

      .search {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 8px;
        font: inherit;
        font-size: 1rem;
        padding: 10px 12px;
        background: #fff;
      }

      .search:focus {
        outline: 2px solid color-mix(in srgb, var(--accent) 30%, white);
        outline-offset: 0;
        border-color: var(--accent);
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .chip {
        text-decoration: none;
        color: var(--text);
        background: var(--surface-muted);
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.85rem;
        border: 1px solid transparent;
      }

      .chip span {
        color: var(--muted);
      }

      .chip:hover {
        border-color: var(--accent);
      }

      .groups {
        margin-top: 20px;
        display: grid;
        gap: 16px;
      }

      .group {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        padding: 14px;
      }

      .group.hidden {
        display: none;
      }

      .group h2 {
        margin: 0 0 10px;
        font-size: 1.1rem;
      }

      .group h2 span {
        color: var(--muted);
        font-weight: 520;
      }

      .doc-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }

      .doc-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 6px;
      }

      .doc-item.hidden {
        display: none;
      }

      .doc-item:hover {
        background: #f5faf8;
      }

      .doc-link {
        color: var(--text);
        text-decoration: none;
        font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 0.92rem;
        overflow-wrap: anywhere;
      }

      .doc-link:hover {
        color: var(--accent);
        text-decoration: underline;
      }

      .meta {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--muted);
        font-size: 0.82rem;
        white-space: nowrap;
      }

      .tag {
        background: var(--accent-soft);
        color: #065f46;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 0.78rem;
      }

      .empty {
        margin-top: 20px;
        border: 1px dashed var(--border);
        border-radius: 8px;
        background: var(--surface);
        color: var(--muted);
        padding: 20px;
        text-align: center;
        display: none;
      }
    </style>
  </head>
  <body>
    <main>
      <header class="header">
        <h1>Islandflow docs index</h1>
        <p class="subtitle">A browsable index of files under <code>docs/</code> with filtering and grouped navigation.</p>
      </header>

      <section class="toolbar">
        <div class="stats"><strong id="visible-count">${totalCount}</strong> of <strong>${totalCount}</strong> files shown</div>
        <input id="doc-search" class="search" type="search" placeholder="Filter by filename or folder..." autocomplete="off" />
        <nav class="chips">${categoryChips}</nav>
      </section>

      <section class="groups" id="groups">${groupsMarkup}</section>
      <p class="empty" id="empty-state">No files match that filter.</p>
    </main>

    <script>
      const searchInput = document.getElementById("doc-search");
      const items = Array.from(document.querySelectorAll(".doc-item"));
      const groups = Array.from(document.querySelectorAll(".group"));
      const visibleCount = document.getElementById("visible-count");
      const emptyState = document.getElementById("empty-state");

      function applyFilter(query) {
        const normalized = query.trim().toLowerCase();
        let shown = 0;

        for (const item of items) {
          const searchable = item.dataset.search || "";
          const isVisible = normalized.length === 0 || searchable.includes(normalized);
          item.classList.toggle("hidden", !isVisible);
          if (isVisible) shown += 1;
        }

        for (const group of groups) {
          const hasVisibleItems = group.querySelector(".doc-item:not(.hidden)") !== null;
          group.classList.toggle("hidden", !hasVisibleItems);
        }

        visibleCount.textContent = String(shown);
        emptyState.style.display = shown === 0 ? "block" : "none";
      }

      searchInput.addEventListener("input", () => applyFilter(searchInput.value));
      applyFilter("");
    </script>
  </body>
</html>
`;
}

async function main() {
  const files = await collectDocsFiles(docsDir);
  const html = renderDocument(files);
  await fs.writeFile(outputFile, html, "utf8");
  console.log(`Generated ${outputFile} with ${files.length} entries.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
