/**
 * What the record adds to a battle story (2026-10-11, the editor): the
 * deck it was won with and that deck's record in its mode this season,
 * whether it is the member's second promotion in a day, and the
 * clanmates already in the arena it moved them into. On a scratch
 * database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { storyContext } from "../src/story-context.mjs";

const CLAN = "#2PP2PP2P";
const ADA = "#PYL0Q2G8";
const BO = "#PYL0Q2G9";
const CY = "#PYL0Q2GR";
const T = Date.parse("2026-10-11T18:00:00Z");
const H = 3_600_000;
const at = (ms) => new Date(ms).toISOString();
const DECK = "deck-hash-1";
const identities = async (_db, hashes) =>
  new Map(
    hashes.map((h) => [
      h,
      { archetype: { label: "Hog Rider cycle", family: "cycle" } },
    ]),
  );

let ctx;
let db;

async function battle(id, ms, outcome, { type = "PvP", deck = DECK } = {}) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_name)
     values ($1, $2, $3, 'pvp', 'Ladder')`,
    [id, at(ms), type],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, side, outcome, battle_time, type, type_class,
        crowns, deck_hash)
     values ($1, $2, 0, $3, $4, $5, 'pvp', 3, $6)`,
    [id, ADA, outcome, at(ms), type, deck],
  );
}

before(async () => {
  ctx = await scratchDb("story_context");
  db = ctx.db;
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Test Clan')`, [
    CLAN,
  ]);
  for (const [tag, name] of [
    [ADA, "Ada"],
    [BO, "Bo"],
    [CY, "Cy"],
  ]) {
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
       values ($1, $2, 'member', $3)`,
      [CLAN, tag, at(T - 40 * 24 * H)],
    );
  }
  await db.query(
    `insert into deck (deck_hash, card_count, first_seen_at, last_seen_at)
     values ($1, 8, $2, $2)`,
    [DECK, at(T - 5 * 24 * H)],
  );
  // Season 137 began 2026-10-05: three ladder results this season, one
  // last season and one in Ranked, which are not this deck's ladder.
  await battle("b1", T - 2 * H, "win");
  await battle("b2", T - 3 * H, "win");
  await battle("b3", T - 4 * H, "loss");
  await battle("b0", Date.parse("2026-09-20T12:00:00Z"), "win");
  await battle("r1", T - 5 * H, "win", { type: "pathOfLegend" });
  // Two arena moves today: the second promotion in a day.
  for (const [from, to, ms] of [
    [54000019, 54000020, T - 6 * H],
    [54000020, 54000021, T - 2 * H],
  ])
    await db.query(
      `insert into player_event
         (player_tag, event_type, timing, window_start, window_end, arena_from, arena_to)
       values ($1, 'arena_changed', 'estimated', $2, $2, $3, $4)`,
      [ADA, at(ms), from, to],
    );
  // Bo is already in that arena; Cy is not.
  for (const [tag, arena] of [
    [BO, 54000021],
    [CY, 54000019],
  ])
    await db.query(
      `insert into player_snapshot_daily (player_tag, snapshot_date, arena_id, profile_observed_at)
       values ($1, $2, $3, $4)`,
      [tag, at(T).slice(0, 10), arena, at(T - H)],
    );
});

after(async () => ctx?.drop());

test("a battle story is told the deck's season record in its mode, a second promotion in a day and the clanmates already there", async () => {
  const promoted_by = { battle_id: "b1", crowns: 3, crowns_against: 0 };
  const story = {
    key: "tl_00000000000000000001",
    items: [
      {
        id: "tl_00000000000000000001",
        kind: "arena_changed",
        facts: {
          player_tag: ADA,
          name: "Ada",
          from: 54000020,
          to: 54000021,
          promoted_by,
        },
      },
    ],
  };
  const out = await storyContext(db, CLAN, [story], { nowMs: T, identities });
  assert.deepEqual(out.get(story.key), {
    deck: {
      label: "Hog Rider cycle",
      mode: "ladder",
      won: 2,
      lost: 1,
      drawn: 0,
    },
    promotions: 2,
    mates: ["Bo"],
    mates_total: 1,
  });
});

test("a promotion told late counts the day before it, not the day before the run", async () => {
  const story = {
    key: "tl_00000000000000000004",
    items: [
      {
        id: "tl_00000000000000000004",
        kind: "arena_changed",
        at: at(T - 6 * H),
        facts: {
          player_tag: ADA,
          from: 54000019,
          to: 54000020,
          promoted_by: { battle_id: "b3" },
        },
      },
    ],
  };
  // Told at T + 20 h: the move at T - 2 h is after it, so it is the first.
  const out = await storyContext(db, CLAN, [story], {
    nowMs: T + 20 * H,
    identities,
  });
  assert.equal(out.get(story.key).promotions, 1);
});

test("a story of several members, or with no battle, is told nothing more", async () => {
  const join = {
    key: "tl_00000000000000000002",
    items: [
      {
        id: "tl_00000000000000000002",
        kind: "member_joined",
        facts: { player_tag: BO, name: "Bo" },
      },
    ],
  };
  const out = await storyContext(db, CLAN, [join], { nowMs: T, identities });
  assert.equal(out.size, 0);
  // An unclassified deck is not named.
  const plain = async (_db, hashes) =>
    new Map(hashes.map((h) => [h, { archetype: { family: "unclassified" } }]));
  const won = {
    key: "tl_00000000000000000003",
    items: [
      {
        id: "tl_00000000000000000003",
        kind: "career_wins_step",
        facts: { player_tag: ADA, crossed_by: { battle_id: "b2" } },
      },
    ],
  };
  const told = await storyContext(db, CLAN, [won], {
    nowMs: T,
    identities: plain,
  });
  assert.deepEqual(told.get(won.key), {});
});
