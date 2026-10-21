/**
 * A member's dossier for a leader's draft about them (Jamie, 2026-10-20:
 * "use the full data resources of Elixir"): every war week in this clan,
 * donations by week and in their career, the profile's highlights, their
 * decks by mode over 28 days, their milestones and their role changes;
 * and what a demotion is told of it when every week they gave anything
 * is older than the recent weeks. On a scratch database (golden rule 9).
 * Synthetic people only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { dossierLines, storyAngles } from "@elixir-mcp/clan-engine";
import { clanStoryFacts, draftStory } from "../src/story-facts.mjs";

const CLAN = "#QGP2YRL8";
const OTHER = "#2PP2PP2P";
const DOT = "#PYL0Q2GL";
// A Tuesday: this week began Monday 2026-10-19.
const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 24 * 3600_000;
const at = (ms) => new Date(ms).toISOString();
const identities = async (_db, hashes) =>
  new Map(
    hashes.map((h) => [
      h,
      {
        archetype:
          h === "deck-mystery"
            ? { label: "4.1 elixir deck", family: "unclassified" }
            : { label: `${h.slice(5)} archetype`, family: "cycle" },
      },
    ]),
  );

async function seed(db) {
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Example Clan'), ($2, 'Elsewhere')`,
    [CLAN, OTHER],
  );
  await db.query(
    `insert into player (player_tag, name, years_played) values ($1, 'Dot', 6)`,
    [DOT],
  );
  await db.query(
    `insert into card (card_id, name, kind) values (26000021, 'Hog Rider', 'card')`,
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at, left_observed_at, baseline)
     values ($1, $2, 'elder', '2026-05-04T12:00:00Z', null, false)`,
    [CLAN, DOT],
  );
  // Ten finished weeks and one under way. Dot played the five before
  // the last four (ago 4-8), none of the last four, and the oldest week
  // has no row for them. Each finished week closed on a Monday; the
  // oldest three only by when Elixir saw them finish (no closed_at).
  const weeks = [
    [135, 2, null, null, 4, 800],
    [135, 1, 1, 0, 0, 0],
    [135, 0, 2, 0, 0, 0],
    [134, 3, 3, 0, 0, 0],
    [134, 2, 1, 0, 0, 0],
    [134, 1, 2, 16, 16, 2900],
    [134, 0, 1, 16, 16, 2750],
    [133, 3, 4, 16, 12, 2050],
    [133, 2, 1, 16, 16, 3100],
    [133, 1, 2, 16, 8, 1200],
    [133, 0, 3, 16, null, null],
  ];
  const lastClose = Date.parse("2026-10-19T09:40:00Z");
  let finished = 0;
  for (const [s, w, rank, , decks, points] of weeks) {
    const ago = rank == null ? null : finished++;
    const closed = ago == null ? null : lastClose - ago * 7 * DAY;
    await db.query(
      `insert into war_week (clan_tag, season_id, section_index, is_colosseum, closed_at, finished_observed_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        CLAN,
        s,
        w,
        s === 134 && w === 3,
        ago != null && ago < 7 ? at(closed) : null,
        closed != null ? at(closed + 3600_000) : null,
      ],
    );
    await db.query(
      `insert into war_week_clan (clan_tag, season_id, section_index, participant_clan_tag, participant_name, fame, rank, trophy_change)
       values ($1, $2, $3, $1, 'Example Clan', 30000, $4, 0)`,
      [CLAN, s, w, rank],
    );
    if (decks != null)
      await db.query(
        `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
         values ($1, $2, $3, $4, $5, $6)`,
        [CLAN, s, w, DOT, points, decks],
      );
  }
  // Donations in this clan, one Wednesday read a week: none in the last
  // four whole weeks, 100 to 300 in the five before, and a week given
  // in another clan, which is not this clan's.
  const monday = Date.parse("2026-10-19T00:00:00Z");
  for (let ago = 0; ago < 9; ago += 1) {
    const wed = monday - (ago + 1) * 7 * DAY + 2 * DAY;
    await db.query(
      `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, clan_tag, donations, observed_at)
       values ($1, $2::date, 'daily', $3, $4, $5)`,
      [DOT, at(wed).slice(0, 10), CLAN, ago < 4 ? 0 : 50 * (ago - 2), at(wed)],
    );
  }
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, clan_tag, donations, observed_at)
     values ($1, '2026-07-29', 'daily', $2, 999, '2026-07-29T08:00:00Z')`,
    [DOT, OTHER],
  );
  // The latest profile read (this week's, so in no week told).
  await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, clan_tag, donations, trophies, best_trophies,
        wins, collection_level, total_donations, favorite_card_id, pol_best_league,
        profile_observed_at, observed_at)
     values ($1, '2026-10-19', 'daily', $2, 0, 9100, 9400, 5200, 60, 45210, 26000021, 9,
             '2026-10-19T08:00:00Z', '2026-10-19T08:00:00Z')`,
    [DOT, CLAN],
  );
  await db.query(
    // The profile's best (9 above, unrated) is on the earlier ten-league
    // scale and never named; the best recorded season is, the newest of
    // equals. Below Ultimate Champion a final carries no rating.
    `insert into player_pol_season (player_tag, season_month, league, trophies, rank, observed_at)
     values ($1, '2026-09', 6, 0, null, '2026-10-01T00:00:00Z'),
            ($1, '2026-08', 6, 0, null, '2026-09-01T00:00:00Z'),
            ($1, '2026-07', 4, 0, null, '2026-08-01T00:00:00Z')`,
    [DOT],
  );
  for (const [name, level, max, progress] of [
    ["MasteryHogRider", 10, 10, 0],
    ["MasteryMusketeer", 10, 10, 0],
    ["MasteryKnight", 5, 10, 0],
    ["Classic12Wins", null, null, null],
    ["SeasonalBadge_202509", null, null, null],
    ["ClanWarWins", 5, 8, 150],
  ])
    await db.query(
      `insert into player_badge (player_tag, name, level, max_level, progress, observed_at)
       values ($1, $2, $3, $4, $5, '2026-10-19T08:00:00Z')`,
      [DOT, name, level, max, progress],
    );
  // Battles: twelve Trophy Road games on one deck (eight won), three in
  // Path of Legends, one war duel in this clan whose two rounds are
  // games, a boat defense (not theirs), a war battle for another clan,
  // a friendly, an unclassified deck and a ladder game from before the
  // 28 days.
  for (const hash of [
    "deck-hog",
    "deck-pol",
    "deck-war",
    "deck-mystery",
    "deck-old",
  ])
    await db.query(
      `insert into deck (deck_hash, card_count, first_seen_at, last_seen_at) values ($1, 8, $2, $2)`,
      [hash, at(NOW - 40 * DAY)],
    );
  let n = 0;
  const battle = async (
    ms,
    type,
    hash,
    outcome,
    { clan = CLAN, boat = null, cls = "pvp" } = {},
  ) => {
    n += 1;
    const id = `b${n}`;
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class, boat_battle_side)
       values ($1, $2, $3, $4, $5)`,
      [id, at(ms), type, cls, boat],
    );
    await db.query(
      `insert into battle_participant
         (battle_id, player_tag, side, outcome, battle_time, type, type_class, clan_tag, deck_hash)
       values ($1, $2, 0, $3, $4, $5, $6, $7, $8)`,
      [id, DOT, outcome, at(ms), type, cls, clan, hash],
    );
    return id;
  };
  for (let i = 0; i < 12; i += 1)
    await battle(
      NOW - (i + 1) * DAY,
      "PvP",
      "deck-hog",
      i < 8 ? "win" : "loss",
    );
  for (let i = 0; i < 3; i += 1)
    await battle(
      NOW - (i + 2) * DAY,
      "pathOfLegend",
      "deck-pol",
      i === 0 ? "win" : "loss",
    );
  const duel = await battle(NOW - 3 * DAY, "riverRaceDuel", null, "win");
  for (const [round, outcome] of [
    [1, "win"],
    [2, "loss"],
  ])
    await db.query(
      `insert into battle_participant_round (battle_id, player_tag, round, deck_hash, outcome)
       values ($1, $2, $3, 'deck-war', $4)`,
      [duel, DOT, round, outcome],
    );
  await battle(NOW - 4 * DAY, "boatBattle", "deck-war", "loss", {
    boat: "defender",
    cls: "boat",
  });
  await battle(NOW - 20 * DAY, "riverRacePvP", "deck-war", "win", {
    clan: OTHER,
  });
  await battle(NOW - 2 * DAY, "friendly", "deck-hog", "win");
  for (let i = 0; i < 4; i += 1)
    await battle(NOW - 5 * DAY, "PvP", "deck-mystery", "win");
  await battle(NOW - 40 * DAY, "PvP", "deck-old", "win");
  // Milestones: one in the 28 days, one before them.
  for (const [ms, badge] of [
    [NOW - 3 * DAY, "Classic12Wins"],
    [NOW - 40 * DAY, "Grand12Wins"],
  ])
    await db.query(
      `insert into player_event (player_tag, event_type, timing, window_start, window_end, badge_name)
       values ($1, 'legendary_badge_earned', 'estimated', $2, $2, $3)`,
      [DOT, at(ms), badge],
    );
  // Made Elder here once.
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, player_tag, role_before, role_after)
     values ($1, 'role_changed', 'estimated', '2026-06-01T00:00:00Z', '2026-06-01T06:00:00Z', $2, 'member', 'elder')`,
    [CLAN, DOT],
  );
  // The clan announced an award for them last season.
  await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, occurred_at, recorded_at)
     values ('clan', $1, $2, 'award_granted', $3, 'clan', 'test', 'a1', $4, $4)`,
    [
      CLAN,
      DOT,
      JSON.stringify({ award: "Steady Hand", season_id: 136 }),
      at(NOW - 3 * DAY),
    ],
  );
}

test("a member's dossier: every war week here, donations, profile highlights, decks by mode, milestones, roles; told once", async () => {
  const scratch = await scratchDb("story_dossier");
  try {
    const db = scratch.db;
    await seed(db);
    const story = await clanStoryFacts(db, CLAN, {
      playerTags: [DOT],
      nowMs: NOW,
      moments: true,
      dossier: DOT,
      identities,
    });
    // Their history is told once: in the dossier, not the member entry.
    assert.deepEqual(story.members[DOT].war, []);
    assert.deepEqual(story.members[DOT].moments, []);
    const d = story.dossier;
    assert.equal(d.days, 28);
    // Every finished week they have a row for, newest first, with how
    // many finished weeks back it is; never the week under way.
    assert.deepEqual(
      d.war.map((w) => [
        w.season_id,
        w.section_index,
        w.ago,
        w.decks_used,
        w.points,
      ]),
      [
        [135, 1, 0, 0, 0],
        [135, 0, 1, 0, 0],
        [134, 3, 2, 0, 0],
        [134, 2, 3, 0, 0],
        [134, 1, 4, 16, 2900],
        [134, 0, 5, 16, 2750],
        [133, 3, 6, 12, 2050],
        [133, 2, 7, 16, 3100],
        [133, 1, 8, 8, 1200],
      ],
    );
    assert.equal(d.war[2].is_colosseum, true);
    // Whole weeks in this clan only (the other clan's 999 is not here).
    assert.deepEqual(
      d.donations.weeks.map((w) => [w.week, w.ago, w.donations]),
      [
        ["2026-10-12", 0, 0],
        ["2026-10-05", 1, 0],
        ["2026-09-28", 2, 0],
        ["2026-09-21", 3, 0],
        ["2026-09-14", 4, 100],
        ["2026-09-07", 5, 150],
        ["2026-08-31", 6, 200],
        ["2026-08-24", 7, 250],
        ["2026-08-17", 8, 300],
      ],
    );
    assert.equal(d.donations.career, 45210);
    assert.deepEqual(d.profile, {
      years_played: 6,
      favorite_card: "Hog Rider",
      masteries_at_top: 2,
      mastery_level: 10,
      masteries: ["Hog Rider", "Musketeer"],
      legendary_badges: ["Classic Challenge 12 Wins"],
      pol_best: { season: "2026-09", league: 6, name: "Royal Champion" },
      clan_war_wins: 150,
    });
    // Modes on their own; a duel's rounds are games; a boat defense,
    // another clan's war, a friendly and a battle before the 28 days are
    // not counted; an unclassified deck is counted but not named.
    assert.deepEqual(d.decks, [
      {
        mode: "ladder",
        games: 16,
        wins: 12,
        losses: 4,
        decks: [{ label: "hog archetype", games: 12, wins: 8, losses: 4 }],
      },
      {
        mode: "ranked",
        games: 3,
        wins: 1,
        losses: 2,
        decks: [{ label: "pol archetype", games: 3, wins: 1, losses: 2 }],
      },
      { mode: "war", games: 2, wins: 1, losses: 1, decks: [] },
    ]);
    assert.equal(d.moments.length, 1);
    assert.match(d.moments[0].text, /Classic Challenge 12 Wins/);
    assert.deepEqual(d.roles, [
      { at: "2026-06-01T06:00:00.000Z", before: "member", after: "elder" },
    ]);
    assert.deepEqual(d.awards, [{ name: "Steady Hand", season_id: 136 }]);
    assert.doesNotMatch(JSON.stringify(d), /fame|30000|#|Elsewhere|999/);

    // A demotion whose only positive history is older than the recent
    // four weeks: those weeks and donations, never a zero, a missed week,
    // days since, the profile or the last 28 days.
    const lines = dossierLines(d, "demotion", { recentWeeks: 4 }).join("\n");
    assert.match(
      lines,
      /War weeks they played in this clan, newest first \(decks used, points\): season 134 week 2: 16 decks, 2,900 points; season 134 week 1: 16 decks, 2,750 points; season 133 week 4: 12 decks, 2,050 points; season 133 week 3: 16 decks, 3,100 points; season 133 week 2: 8 decks, 1,200 points/,
    );
    assert.match(lines, /5 weeks played, 68 decks, 12,000 points/);
    assert.match(
      lines,
      /1,000 across these 5 weeks, 300 their best \(the week of 2026-08-17\)/,
    );
    assert.doesNotMatch(
      lines,
      /season 135|season 134 week 3|season 134 week 4|\b0 decks|: 0\b|days ago|days since|Mastery|Path of Legends|Trophy Road|milestones|role changes|45,210/,
    );
    const angles = storyAngles(d, "demotion", {
      recentWeeks: 4,
      member: { tenure_days: 169, joined_at: "2026-05-04T12:00:00Z" },
    });
    assert.ok(angles.length >= 3 && angles.length <= 4, angles.join("\n"));
    assert.match(
      angles[0],
      /^5 war weeks in a row in this clan, season 133 week 2 to season 134 week 2: 12,000 points together\.$/,
    );
  } finally {
    await scratch.drop();
  }
});

test("a draft's story asks for the dossier only when it is about one member", async () => {
  const scratch = await scratchDb("story_dossier_draft");
  try {
    const db = scratch.db;
    await seed(db);
    const one = await draftStory(db, CLAN, [DOT], { nowMs: NOW });
    assert.ok(one.dossier, "a draft about one member reads their dossier");
    assert.equal(one.dossier.war.length, 9);
    assert.deepEqual(one.members[DOT].war, []);
    // The real deck namer: these synthetic decks have no cards, so none
    // is named, and each mode still counts its games.
    assert.deepEqual(
      one.dossier.decks.map((m) => [m.mode, m.games, m.decks.length]),
      [
        ["ladder", 16, 0],
        ["ranked", 3, 0],
        ["war", 2, 0],
      ],
    );
    const none = await draftStory(db, CLAN, [], { nowMs: NOW });
    assert.equal("dossier" in none, false);
    // Another caller (the Discord editor) never asks for one.
    const editor = await clanStoryFacts(db, CLAN, {
      playerTags: [DOT],
      nowMs: NOW,
      moments: true,
    });
    assert.equal("dossier" in editor, false);
    assert.equal(editor.members[DOT].war.length, 4);
    // A member the record does not hold has no dossier.
    const nobody = await draftStory(db, CLAN, ["#PYL0Q2GY"], { nowMs: NOW });
    assert.equal(nobody.dossier, null);
  } finally {
    await scratch.drop();
  }
});

test("a war week that closed more than a year ago is never told, even inside the 52-week cap", async () => {
  // Codex on #607: a clan that skipped wars, or a gap in the record,
  // let the row cap alone reach past the year the docs promise.
  const scratch = await scratchDb("story_dossier_year");
  try {
    const db = scratch.db;
    await db.query(
      `insert into clan (clan_tag, name) values ($1, 'Example Clan')`,
      [CLAN],
    );
    await db.query(`insert into player (player_tag, name) values ($1, 'Dot')`, [
      DOT,
    ]);
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at, left_observed_at, baseline)
       values ($1, $2, 'elder', '2025-06-01T12:00:00Z', null, false)`,
      [CLAN, DOT],
    );
    // Six finished weeks, far fewer than 52: two this month, one known
    // only by when Elixir saw it finish, one with no close time at all,
    // then a year-long gap and two weeks from 2025. Dot played them all.
    for (const [s, w, closedAt, finishedAt, points] of [
      [136, 1, "2026-10-19T09:40:00Z", "2026-10-19T10:05:00Z", 2600],
      [136, 0, "2026-10-12T09:40:00Z", "2026-10-12T10:05:00Z", 2400],
      [135, 3, null, "2026-09-29T10:05:00Z", 2200],
      [135, 2, null, null, 2000],
      [123, 1, "2025-09-15T09:40:00Z", "2025-09-15T10:05:00Z", 3000],
      [123, 0, "2025-09-08T09:40:00Z", "2025-09-08T10:05:00Z", 3200],
    ]) {
      await db.query(
        `insert into war_week (clan_tag, season_id, section_index, is_colosseum, closed_at, finished_observed_at)
         values ($1, $2, $3, false, $4, $5)`,
        [CLAN, s, w, closedAt, finishedAt],
      );
      await db.query(
        `insert into war_week_clan (clan_tag, season_id, section_index, participant_clan_tag, participant_name, fame, rank, trophy_change)
         values ($1, $2, $3, $1, 'Example Clan', 30000, 1, 0)`,
        [CLAN, s, w],
      );
      await db.query(
        `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
         values ($1, $2, $3, $4, $5, 16)`,
        [CLAN, s, w, DOT, points],
      );
    }
    const { dossier } = await draftStory(db, CLAN, [DOT], { nowMs: NOW });
    // The week with no close time cannot be shown to be in the year and
    // is left out; it still counts toward how many weeks back each is.
    assert.deepEqual(
      dossier.war.map((x) => [x.season_id, x.section_index, x.ago, x.points]),
      [
        [136, 1, 0, 2600],
        [136, 0, 1, 2400],
        [135, 3, 2, 2200],
      ],
    );
    const told = dossierLines(dossier, "promotion").join("\n");
    assert.doesNotMatch(told, /season 123|3,000|3,200/);
  } finally {
    await scratch.drop();
  }
});

test("Path of Legends at its best: a rated final or a rated profile best is Ultimate Champion; 1 with no rating is never named", async () => {
  const scratch = await scratchDb("story_dossier_pol");
  try {
    const db = scratch.db;
    await db.query(
      `insert into clan (clan_tag, name) values ($1, 'Example Clan')`,
      [CLAN],
    );
    // Synthetic members: two Ultimate Champion finals on record; one
    // only before the record (a rated best of 10, the earlier scale's
    // top); one who never played (1 with 0 every season, an unrated 9);
    // one whose two Ultimate Champion finals are older than their newest
    // 12 recorded seasons (still counted, still in the record).
    const RECORDED = "#2QQ0RPV8";
    const BEFORE = "#8LJ9CVGQ";
    const NEVER = "#9VQ2LJ8C";
    const LONG = "#R8YQ0JLP";
    const longSeasons = [
      ["2025-08", 7, 1650],
      ["2025-09", 7, 1700],
      ...Array.from({ length: 12 }, (_, i) => {
        const m = new Date(Date.UTC(2025, 9 + i, 1));
        return [m.toISOString().slice(0, 7), 3, 0];
      }),
    ];
    for (const [tag, bestLeague, bestTrophies, seasons] of [
      [
        RECORDED,
        7,
        1805,
        [
          ["2026-09", 1, 0],
          ["2026-08", 7, 1507],
          ["2026-07", 7, 1805],
          ["2026-06", 5, 0],
        ],
      ],
      [
        BEFORE,
        10,
        1596,
        [
          ["2026-09", 1, 0],
          ["2026-08", 4, 0],
        ],
      ],
      [
        NEVER,
        9,
        0,
        [
          ["2026-09", 1, 0],
          ["2026-08", 1, 0],
        ],
      ],
      [LONG, 7, 1700, longSeasons],
    ]) {
      await db.query(
        `insert into player (player_tag, name, years_played) values ($1, 'Someone', 3)`,
        [tag],
      );
      await db.query(
        `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at, left_observed_at, baseline)
         values ($1, $2, 'member', '2026-05-04T12:00:00Z', null, false)`,
        [CLAN, tag],
      );
      await db.query(
        `insert into player_snapshot_daily
           (player_tag, snapshot_date, snapshot_kind, clan_tag, pol_best_league, pol_best_trophies,
            profile_observed_at, observed_at)
         values ($1, '2026-10-19', 'daily', $2, $3, $4, '2026-10-19T08:00:00Z', '2026-10-19T08:00:00Z')`,
        [tag, CLAN, bestLeague, bestTrophies],
      );
      for (const [month, league, trophies] of seasons)
        await db.query(
          `insert into player_pol_season (player_tag, season_month, league, trophies, rank, observed_at)
           values ($1, $2, $3, $4, null, $5)`,
          [tag, month, league, trophies, `${month}-28T00:00:00Z`],
        );
    }
    const best = async (tag) =>
      (await draftStory(db, CLAN, [tag], { nowMs: NOW })).dossier?.profile
        ?.pol_best ?? null;
    assert.deepEqual(await best(RECORDED), {
      season: "2026-08",
      league: 7,
      name: "Ultimate Champion",
      ultimate_seasons: 2,
    });
    assert.deepEqual(await best(BEFORE), {
      season: null,
      league: 7,
      name: "Ultimate Champion",
      ultimate_seasons: 0,
    });
    assert.equal(await best(NEVER), null);
    assert.equal(longSeasons.at(-1)[0], "2026-09");
    assert.deepEqual(await best(LONG), {
      season: "2025-09",
      league: 7,
      name: "Ultimate Champion",
      ultimate_seasons: 2,
    });
  } finally {
    await scratch.drop();
  }
});
