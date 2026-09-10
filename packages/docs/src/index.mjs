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

/** Query terms: lower-case words of two or more characters. */
const terms = (q) =>
  String(q ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);

/** Every index of `needle` in `hay` (both lower-case). */
function positions(hay, needle) {
  const out = [];
  let at = hay.indexOf(needle);
  while (at !== -1) {
    out.push(at);
    at = hay.indexOf(needle, at + needle.length);
  }
  return out;
}

/**
 * Search the pages.
 *
 * Tokenized, not exact-substring: "pilot score minimum battles" used
 * to return nothing because no page contains that phrase, and an agent
 * concluded the docs did not cover it (Claude, 2026-09-10). Now the
 * words are matched separately; pages holding EVERY word rank first,
 * and if none does the search degrades to ANY word and says so in
 * `fallback`. The excerpt is cut around the densest window of hits,
 * not the first one, so "Pilot Score" shows the formula rather than
 * the lede.
 */
export function searchDocs(query, limit = 5) {
  const words = terms(query);
  if (words.length === 0) return { matches: [], fallback: false };
  const scored = [];
  for (const d of DOCS) {
    const hay = `${d.title}\n${d.lede}\n${d.markdown}`;
    const lower = hay.toLowerCase();
    const hitsPerWord = words.map((w) => positions(lower, w));
    const wordsHit = hitsPerWord.filter((p) => p.length > 0).length;
    if (wordsHit === 0) continue;
    const all = hitsPerWord.flat().sort((a, b) => a - b);
    // The densest 320-character window over all hits.
    let best = { at: all[0], count: 0 };
    for (let i = 0; i < all.length; i++) {
      let j = i;
      while (j + 1 < all.length && all[j + 1] - all[i] <= 320) j += 1;
      if (j - i + 1 > best.count) best = { at: all[i], count: j - i + 1 };
    }
    const start = Math.max(0, best.at - 100);
    const excerpt = hay
      .slice(start, best.at + 300)
      .replace(/\s+/g, " ")
      .trim();
    scored.push({
      slug: d.slug,
      title: d.title,
      section: d.section,
      words_matched: wordsHit,
      hits: all.length,
      excerpt,
      // The H2 the best window falls in, so a follow-up can ask for it.
      in_section: sectionAt(d, hay, best.at),
    });
  }
  const full = scored.filter((s) => s.words_matched === words.length);
  const pool = full.length > 0 ? full : scored;
  pool.sort((a, b) => b.words_matched - a.words_matched || b.hits - a.hits);
  return { matches: pool.slice(0, limit), fallback: full.length === 0 };
}

/** Which H2 section of `d` the character offset `at` (in the search
 *  haystack) falls in, by walking the sections in order. */
function sectionAt(d, hay, at) {
  const head = hay.length - d.markdown.length; // title + lede prefix
  const pos = at - head;
  let cursor = 0;
  let found = null;
  for (const s of d.sections ?? []) {
    const idx = d.markdown.indexOf(`## ${s.title}`, cursor);
    if (idx === -1) continue;
    if (pos >= idx) found = s.slug;
    cursor = idx + 1;
  }
  return found;
}
