/**
 * What the record tells the clan's own model about a clan and its
 * members (2026-10-11): recorded facts only, decks and points (never a
 * member's fame), time in the clan with earlier stints, the clan's last
 * finished war weeks. On a scratch database (golden rule 9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { clanStoryFacts } from "../src/story-facts.mjs";

const CLAN = "#J2RGCRVG";
const ADA = "#PYL0Q2G8";
const BEN = "#PYL0Q2G9";
const NOW = Date.parse("2026-10-11T12:00:00Z");

test("a clan's story facts: its name, members and finished weeks; a member's profile, tenure, stints and war weeks", async () => {
  const scratch = await scratchDb("story_facts");
  try {
    const db = scratch.db;
    await db.query(
      `insert into clan (clan_tag, name) values ($1, 'Example Clan')`,
      [CLAN],
    );
    await db.query(
      `insert into player (player_tag, name) values ($1, 'Ada'), ($2, 'Ben')`,
      [ADA, BEN],
    );
    await db.query(
      `insert into arena (arena_id, name) values (54000012, 'Legendary Arena')`,
    );
    await db.query(
      `insert into clan_snapshot_daily (clan_tag, day, snapshot_kind, observed_at, members)
       values ($1, '2026-10-10', 'daily', '2026-10-10T08:00:00Z', 41)`,
      [CLAN],
    );
    // Ada: an earlier stint, then back since 2026-09-01. Ben left.
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at, left_observed_at, baseline) values
        ($1, $2, 'member', '2026-03-07T00:00:00Z', '2026-05-01T00:00:00Z', true),
        ($1, $2, 'elder',  '2026-09-01T12:00:00Z', null, false),
        ($1, $3, 'member', '2026-08-01T00:00:00Z', '2026-10-01T00:00:00Z', false)`,
      [CLAN, ADA, BEN],
    );
    await db.query(
      `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, trophies, best_trophies, wins, collection_level, arena_id, profile_observed_at, observed_at) values
        ($1, '2026-10-09', 'daily', 9900, 10100, 4000, 50, 54000012, '2026-10-09T08:00:00Z', '2026-10-09T08:00:00Z'),
        ($1, '2026-10-10', 'daily', 10040, 10500, 4321, 52, 54000012, '2026-10-10T08:00:00Z', '2026-10-10T08:00:00Z'),
        ($1, '2026-10-11', 'daily', 99999, 99999, 99999, 99, null, null, '2026-10-11T08:00:00Z')`,
      [ADA],
    );
    // Five weeks: four finished (ranked), one under way.
    for (const [s, w, rank, change, colo] of [
      [134, 3, 3, -10, true],
      [135, 0, 1, 50, false],
      [135, 1, 2, 20, false],
      [135, 2, 4, -20, false],
      [135, 3, 2, 40, false],
      [135, 4, null, null, false],
    ]) {
      await db.query(
        `insert into war_week (clan_tag, season_id, section_index, is_colosseum) values ($1, $2, $3, $4)`,
        [CLAN, s, w, colo],
      );
      await db.query(
        `insert into war_week_clan (clan_tag, season_id, section_index, participant_clan_tag, participant_name, fame, rank, trophy_change)
         values ($1, $2, $3, $1, 'Example Clan', 30000, $4, $5),
                ($1, $2, $3, '#OTHER', 'Rival', 20000, 9, 0)`,
        [CLAN, s, w, rank, change],
      );
      await db.query(
        `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
         values ($1, $2, $3, $4, $5, $6)`,
        [CLAN, s, w, ADA, 2000 + w, w === 2 ? 0 : 16],
      );
    }
    const story = await clanStoryFacts(db, CLAN, {
      playerTags: [ADA, BEN, "#NOBODY", ADA],
      nowMs: NOW,
    });
    assert.deepEqual(story.clan, {
      name: "Example Clan",
      members: 41,
      war: [
        {
          season_id: 135,
          section_index: 3,
          is_colosseum: false,
          rank: 2,
          trophy_change: 40,
        },
        {
          season_id: 135,
          section_index: 2,
          is_colosseum: false,
          rank: 4,
          trophy_change: -20,
        },
        {
          season_id: 135,
          section_index: 1,
          is_colosseum: false,
          rank: 2,
          trophy_change: 20,
        },
        {
          season_id: 135,
          section_index: 0,
          is_colosseum: false,
          rank: 1,
          trophy_change: 50,
        },
      ],
    });
    assert.deepEqual(Object.keys(story.members).sort(), [ADA, BEN].sort());
    const ada = story.members[ADA];
    assert.deepEqual(
      { ...ada, war: ada.war.length },
      {
        name: "Ada",
        role: "elder",
        trophies: 10040,
        best_trophies: 10500,
        arena: "Legendary Arena",
        career_wins: 4321,
        collection_level: 52,
        joined_at: "2026-09-01T12:00:00.000Z",
        baseline: false,
        tenure_days: 40,
        stints_before: 1,
        last_left_at: "2026-05-01T00:00:00.000Z",
        war: 4,
        moments: [],
      },
    );
    assert.deepEqual(ada.war[0], {
      season_id: 135,
      section_index: 3,
      is_colosseum: false,
      decks_used: 16,
      points: 2003,
    });
    assert.doesNotMatch(JSON.stringify(story), /fame|30000|Rival|OTHER/);
    // A departed member: their last stint's length, and no role.
    const ben = story.members[BEN];
    assert.equal(ben.role, null);
    assert.equal(ben.tenure_days, 61);
    assert.equal(ben.stints_before, 0);
    assert.equal(ben.trophies, null);
    // A leader's draft reads the member's milestones too (none recorded here).
    const withMoments = await clanStoryFacts(db, CLAN, {
      playerTags: [ADA],
      nowMs: NOW,
      moments: true,
    });
    assert.deepEqual(withMoments.members[ADA].moments, []);
    // The clan alone, and a clan the record does not hold.
    assert.deepEqual(
      (await clanStoryFacts(db, CLAN, { nowMs: NOW })).members,
      {},
    );
    assert.deepEqual(await clanStoryFacts(db, "#NOPE", { nowMs: NOW }), {
      clan: null,
      members: {},
    });
  } finally {
    await scratch.drop();
  }
});
