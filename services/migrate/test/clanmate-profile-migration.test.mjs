import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scratchDb,
  seedReceipt,
} from "../../../packages/ingest/test/helpers.mjs";

test("existing clan evidence needs a matching admitted profile body at its precise observation", async () => {
  const ctx = await scratchDb("clanmate_profile_migration");
  try {
    const db = ctx.db;
    const known = "#0PGQ2UYL",
      missing = "#0RJ29CVY",
      conflict = "#0LYQ8GRP";
    const clan = "#0PPPG9";
    await db.query("alter table clan drop column roster_observed_at");
    await db.query(
      "alter table player_profile_membership drop column clan_tag, drop column clan_observed_at",
    );
    const receipt = await seedReceipt(db, {
      endpoint: "player",
      entityKey: known,
    });
    const {
      rows: [{ gateway_id, fetched_at }],
    } = await db.query(
      "select gateway_id,date_trunc('seconds',fetched_at) as fetched_at from api_receipt where receipt_id=$1",
      [receipt],
    );
    await db.query("update api_receipt set fetched_at=$1 where receipt_id=$2", [
      fetched_at,
      receipt,
    ]);
    await db.query(
      "insert into player(player_tag,last_known_clan_tag) select tag,$2 from unnest($1::text[]) tag",
      [[known, missing, conflict], clan],
    );
    await db.query(
      "insert into player_profile_membership(player_tag,state,observed_at) select player_tag,'member',$1 from player",
      [fetched_at],
    );
    const {
      rows: [other],
    } = await db.query(
      "insert into gateway(owner_account_id,name,static_ip,status) select owner_account_id,'other-reader','127.0.0.2','active' from gateway where gateway_id=$1 returning gateway_id",
      [gateway_id],
    );
    for (const [tag, hash, observedClan] of [
      [known, "test-hash", clan],
      [conflict, "first", clan],
      [conflict, "second", "#0QC8RCGY"],
    ]) {
      await db.query(
        "insert into api_payload(endpoint,entity_key,payload_hash,payload_json) values('player',$1,$2,$3)",
        [tag, hash, JSON.stringify({ tag, clan: { tag: observedClan } })],
      );
      if (tag === conflict)
        await db.query(
          "insert into api_receipt(endpoint,entity_key,payload_hash,fetched_at,gateway_id,admission) values('player',$1,$2,$3,$4,'admitted')",
          [
            tag,
            hash,
            fetched_at,
            hash === "second" ? other.gateway_id : gateway_id,
          ],
        );
    }
    const migration = readFileSync(
      new URL(
        "../../../db/migrations/0305_profile_clan_observation.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(migration);
    const { rows } = await db.query(
      "select player_tag,clan_tag from player_profile_membership",
    );
    assert.deepEqual(
      Object.fromEntries(rows.map((row) => [row.player_tag, row.clan_tag])),
      { [known]: clan, [missing]: null, [conflict]: null },
    );
    await db.query(
      "update player_profile_membership set observed_at=observed_at+interval '1 second' where player_tag=$1",
      [known],
    );
    const {
      rows: [row],
    } = await db.query(
      "select clan_observed_at=observed_at as current from player_profile_membership where player_tag=$1",
      [known],
    );
    assert.equal(
      row.current,
      false,
      "a previous Lambda advancing state cannot advance the old tag's timestamp",
    );
  } finally {
    await ctx.drop();
  }
});
