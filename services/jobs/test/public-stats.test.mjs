import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { publishPublicStats } from "../src/public-stats.mjs";
import {
  calculatePublicStats,
  readPublicStats,
} from "@elixir-mcp/tools/public-stats";

test("the public projection preserves the counts, replaces atomically and falls back when stale", async () => {
  const scratch = await scratchDb("public_stats_web");
  try {
    const direct = await readPublicStats(scratch.db);
    await publishPublicStats(scratch.url);
    const snapshot = await readPublicStats(scratch.db);
    assert.deepEqual(snapshot.totals, direct.totals);
    assert.deepEqual(snapshot.series, direct.series);
    assert.ok(snapshot.as_of);
    await publishPublicStats(scratch.url);
    assert.equal(
      (
        await scratch.db.query(
          "select count(*)::int as n from public_stats_cache",
        )
      ).rows[0].n,
      1,
    );
    await scratch.db.query(
      "update public_stats_cache set payload = '{\"fictional_stale\":true}', updated_at = now() - interval '3 hours'",
    );
    assert.equal(
      (await readPublicStats(scratch.db)).fictional_stale,
      undefined,
    );
  } finally {
    await scratch.drop();
  }
});

/**
 * The hourly refresh recounts only the days new receipts reached
 * (2026-10-21, platform review §3). Whatever it reuses, the snapshot must
 * equal a full count of the record at the time.
 */
