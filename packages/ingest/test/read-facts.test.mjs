/**
 * The read facts (0259): ingest writes them with each admitted read, the
 * readers answer from them alone, and {read_facts_backfill} fills them
 * from the receipts held, resumably and idempotently, to the same rows.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { scratchDb } from "./helpers.mjs";
import { processResult } from "../src/pipeline.mjs";
import {
  recordReadFacts,
  daysSincePollSql,
  rosterReadAtOrBefore,
  rosterReadAtOrAfter,
  roleHistorySinceSql,
  backfillReadFacts,
  checkReadFacts,
} from "@elixir-mcp/record/read-facts";

const PLAYER = "#0QYRL2C";
const OTHER = "#0PRY9LJ";
const NEVER = "#0GJ2UQY";
const CLAN = "#0CUV8RG";

async function gateways(db) {
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('read-facts', 'approved', true)
     returning account_id`,
  );
  const gw = async (name) =>
    (
      await db.query(
        `insert into gateway (owner_account_id, name, static_ip, status)
         values ($1, $2, '127.0.0.1', 'active') returning gateway_id`,
        [owner.account_id, name],
      )
    ).rows[0].gateway_id;
  return {
    live: await gw("collector-a"),
    imported: await gw("backfill-elixir-bot"),
  };
}

/** One admitted battle-log read as the pipeline makes it: receipt, fact,
 *  then poll_state. */
async function battlelogRead(db, gatewayId, tag, at) {
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('player_battlelog', $1, $2, 'h', $3, 'admitted')`,
    [tag, at, gatewayId],
  );
  await recordReadFacts(db, {
    endpoint: "player_battlelog",
    entityKey: tag,
    fetchedAt: at,
    gatewayId,
  });
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ($1, 'player_battlelog', $2)
     on conflict (subject_tag, endpoint) do update set last_admitted_at =
       greatest(poll_state.last_admitted_at, excluded.last_admitted_at)`,
    [tag, at],
  );
}

