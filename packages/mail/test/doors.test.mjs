/** Mail's links, footer and the rulings the render owns (structure, "Mail
 *  links and footer"): one door per name, chosen per reader, the facts the
 *  same for everyone. Rendering only: nothing here sends. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMail, htmlToText } from "../src/index.mjs";
import { renderEmail } from "../../../services/email-relay/src/templates.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "../fixtures");
const load = (name) =>
  JSON.parse(readFileSync(path.join(fixtures, `${name}.json`), "utf8"));
const SITE = "https://elixir.poapkings.com";
const links = {
  unsubscribe: `${SITE}/api/email/unsubscribe?t=x`,
  manage: `${SITE}/settings/emails`,
  period: "2026-W39",
};
const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.";
const bare = (tag) => tag.slice(1);

test("a player's name opens the reader's door: own to Ladder, clanmate to the member page, anyone else to the record", () => {
  const facts = load("tracking_report");
  const friend = facts.friends[0].tag;
  const own = facts.primary.tag;
  const clanTag = facts.clans[0].tag;
  const read = (extra) =>
    renderMail("tracking_report", facts, { ...links, ...extra }).html;

  const stranger = read({ mine: [own] });
  assert.ok(stranger.includes(`/console/explore/player/${bare(friend)}?`));

  // A friend who is also a clanmate opens in Clan (A22).
  const mate = read({
    mine: [own],
    member_clans: [clanTag],
    clanmates: { [friend]: clanTag },
  });
  assert.ok(mate.includes(`/clan/${bare(clanTag)}/members/${bare(friend)}?`));
  assert.ok(!mate.includes(`/console/explore/player/${bare(friend)}?`));
});

test("the clan report's links follow the reader: member to Clan, Season and Members; everyone else to the record", () => {
  const facts = load("clan_report");
  const tag = bare(facts.clan.tag);
  const member = renderMail("clan_report", facts, {
    ...links,
    member_clans: [facts.clan.tag],
  });
  assert.ok(member.html.includes(`/clan/${tag}/season?`), "the clan's name");
  assert.ok(member.html.includes(`/clan/${tag}/members?`), "Open the roster");
  assert.match(member.html, new RegExp(`>Open ${facts.clan.name}<`));
  assert.doesNotMatch(member.html, /in the console/);

  const outside = renderMail("clan_report", facts, links);
  assert.ok(!outside.html.includes(`/clan/${tag}/season?`));
  assert.ok(outside.html.includes(`/console/explore/clan/${tag}?`));
  // The facts are one for both: nothing per reader was stored, the subject
  // does not move.
  assert.equal(member.subject, outside.subject);
});

test("Gone quiet is the clan's: a verified member reads a last battle's date, nobody reads a count", () => {
  const facts = load("clan_report");
  const name = facts.presence.quiet[0].name;
  facts.presence.quiet[0].last_battle = "2026-10-21T15:00:00.000Z";
  facts.presence.returned = [{ name: "Back Again" }];
  const member = htmlToText(
    renderMail("clan_report", facts, {
      ...links,
      member_clans: [facts.clan.tag],
      verified_clans: [facts.clan.tag],
    }).html,
  );
  assert.match(member, /Gone quiet/);
  assert.ok(member.includes(`${name}, last battle Oct 21`));
  assert.match(member, /Back: Back Again\./);
  assert.doesNotMatch(member, /\d+ days? quiet/);

  const outside = htmlToText(renderMail("clan_report", facts, links).html);
  assert.doesNotMatch(outside, /Gone quiet|Back: /);

  const unverified = htmlToText(
    renderMail("clan_report", facts, {
      ...links,
      member_clans: [facts.clan.tag],
    }).html,
  );
  assert.doesNotMatch(unverified, /Gone quiet|Back: /);
});

test("the You line shows a player of yours with a deck used, and no reader else", () => {
  const facts = load("clan_report");
  const raced = facts.war.raced[0];
  raced.decks = 12;
  raced.points = 2850;
  const you = htmlToText(
    renderMail("clan_report", facts, { ...links, mine: [raced.tag] }).html,
  );
  assert.match(you, /You, [^\n]*12 of \d+ war decks, 2,850 points\./);
  assert.doesNotMatch(
    htmlToText(renderMail("clan_report", facts, links).html),
    /^You, /m,
  );
  raced.decks = 0;
  assert.doesNotMatch(
    htmlToText(
      renderMail("clan_report", facts, { ...links, mine: [raced.tag] }).html,
    ),
    /^You, /m,
  );
});

test("was removed is said to a verified member of the clan, departed to everyone else", () => {
  const facts = load("clan_report");
  facts.membership.left[0].removed = true;
  const said = (extra) =>
    htmlToText(renderMail("clan_report", facts, { ...links, ...extra }).html);
  const tag = facts.clan.tag;
  assert.match(
    said({ member_clans: [tag], verified_clans: [tag] }),
    /was removed from/,
  );
  // An unverified claim opens the clan's door and reads no clan-visible fact.
  const unverified = said({ member_clans: [tag] });
  assert.doesNotMatch(unverified, /was removed from/);
  assert.match(unverified, /departed/);
  assert.doesNotMatch(said({}), /was removed from/);
});

test("a thin week draws no main deck, and says where the decks are", () => {
  const facts = load("arena_week");
  const full = renderMail("arena_week", facts, links).html;
  assert.match(full, /deck</);
  facts.primary.totals.battles = 3;
  const thin = renderMail("arena_week", facts, links).html;
  assert.doesNotMatch(thin, /main deck|Your [A-Za-z ]* deck</);
  assert.match(htmlToText(thin), /Your decks are in Ladder › Decks/);
});

test("an alt's first sits under the alt, with its time, and an alt with no battle is drawn only for one", () => {
  const facts = load("arena_week");
  const alt = facts.alts[0];
  alt.battles = 0;
  alt.wins = 0;
  alt.losses = 0;
  alt.by_family = [];
  alt.trophies = null;
  alt.firsts = [
    { text: "passed 1,000 career wins", at: "2026-10-15T00:53:00.000Z" },
  ];
  const out = renderMail("arena_week", facts, {
    ...links,
    timezone: "America/Chicago",
  });
  assert.match(
    htmlToText(out.html),
    /Passed 1,000 career wins, [A-Z][a-z]{2} [^\n]*\./,
  );
  assert.doesNotMatch(out.preheader, new RegExp(`${alt.name} 0\\b`));
});

test("no mail says Console: the footer is one line, the disclaimer stays word for word, HTML and text", () => {
  const kinds = readdirSync(fixtures).map((f) => f.replace(/\.json$/, ""));
  const send_id = "3f2a9c1b-0000-4000-8000-000000000001";
  for (const kind of kinds) {
    const { html } = renderMail(kind, load(kind), { ...links, send_id });
    const text = htmlToText(html);
    for (const part of [html, text]) {
      assert.ok(part.includes(DISCLAIMER), `${kind}: the disclaimer`);
      assert.doesNotMatch(
        part.replaceAll(/https?:\/\/[^\s"<)]+/g, ""),
        /\bconsole\b/i,
        `${kind}: the word`,
      );
    }
    assert.match(html, />Turn off this mail</, kind);
    assert.match(html, />Manage emails</, kind);
    assert.match(html, />Send feedback</, kind);
    assert.match(html, />Mail 3f2a9c</, kind);
    assert.doesNotMatch(html, /sponsor|\/support/i, kind);
    assert.doesNotMatch(html, /Turn off (the|Your)/, kind);
  }
});

test("transactional mail keeps the disclaimer, carries no turn-off, and names no retired place", () => {
  const cases = [
    { kind: "login", code: "123456", token: "t", to: "a@example.org" },
    { kind: "welcome", to: "a@example.org" },
    { kind: "owner_notify", note: "A notice.", to: "a@example.org" },
  ];
  for (const msg of cases) {
    const { html, text } = renderEmail(msg);
    for (const part of [html, text])
      assert.ok(part.includes(DISCLAIMER), `${msg.kind}: the disclaimer`);
    assert.doesNotMatch(html, /Turn off this mail|Manage emails/, msg.kind);
    assert.doesNotMatch(
      `${html}\n${text}`.replaceAll(/https?:\/\/[^\s"<)]+/g, ""),
      /\bConsole\b|the console/,
      msg.kind,
    );
  }
  assert.ok(
    renderEmail(cases[0]).html.includes(`${SITE}/signin#login_token=t`),
  );
  assert.ok(renderEmail(cases[1]).text.includes(`${SITE}/home`));
  assert.match(renderEmail(cases[2]).html, />Open Admin</);
});

test("an issue stored before these rulings renders: a count-only quiet line, string action lines, no reader context", () => {
  const facts = load("clan_report");
  delete facts.presence.quiet[0].last_battle;
  const out = renderMail("clan_report", facts, {
    ...links,
    member_clans: [facts.clan.tag],
  }).html;
  assert.doesNotMatch(out, /undefined|NaN/);
  const waiting = renderMail(
    "clan_actions_waiting",
    {
      ...load("clan_actions_waiting"),
      lines: ["#41 Promote to Elder: A Player (new)", "And 5 more."],
    },
    links,
  ).html;
  assert.doesNotMatch(waiting, /undefined|NaN/);
});
