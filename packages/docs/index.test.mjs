import { test } from "node:test";
import assert from "node:assert/strict";
import { DOCS, EXAMPLES, UPDATES, searchDocs } from "./src/index.mjs";

test("the corpus carries every docs page, all eleven examples and the updates", () => {
  assert.ok(DOCS.length >= 20, `only ${DOCS.length} docs pages`);
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
    DOCS.filter((d) => d.sections.length > 0).length >= 17,
    "the long pages carry H2 sections",
  );
});

test("inline SVG leaves the corpus and its aria-label stays as text", () => {
  for (const d of DOCS)
    assert.ok(!/<svg\b/.test(d.markdown), `${d.slug} carries an <svg>`);
  const arch = DOCS.find((d) => d.slug === "architecture").markdown;
  assert.match(arch, /\[Diagram: /);
});

test("section slugs are GitHub-style, the shape the code's docs pointers use", () => {
  const recording = DOCS.find((d) => d.slug === "recording");
  const slugs = recording.sections.map((s) => s.slug);
  // Apostrophes and quotes vanish rather than becoming hyphens.
  assert.ok(slugs.includes("the-games-own-last-seen"), slugs.join(", "));
  assert.ok(slugs.includes("added-means-recorded"));
  const battles = DOCS.find((d) => d.slug === "battles");
  assert.deepEqual(
    battles.sections.map((s) => s.slug),
    [
      "what-a-battle-record-holds",
      "mode-groups",
      "duels-and-boat-battles",
      "decided-battles-and-denominators",
      "deck-identity-and-forms",
      "war-weeks-points-and-fame",
    ],
  );
  // The mode table is rendered from the contract, not typed.
  assert.match(battles.markdown, /`riverRaceDuelColosseum`/);
  const clocks = DOCS.find((d) => d.slug === "clocks");
  assert.ok(clocks.sections.some((s) => s.slug === "the-policy-day"));
});

test("the index lede is never shorter than 40 characters, and description rides beside it", () => {
  // A lede under 40 characters yields to the description in the builder;
  // every page carries both, so a reader can fall back either way.
  for (const d of DOCS) {
    assert.ok(d.lede.length >= 40, `${d.slug}: ${d.lede}`);
    assert.ok(d.description.length >= 40, `${d.slug} has no description`);
  }
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
  // Plurals: "quotas" finds the page that says "quota", and vice versa.
  const plural = searchDocs("quotas");
  assert.equal(plural.fallback, false);
  assert.ok(plural.matches.some((m) => m.slug === "limits"));
  assert.ok(searchDocs("quota").matches.some((m) => m.slug === "limits"));
  assert.ok(searchDocs("policy day").matches[0].slug === "clocks");
});
