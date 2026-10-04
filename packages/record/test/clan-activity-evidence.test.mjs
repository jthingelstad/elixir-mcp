import test from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { clanActivityEvidence } from "../src/clan-activity-evidence.mjs";
import { inactivityEvidence } from "@elixir-mcp/clan-engine";

test("private activity proof is batched for current clan members and uses daily profile stamps, never roster or reset stamps", async () => {
  const scratch = await scratchDb("clan_removal_evidence");
  try {
    const db = scratch.db;
    await db.query("insert into clan (clan_tag) values ('#PYL'),('#PYQ')");
    await db.query(
      "insert into player (player_tag) values ('#9QY'),('#9QU'),('#9QV')",
    );
    await db.query(`insert into clan_membership(clan_tag,player_tag,role,joined_observed_at,left_observed_at) values
      ('#PYL','#9QY','member',now()-interval '30 days',null),
      ('#PYQ','#9QU','member',now()-interval '30 days',null),
      ('#PYL','#9QV','member',now()-interval '30 days',now()-interval '2 days')`);
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,battle_count,profile_observed_at,observed_at)
      values ('#9QY',current_date-2,'daily',100,now()-interval '2 days',now()),
      ('#9QY',current_date-1,'daily',101,now()-interval '1 day',now()),
      ('#9QY',current_date,'pre_reset',999,now(),now())`);
    await db.query(`insert into battle(battle_id,battle_time,type,type_class,boat_battle_side) values
      ('own-attack',now()-interval '3 days','boatBattle','pvp','attacker'),
      ('automatic-defense',now()-interval '1 hour','boatBattle','pvp','defender')`);
    await db.query(`insert into battle_participant(battle_id,player_tag,clan_tag,side,outcome,battle_time,type,type_class)
      select battle_id,'#9QY','#PYL',0,'win',battle_time,type,type_class from battle`);
    const evidence = await clanActivityEvidence(db, "#PYL", [
      "#9QY",
      "#9QU",
      "#9QV",
    ]);
    assert.deepEqual([...evidence.keys()], ["#9QY"]);
    const rows = evidence.get("#9QY").activity_evidence.observations;
    assert.deepEqual(
      rows.map((r) => r.battle_count),
      [100, 101],
    );
    assert.ok(
      Date.parse(rows[1].profile_observed_at) < Date.now() - 23 * 3600_000,
    );
    assert.equal(evidence.get("#9QY").activity_evidence.current_member, true);
    assert.ok(
      Date.parse(evidence.get("#9QY").last_battle_time) <
        Date.now() - 2 * 86400_000,
    );
    await db.query(
      `update player_snapshot_daily set battle_count=102 where player_tag='#9QY' and snapshot_kind='daily' and snapshot_date=current_date-1`,
    );
    assert.equal(
      (await clanActivityEvidence(db, "#PYL", ["#9QY"])).get("#9QY")
        .activity_evidence.observations[1].battle_count,
      102,
    );
    assert.equal((await clanActivityEvidence(db, "#PYL", [])).size, 0);
  } finally {
    await scratch.drop();
  }
});

test("roster-only and absent daily rows remain gaps between genuine profile observations", async () => {
  const scratch = await scratchDb("clan_profile_gaps");
  try {
    const db = scratch.db;
    await db.query("insert into clan(clan_tag) values ('#PYL')");
    await db.query("insert into player(player_tag) values ('#9QY')");
    await db.query(
      "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values ('#PYL','#9QY','member',now()-interval '30 days')",
    );
    await db.query(`insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,battle_count,profile_observed_at,observed_at) values
      ('#9QY',current_date-5,'daily',null,null,now()),
      ('#9QY',current_date-4,'daily',100,now()-interval '4 days',now()),
      ('#9QY',current_date-3,'daily',null,null,now()),
      ('#9QY',current_date-1,'daily',101,now()-interval '1 day',now())`);
    const m = (await clanActivityEvidence(db, "#PYL", ["#9QY"])).get("#9QY");
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
    assert.equal(proof.status, "held");
    assert.match(proof.reason, /observations are missing/);
    assert.equal(proof.latest_activity_interval, null);
    assert.equal(proof.counter_quiet_days, null);
  } finally {
    await scratch.drop();
  }
});
