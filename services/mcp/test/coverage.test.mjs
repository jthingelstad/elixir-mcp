/**
 * meta.completeness_note fires (review 2026-09-19, defect 13). It was
 * promised by the instructions, responses.md and choosing-a-tool and set
 * by nothing; buildMeta now reads the newest profile interval for a
 * player subject whose window ends inside the last seven days.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { recentCompleteness, completenessNote } from "../src/coverage.mjs";

let scratch;
let account;
const registry = makeRegistry();
const call = (name, args = {}) =>
  registry.invoke(name, { db: scratch.db, account }, args);

const GAPPED = "#P0G";
const FULL = "#P0L";
const STALE = "#P0Q";

async function seedPlayer(tag, { counted, recorded, lastPollHoursAgo }) {
  await scratch.db.query("insert into player (player_tag) values ($1)", [tag]);
  await scratch.db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, battle_count, observed_at, profile_observed_at)
     values ($1, current_date - 4, 'daily', 100, now() - interval '4 days', now() - interval '4 days'),
            ($1, current_date - 1, 'daily', $2, now() - ($3 || ' hours')::interval, now() - ($3 || ' hours')::interval)`,
    [tag, 100 + counted, String(lastPollHoursAgo)],
  );
  await scratch.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_name)
     select $1 || '-' || n, now() - interval '4 days' + n * interval '1 hour', 'PvP', 'pvp', 'Ladder'
     from generate_series(1, $2::int) n`,
    [tag, recorded],
  );
  await scratch.db.query(
    `insert into battle_participant (battle_id, player_tag, side, outcome, battle_time, type, type_class, trophy_change)
     select battle_id, $1, 0, 'win', battle_time, type, type_class, 30 from battle where battle_id like $1 || '-%'`,
    [tag],
  );
}

before(async () => {
  scratch = await scratchDb("coverage_note");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash, status) values ('coverage-note', 'approved') returning account_id",
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  // Thirty battles counted, twenty recorded: ratio 0.667. Polled an hour ago.
  await seedPlayer(GAPPED, { counted: 30, recorded: 20, lastPollHoursAgo: 1 });
  // Thirty counted, thirty recorded: complete.
  await seedPlayer(FULL, { counted: 30, recorded: 30, lastPollHoursAgo: 1 });
  // The counter went backwards (not comparable) and the last poll is
  // three days old: unknown with a long tail.
  await seedPlayer(STALE, { counted: -5, recorded: 0, lastPollHoursAgo: 72 });
});
after(async () => scratch.drop());

test("recentCompleteness reads the newest interval in one query", async () => {
  const gapped = await recentCompleteness(scratch.db, GAPPED);
  assert.equal(gapped.expected_battles, 30);
  assert.equal(gapped.captured_battles, 20);
  assert.equal(gapped.ratio, 0.667);
  assert.ok(gapped.tail_hours >= 1 && gapped.tail_hours < 1.2);
  const full = await recentCompleteness(scratch.db, FULL);
  assert.equal(full.ratio, 1);
  const stale = await recentCompleteness(scratch.db, STALE);
  assert.equal(stale.ratio, null, "a counter that went backwards is unknown");
  assert.ok(stale.tail_hours > 71);
  const nobody = await recentCompleteness(scratch.db, "#P0R");
  assert.deepEqual(nobody, {
    observed_from: null,
    observed_to: null,
    expected_battles: null,
    captured_battles: null,
    ratio: null,
    tail_hours: null,
  });
  assert.equal(completenessNote("#P0R", nobody), null, "no profile, no claim");
});

test("battles_performance carries completeness_note on a measured gap, on an unknown with a long tail, and never when complete", async () => {
  const gapped = await call("battles_performance", {
    player_tag: GAPPED,
    days: 7,
  });
  assert.match(
    gapped.meta.completeness_note,
    /20 of the 30 battles .* are recorded \(0\.667\)/,
  );
  assert.match(gapped.meta.completeness_note, /elixir_coverage/);

  const full = await call("battles_performance", { player_tag: FULL, days: 7 });
  assert.equal(full.meta.completeness_note, undefined);

  const stale = await call("battles_performance", {
    player_tag: STALE,
    days: 7,
  });
  assert.match(stale.meta.completeness_note, /Completeness is unknown/);
  assert.match(stale.meta.completeness_note, /hours have passed/);

  // A window that ended before the last seven days is not the newest
  // interval's business: no note.
  const old = await call("battles_performance", {
    player_tag: GAPPED,
    from: "2026-01-01",
    to: "2026-02-01",
  });
  assert.equal(old.meta.completeness_note, undefined);

  // The summary tool (no window) reads the same interval.
  const summary = await call("players_summary", { player_tag: GAPPED });
  assert.match(summary.meta.completeness_note, /Capture is incomplete/);
});
