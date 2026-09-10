/**
 * The documentation corpus, as the MCP door reads it. Built by
 * ../build.mjs from apps/site's own sources (docs Markdown, examples,
 * updates), so what an agent reads here is what a person reads on the
 * site — one source, never a second copy.
 */
import corpus from "../dist/corpus.json" with { type: "json" };

export const DOCS = corpus.docs;
export const EXAMPLES = corpus.examples;
export const UPDATES = corpus.updates;
export const CORPUS_BUILT_AT = corpus.built_at;

/** Case-insensitive substring search over a page's title, lede and
 *  body; returns the pages that match with a short excerpt around the
 *  first hit, best (most hits) first. */
export function searchDocs(query, limit = 5) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const d of DOCS) {
    const hay = `${d.title}\n${d.lede}\n${d.markdown}`;
    const lower = hay.toLowerCase();
    let count = 0;
    let at = lower.indexOf(q);
    const first = at;
    while (at !== -1) {
      count += 1;
      at = lower.indexOf(q, at + q.length);
    }
    if (count === 0) continue;
    const start = Math.max(0, first - 120);
    const excerpt = hay
      .slice(start, first + q.length + 160)
      .replace(/\s+/g, " ")
      .trim();
    hits.push({
      slug: d.slug,
      title: d.title,
      section: d.section,
      hits: count,
      excerpt,
    });
  }
  return hits.sort((a, b) => b.hits - a.hits).slice(0, limit);
}
