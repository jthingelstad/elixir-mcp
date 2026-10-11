/**
 * The editor's lookups (2026-10-11): a current member's record and
 * battles this week, and what the channel posted, read-only, bounded,
 * roughly timed in words and never a clock time. A former member, or a
 * name not on the roster, is not looked up. On a scratch database
 * (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { agoWords, editorResearch } from "../src/editor-research.mjs";

const CLAN = "#2PP2PP2P";
const ADA = "#PYL0Q2G8";
const GONE = "#PYL0Q2G9";
const OPP = "#PYL0Q2GR";
const T = Date.parse("2026-10-11T18:00:00Z");
const H = 3_600_000;
const at = (ms) => new Date(ms).toISOString();
const identities = async (_db, hashes) =>
  new Map(
    hashes.map((h) => [
      h,
      { archetype: { label: "Hog Rider cycle", family: "cycle" } },
    ]),
  );

let ctx;
let db;

async function battle(id, ms, type, outcome, crowns, against, change) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_name)
     values ($1, $2, $3, 'pvp', 'Ladder')`,
    [id, at(ms), type],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, side, outcome, battle_time, type, type_class,
        crowns, trophy_change, deck_hash)
     values ($1, $2, 0, $3, $4, $5, 'pvp', $6, $7, 'deck-1'),
            ($1, $8, 1, null, $4, $5, 'pvp', $9, null, null)`,
    [id, ADA, outcome, at(ms), type, crowns, change, OPP, against],
  );
}

before(async () => {
  ctx = await scratchDb("editor_research");
  db = ctx.db;
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Test Clan')`, [
    CLAN,
  ]);
  for (const [tag, name] of [
    [ADA, "Ada"],
    [GONE, "Gone"],
    [OPP, "keyluis"],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at, left_observed_at)
     values ($1, $2, 'elder', $3, null), ($1, $4, 'member', $3, $5)`,
    [CLAN, ADA, at(T - 40 * 24 * H), GONE, at(T - 24 * H)],
  );
  await db.query(
    `insert into deck (deck_hash, card_count, first_seen_at, last_seen_at)
     values ('deck-1', 8, $1, $1)`,
    [at(T - 10 * 24 * H)],
  );
  await battle("b1", T - 30 * 60_000, "PvP", "win", 3, 0, 31);
  await battle("b2", T - 5 * H, "pathOfLegend", "loss", 1, 2, null);
  await battle("b3", T - 30 * H, "PvP", "win", 2, 1, 29);
  // Older than a week: not this week's.
  await battle("b0", T - 9 * 24 * H, "PvP", "win", 3, 0, 30);
});

after(async () => ctx?.drop());

test("roughly when, in words", () => {
  assert.equal(agoWords(T - 20 * 60_000, T), "within the hour");
  assert.equal(agoWords(T - 2 * H, T), "a couple of hours ago");
  assert.equal(agoWords(T - 5 * H, T), "earlier today");
  assert.equal(agoWords(T - 30 * H, T), "yesterday");
  assert.equal(agoWords(T - 72 * H, T), "3 days ago");
});

test("a member's battles this week, newest first, by mode, with the opponent, the deck and no clock time", async () => {
  const research = editorResearch(db, CLAN, { nowMs: T, identities });
  const [all, ranked, war] = await research([
    { id: "a", name: "member_battles", input: { name: "ada", mode: "any" } },
    { id: "b", name: "member_battles", input: { name: "Ada", mode: "ranked" } },
    { id: "c", name: "member_battles", input: { name: "Ada", mode: "war" } },
  ]);
  assert.equal(all.id, "a");
  assert.equal(
    all.text,
    [
      "Ada's battles, newest first:",
      "- win 3-0 against keyluis, ladder, Hog Rider cycle, +31 trophies, within the hour",
      "- loss 1-2 against keyluis, ranked, Hog Rider cycle, earlier today",
      "- win 2-1 against keyluis, ladder, Hog Rider cycle, +29 trophies, yesterday",
    ].join("\n"),
  );
  assert.doesNotMatch(all.text, /\d{1,2}:\d{2}|#PYL/, "no clock time, no tag");
  assert.match(ranked.text, /^Ada's battles, newest first:\n- loss 1-2/);
  assert.equal(ranked.text.split("\n").length, 2);
  assert.equal(war.text, "No war battles recorded for Ada in the last 7 days.");
});

test("a member's record; a former member or a stranger is not looked up; the channel's posts; bounds and failures", async () => {
  let reads = 0;
  const research = editorResearch(db, CLAN, {
    nowMs: T,
    identities,
    history: async () => {
      reads += 1;
      return {
        entries: [
          { at: at(T - H / 2), outcome: "posted", excerpt: "Ada won\\_big." },
          { at: at(T - 2 * H), outcome: "skipped", excerpt: "Not this." },
          { at: at(T - 5 * 24 * H), outcome: "posted", excerpt: "Too old." },
        ],
      };
    },
  });
  const out = await research([
    { id: "1", name: "member_record", input: { name: "Ada" } },
    { id: "2", name: "member_record", input: { name: "Gone" } },
    { id: "3", name: "member_battles", input: { name: "Nobody", mode: "any" } },
    { id: "4", name: "channel_recent", input: {} },
    { id: "5", name: "delete_everything", input: {} },
    { id: "6", name: "channel_recent", input: {} },
    { id: "7", name: "channel_recent", input: {} },
  ]);
  assert.deepEqual(
    out.map((r) => r.id),
    ["1", "2", "3", "4", "5", "6", "7"],
    "every call answered, in order",
  );
  assert.match(out[0].text, /^MEMBER: Ada/);
  assert.match(out[0].text, /elder/i);
  assert.equal(out[1].text, 'No current member of the clan is named "Gone".');
  assert.equal(out[2].text, 'No current member of the clan is named "Nobody".');
  assert.equal(
    out[3].text,
    "The channel's posts, newest first:\n- within the hour: Ada won_big.",
    "posted only, within three days, as written",
  );
  assert.equal(out[4].text, "There is no lookup named delete_everything.");
  assert.equal(out[6].text, "Not looked up: at most 6 lookups a round.");
  assert.equal(reads, 2, "the seventh is never run");

  const failing = editorResearch(db, CLAN, {
    nowMs: T,
    history: async () => {
      throw new Error("s3");
    },
  });
  const [failed] = await failing([
    { id: "x", name: "channel_recent", input: {} },
  ]);
  assert.equal(failed.text, "That lookup failed; go on without it.");
});
