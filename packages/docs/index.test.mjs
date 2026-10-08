import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { corpus, searchDocs } from "./src/index.mjs";

const { docs: DOCS, examples: EXAMPLES, updates: UPDATES } = await corpus();

test("importing the package does not need the corpus built (the site's build imports it)", async () => {
  // The site renders its tool reference from the MCP registry, which
  // imports this package, and the corpus is built from the site: a
  // module-scope read of dist/corpus.json made the docs build depend on
  // its own output. The module alone, with no dist/ beside it, must load.
  const dir = await mkdtemp(path.join(tmpdir(), "elixir-docs-"));
  try {
    await mkdir(path.join(dir, "src"));
    await copyFile(
      new URL("./src/index.mjs", import.meta.url),
      path.join(dir, "src/index.mjs"),
    );
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(path.join(dir, "src/index.mjs"))});
         const read = await m.corpus().then(() => "read", () => "missing");
         console.log(typeof m.corpus, read);`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(out.trim(), "function missing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the corpus carries every docs page, all ten examples and the updates", () => {
  assert.ok(DOCS.length >= 20, `only ${DOCS.length} docs pages`);
  assert.ok(DOCS.every((d) => d.slug && d.title && d.markdown.length > 100));
  assert.equal(EXAMPLES.length, 10);
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
  assert.match(m, /Card levels: described, not adjusted for/);
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
      "events-are-their-own-group",
      "duels-and-boat-battles",
      "comparisons-and-what-a-battle-proves-about-its-own-length",
      "the-control-next-to-the-number",
      "decided-battles-and-denominators",
      "deck-identity-and-forms",
      "war-weeks-points-and-fame",
    ],
  );
  // The mode table is rendered from the contract, not typed.
  assert.match(battles.markdown, /`riverRaceDuelColosseum`/);
  // The war-deck tools retired, and their page with them.
  assert.equal(
    DOCS.find((d) => d.slug === "war-decks"),
    undefined,
  );
  const clocks = DOCS.find((d) => d.slug === "clocks");
  assert.ok(clocks.sections.some((s) => s.slug === "the-policy-day"));
});

test("every page sits in one of the site's groups, in the rail's order", async () => {
  // The docs' groups have one source, the site's `_data/docGroups.js`,
  // which the rail, the docs home and this corpus all read (2026-10-01:
  // they were two lists, kept in step by hand). A page's `section` is
  // the group's label here, and the corpus runs group by group.
  const { default: GROUPS } = await import(
    new URL("../../apps/site/src/_data/docGroups.js", import.meta.url)
  );
  const labels = GROUPS.map((g) => g.label);
  const ranks = DOCS.map((d) => labels.indexOf(d.section));
  assert.ok(
    ranks.every((r) => r > -1),
    DOCS.filter((d) => !labels.includes(d.section))
      .map((d) => `${d.slug}: ${d.section}`)
      .join(", "),
  );
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b),
  );
  assert.equal(DOCS[0].section, "Start");
  assert.equal(DOCS.find((d) => d.slug === "clocks").section, "The record");
});

test("the Clan docs advertise both uses of the clan's own model", () => {
  const actions = DOCS.find((d) => d.slug === "clan-actions").markdown;
  assert.match(actions, /Draft in our voice/);
  assert.match(actions, /promotion, demotion, awards announcement/);

  const policy = DOCS.find((d) => d.slug === "clan-policy").markdown;
  assert.match(policy, /recruiting pitch in Recruit/);
  assert.match(policy, /Clan Leader Message/);
});

test("the index lede is never shorter than 40 characters, and description rides beside it", () => {
  // A lede under 40 characters yields to the description in the builder;
  // every page carries both, so a reader can fall back either way.
  for (const d of DOCS) {
    assert.ok(d.lede.length >= 40, `${d.slug}: ${d.lede}`);
    assert.ok(d.description.length >= 40, `${d.slug} has no description`);
  }
});

test("search matches by word, prefers pages with every word, and says when it fell back", async () => {
  const r = await searchDocs("rival intelligence coverage");
  assert.ok(
    r.matches.length > 0,
    "the phrase no page contains still finds pages by word",
  );
  assert.equal(r.matches[0].slug, "methodology");
  assert.ok(r.matches[0].in_section, "the match names the section it is in");
  const exact = await searchDocs("rival intelligence");
  assert.equal(exact.fallback, false);
  assert.match(exact.matches[0].excerpt, /Rival intelligence/i);
  assert.deepEqual(await searchDocs(""), { matches: [], fallback: false });
  // Plurals: "quotas" finds the page that says "quota", and vice versa.
  const plural = await searchDocs("quotas");
  assert.equal(plural.fallback, false);
  assert.ok(plural.matches.some((m) => m.slug === "limits"));
  assert.ok(
    (await searchDocs("quota")).matches.some((m) => m.slug === "limits"),
  );
  assert.ok((await searchDocs("policy day")).matches[0].slug === "clocks");
});
