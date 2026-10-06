import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { scratchDb, seedReceipt, fixture } from "../../ingest/test/helpers.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { readMembershipCapture } from "../src/membership-capture.mjs";

test("membership projection uses admitted source observations, surviving uncached bulk capture and replay", async () => {
  const scratch = await scratchDb("membership_capture");
  try {
    const db = scratch.db;
    const profile = await fixture("player/profile.json");
    const tag = profile.tag;
    const receipt = await seedReceipt(db, {
      endpoint: "player",
      entityKey: tag,
    });
    const {
      rows: [seed],
    } = await db.query(
      "select gateway_id from api_receipt where receipt_id=$1",
      [receipt],
    );
    await db.query("delete from api_receipt where receipt_id=$1", [receipt]);
    const {
      rows: [second],
    } = await db.query(
      `insert into gateway(owner_account_id,name,static_ip,status)
      select owner_account_id,'second-observer','127.0.0.2','active'
      from gateway where gateway_id=$1 returning gateway_id`,
      [seed.gateway_id],
    );
    const put = async (stamp, payload, gateway = seed.gateway_id, deps = {}) =>
      processResult(
        db,
        {
          v: 1,
          job: { endpoint: "player", entity_key: tag, lane: "bulk" },
          gateway_id: gateway,
          fetched_at: stamp,
          status: "ok",
          body_gzip_b64: gzipSync(
            Buffer.from(JSON.stringify(payload)),
          ).toString("base64"),
        },
        deps,
      );
    const evidence = async () =>
      (await readMembershipCapture(db, [tag])).get(tag);
    assert.equal(await evidence(), undefined);
    await db.query(
      "insert into player(player_tag,name,first_seen_at,last_seen_at) values($1,'Legacy player','2026-08-31','2026-08-31')",
      [tag],
    );
    assert.equal((await evidence()).state, "unknown");
    await put("2026-09-01T12:00:00Z", profile);
    assert.deepEqual(await evidence(), {
      state: "member",
      observed_at: "2026-09-01T12:00:00.000Z",
    });
    const absent = { ...profile };
    delete absent.clan;
    await put("2026-09-02T12:00:00Z", absent);
    assert.deepEqual(await evidence(), {
      state: "none",
      observed_at: "2026-09-02T12:00:00.000Z",
    });
    const {
      rows: [row],
    } = await db.query(
      "select last_known_clan_tag from player where player_tag=$1",
      [tag],
    );
    assert.equal(
      row.last_known_clan_tag,
      profile.clan.tag,
      "retained tag is not current membership evidence",
    );
    await put("2026-09-02T13:00:00Z", absent);
    assert.equal(
      (await evidence()).observed_at,
      "2026-09-02T13:00:00.000Z",
      "unchanged capture advances its observation",
    );
    await put("2026-09-03T12:00:00Z", { ...absent, name: null });
    assert.equal(
      (await evidence()).state,
      "none",
      "rejected profile establishes nothing",
    );
    await put("2026-09-01T13:00:00Z", profile);
    assert.equal(
      (await evidence()).state,
      "none",
      "old replay cannot regress membership",
    );
    await put("2026-09-04T12:00:00Z", { ...absent, clan: {} });
    assert.equal((await evidence()).state, "unknown");
    await put("2026-09-05T12:00:00Z", profile);
    await put("2026-09-05T12:00:00Z", absent, second.gateway_id);
    assert.equal(
      (await evidence()).state,
      "unknown",
      "same-time conflicting observers fail closed",
    );
    await put("2026-09-05T12:00:00Z", profile, second.gateway_id);
    assert.equal(
      (await evidence()).state,
      "unknown",
      "redelivery cannot settle a conflict",
    );
    await put("2026-09-06T12:00:00Z", { ...absent, clan: null });
    assert.equal((await evidence()).state, "none");
    await db.query("delete from api_payload");
    assert.equal(
      (await evidence()).state,
      "none",
      "rolling cache expiry cannot erase evidence",
    );
    await put("2026-09-07T12:00:00Z", profile, seed.gateway_id, {
      skipProjection: true,
    });
    assert.equal(
      (await evidence()).state,
      "unknown",
      "an admitted unprojected observation leaves a gap",
    );
  } finally {
    await scratch.drop();
  }
});
