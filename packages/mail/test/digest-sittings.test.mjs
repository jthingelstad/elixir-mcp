/** The digest tells sittings as the web's session card does (2026-11-16):
 *  the headline from the facts, figures, chips, the deck played most, and
 *  each linked to its own page. Small sittings stay one line. Names are
 *  escaped. Fixture tags are invented. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMail } from "../src/render.mjs";
import { htmlToText } from "../src/text.mjs";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);
// The text part with each link's address taken out, as a reader reads it.
const words = (html) => htmlToText(html).replace(/ \(https?:[^)]*\)/g, "");
const read = (name) =>
  JSON.parse(readFileSync(path.join(fixtures, `${name}.json`), "utf8"));
const links = {
  unsubscribe: "https://elixir.poapkings.com/api/email/unsubscribe?t=x",
  manage: "/settings/emails",
  period: "2026-W37",
  send_id: "00000000-0000-4000-8000-000000000000",
  timezone: "America/Chicago",
  pixel: false,
};

test("digest deck images use Evo, Champion and Wild order without changing the facts", () => {
  const facts = read("tracking_report");
  const person = facts.people.find((p) => p.name === "Rapid Clear");
  const sitting = person.sittings.find(
    (s) => s.deck?.cards?.length && s.facts.battles > 2,
  );
  const cards = Array.from({ length: 8 }, (_, i) => ({
    id: 26000000 + i,
    name: `Card ${i}`,
    form: i === 5 || i === 7 ? "evolution" : "base",
    rarity: i === 3 ? "champion" : "common",
  }));
  sitting.deck.cards = cards;
  person.sittings = [sitting];
  person.items = [];
  facts.people = [person];
  const { html } = renderMail("tracking_report", facts, links);
  const shown = [
    ...html.matchAll(
      /src="https:\/\/elixir.poapkings.com\/assets\/cards\/(\d+)(?:_evo)?\.png"/g,
    ),
  ].map((m) => Number(m[1]));
  assert.deepEqual(
    shown,
    [5, 3, 7, 0, 1, 2, 4, 6].map((i) => cards[i].id),
  );
  assert.deepEqual(
    cards.map((c) => c.id),
    Array.from({ length: 8 }, (_, i) => 26000000 + i),
  );
});

test("each sitting's headline links its session page, campaign-tagged", () => {
  const { html } = renderMail(
    "tracking_report",
    read("tracking_report"),
    links,
  );
  const text = words(html);
  assert.ok(text.includes("Won 8 of 12 on Trophy Road, 5 in a row"));
  assert.ok(text.includes("3 three-crown wins · Best win 3-0"));
  assert.ok(text.includes("Climbed Master III to Champion"));
  assert.ok(text.includes("Classic Challenge: up to 5 wins"));
  assert.ok(text.includes("With Quail Cool"));
  assert.ok(text.includes("+1 more deck: Royal Giant beatdown (3)"));
  assert.ok(text.includes("1 more session on their page."));
  const hrefs = [...html.matchAll(/href="([^"]*\/session\/[^"]*)"/g)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );
  assert.ok(hrefs.length >= 8, `${hrefs.length} session links`);
  for (const h of hrefs) {
    const u = new URL(h);
    assert.equal(u.origin, "https://elixir.poapkings.com");
    assert.match(u.pathname, /^\/home\/player\/[0-9A-Z]+\/session\/tl_/);
    assert.ok(u.searchParams.get("at"), h);
    assert.equal(u.searchParams.get("utm_medium"), "tracking_report");
  }
});

test("a one- or two-battle sitting is one line; deck art once per person", () => {
  const facts = read("tracking_report");
  const { html } = renderMail("tracking_report", facts, links);
  const text = words(html);
  assert.match(
    text,
    /Lost a Trophy Road battle\s+−29 trophies · Hog Rider cycle · Mon Nov 9/,
  );
  // Rapid Clear's three sittings carry one deck row (eight cards).
  const rapid = facts.people.find((p) => p.name === "Rapid Clear");
  const withDecks = rapid.sittings.filter((s) => s.deck?.cards?.length);
  assert.ok(withDecks.length > 1);
  const block = html.slice(
    html.indexOf("Rapid Clear"),
    html.indexOf("Dove Sunny"),
  );
  // The one deck row: each of its cards once, Evo art included.
  assert.equal(block.match(/alt="Hog Rider"/g)?.length, 1);
  assert.equal(block.match(/alt="Evo Skeletons"/g)?.length, 1);
});

test("hostile names in a sitting stay text, in HTML and the text part", () => {
  const facts = read("tracking_report");
  const dove = facts.people.find((p) => p.name === "Dove Sunny");
  const [duo, ranked] = dove.sittings;
  duo.facts.together[0].name = `<i>Rapid</i> "Clear"`;
  ranked.deck.label = "<b>deck</b>";
  ranked.facts.decks[0].label = "<b>deck</b>";
  ranked.facts.ranked.promotions[0].from_name = "<img src=x>";
  ranked.deck.cards[0].name = "<script>x</script>";
  const { html } = renderMail("tracking_report", facts, links);
  for (const raw of ["<i>Rapid", "<b>deck", "<img src=x>", "<script>"])
    assert.ok(!html.includes(raw), raw);
  assert.ok(html.includes("&lt;i&gt;Rapid&lt;/i&gt;"));
  assert.ok(words(html).includes(`With <i>Rapid</i> "Clear"`));
});

test("a path that is not a session page is no link", () => {
  const facts = read("tracking_report");
  const s = facts.people[0].sittings[0];
  s.path = "https://evil.example/home/player/0QQG0JVQQ/session/x";
  const { html } = renderMail("tracking_report", facts, links);
  assert.ok(!html.includes("evil.example"));
});

test("a cheer on a sitting opens its session page in the activity mail", () => {
  const { html } = renderMail("activity_today", read("activity_today"), links);
  assert.match(
    html,
    /href="https:\/\/elixir\.poapkings\.com\/home\/player\/0QQG0JVQQ\/session\/tl_0000000000000000c001\?at=2026-11-16T15%3A02%3A00\.000Z&amp;utm_/,
  );
});

test("a full digest stays under Gmail's clip: twelve people, three big sittings each (Codex on #1084)", () => {
  const facts = read("tracking_report");
  const rapid = facts.people.find((p) => p.name === "Rapid Clear");
  const big = rapid.sittings.find((s) => (s.facts.battles ?? 0) > 2);
  const items = [...rapid.items, ...rapid.items, ...rapid.items].slice(0, 3);
  facts.people = Array.from({ length: 12 }, (_, i) => ({
    ...rapid,
    tag: `#0QQG0JVQQ`,
    name: `Rapid Clear the ${"Long ".repeat(3)}${i}`,
    items,
    sittings: [big, big, big].map((s, j) => ({
      ...s,
      path: s.path.replace("a102", `a1${i}${j}`),
    })),
    more_sittings: 5,
  }));
  const { html } = renderMail("tracking_report", facts, links);
  const size = Buffer.byteLength(html, "utf8");
  assert.ok(size < 100_000, `${size} bytes`);
  // The footer, and its turn-off link, are inside the mail.
  assert.ok(html.includes("api/email/unsubscribe?t=x"));
  // The first people are told in full, the art on at most three; the
  // last only counted, with a link to their page.
  assert.ok(words(html).includes("3 three-crown wins"));
  assert.ok((html.match(/alt="Hog Rider"/g) ?? []).length <= 3);
  assert.ok(words(html).includes("8 sessions on their page."));
});

test("the budget counts UTF-8 bytes: long CJK highlights still leave the footer in (Codex on #1085)", () => {
  const facts = read("tracking_report");
  const rapid = facts.people.find((p) => p.name === "Rapid Clear");
  const big = rapid.sittings.find((s) => (s.facts.battles ?? 0) > 2);
  const highlight = rapid.items.find((it) => it.kind === "battle_highlight");
  const words500 = "皇家巨人推進".repeat(84).slice(0, 500);
  facts.people = Array.from({ length: 12 }, (_, i) => ({
    ...rapid,
    name: `Rapid Clear ${i}`,
    items: [0, 1, 2].map(() => ({ ...highlight, words: words500 })),
    sittings: [big, big, big],
    more_sittings: 0,
  }));
  const { html } = renderMail("tracking_report", facts, links);
  // The sittings gave way first, then the later people's words: counted
  // on the timeline. The footer and its turn-off link are inside the clip.
  const size = Buffer.byteLength(html, "utf8");
  assert.ok(size < 100_000, `${size} bytes`);
  assert.ok(html.includes("api/email/unsubscribe?t=x"));
  assert.ok(words(html).includes("3 sessions on their page."));
  assert.ok(words(html).includes("3 more on your timeline."));
  assert.ok(html.includes(words500));
});

test("plain posts retain deck/cards and member actions within the digest byte budget", () => {
  const facts = read("tracking_report");
  const rapid = facts.people.find((p) => p.name === "Rapid Clear");
  const deck = rapid.sittings.find((s) => s.deck?.cards?.length).deck;
  const postWords = "皇家巨人推進".repeat(84).slice(0, 500);
  facts.people = Array.from({ length: 12 }, (_, i) => ({
    ...rapid,
    battles: 0,
    sessions: 0,
    sittings: [],
    items: [0, 1, 2].map((j) => ({
      kind: "post",
      words: postWords,
      post: { id: String(i * 3 + j + 1), question: j === 0, deck, cards: [] },
    })),
    more_items: 0,
  }));
  const { html, subject } = renderMail("tracking_report", facts, links);
  const size = Buffer.byteLength(html, "utf8");
  assert.ok(size < 100_000, `${size} bytes`);
  assert.ok(html.includes("api/email/unsubscribe?t=x"));
  assert.ok(html.includes("/home/post/1?"));
  assert.ok(words(html).includes("Hog Rider"));
  assert.ok(words(html).includes("3 more on your timeline."));
  assert.match(subject, /36 posts/);
  assert.match(words(html), /36 posts/);
  assert.doesNotMatch(html, /\/h\//);
});
