/**
 * Clan's participation read, made cheaper without changing its answer
 * (2026-11-09). Two changes: the weekly donation statements read each
 * member's own key range instead of scanning the table, and identical
 * reads in flight together (a page's parallel panels) share one
 * computation. The fixture has a closed war week and the current one, a
 * member who left inside the window, and a clan with no war at all; the
 * tool's donation columns must equal the flat statement it replaced, and
 * a shared answer must be the answer the read gives alone.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { isoWeekStart } from "@elixir-mcp/tools/time";
import { sharedRead, sharedReadsInFlight } from "../src/shared-read.mjs";

// The week starts are timestamps without a zone, read as the process's
// local time: the Lambdas run in UTC, and so does this.
process.env.TZ = "UTC";

const WAR = "#PYLQ8";
const QUIET = "#PYLQ9";
const DAY = 86400_000;
const now = Date.now();
const ago = (days) => new Date(now - days * DAY).toISOString();
const [A1, A2, GONE, B1, B2] = ["#9QP", "#9QY", "#9QL", "#9QG", "#9QR"];

// The donation statement as it stood before 2026-11-09, current members
// and former ones (this clan's rows only): the reference.
const LEGACY = `select player_tag, date_trunc('week', snapshot_date::timestamp) as week_start,
                    max(donations)::int as donations
             from player_snapshot_daily
             where player_tag = any($1) and snapshot_kind in ('daily', 'pre_reset')
               and snapshot_date >= $2::date and ($3::text is null or clan_tag = $3)
             group by player_tag, date_trunc('week', snapshot_date::timestamp)`;

let scratch;
let db;
let invoke;

before(async () => {
  scratch = await scratchDb("clan_part_shared");
  db = scratch.db;
  await ensureSeasonsAround(db);
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('cps-owner', 'approved', true) returning account_id`,
  );
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'War Clan'), ($2, 'Quiet Clan'), ('#PYLQ0', 'Elsewhere')`,
    [WAR, QUIET],
  );
  for (const tag of [WAR, QUIET])
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', $1, $2, 'comprehensive')`,
      [tag, owner.account_id],
    );
  for (const tag of [A1, A2, GONE, B1, B2])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      `n${tag.slice(2)}`,
    ]);
  const member = (clan, tag, role, left = null) =>
    db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at, role)
       values ($1, $2, $3, $4, $5)`,
      [clan, tag, ago(80), left, role],
    );
  await member(WAR, A1, "leader");
  await member(WAR, A2, "member");
  // Left ten days ago, inside the window, and plays elsewhere since.
  await member(WAR, GONE, "elder", ago(10));
  await member(QUIET, B1, "leader");
  await member(QUIET, B2, "member");
  // The counter every game day for 70 days, climbing and reset weekly,
  // with gaps; GONE's rows after leaving are another clan's.
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, donations, observed_at, clan_tag, roster_observed_at)
     select t.tag, current_date - d, 'daily',
            case when (t.i + d) % 9 = 0 then null
                 else extract(isodow from current_date - d)::int * (10 + t.i::int * 17) end,
            now() - d * interval '1 day',
            case when t.tag = $3 and d < 10 then '#PYLQ0' else t.clan end,
            now() - d * interval '1 day'
       from unnest($1::text[], $2::text[]) with ordinality as t(tag, clan, i),
            generate_series(0, 70) d
      where (t.i + d) % 13 <> 0`,
    [[A1, A2, GONE, B1, B2], [WAR, WAR, WAR, QUIET, QUIET], GONE],
  );
  // A high-water mark near a reset counts beside the day rows; a season
  // roll row does not.
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, donations, observed_at, clan_tag)
     select tag, (date_trunc('week', now()) - interval '1 day')::date, kind, 5000, now(), clan
       from unnest($1::text[], $2::text[]) as t(tag, clan),
            unnest(array['pre_reset', 'season_roll']) kind`,
    [
      [A1, B1],
      [WAR, QUIET],
    ],
  );
  // The war clan: a week that finished last Monday and the one running.
  const monday = isoWeekStart(new Date(now)).getTime();
  const finish = new Date(monday + (9 * 60 + 35) * 60_000);
  const closed = finish < now ? finish : new Date(finish - 7 * DAY);
  for (const [section, started, finished] of [
    [0, new Date(closed - 7 * DAY), closed],
    [1, new Date(closed.getTime() + 5 * 60_000), null],
  ]) {
    await db.query(
      `insert into war_week (clan_tag, season_id, section_index, started_observed_at, finished_observed_at)
       values ($1, 900, $2, $3, $4)`,
      [WAR, section, started.toISOString(), finished?.toISOString() ?? null],
    );
    await db.query(
      `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
       select $1, 900, $2, tag, 400 + i::int * 50, 4 + i::int
         from unnest($3::text[]) with ordinality as t(tag, i)`,
      [WAR, section, [A1, A2, GONE]],
    );
  }
  invoke = makeInvoker({
    db,
    account: { accountId: owner.account_id, isOwner: true, timezone: null },
    registry: makeRegistry(),
    surface: "web",
  });
});

after(async () => {
  await scratch?.drop();
});

const read = async (clan) => {
  const r = await invoke("clans_participation", { clan_tag: clan, weeks: 8 });
  assert.equal(r.isError, false, JSON.stringify(r.body).slice(0, 400));
  return r.body;
};

for (const [clan, label] of [
  [WAR, "a clan at war, with a member who left"],
  [QUIET, "a clan with no war"],
]) {
  test(`${label}: every week's donations are the flat statement's`, async () => {
    const body = await read(clan);
    const from = body.weeks[0].from;
    const expected = async (tags, clanOnly) => {
      const { rows } = await db.query(LEGACY, [tags, from, clanOnly]);
      const at = new Map(
        rows.map((r) => [
          // Keyed the way the tool keys its own rows.
          `${r.player_tag}|${new Date(r.week_start).toISOString()}`,
          r.donations,
        ]),
      );
      return (tag) => body.weeks.map((w) => at.get(`${tag}|${w.from}`) ?? null);
    };
    const current = await expected(
      body.members.map((m) => m.player_tag),
      null,
    );
    for (const m of body.members)
      assert.deepEqual(m.donations, current(m.player_tag), m.player_tag);
    const former = await expected(
      body.former_members.map((m) => m.player_tag),
      clan,
    );
    for (const m of body.former_members)
      assert.deepEqual(m.donations, former(m.player_tag), m.player_tag);
    // The fixture reaches what it claims to: a closed week and the
    // current one with counts, and the departure where there is one.
    assert.equal(body.weeks.at(-1).partial, true);
    assert.ok(body.members.some((m) => m.donations.at(-1) !== null));
    assert.ok(body.members.some((m) => m.donations.at(-2) !== null));
    assert.equal(body.former_members.length, clan === WAR ? 1 : 0);
    assert.equal(body.war_weeks.length, clan === WAR ? 2 : 0);
  });
}

test("reads in flight together share one computation, each with its own copy", async () => {
  let runs = 0;
  const run = () => {
    runs += 1;
    return invoke("clans_participation", { clan_tag: WAR, weeks: 8 });
  };
  const key = JSON.stringify(["owner", null, "clans_participation", WAR]);
  const answers = await Promise.all([
    sharedRead(key, run),
    sharedRead(key, run),
    sharedRead(key, run),
    sharedRead(key, run),
  ]);
  assert.equal(runs, 1);
  assert.equal(sharedReadsInFlight(), 0, "nothing is kept once it settles");
  for (const a of answers.slice(1)) assert.deepEqual(a, answers[0]);
  // A copy each: one caller's handling never reaches another's.
  answers[0].body.members.length = 0;
  assert.ok(answers[1].body.members.length > 0);
  // A read that starts after it settled computes afresh.
  await sharedRead(key, run);
  assert.equal(runs, 2);
});

test("a shared answer is the read's own answer", async () => {
  // The same read alone and shared, against a pinned clock: as_of and
  // the day counts move with the wall clock, nothing else may differ.
  const strip = (body) => {
    const copy = structuredClone(body);
    delete copy.meta;
    for (const m of copy.members) delete m.days_since_battle;
    for (const m of copy.members) delete m.days_in_clan_observed;
    for (const w of copy.weeks) delete w.covers;
    return copy;
  };
  const alone = await read(WAR);
  const key = JSON.stringify(["owner", null, "clans_participation", "again"]);
  const run = () => invoke("clans_participation", { clan_tag: WAR, weeks: 8 });
  const [first, second] = await Promise.all([
    sharedRead(key, run),
    sharedRead(key, run),
  ]);
  assert.deepEqual(strip(first.body), strip(alone));
  assert.deepEqual(second, first);
});

test("a failed read is not shared: each waiting caller makes its own", async () => {
  let runs = 0;
  const key = "failing";
  const failing = () => {
    runs += 1;
    return Promise.resolve({ isError: true, body: { error: { code: "x" } } });
  };
  const throwing = () => {
    runs += 1;
    return Promise.reject(new Error("boom"));
  };
  const ok = () => {
    runs += 1;
    return Promise.resolve({ isError: false, body: { n: runs } });
  };
  const [lead, joined] = await Promise.all([
    sharedRead(key, failing),
    sharedRead(key, ok),
  ]);
  assert.equal(lead.isError, true);
  assert.equal(joined.isError, false);
  assert.equal(runs, 2);
  const [thrown, after] = await Promise.allSettled([
    sharedRead(key, throwing),
    sharedRead(key, ok),
  ]);
  assert.equal(thrown.status, "rejected");
  assert.equal(after.status, "fulfilled");
  assert.equal(after.value.isError, false);
  assert.equal(sharedReadsInFlight(), 0);
});
