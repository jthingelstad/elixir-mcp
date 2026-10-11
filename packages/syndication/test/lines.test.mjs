/**
 * One timeline item as one Discord line: the item's sentence, a time
 * only when the item is over three hours old (2026-10-11), names that
 * cannot restyle the channel, and links back to Elixir that Discord
 * never previews (Jamie, 2026-10-10).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discordLine,
  discordStamp,
  escapeDiscord,
  itemLinks,
} from "../src/lines.mjs";

const NOW = Date.parse("2026-10-10T18:00:00Z");
const ORIGIN = "https://elixir.poapkings.com";

test("names are literal: markdown, mentions and brackets are escaped", () => {
  assert.equal(
    escapeDiscord("*_King_* ~~x~~ `y` ||z|| > [a](b) <@123> @everyone"),
    "\\*\\_King\\_\\* \\~\\~x\\~\\~ \\`y\\` \\|\\|z\\|\\| \\> \\[a\\](b) \\<\\@123\\> \\@everyone",
  );
  assert.equal(escapeDiscord("two\nlines"), "two lines");
});

test("a fresh item carries no time, and every link is masked around <address>", () => {
  const line = discordLine(
    {
      at: "2026-10-10T16:18:00Z",
      kind: "ranked_promotion",
      subject_tag: "#J2RGCRVG",
      subject_name: "POAP KINGS",
      section: "standouts",
      text: "King_Thing was promoted to Champion on a battle.",
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
    `King\\_Thing was promoted to Champion on a battle. · [battle](<${ORIGIN}/battle/abababababab>) · [King\\_Thing](<${ORIGIN}/console/explore/player/20JJJ2CCRU>) · [POAP KINGS](<${ORIGIN}/console/explore/clan/J2RGCRVG>)`,
  );
  // Every address in the line sits inside angle brackets.
  for (const m of line.matchAll(/https:\/\/\S+/g))
    assert.equal(line[m.index - 1], "<", m[0]);
});

test("a race week links its week; an older item says how long ago, after its sentence", () => {
  const it = {
    at: "2026-10-06T10:00:00Z",
    kind: "week_resolved",
    subject_tag: "#J2RGCRVG",
    subject_name: "POAP KINGS",
    section: "war",
    text: "POAP KINGS finished week 2 in place 1.",
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
      `POAP KINGS finished week 2 in place 1. · <t:${Date.parse(it.at) / 1000}:R> · [week 2]`,
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
      text: `A leader said in POAP KINGS's clan chat: "${"word ".repeat(600)}"`,
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

const item = (at, extra = {}) => ({
  at,
  kind: "arena_changed",
  subject_tag: "#20JJJ2CCRU",
  subject_name: "King Thing",
  section: "arena",
  text: "King Thing moved to Magic Academy.",
  facts: {},
  ...extra,
});

test("three hours old or less: no time; older: a relative stamp, never a clock time", () => {
  const H = 3600_000;
  assert.equal(
    discordStamp(item(new Date(NOW - 3 * H).toISOString()), NOW),
    "",
  );
  const late = new Date(NOW - 3 * H - 1000).toISOString();
  assert.equal(
    discordStamp(item(late), NOW),
    `<t:${Math.floor(Date.parse(late) / 1000)}:R>`,
  );
  // A clock skewed ahead is fresh, never a time to come.
  assert.equal(discordStamp(item(new Date(NOW + H).toISOString()), NOW), "");
  assert.equal(discordStamp(item("not a time"), NOW), "");
  assert.doesNotMatch(
    discordLine(item(new Date(NOW - 26 * H).toISOString()), { nowMs: NOW }),
    /<t:\d+:[^R]>/,
  );
});

test("a sitting's age runs from its last battle: edited as it grows, it never gains a time", () => {
  const H = 3600_000;
  // Started four hours ago and still going: each edit is built now, and
  // its last battle is minutes old, so the edit carries no time, as the
  // first post did not (2026-10-11: an edit showed 3:41 PM on a 2:33 PM
  // message).
  const sitting = (endedAgo, open) =>
    item(new Date(NOW - 4 * H).toISOString(), {
      kind: "battle_session",
      section: "battles",
      text: "King Thing played a session of 30 battles.",
      facts: {
        started_at: new Date(NOW - 4 * H).toISOString(),
        ended_at: new Date(NOW - endedAgo).toISOString(),
        open,
      },
    });
  assert.equal(discordStamp(sitting(10 * 60_000, true), NOW), "");
  assert.equal(discordStamp(sitting(45 * 60_000, false), NOW), "");
  assert.ok(
    discordLine(sitting(45 * 60_000, false), { nowMs: NOW }).startsWith(
      "King Thing played",
    ),
  );
  // A sitting the record learned late says how long ago it ended.
  assert.equal(
    discordStamp(sitting(5 * H, false), NOW),
    `<t:${Math.floor((NOW - 5 * H) / 1000)}:R>`,
  );
});

test("a name that opens the line is never a heading or a list", () => {
  for (const [name, lit] of [
    ["# Top", "\\# Top"],
    ["-# small", "\\-# small"],
    ["- dash", "\\- dash"],
    ["1. First", "1\\. First"],
  ])
    assert.ok(
      discordLine(
        item(new Date(NOW).toISOString(), { text: `${name} moved up.` }),
        {
          nowMs: NOW,
        },
      ).startsWith(`${lit} moved up.`),
      name,
    );
});
