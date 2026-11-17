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
  assert.ok(text.includes("1 more sitting on their page."));
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
  const { html } = renderMail(
    "tracking_report",
    read("tracking_report"),
    links,
  );
  for (const raw of ["<b>Bo</b>", "<script>", "<i>Rapid</i>", "<img src=x>"])
    assert.ok(!html.includes(raw), raw);
  assert.ok(html.includes("&lt;i&gt;Rapid&lt;/i&gt;"));
  const text = words(html);
  assert.ok(text.includes(`Against <i>Rapid</i> "Clear"`));
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
