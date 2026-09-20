/**
 * A collector that stops checking in is said so, once (2026-09-19):
 * the tool reads it as silent, the hourly sweep tells the owner one
 * time per silence, and a heartbeat after the notice makes the next
 * silence news again. Draining is a stop on purpose and never silent.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { silentSince } from "../../ingest/src/fleet.mjs";
import { sweepSilentCollectors } from "../src/fleet.mjs";
import { makeRegistry } from "../../mcp/src/tools.mjs";

let ctx;
let account;
// The scratch helper hands back a client, not its URL; the sweep opens
// its own connection, so rebuild the URL the way the helper names it.
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const DB_URL = ADMIN_URL.replace(
  /\/postgres$/,
  `/elixir_mcp_test_fleet_${process.pid}`,
);
const NOW = Date.parse("2026-09-19T17:00:00Z");
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600_000).toISOString();

before(async () => {
  ctx = await scratchDb("fleet");
  const {
    rows: [row],
  } = await ctx.db.query(
    `insert into account (email_hash, status, role) values ('fleet', 'approved', 'member') returning account_id`,
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  for (const [name, card, status, beat, enrolled] of [
    ["mini", "Mini P.E.K.K.A", "active", iso(0.02), iso(200)],
    ["hog", "Hog Rider", "active", iso(40), iso(200)],
    ["witch", "Witch", "draining", iso(40), iso(200)],
    ["cannon", "Cannon", "probation", null, iso(3)],
    ["fresh", "Skeleton Army", "active", null, iso(0.5)],
  ])
    await ctx.db.query(
      `insert into gateway (owner_account_id, name, card_name, static_ip, status, last_heartbeat_at, enrolled_at)
       values ($1, $2, $3, '127.0.0.1', $4, $5, $6)`,
      [account.accountId, name, card, status, beat, enrolled],
    );
});
after(async () => ctx.drop());

test("silentSince: an hour without a heartbeat on a running collector; never on a stop on purpose", () => {
  assert.equal(
    silentSince({ status: "active", last_heartbeat_at: iso(0.02) }, NOW),
    null,
  );
  assert.equal(
    silentSince(
      { status: "active", last_heartbeat_at: iso(40) },
      NOW,
    )?.toISOString(),
    iso(40),
  );
  assert.equal(
    silentSince({ status: "draining", last_heartbeat_at: iso(40) }, NOW),
    null,
  );
  // Never checked in: silent once its enrolment is older than the hour.
  assert.equal(
    silentSince(
      { status: "probation", last_heartbeat_at: null, enrolled_at: iso(3) },
      NOW,
    )?.toISOString(),
    iso(3),
  );
  assert.equal(
    silentSince(
      { status: "active", last_heartbeat_at: null, enrolled_at: iso(0.5) },
      NOW,
    ),
    null,
  );
});

test("the sweep tells the owner once per silence, and again after a heartbeat", async () => {
  const sent = [];
  const enqueue = async (m) => sent.push(m);
  const first = await sweepSilentCollectors(DB_URL, { enqueue, nowMs: NOW });
  assert.deepEqual(first.silent.map((s) => [s.collector, s.hours]).sort(), [
    ["Cannon", 3],
    ["Hog Rider", 40],
  ]);
  assert.equal(sent.length, 2);
  const hog = sent.find((m) => m.detail.collector === "Hog Rider");
  assert.equal(hog.kind, "owner_notify");
  assert.equal(hog.notify_kind, "gateway_silent");
  assert.match(
    hog.note,
    /has not checked in since 2026-09-18T01:00:00.000Z \(40 h\)/,
  );
  assert.match(hog.note, /drain it in Admin/);
  assert.ok(!("to" in hog) || typeof hog.to === "string");
  // Half an hour on: the same silences, nothing new to say.
  const again = await sweepSilentCollectors(DB_URL, {
    enqueue,
    nowMs: NOW + 1800_000,
  });
  assert.deepEqual(again.silent, []);
  assert.equal(sent.length, 2);
  // Hog Rider comes back for a minute at +1h and goes quiet again; the
  // running collectors keep checking in. At +3h its new silence is news.
  await ctx.db.query(
    `update gateway set last_heartbeat_at = $1 where name = 'hog'`,
    [new Date(NOW + 3600_000).toISOString()],
  );
  await ctx.db.query(
    `update gateway set last_heartbeat_at = $1 where name in ('mini', 'fresh', 'cannon')`,
    [new Date(NOW + 2.9 * 3600_000).toISOString()],
  );
  const later = await sweepSilentCollectors(DB_URL, {
    enqueue,
    nowMs: NOW + 3 * 3600_000,
  });
  assert.deepEqual(
    later.silent.map((s) => s.collector),
    ["Hog Rider"],
  );
  assert.equal(sent.length, 3);
});

test("elixir_collectors reads a quiet active collector as silent and keeps the lifecycle beside it", async () => {
  // The tool reads the wall clock: put Hog Rider forty hours back from
  // now and every running collector a minute back (the sweep test left
  // them at its fixed NOW, which the wall clock passed by an hour the
  // next day and read as three silences, not one).
  const quiet = new Date(Date.now() - 40 * 3600_000).toISOString();
  await ctx.db.query(
    `update gateway set last_heartbeat_at = $1 where name in ('hog', 'witch')`,
    [quiet],
  );
  await ctx.db.query(
    `update gateway set last_heartbeat_at = $1 where name in ('mini', 'fresh', 'cannon')`,
    [new Date(Date.now() - 60_000).toISOString()],
  );
  const registry = makeRegistry();
  const res = await registry.invoke(
    "elixir_collectors",
    { db: ctx.db, account },
    {},
  );
  const by = Object.fromEntries(res.collectors.map((c) => [c.card, c]));
  assert.equal(by["Mini P.E.K.K.A"].status, "active");
  assert.equal(by["Mini P.E.K.K.A"].lifecycle, "active");
  assert.equal(by["Hog Rider"].status, "silent");
  assert.equal(by["Hog Rider"].lifecycle, "active");
  assert.equal(by["Hog Rider"].silent_since, quiet);
  assert.equal(by["Hog Rider"].last_seen, quiet);
  assert.equal(by["Witch"].status, "draining");
  assert.equal(by["Witch"].silent_since, undefined);
  assert.ok(
    res.notes.some((n) => /collector is silent/.test(n)),
    res.notes.join("\n"),
  );
});
