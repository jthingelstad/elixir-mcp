/**
 * The What's new entries marked for everyone's Timeline (2026-11-23), as
 * the web API reads them: `[{ id, at, title, lede, path }]`, newest first.
 * Built by ../build.mjs from the entries' own files (the site's reader
 * parses and checks the mark), so the Markdown file stays the one source.
 *
 * Its own small file, not the corpus: Home reads it on every feed page, and
 * the corpus is over a megabyte. Read on first use, never at import, for
 * the reason src/index.mjs gives; the literal specifier lets esbuild inline
 * it into the bundle that imports this.
 */
let loaded;

export async function timelineUpdates() {
  loaded ??= (
    await import("../dist/timeline-updates.json", { with: { type: "json" } })
  ).default;
  return loaded;
}