async function rosterRead(db, gatewayId, at) {
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('clan', $1, $2, 'h', $3, 'admitted')`,
    [CLAN, at, gatewayId],
  );
  await recordReadFacts(db, {
    endpoint: "clan",
    entityKey: CLAN,
    fetchedAt: at,
    gatewayId,
  });
}

const gapsOf = async (db, tag) =>
  (
    await db.query(
      `select read_at, next_read_at from battlelog_read_gap
        where player_tag = $1 order by next_read_at`,
      [tag],
    )
  ).rows.map((r) => [
    r.read_at?.toISOString() ?? null,
    r.next_read_at.toISOString(),
  ]);

const daysSince = async (db, tag, at) => {
  const ms = Date.parse(at);
  const {
    rows: [r],
  } = await db.query(
    `select ${daysSincePollSql("$1", "$2::timestamptz", "$3::timestamptz")} as d`,
    [tag, new Date(ms).toISOString(), new Date(ms + 1).toISOString()],
  );
  return r.d;
};

/** What a whole table holds, to compare ingest's rows with the backfill's. */
const snapshot = async (db) => ({
  days: (
    await db.query(
      `select endpoint, entity_key, day::text,
              array(select x from unnest(read_at) x order by x) as read_at, first_live_at
         from admitted_read_day order by 1, 2, 3`,
    )
  ).rows,
  gaps: (
    await db.query(
      `select player_tag, read_at, next_read_at from battlelog_read_gap order by 1, 3`,
    )
  ).rows,
});

test("the pipeline writes a read's fact with its admission", async () => {
  const scratch = await scratchDb("read_facts_pipeline");
  try {
    const { db } = scratch;
    const { live } = await gateways(db);
    const out = await processResult(db, {
      v: 1,
      job: { endpoint: "player_battlelog", entity_key: PLAYER, lane: "bulk" },
      gateway_id: live,
      fetched_at: "2026-10-01T12:00:00Z",
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from("[]")).toString("base64"),
    });
    assert.equal(out.outcome, "admitted", JSON.stringify(out));
    assert.deepEqual(await gapsOf(db, PLAYER), [
      [null, "2026-10-01T12:00:00.000Z"],
    ]);
  } finally {
    await scratch.drop();
  }
});

test("battle-log stretches: a day or more unread is a row, a late read splits one, and days_since_poll reads them", async () => {
  const scratch = await scratchDb("read_facts_gaps");
  try {
    const { db } = scratch;
    const { live } = await gateways(db);
    await battlelogRead(db, live, PLAYER, "2026-10-01T00:00:00Z");
    await battlelogRead(db, live, PLAYER, "2026-10-01T20:00:00Z"); // under a day
    await battlelogRead(db, live, PLAYER, "2026-10-05T20:00:00Z"); // four days
    await battlelogRead(db, live, PLAYER, "2026-10-06T08:00:00Z");
    assert.deepEqual(await gapsOf(db, PLAYER), [
      [null, "2026-10-01T00:00:00.000Z"],
      ["2026-10-01T20:00:00.000Z", "2026-10-05T20:00:00.000Z"],
    ]);

    // Before the first read: no read to count from.
    assert.equal(await daysSince(db, PLAYER, "2026-09-30T00:00:00Z"), null);
    // A read at the instant counts.
    assert.equal(await daysSince(db, PLAYER, "2026-10-01T00:00:00Z"), 0);
    // Inside the stretch, from its opening read.
    assert.equal(await daysSince(db, PLAYER, "2026-10-04T21:00:00Z"), 3);
    // Outside any stretch: under a day from a read.
    assert.equal(await daysSince(db, PLAYER, "2026-10-01T22:00:00Z"), 0);
    // After the latest read, from poll_state.
    assert.equal(await daysSince(db, PLAYER, "2026-10-09T09:00:00Z"), 3);
    // Never read.
    assert.equal(await daysSince(db, NEVER, "2026-10-09T09:00:00Z"), null);

    // A read admitted late, inside the four-day stretch, splits it into
    // the parts still a day or more.
    await battlelogRead(db, live, PLAYER, "2026-10-03T08:00:00Z");
    assert.deepEqual(await gapsOf(db, PLAYER), [
      [null, "2026-10-01T00:00:00.000Z"],
      ["2026-10-01T20:00:00.000Z", "2026-10-03T08:00:00.000Z"],
      ["2026-10-03T08:00:00.000Z", "2026-10-05T20:00:00.000Z"],
    ]);
    assert.equal(await daysSince(db, PLAYER, "2026-10-04T21:00:00Z"), 1);
    // A late read under a day from both ends leaves no stretch.
    await battlelogRead(db, live, PLAYER, "2026-10-02T12:00:00Z");
    assert.deepEqual(await gapsOf(db, PLAYER), [
      [null, "2026-10-01T00:00:00.000Z"],
      ["2026-10-03T08:00:00.000Z", "2026-10-05T20:00:00.000Z"],
    ]);
    // A late read before the first moves the first.
    await battlelogRead(db, live, PLAYER, "2026-09-28T00:00:00Z");
    assert.deepEqual((await gapsOf(db, PLAYER)).slice(0, 2), [
      [null, "2026-09-28T00:00:00.000Z"],
      ["2026-09-28T00:00:00.000Z", "2026-10-01T00:00:00.000Z"],
    ]);
    assert.equal(await daysSince(db, PLAYER, "2026-09-30T00:00:00Z"), 2);

    // The backfill writes the same rows from the receipts alone.
    const ingested = await snapshot(db);
    await db.query("truncate battlelog_read_gap, admitted_read_day");
    const out = await backfillReadFacts(db, {});
    assert.equal(out.done, true);
    assert.deepEqual(await snapshot(db), ingested);
  } finally {
    await scratch.drop();
  }
});

test("roster reads by day: the reads either side of an instant, and role history from the first live read", async () => {
  const scratch = await scratchDb("read_facts_days");
  try {
    const { db } = scratch;
    const { live, imported } = await gateways(db);
    await rosterRead(db, imported, "2026-08-01T10:00:00Z");
    await rosterRead(db, live, "2026-10-01T23:00:00Z");
    await rosterRead(db, live, "2026-10-01T09:00:00Z"); // late, same day
    await rosterRead(db, live, "2026-10-03T01:00:00Z");
    // A replay of that read (the receipt is unique; the fact is written again).
    await recordReadFacts(db, {
      endpoint: "clan",
      entityKey: CLAN,
      fetchedAt: "2026-10-03T01:00:00Z",
      gatewayId: live,
    });
    const one = async (sql, ...args) => (await db.query(sql, args)).rows[0];
    const around = async (at) =>
      one(
        `select ${rosterReadAtOrBefore("$1", "$2::timestamptz")} as before,
                ${rosterReadAtOrAfter("$1", "$2::timestamptz")} as after`,
        CLAN,
        at,
      );
    assert.deepEqual(await around("2026-10-02T12:00:00Z"), {
      before: new Date("2026-10-01T23:00:00Z"),
      after: new Date("2026-10-03T01:00:00Z"),
    });
    assert.deepEqual(await around("2026-10-03T01:00:00Z"), {
      before: new Date("2026-10-03T01:00:00Z"),
      after: new Date("2026-10-03T01:00:00Z"),
    });
    assert.deepEqual(await around("2026-07-01T00:00:00Z"), {
      before: null,
      after: new Date("2026-08-01T10:00:00Z"),
    });
    assert.equal(
      (
        await one(roleHistorySinceSql("$1"), CLAN)
      ).role_history_since.toISOString(),
      "2026-10-01T09:00:00.000Z",
      "the first live read, never the import's",
    );
    const {
      rows: [day],
    } = await db.query(
      `select cardinality(read_at) as n from admitted_read_day
        where entity_key = $1 and day = '2026-10-03'`,
      [CLAN],
    );
    assert.equal(day.n, 1, "a replayed read is one instant");

    const ingested = await snapshot(db);
    await db.query("truncate admitted_read_day");
    assert.equal((await backfillReadFacts(db, {})).done, true);
    assert.deepEqual(await snapshot(db), ingested);
  } finally {
    await scratch.drop();
  }
});

test("{read_facts_backfill} resumes from its cursor, writes nothing twice, and the check reads 0 missing", async () => {
  const scratch = await scratchDb("read_facts_backfill");
  try {
    const { db } = scratch;
    const { live } = await gateways(db);
    await db.query(
      `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
       values ('clan', $1, '2026-10-01T10:00:00Z', 'h', $4, 'admitted'),
              ('clan', $1, '2026-10-02T10:00:00Z', 'h', $4, 'admitted'),
              ('clan', $1, '2026-10-02T11:00:00Z', 'h', $4, 'rejected'),
              ('events', 'GLOBAL', '2026-10-01T10:00:00Z', 'h', $4, 'admitted'),
              ('player_battlelog', $2, '2026-10-01T10:00:00Z', 'h', $4, 'admitted'),
              ('player_battlelog', $2, '2026-10-04T10:00:00Z', 'h', $4, 'admitted'),
              ('player_battlelog', $3, '2026-10-01T10:00:00Z', 'h', $4, 'admitted'),
              ('player', $2, '2026-10-01T10:00:00Z', 'h', $4, 'admitted')`,
      [CLAN, PLAYER, OTHER, live],
    );
    const before = await checkReadFacts(db);
    assert.equal(before.admitted_read_day.missing_reads, 3);
    assert.equal(before.battlelog_read_gap.missing_first_read, 2);
    assert.equal(before.battlelog_read_gap.missing_gaps, 1);

    const first = await backfillReadFacts(db, { subjects: 2 });
    assert.equal(first.subjects, 2);
    assert.equal(first.done, false);
    assert.deepEqual(first.after, { endpoint: "events", key: "GLOBAL" });
    assert.equal(first.remaining, 2, "two battle logs left");
    const rest = await backfillReadFacts(db, { after: first.after });
    assert.equal(rest.done, true);
    assert.equal(rest.after, null);
    assert.equal(rest.remaining, 0);
    assert.equal(first.written + rest.written, 3 + 3);

    const again = await backfillReadFacts(db, {});
    assert.equal(again.written, 0, "idempotent: a re-run writes nothing");

    const after = await checkReadFacts(db);
    assert.equal(after.admitted_read_day.missing_reads, 0);
    assert.equal(after.admitted_read_day.missing_first_live, 0);
    assert.equal(after.battlelog_read_gap.missing_first_read, 0);
    assert.equal(after.battlelog_read_gap.missing_gaps, 0);
    assert.equal(after.admitted_read_day.rows, 3);
    assert.equal(after.battlelog_read_gap.rows, 3);
  } finally {
    await scratch.drop();
  }
});
