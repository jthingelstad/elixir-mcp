/** Mail's links, footer and the rulings the render owns (structure, "Mail
 *  links and footer"): a player's name opens the player page, a clan's door
 *  is chosen per reader, the facts the same for everyone. Rendering only:
 *  nothing here sends. */
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

test("a player's name opens the player page for every reader: own, clanmate, friend and stranger alike (#764)", () => {
  const facts = load("tracking_report");
  const friend = facts.people[0].tag;
  const own = facts.you.tag;
  const clanTag = facts.clans[0].tag;
  const read = (extra) =>
    renderMail("tracking_report", facts, { ...links, ...extra }).html;

  const stranger = read({});
  assert.ok(stranger.includes(`/home/player/${bare(friend)}?`));
  assert.ok(!stranger.includes(`/console/explore/player/`));

  // Jamie, 2026-11-12: one page, replacing "Mail links follow the reader"
  // for names. A friend who is a clanmate opens it too, and so does your own.
  const mate = read({ mine: [own], member_clans: [clanTag] });
  assert.ok(mate.includes(`/home/player/${bare(friend)}?`));
  assert.ok(!mate.includes(`/members/${bare(friend)}`));
  // The reader's own name opens the player page too, never Ladder: Ladder
  // is reachable from the page (Jamie, 2026-11-12).
  assert.ok(mate.includes(`/home/player/${bare(own)}?`));
  assert.ok(!mate.includes(`/ladder?player=${bare(own)}`));
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

test("an actions issue stored with string lines still renders", () => {
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
