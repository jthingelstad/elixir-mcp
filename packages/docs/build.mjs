#!/usr/bin/env node
/**
 * Build the documentation corpus the MCP door serves.
 *
 * One source, two readers: apps/site renders these files as pages for a
 * person, and this turns the same files into dist/corpus.json for the
 * three read-only tools (elixir_docs, elixir_examples, elixir_updates)
 * so an agent can be asked how to use the service and answer from the
 * documentation itself. A second copy of the docs kept for agents would
 * drift from the pages within a week; a corpus built from the pages
 * cannot.
 *
 * Generated, never committed: dist/ is ignored, and the root build runs
 * this before anything bundles or tests.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "../../apps/site/src");
const SITE_URL = "https://elixir.poapkings.com";

// The same renderer the site's text bundle uses: a doc's Nunjucks
// variables resolve against the same data, so an agent reads the
// number where a person reads the number.
const { renderDoc, docContext } = await import(
  path.join(site, "_lib/doc-render.mjs")
);
const ctx = await docContext();

/** Site-relative links become absolute: a corpus read over MCP has no
 *  origin to resolve "/docs/tools" against. */
const absolute = (md) =>
  md.replace(/\]\((\/[^)\s]*)\)/g, (_, p) => `](${SITE_URL}${p})`);

/** The page H1 duplicates `title`, which every reader prints itself. */
const withoutLeadingH1 = (md) => md.replace(/^\s*# [^\n]*\n+/, "");

/** Inline <svg> blocks leave the corpus: an agent asking for the
 *  architecture page was reading fifty lines of path data (review 1.3).
 *  The diagram's aria-label, the one sentence written for a reader who
 *  cannot see it, stays as a line of text. */
const withoutSvg = (md) =>
  md.replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/g, (_, attrs) => {
    const label = /aria-label="([^"]*)"/.exec(attrs)?.[1];
    return label ? `[Diagram: ${label}]` : "";
  });

/** The H2 sections of a page, each with its slug (the site's heading
 *  id) and its own Markdown, so a reader can pull one section. */
function sections(md) {
  const out = [];
  const lines = md.split("\n");
  let cur = null;
  for (const line of lines) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      cur = { title: h[1].trim(), slug: slugOf(h[1]), markdown: "" };
      out.push(cur);
    } else if (cur) cur.markdown += line + "\n";
  }
  return out.map((s) => ({ ...s, markdown: s.markdown.trim() }));
}
/** GitHub-style heading slugs, the shape the code's docs pointers use
 *  (docsRef("recording", "the-games-own-last-seen")): lower-case, inline
 *  markup and quotation stripped, every other non-alphanumeric run a
 *  single hyphen, trimmed. The site's renderer (apps/site/eleventy.config.mjs)
 *  is the same on every heading without punctuation; keep H2 titles free
 *  of apostrophes and quotes and the two never disagree. */
const slugOf = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_'"\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Front matter as a flat object; the body as Markdown. */
function parse(md) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) return { data: {}, body: md };
  const data = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
    else if (/^\[.*\]$/.test(v))
      v = v
        .slice(1, -1)
        .split(",")
        .map((x) => x.trim().replace(/^"|"$/g, ""));
    else if (/^\d+$/.test(v)) v = Number(v);
    data[kv[1]] = v;
  }
  return { data, body: md.slice(m[0].length).trim() };
}

const SECTIONS = {
  start: "Start here",
  using: "Using it",
  record: "The record",
  policy: "Policy",
};

const docs = readdirSync(path.join(site, "docs"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const { data, body } = parse(
      readFileSync(path.join(site, "docs", f), "utf8"),
    );
    // Every page opens with an H1 equal to its title, which readers
    // (resources/read, elixir_docs) already print from `title`; keeping
    // it in `markdown` had every page read back with the heading twice.
    const markdown = withoutLeadingH1(
      withoutSvg(absolute(renderDoc(body, ctx))),
    );
    // The index an agent reads shows the lede; a slogan-length lede
    // ("The short version: ...") says nothing about what the page
    // answers, so a lede under 40 characters yields to the description.
    const lede = String(data.lede ?? "");
    return {
      slug: data.slug,
      title: data.title,
      section: SECTIONS[data.section] ?? data.section,
      order: data.order ?? 0,
      lede: lede.length >= 40 ? lede : (data.description ?? lede),
      description: data.description ?? "",
      url: `${SITE_URL}/docs/${data.slug}`,
      markdown,
      sections: sections(markdown),
    };
  })
  .sort((a, b) => a.order - b.order);

const { default: examples } = await import(
  path.join(site, "_data/examples.js")
);
const { default: updates } = await import(path.join(site, "_data/updates.js"));

const corpus = {
  built_at: new Date().toISOString(),
  docs,
  examples: examples.flatMap((g) =>
    g.cases.map((c) => ({
      slug: c.key,
      group: g.group,
      label: c.label,
      title: c.title,
      lede: c.lede,
      url: `${SITE_URL}/examples/${c.key}`,
      reads: c.reads,
      setup: c.setup,
      tools: String(c.script?.tool ?? "")
        .split("·")
        .map((t) => t.trim())
        .filter(Boolean),
      transcript: (c.script?.lines ?? []).map((l) => ({
        role: l.role,
        text: l.text,
        ...(l.cite ? { cite: l.cite } : {}),
      })),
    })),
  ),
  updates: updates.map((u) => ({
    date: u.date,
    title: u.title,
    body: u.body,
  })),
};

mkdirSync(path.join(here, "dist"), { recursive: true });
writeFileSync(
  path.join(here, "dist/corpus.json"),
  JSON.stringify(corpus, null, 2),
);
console.log(
  `docs corpus: ${corpus.docs.length} pages, ${corpus.examples.length} examples, ${corpus.updates.length} updates`,
);
