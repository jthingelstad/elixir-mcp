/**
 * Every docs pointer a tool emits resolves to a page and a section that
 * exist in the built corpus (docs/ENGINEERING.md, "Tool conventions").
 *
 * A `docs: "battles#deck-identity-and-forms"` on a response is a promise
 * that elixir_docs({ page, section }) and elixir://docs/battles#... will
 * answer. Pointers are string literals in the tool modules, so the source
 * text is scanned rather than every handler executed: docsRef("page",
 * "section"), docsRef("page"), and `const X_DOCS = "page#section"`.
 * Run after `npm run build` (the corpus is generated).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS } from "@elixir-mcp/docs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../src");

/** Every tool module, including a split family's own directory
 *  (tools/battles/*.mjs since 2026-09-23). */
function toolModules(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...toolModules(full));
    else if (entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs"))
      out.push(full);
  }
  return out;
}
const files = toolModules(path.join(src, "tools"));
/** A split family's index (tools/battles.mjs beside tools/battles/) only
 *  assembles the tools; its files carry the pointers. */
const isSplitIndex = (file) =>
  existsSync(file.replace(/\.mjs$/, "")) &&
  statSync(file.replace(/\.mjs$/, "")).isDirectory();

/** [{ file, page, section|null, literal }] for every pointer in the source. */
function pointers() {
  const out = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = path.relative(src, file);
    for (const m of text.matchAll(
      /docsRef\(\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?\s*\)/g,
    ))
      out.push({ file: rel, page: m[1], section: m[2] ?? null, literal: m[0] });
    for (const m of text.matchAll(/const\s+\w+_DOCS\s*=\s*"([^"#]+)#([^"]+)"/g))
      out.push({ file: rel, page: m[1], section: m[2], literal: m[0] });
  }
  return out;
}

test("docs pointers: the source declares some, in every tool module", () => {
  const found = pointers();
  assert.ok(found.length >= 30, `only ${found.length} pointers found`);
  // The rule is per tool MODULE as it stood before the split: a family
  // split into tools/<family>/ answers as one module, since not every
  // tool emits a pointer (elixir_docs is the docs).
  const moduleOf = (rel) => rel.replace(/^(tools\/[^/]+)\/[^/]+\.mjs$/, "$1");
  const modulesWithPointers = new Set(found.map((p) => moduleOf(p.file)));
  for (const file of files) {
    const rel = path.relative(src, file);
    if (rel === "tools/shared.mjs" || rel === "tools/synergy.mjs") continue;
    if (isSplitIndex(file)) continue;
    assert.ok(
      modulesWithPointers.has(moduleOf(rel)),
      `${moduleOf(rel)} emits no docs pointer`,
    );
  }
});

test("docs pointers: every page and section a tool names exists in the corpus", () => {
  const pages = new Map(DOCS.map((d) => [d.slug, d]));
  const misses = [];
  for (const p of pointers()) {
    const doc = pages.get(p.page);
    if (!doc) {
      misses.push(`${p.file}: ${p.literal} -> no page "${p.page}"`);
      continue;
    }
    if (p.section && !doc.sections.some((s) => s.slug === p.section))
      misses.push(
        `${p.file}: ${p.literal} -> "${p.page}" has no section "${p.section}" (has: ${doc.sections.map((s) => s.slug).join(", ")})`,
      );
  }
  assert.deepEqual(misses, []);
});

test("docs pointers: the shared segment pointer resolves", async () => {
  const { SEGMENT_DOCS } = await import("../src/tools/shared.mjs");
  for (const ref of [SEGMENT_DOCS]) {
    const [page, section] = ref.split("#");
    const doc = DOCS.find((d) => d.slug === page);
    assert.ok(doc, `${ref}: no page`);
    assert.ok(
      doc.sections.some((s) => s.slug === section),
      `${ref}: no section`,
    );
  }
});
