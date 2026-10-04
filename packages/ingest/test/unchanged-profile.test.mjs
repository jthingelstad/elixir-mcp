import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { processResult } from "../src/pipeline.mjs";
import { scratchDb } from "./helpers.mjs";

test("unchanged admitted profiles advance observation evidence without facts or points; rejected, failed, skipped and older deliveries cannot", async () => {
  const ctx = await scratchDb("unchanged_profile");
  try {
    const {
      rows: [account],
    } = await ctx.db.query(
      "insert into account(email_hash,status) values ('synthetic-unchanged','approved') returning account_id",
    );
    const {
      rows: [gateway],
    } = await ctx.db.query(
      "insert into gateway(owner_account_id,name,static_ip,status) values ($1,'synthetic-unchanged','127.0.0.1','active') returning gateway_id",
      [account.account_id],
    );
    const gatewayId = gateway.gateway_id;
    const message = ({
      endpoint,
      entityKey,
      payload,
      fetchedAt,
      status = "ok",
    }) => ({
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gatewayId,
      fetched_at: fetchedAt,
      status,
      ...(status === "ok"
        ? {
            body_gzip_b64: gzipSync(
              Buffer.from(JSON.stringify(payload)),
            ).toString("base64"),
          }
        : { http_status: 500 }),
    });
    const tag = "#9QQ";
    const payload = {
      tag,
      name: "Synthetic unchanged profile",
      battleCount: 100,
      wins: 60,
      losses: 40,
      trophies: 6000,
      donations: 0,
    };
    const at = (minute) => `2026-09-16T12:${minute}:00.000Z`;
    const deliver = (minute, overrides = {}, deps = {}) =>
      processResult(
        ctx.db,
        message({
          endpoint: "player",
          entityKey: tag,
          payload,
          fetchedAt: at(minute),
          ...overrides,
        }),
        deps,
      );
    const read = async () => {
      const { rows } = await ctx.db.query(
        `select battle_count, trophies, profile_observed_at, observed_at
       from player_snapshot_daily where player_tag=$1 and snapshot_kind='daily'
         and snapshot_date='2026-09-16'`,
        [tag],
      );
      return rows[0];
    };
    const points = async () =>
      (
        await ctx.db.query(
          "select fetch_points from gateway where gateway_id=$1",
          [gatewayId],
        )
      ).rows[0].fetch_points;
    assert.equal((await deliver("00")).outcome, "admitted");
    const before = await points();
    const repeat = await deliver("10");
    assert.equal(repeat.outcome, "admitted");
    assert.equal(repeat.projection.facts, 0);
    assert.equal(await points(), before);
    assert.equal((await read()).profile_observed_at.toISOString(), at("10"));
    const receipts = await ctx.db.query(
      `select fetched_at, payload_hash, admission, new_facts from api_receipt
     where endpoint='player' and entity_key=$1 order by fetched_at`,
      [tag],
    );
    assert.equal(receipts.rows.length, 2);
    assert.equal(receipts.rows[0].payload_hash, receipts.rows[1].payload_hash);
    assert.equal(receipts.rows[1].admission, "admitted");
    assert.equal(receipts.rows[1].new_facts, 0);

    // Duplicate and delayed deliveries never replace the measured-through time.
    assert.equal((await deliver("10")).outcome, "duplicate");
    assert.equal((await deliver("05")).projection.facts, 0);
    assert.equal((await read()).profile_observed_at.toISOString(), at("10"));
    assert.equal(
      (await deliver("20", { payload: { ...payload, name: null } })).outcome,
      "rejected",
    );
    assert.equal(
      (await deliver("25", { status: "error", http_status: 500 })).outcome,
      "fetch_error",
    );
    assert.equal(
      (await deliver("30", {}, { skipProjection: true })).outcome,
      "admitted",
    );
    assert.equal((await read()).profile_observed_at.toISOString(), at("10"));

    // A newer roster observation owns shared values. A delayed unchanged
    // profile can advance its own stamp without replacing that roster.
    await ctx.db.query(
      `update player_snapshot_daily set trophies=6100, observed_at=$2,
       roster_observed_at=$2 where player_tag=$1 and snapshot_kind='daily'`,
      [tag, at("50")],
    );
    assert.equal((await deliver("40")).projection.facts, 0);
    const row = await read();
    assert.equal(row.profile_observed_at.toISOString(), at("40"));
    assert.equal(row.observed_at.toISOString(), at("50"));
    assert.equal(row.battle_count, 100);
    assert.equal(row.trophies, 6100);
    assert.equal(await points(), before);
  } finally {
    await ctx.drop();
  }
});
