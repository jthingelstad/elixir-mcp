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
    return {
      slug: data.slug,
      title: data.title,
      section: SECTIONS[data.section] ?? data.section,
      order: data.order ?? 0,
      lede: data.lede ?? data.description ?? "",
      description: data.description ?? "",
      url: `https://elixir.poapkings.com/docs/${data.slug}`,
      markdown: body,
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
      url: `https://elixir.poapkings.com/examples/${c.key}`,
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
