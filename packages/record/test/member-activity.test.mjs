import { ensureSeason } from "../src/season.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  memberActivityWeeks,
  memberActivityWarBounds,
} from "../src/member-activity.mjs";

test("member week counters exclude other clans, other players and pre-stint history", async () => {
  const scratch = await scratchDb("clan_member_activity");
  try {
    const db = scratch.db;
    await ensureSeason(db, "2026-09");
    const bounds = await memberActivityWarBounds(db, [
      { season_id: 136, section_index: 3 },
    ]);
    assert.deepEqual(bounds, [
      {
        season_id: 136,
        section_index: 3,
        from: "2026-09-28T10:00:00.000Z",
        to: "2026-10-05T10:00:00.000Z",
      },
    ]);
    await db.query("insert into player (player_tag) values ('#0GR'),('#0UJ')");
    await db.query("insert into clan (clan_tag) values ('#0C9'),('#0U9')");
    await db.query(`insert into battle (battle_id,battle_time,type,type_class) values
      ('kept','2026-10-01T12:00:00Z','pathOfLegend','pvp'),
      ('other-clan','2026-10-01T13:00:00Z','pathOfLegend','pvp'),
      ('other-member','2026-10-01T14:00:00Z','pathOfLegend','pvp'),
      ('pre-stint','2026-09-27T12:00:00Z','pathOfLegend','pvp')`);
    await db.query(`insert into battle_participant(battle_id,player_tag,clan_tag,side,outcome,battle_time,type,type_class)
      select battle_id,case when battle_id='other-member' then '#0UJ' else '#0GR' end,
        case when battle_id='other-clan' then '#0U9' else '#0C9' end,0,'win',battle_time,type,type_class from battle`);
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,clan_tag,donations,observed_at)
      values ('#0GR','2026-10-01','daily','#0C9',12,'2026-10-01T12:00:00Z'),
        ('#0GR','2026-10-02','daily','#0U9',999,'2026-10-02T12:00:00Z')`);
    const weeks = [
      {
        iso_week: "2026-W40",
        from: "2026-09-28T00:00:00Z",
        to: "2026-10-05T00:00:00Z",
      },
    ];
    const rows = await memberActivityWeeks(
      db,
      "#0C9",
      "#0GR",
      weeks,
      "2026-09-28T00:00:00Z",
      "2026-10-04T00:00:00Z",
    );
    assert.deepEqual(rows, [
      { iso_week: "2026-W40", battles: 1, ranked_battles: 1, donations: 12 },
    ]);
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,clan_tag,donations,observed_at)
      values ('#0GR','2026-10-01','pre_reset','#0C9',99,'2026-10-01T18:00:00Z')`);
    const rejoined = await memberActivityWeeks(
      db,
      "#0C9",
      "#0GR",
      weeks,
      "2026-10-01T15:00:00Z",
      "2026-10-04T00:00:00Z",
    );
    assert.deepEqual(rejoined, [
      { iso_week: "2026-W40", battles: 0, ranked_battles: 0, donations: null },
    ]);
  } finally {
    await scratch.drop();
  }
});

test("a member's week counts battles from Monday's reset to the next, on battle_time", async () => {
  const scratch = await scratchDb("clan_member_activity_reset");
  try {
    const db = scratch.db;
    await ensureSeason(db, "2026-09");
    await db.query("insert into player (player_tag) values ('#0GR')");
    await db.query("insert into clan (clan_tag) values ('#0C9')");
    await db.query(`insert into battle (battle_id,battle_time,type,type_class) values
      ('before-reset','2026-09-28T09:59:00Z','pathOfLegend','pvp'),
      ('at-reset','2026-09-28T10:00:00Z','pathOfLegend','pvp'),
      ('last-morning','2026-10-05T09:59:00Z','pathOfLegend','pvp'),
      ('next-week','2026-10-05T10:00:00Z','pathOfLegend','pvp')`);
    await db.query(`insert into battle_participant(battle_id,player_tag,clan_tag,side,outcome,battle_time,type,type_class)
      select battle_id,'#0GR','#0C9',0,'win',battle_time,type,type_class from battle`);
    const rows = await memberActivityWeeks(
      db,
      "#0C9",
      "#0GR",
      [
        {
          iso_week: "2026-W40",
          from: "2026-09-28T00:00:00Z",
          to: "2026-10-05T00:00:00Z",
        },
      ],
      "2026-09-01T00:00:00Z",
      "2026-10-20T00:00:00Z",
    );
    assert.equal(rows[0].battles, 2, "at-reset and last-morning, nothing else");
    assert.equal(rows[0].ranked_battles, 2);
    // Donations on the same clock: a read before the reset is the week closing.
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,clan_tag,donations,observed_at)
      values ('#0GR','2026-09-28','pre_reset','#0C9',80,'2026-09-28T09:00:00Z'),
        ('#0GR','2026-09-30','daily','#0C9',12,'2026-09-30T12:00:00Z')`);
    const donated = await memberActivityWeeks(
      db,
      "#0C9",
      "#0GR",
      [
        {
          iso_week: "2026-W40",
          from: "2026-09-28T00:00:00Z",
          to: "2026-10-05T00:00:00Z",
        },
      ],
      "2026-09-28T05:00:00Z",
      "2026-10-20T00:00:00Z",
    );
    assert.equal(donated[0].donations, 12);
    assert.equal(donated[0].battles, 2);
  } finally {
    await scratch.drop();
  }
});
