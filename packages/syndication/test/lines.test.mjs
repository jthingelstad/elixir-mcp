/**
 * One timeline item as one Discord line: the item's sentence on the
 * reader's own clock, names that cannot restyle the channel, and links
 * back to Elixir that Discord never previews (Jamie, 2026-10-10).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { discordLine, escapeDiscord, itemLinks } from "../src/lines.mjs";

const NOW = Date.parse("2026-10-10T18:00:00Z");
const ORIGIN = "https://elixir.poapkings.com";

test("names are literal: markdown, mentions and brackets are escaped", () => {
  assert.equal(
    escapeDiscord("*_King_* ~~x~~ `y` ||z|| > [a](b) <@123> @everyone"),
    "\\*\\_King\\_\\* \\~\\~x\\~\\~ \\`y\\` \\|\\|z\\|\\| \\> \\[a\\](b) \\<\\@123\\> \\@everyone",
  );
  assert.equal(escapeDiscord("two\nlines"), "two lines");
});

test("the time lead becomes a Discord timestamp, and every link is masked around <address>", () => {
  const line = discordLine(
    {
      at: "2026-10-10T16:18:00Z",
      kind: "ranked_promotion",
      subject_tag: "#J2RGCRVG",
      subject_name: "POAP KINGS",
      section: "standouts",
      text: "Sat 11:18 King_Thing was promoted to Champion on a battle.",
      facts: {
        player_tag: "#20JJJ2CCRU",
        name: "King_Thing",
        promoted_by: { battle_id: "ab".repeat(32) },
      },
    },
    {
      nowMs: NOW,
      clanTags: new Set(["#J2RGCRVG"]),
      battles: new Map([
        ["ab".repeat(32), { url: `${ORIGIN}/battle/abababababab` }],
      ]),
    },
  );
  assert.equal(
    line,
    `<t:${Date.parse("2026-10-10T16:18:00Z") / 1000}:t> King\\_Thing was promoted to Champion on a battle. · [battle](<${ORIGIN}/battle/abababababab>) · [King\\_Thing](<${ORIGIN}/console/explore/player/20JJJ2CCRU>) · [POAP KINGS](<${ORIGIN}/console/explore/clan/J2RGCRVG>)`,
  );
  // Every address in the line sits inside angle brackets.
  for (const m of line.matchAll(/https:\/\/\S+/g))
    assert.equal(line[m.index - 1], "<", m[0]);
});

test("a race week links its week; an older item carries its date", () => {
  const it = {
    at: "2026-10-06T10:00:00Z",
    kind: "week_resolved",
    subject_tag: "#J2RGCRVG",
    subject_name: "POAP KINGS",
    section: "war",
    text: "Mon 05:00 POAP KINGS finished week 2 in place 1.",
    facts: { season_id: 136, section_index: 1 },
  };
  assert.deepEqual(
    itemLinks(it, { clanTags: new Set(["#J2RGCRVG"]) }).map((l) => l.url),
    [
      `${ORIGIN}/console/explore/week/J2RGCRVG~136~1`,
      `${ORIGIN}/console/explore/clan/J2RGCRVG`,
    ],
  );
  assert.ok(
    discordLine(it, { nowMs: NOW }).startsWith(
      `<t:${Date.parse(it.at) / 1000}:f> POAP KINGS finished week 2 in place 1. · [week 2]`,
    ),
  );
});

test("a long sentence is cut, its links kept, inside Discord's 2,000 characters", () => {
  const line = discordLine(
    {
      at: "2026-10-10T17:00:00Z",
      kind: "clan_message",
      subject_tag: "#J2RGCRVG",
      subject_name: "POAP KINGS",
      section: "attested",
      text: `Sat 12:00 A leader said in POAP KINGS's clan chat: "${"word ".repeat(600)}"`,
      facts: {},
    },
    { nowMs: NOW, clanTags: new Set(["#J2RGCRVG"]) },
  );
  assert.ok(line.length <= 2000);
  assert.match(
    line,
    /… · \[POAP KINGS\]\(<https:\/\/elixir\.poapkings\.com\/console\/explore\/clan\/J2RGCRVG>\)$/,
  );
});
