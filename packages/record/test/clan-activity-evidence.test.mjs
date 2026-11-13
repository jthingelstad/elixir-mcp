import test from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { clanActivityEvidence } from "../src/clan-activity-evidence.mjs";
import { inactivityEvidence } from "@elixir-mcp/clan-engine";

test("private activity proof is batched for current clan members and uses daily profile stamps, never roster or reset stamps", async () => {
  const scratch = await scratchDb("clan_removal_evidence");
  try {
    const db = scratch.db;
    await db.query("insert into clan (clan_tag) values ('#0C9'),('#0U9')");
    await db.query(
      "insert into player (player_tag) values ('#0GR'),('#0UJ'),('#0GV')",
    );
    await db.query(`insert into clan_membership(clan_tag,player_tag,role,joined_observed_at,left_observed_at) values
      ('#0C9','#0GR','member',now()-interval '30 days',null),
      ('#0U9','#0UJ','member',now()-interval '30 days',null),
      ('#0C9','#0GV','member',now()-interval '30 days',now()-interval '2 days')`);
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,battle_count,profile_observed_at,observed_at)
      values ('#0GR',current_date-2,'daily',100,now()-interval '2 days',now()),
      ('#0GR',current_date-1,'daily',101,now()-interval '1 day',now()),
      ('#0GR',current_date,'pre_reset',999,now(),now())`);
    await db.query(`insert into battle(battle_id,battle_time,type,type_class,boat_battle_side) values
      ('own-attack',now()-interval '3 days','boatBattle','pvp','attacker'),
      ('automatic-defense',now()-interval '1 hour','boatBattle','pvp','defender')`);
    await db.query(`insert into battle_participant(battle_id,player_tag,clan_tag,side,outcome,battle_time,type,type_class)
      select battle_id,'#0GR','#0C9',0,'win',battle_time,type,type_class from battle`);
    const evidence = await clanActivityEvidence(db, "#0C9", [
      "#0GR",
      "#0UJ",
      "#0GV",
    ]);
    assert.deepEqual([...evidence.keys()], ["#0GR"]);
    const rows = evidence.get("#0GR").activity_evidence.observations;
    assert.deepEqual(
      rows.map((r) => r.battle_count),
      [100, 101],
    );
    assert.ok(
      Date.parse(rows[1].profile_observed_at) < Date.now() - 23 * 3600_000,
    );
    assert.equal(evidence.get("#0GR").activity_evidence.current_member, true);
    assert.ok(
      Date.parse(evidence.get("#0GR").last_battle_time) <
        Date.now() - 2 * 86400_000,
    );
    // The last battle's mode rides with it (#532): the boat attack, never
    // the later automatic defense.
    assert.equal(evidence.get("#0GR").last_battle_mode_group, "war");
    assert.equal(evidence.get("#0GR").last_battle_game_mode, null);
    await db.query(
      `update battle set game_mode_name='CW_Battle_1v1' where battle_id='own-attack'`,
    );
    assert.equal(
      (await clanActivityEvidence(db, "#0C9", ["#0GR"])).get("#0GR")
        .last_battle_game_mode,
      "CW_Battle_1v1",
    );
    await db.query(
      `update player_snapshot_daily set battle_count=102 where player_tag='#0GR' and snapshot_kind='daily' and snapshot_date=current_date-1`,
    );
    assert.equal(
      (await clanActivityEvidence(db, "#0C9", ["#0GR"])).get("#0GR")
        .activity_evidence.observations[1].battle_count,
      102,
    );
    assert.equal((await clanActivityEvidence(db, "#0C9", [])).size, 0);
  } finally {
    await scratch.drop();
  }
});

test("roster-only and absent daily rows remain gaps between genuine profile observations", async () => {
  const scratch = await scratchDb("clan_profile_gaps");
  try {
    const db = scratch.db;
    await db.query("insert into clan(clan_tag) values ('#0C9')");
    await db.query("insert into player(player_tag) values ('#0GR')");
    await db.query(
      "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values ('#0C9','#0GR','member',now()-interval '30 days')",
    );
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,battle_count,profile_observed_at,observed_at) values
      ('#0GR',current_date-5,'daily',null,null,now()),
      ('#0GR',current_date-4,'daily',100,now()-interval '4 days',now()),
      ('#0GR',current_date-3,'daily',null,null,now()),
      ('#0GR',current_date-1,'daily',101,now()-interval '1 day',now())`);
    const m = (await clanActivityEvidence(db, "#0C9", ["#0GR"])).get("#0GR");
    assert.deepEqual(
      m.activity_evidence.observations.map((r) => r.battle_count),
      [100, 101],
    );
    assert.equal(m.activity_evidence.profile_gaps.length, 2);
    assert.ok(
      m.activity_evidence.profile_gaps.every(
        (g) =>
          g.snapshot_date > m.activity_evidence.observations[0].snapshot_date,
      ),
    );
    const proof = inactivityEvidence(m, Date.now());
    // Missing profile days never hold the clock; the rise across the gap
    // is play, and the clock runs from the read that saw it.
    assert.equal(proof.status, "ready");
    assert.equal(proof.latest_activity_interval.counter_increase, 1);
    assert.ok(Math.abs(proof.days_since_possible_activity - 1) < 0.01);
  } finally {
    await scratch.drop();
  }
});