test("the fetch series refreshed in part equals a full count", async () => {
  const scratch = await scratchDb("public_stats_fetches");
  const { db } = scratch;
  try {
    const {
      rows: [account],
    } = await db.query(
      `insert into account (email_hash, status, is_owner, role)
       values ('stats-owner', 'approved', true, 'owner') returning account_id`,
    );
    const gw = {};
    for (const name of ["alpha", "beta", "backfill-elixir-bot"]) {
      const {
        rows: [g],
      } = await db.query(
        `insert into gateway (owner_account_id, name, status)
         values ($1, $2, 'active') returning gateway_id`,
        [account.account_id, name],
      );
      gw[name] = g.gateway_id;
    }
    let key = 0;
    // n receipts per collector, fetched `daysAgo` days ago.
    const receipts = async (name, daysAgo, n) => {
      for (let i = 0; i < n; i++)
        await db.query(
          `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
           values ('clan', $1, now() - make_interval(days => $2, mins => $3), 'h', $4, 'admitted')`,
          [`#K${key++}`, daysAgo, i * 7, gw[name]],
        );
    };
    const full = async () =>
      (await calculatePublicStats(db)).series.fetches_daily;
    const stored = async () =>
      (
        await db.query(
          "select payload->'series'->'fetches_daily' as series, state from public_stats_cache",
        )
      ).rows[0];
    // Pretend the marks were taken an hour apart, as the hourly job takes
    // them; through stays what each refresh saw.
    const ageMarks = async () =>
      db.query(
        `update public_stats_cache set state = jsonb_set(state, '{fetches_daily,marks}',
           (select jsonb_agg(jsonb_set(m, '{at}',
                     to_jsonb(now() - make_interval(hours => (cnt - ord)::int + 1)))
                     order by ord)
              from jsonb_array_elements(state->'fetches_daily'->'marks')
                   with ordinality as e(m, ord),
                   lateral (select jsonb_array_length(state->'fetches_daily'->'marks') as cnt) c))`,
      );

    for (const d of [9, 6, 3, 1, 0]) {
      await receipts("alpha", d, 3);
      await receipts("beta", d, 2);
      await receipts("backfill-elixir-bot", d, 4);
    }
    // No state yet: a full count.
    let result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, "all");
    assert.deepEqual((await stored()).series, await full());

    // A second refresh at once has no mark an hour older than the last:
    // still a full count.
    await receipts("alpha", 0, 1);
    result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, "all");
    assert.deepEqual((await stored()).series, await full());

    // An hour on: new receipts today and one replayed into a day six days
    // back. Only those days are recounted, and the series is exact.
    await ageMarks();
    await receipts("beta", 0, 2);
    await receipts("alpha", 6, 1);
    result = await publishPublicStats(scratch.url);
    const sixDaysAgo = (
      await db.query(
        "select ((now() - interval '6 days') at time zone 'UTC')::date::text as d",
      )
    ).rows[0].d;
    assert.ok(
      result.fetches_recounted <= sixDaysAgo,
      `recounted from ${result.fetches_recounted}`,
    );
    assert.notEqual(result.fetches_recounted, "all");
    assert.deepEqual((await stored()).series, await full());

    // A receipt in flight at the last refresh: committed after it, with an
    // id below what it saw. Built here as a last mark whose `through`
    // already covers receipts its stored series lacks. The recount starts
    // from the mark an hour before, so they are counted.
    const before = await stored();
    await receipts("alpha", 9, 2);
    const {
      rows: [{ top }],
    } = await db.query("select max(receipt_id)::text as top from api_receipt");
    await db.query(
      `update public_stats_cache set state = jsonb_set(state, '{fetches_daily,marks}',
         (state->'fetches_daily'->'marks') ||
         jsonb_build_array(jsonb_build_object('through', $1::text, 'at', now()::text))),
         payload = jsonb_set(payload, '{series,fetches_daily}', $2::jsonb)`,
      [top, JSON.stringify(before.series)],
    );
    await ageMarks();
    result = await publishPublicStats(scratch.url);
    assert.notEqual(result.fetches_recounted, "all");
    assert.deepEqual((await stored()).series, await full());

    // A deleted receipt moves the table's delete counter: a full count.
    await ageMarks();
    await db.query(
      `delete from api_receipt where receipt_id =
         (select min(receipt_id) from api_receipt where gateway_id = $1)`,
      [gw.alpha],
    );
    await db.query("select pg_stat_force_next_flush()");
    await db.query("select 1");
    result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, "all");
    assert.deepEqual((await stored()).series, await full());

    // A migration that deletes a receipt forces a full count even while
    // the delete counter has not caught up: statistics reach other
    // sessions a second or more after the commit. The stored counter is
    // set to the current one, as a refresh in that second would see it.
    await ageMarks();
    await db.query("begin");
    await db.query(
      `delete from api_receipt where receipt_id =
         (select min(receipt_id) from api_receipt where gateway_id = $1)`,
      [gw.alpha],
    );
    await db.query(
      `insert into schema_migrations (id, name, sha256)
       select max(id) + 1, 'fictional_receipt_removal', 'test' from schema_migrations`,
    );
    await db.query("commit");
    await db.query("select pg_stat_force_next_flush()");
    await db.query("select 1");
    await db.query(
      `update public_stats_cache set state = jsonb_set(state, '{fetches_daily,deleted}',
         to_jsonb((select n_tup_del from pg_stat_user_tables
                    where relid = 'api_receipt'::regclass)::text))`,
    );
    result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, "all");
    assert.deepEqual((await stored()).series, await full());

    // Nothing new: the series is reused as it stands.
    await ageMarks();
    result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, null);
    assert.deepEqual((await stored()).series, await full());

    // A collector renamed to the backfill name leaves the series: a full
    // count, though no receipt moved.
    await ageMarks();
    await db.query(
      "update gateway set name = 'backfill-elixir-bot' where gateway_id = $1",
      [gw.beta],
    );
    result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, "all");
    assert.deepEqual((await stored()).series, await full());

    // A day after the last full count, the next is full whatever else held.
    const lastFull = (hours) =>
      db.query(
        `update public_stats_cache set state = jsonb_set(state, '{fetches_daily,full_at}',
           to_jsonb(now() - make_interval(hours => $1)))`,
        [hours],
      );
    await ageMarks();
    await lastFull(23);
    result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, null);
    await ageMarks();
    await lastFull(25);
    result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, "all");
    await ageMarks();
    result = await publishPublicStats(scratch.url);
    assert.equal(result.fetches_recounted, null);

    // The bookkeeping is never served.
    const served = await readPublicStats(db);
    assert.equal(JSON.stringify(served).includes("marks"), false);
    assert.equal(served.state, undefined);
  } finally {
    await scratch.drop();
  }
});
