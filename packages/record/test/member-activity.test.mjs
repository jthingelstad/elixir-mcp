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
    await db.query("insert into player (player_tag) values ('#9QY'),('#9QU')");
    await db.query("insert into clan (clan_tag) values ('#PYL'),('#PYQ')");
    await db.query(`insert into battle (battle_id,battle_time,type,type_class) values
      ('kept','2026-10-01T12:00:00Z','pathOfLegend','pvp'),
      ('other-clan','2026-10-01T13:00:00Z','pathOfLegend','pvp'),
      ('other-member','2026-10-01T14:00:00Z','pathOfLegend','pvp'),
      ('pre-stint','2026-09-27T12:00:00Z','pathOfLegend','pvp')`);
    await db.query(`insert into battle_participant(battle_id,player_tag,clan_tag,side,outcome,battle_time,type,type_class)
      select battle_id,case when battle_id='other-member' then '#9QU' else '#9QY' end,
        case when battle_id='other-clan' then '#PYQ' else '#PYL' end,0,'win',battle_time,type,type_class from battle`);
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,clan_tag,donations,observed_at)
      values ('#9QY','2026-10-01','daily','#PYL',12,'2026-10-01T12:00:00Z'),
        ('#9QY','2026-10-02','daily','#PYQ',999,'2026-10-02T12:00:00Z')`);
    const weeks = [
      {
        iso_week: "2026-W40",
        from: "2026-09-28T00:00:00Z",
        to: "2026-10-05T00:00:00Z",
      },
    ];
    const rows = await memberActivityWeeks(
      db,
      "#PYL",
      "#9QY",
      weeks,
      "2026-09-28T00:00:00Z",
      "2026-10-04T00:00:00Z",
    );
    assert.deepEqual(rows, [
      { iso_week: "2026-W40", battles: 1, ranked_battles: 1, donations: 12 },
    ]);
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,clan_tag,donations,observed_at)
      values ('#9QY','2026-10-01','pre_reset','#PYL',99,'2026-10-01T18:00:00Z')`);
    const rejoined = await memberActivityWeeks(
      db,
      "#PYL",
      "#9QY",
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
