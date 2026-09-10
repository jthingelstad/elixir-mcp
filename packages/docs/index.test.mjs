import { test } from "node:test";
import assert from "node:assert/strict";
import { DOCS, EXAMPLES, UPDATES, searchDocs } from "./src/index.mjs";

test("the corpus carries every docs page, all eleven examples and the updates", () => {
  assert.ok(DOCS.length >= 16, `only ${DOCS.length} docs pages`);
  assert.ok(DOCS.every((d) => d.slug && d.title && d.markdown.length > 100));
  assert.equal(EXAMPLES.length, 11);
  assert.ok(
    EXAMPLES.every((e) => e.transcript.length >= 2 && e.tools.length >= 1),
  );
  assert.ok(UPDATES.length > 10);
  assert.ok(UPDATES.every((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.date)));
});

test("a doc's variables are rendered and its links are absolute", () => {
  // An agent read "{{ statistics.meta.prior_strength }}" where a person
  // read the number, and "/docs/tools" with nothing to resolve it against.
  for (const d of DOCS) {
    assert.ok(
      !d.markdown.includes("{{"),
      `${d.slug} still has a template variable`,
    );
    assert.ok(
      !/\]\(\/[a-z]/.test(d.markdown),
      `${d.slug} has a site-relative link`,
    );
  }
  const m = DOCS.find((d) => d.slug === "methodology").markdown;
  assert.match(m, /m = \d+/);
  const a = DOCS.find((d) => d.slug === "agents").markdown;
  assert.match(a, /has \d\d tools/);
  // Three short pages (about, privacy, terms) have no H2s; the rest do.
  assert.ok(
    DOCS.filter((d) => d.sections.length > 0).length >= 13,
    "the long pages carry H2 sections",
  );
});

test("search matches by word, prefers pages with every word, and says when it fell back", () => {
  const r = searchDocs("pilot score minimum battles");
  assert.ok(
    r.matches.length > 0,
    "the phrase no page contains still finds pages by word",
  );
  assert.equal(r.matches[0].slug, "methodology");
  assert.ok(r.matches[0].in_section, "the match names the section it is in");
  const exact = searchDocs("Pilot Score");
  assert.equal(exact.fallback, false);
  assert.match(exact.matches[0].excerpt, /Pilot Score/);
  assert.deepEqual(searchDocs(""), { matches: [], fallback: false });
});
