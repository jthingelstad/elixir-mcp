import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { clanEvents } from "./event-rows.mjs";

import { ingestClanRoster } from "../src/roster.mjs";
import { fixture, scratchDb, trackClans } from "./helpers.mjs";

let ctx;

before(async () => {
  ctx = await scratchDb("roster");
  await trackClans(ctx.db, ["#J2RGCRVG"]);
});

after(async () => ctx.drop());

test("roster seeds players and opens memberships (clan auto-follow payoff)", async () => {
  const clan = await fixture("clan/roster.json");
  const result = await ingestClanRoster(ctx.db, {
    payload: clan,
    observedAt: "2026-09-03T14:40:34Z",
  });
  assert.equal(result.members, 49);
  // The first read is a baseline (0207): 49 memberships, no joins.
  assert.equal(result.joined, 0);
  assert.equal(result.baselined, 49);
  assert.equal(result.departed, 0);

  const players = (await ctx.db.query("select count(*)::int n from player"))
    .rows[0].n;
  assert.equal(players, 49, "every member seeded as a player row for free");
  const named = (
    await ctx.db.query(
      "select count(*)::int n from player where name is not null",
    )
  ).rows[0].n;
  assert.equal(named, 49, "names ride the roster payload");
  const open = (
    await ctx.db.query(
      "select count(*)::int n from clan_membership where left_observed_at is null",
    )
  ).rows[0].n;
  assert.equal(open, 49);
});

test("re-ingest of the same roster is a no-op: no events, no tuple version moves", async () => {
  const clan = await fixture("clan/roster.json");
  // A roster is polled far more often than a member plays; an unchanged
  // member rewritten is a dead tuple for nothing (2026-09-11).
  const versions = async () =>
    (
      await ctx.db.query(`
        select 'pl' as t, player_tag as k, xmin::text as v from player
        union all
        select 'cm', clan_tag || '|' || player_tag, xmin::text from clan_membership
        union all
        select 'c', clan_tag, xmin::text from clan
        order by 1, 2`)
    ).rows;
  const before = await versions();
  const result = await ingestClanRoster(ctx.db, {
    payload: clan,
    observedAt: "2026-09-03T14:55:34Z",
  });
  assert.equal(result.joined, 0);
  assert.equal(result.departed, 0);
  assert.deepEqual(await versions(), before, "no row version moved");
});

test("a member disappearing closes their membership, observed not asserted", async () => {
  const clan = structuredClone(await fixture("clan/roster.json"));
  const departed = clan.memberList.pop();
  clan.members = clan.memberList.length;
  const result = await ingestClanRoster(ctx.db, {
    payload: clan,
    observedAt: "2026-09-03T15:10:34Z",
  });
  assert.equal(result.departed, 1);
  const { rows } = await ctx.db.query(
    `select left_observed_at from clan_membership where player_tag = $1`,
    [departed.tag],
  );
  assert.equal(rows.length, 1);
  assert.ok(
    rows[0].left_observed_at,
    "tenure closed with the observation time",
  );
});

test("role changes update the open membership row", async () => {
  const clan = structuredClone(await fixture("clan/roster.json"));
  const promoted = clan.memberList.find((m) => m.role === "member");
  assert.ok(promoted, "fixture has a plain member");
  promoted.role = "elder";
  clan.memberList.push(); // no-op, keep counts honest
  clan.members = clan.memberList.length;
  await ingestClanRoster(ctx.db, {
    payload: clan,
    observedAt: "2026-09-03T15:25:34Z",
  });
  const { rows } = await ctx.db.query(
    `select role from clan_membership where player_tag = $1 and left_observed_at is null`,
    [promoted.tag],
  );
  assert.equal(rows[0].role, "elder");
});

/**
 * The game's own lastSeen is captured, not discarded.
 *
 * It arrives on every clan roster poll and exists NOWHERE else -
 * /players/{tag} has no lastSeen - so a poll that drops it loses that
 * moment permanently. It is also the predicate the game uses to seed a
 * river race roster (verified against a live payload 2026-09-09), which
 * is what turns "not in the race" into "has not opened the game since".
 */
test("memberList lastSeen is stored, never moves backwards, and survives a junk value", async () => {
  const scratch = await scratchDb("roster_last_seen");
  await trackClans(scratch.db, ["#J2RGCRVG"]);
  try {
    const at = "2026-09-09T12:00:00.000Z";
    const roster = (members) => ({
      tag: "#J2RGCRVG",
      name: "POAP KINGS",
      memberList: members,
    });
    const seen = async (tag) =>
      (
        await scratch.db.query(
          `select game_last_seen_at from player where player_tag = $1`,
          [tag],
        )
      ).rows[0].game_last_seen_at;

    await ingestClanRoster(scratch.db, {
      payload: roster([
        {
          tag: "#2P9YQCV",
          name: "Active",
          role: "member",
          lastSeen: "20260909T090000.000Z",
        },
        {
          tag: "#2P9YQCU",
          name: "Dormant",
          role: "member",
          lastSeen: "20260829T090000.000Z",
        },
        // No lastSeen at all: optional CR fields stay optional.
        { tag: "#2P9YQCQ", name: "Silent", role: "member" },
      ]),
      observedAt: at,
      windowStart: null,
      receiptId: null,
    });

    assert.equal(
      (await seen("#2P9YQCV")).toISOString(),
      "2026-09-09T09:00:00.000Z",
    );
    assert.equal(
      (await seen("#2P9YQCU")).toISOString(),
      "2026-08-29T09:00:00.000Z",
    );
    assert.equal(await seen("#2P9YQCQ"), null, "absent stays null, not now()");

    // A late-admitted OLDER poll must not drag the stamp backwards, and a
    // malformed value must not overwrite a good one or stop the run.
    await ingestClanRoster(scratch.db, {
      payload: roster([
        {
          tag: "#2P9YQCV",
          name: "Active",
          role: "member",
          lastSeen: "20260901T090000.000Z",
        },
        {
          tag: "#2P9YQCU",
          name: "Dormant",
          role: "member",
          lastSeen: "not-a-timestamp",
        },
      ]),
      observedAt: "2026-09-09T13:00:00.000Z",
      windowStart: null,
      receiptId: null,
    });

    assert.equal(
      (await seen("#2P9YQCV")).toISOString(),
      "2026-09-09T09:00:00.000Z",
      "an older sighting never wins",
    );
    assert.equal(
      (await seen("#2P9YQCU")).toISOString(),
      "2026-08-29T09:00:00.000Z",
      "junk leaves the known value alone",
    );

    // And it is NOT our poll time, which is the collision the column name
    // exists to avoid.
    const { rows } = await scratch.db.query(
      `select last_seen_at, game_last_seen_at from player where player_tag = $1`,
      ["#2P9YQCU"],
    );
    assert.notEqual(
      rows[0].last_seen_at.toISOString(),
      rows[0].game_last_seen_at.toISOString(),
    );
  } finally {
    await scratch.drop();
  }
});

test("the ledger names every roster moment: prev/new role and direction, the departing role and name", async () => {
  const clan = await fixture("clan/roster.json");
  const fresh = await scratchDb("roster_ledger");
  await trackClans(fresh.db, ["#J2RGCRVG"]);
  try {
    await ingestClanRoster(fresh.db, {
      payload: clan,
      observedAt: "2026-09-03T14:40:34Z",
    });
    const next = structuredClone(clan);
    const promoted = next.memberList.find((m) => m.role === "member");
    promoted.role = "elder";
    const demoted = next.memberList.find((m) => m.role === "coLeader");
    demoted.role = "member";
    const [gone] = next.memberList.splice(
      next.memberList.findIndex(
        (m) => m.role === "elder" && m.tag !== promoted.tag,
      ),
      1,
    );
    await ingestClanRoster(fresh.db, {
      payload: next,
      observedAt: "2026-09-03T15:40:34Z",
    });
    const rows = await clanEvents(fresh.db);
    const up = rows.find(
      (r) =>
        r.event_type === "role_changed" &&
        r.payload.player_tag === promoted.tag,
    );
    assert.deepEqual(
      [up.payload.role_before, up.payload.role_after, up.payload.direction],
      ["member", "elder", "promoted"],
    );
    const down = rows.find(
      (r) =>
        r.event_type === "role_changed" && r.payload.player_tag === demoted.tag,
    );
    assert.equal(down.payload.direction, "demoted");
    const left = rows.find((r) => r.event_type === "member_left");
    assert.equal(left.payload.player_tag, gone.tag);
    assert.equal(left.payload.role_at_departure, "elder");
    assert.equal(
      left.payload.name,
      gone.name,
      "the departing name rides the row",
    );
  } finally {
    await fresh.drop();
  }
});

test("a clan nobody tracks records only its tracked players, read from the whole roster", async () => {
  const scratch = await scratchDb("roster_untracked");
  try {
    const clan = structuredClone(await fixture("clan/roster.json"));
    clan.tag = "#2QQQ";
    const [mine] = clan.memberList;
    const {
      rows: [a],
    } = await scratch.db.query(
      `insert into account (email_hash, status, role)
       values ('roster-untracked', 'approved', 'member') returning account_id`,
    );
    await scratch.db.query("insert into player (player_tag) values ($1)", [
      mine.tag,
    ]);
    await scratch.db.query(
      `insert into recording (subject_type, subject_tag, requested_by, status, scope)
       values ('player', $1, $2, 'active', 'comprehensive')`,
      [mine.tag, a.account_id],
    );
    const r = await ingestClanRoster(scratch.db, {
      payload: clan,
      observedAt: "2026-10-06T14:40:34Z",
    });
    assert.equal(r.members, 49, "liveliness still reads the whole roster");
    assert.equal(r.joined, 0, "a first read is a baseline");
    assert.equal(r.baselined, 1);
    const { rows: players } = await scratch.db.query(
      "select player_tag from player",
    );
    assert.deepEqual(
      players.map((p) => p.player_tag),
      [mine.tag],
    );
    const { rows: open } = await scratch.db.query(
      "select player_tag from clan_membership where clan_tag = '#2QQQ'",
    );
    assert.deepEqual(
      open.map((m) => m.player_tag),
      [mine.tag],
    );
    // Leaving the roster still closes the tracked player's membership.
    clan.memberList = clan.memberList.slice(1);
    const left = await ingestClanRoster(scratch.db, {
      payload: clan,
      observedAt: "2026-10-06T15:40:34Z",
    });
    assert.equal(left.departed, 1);
  } finally {
    await scratch.drop();
  }
});

/**
 * A first sight is a baseline, never a join (0207). The fresh-person
 * journey on 2026-10-08 read "alex joined ClashCoachAIcom" from the first
 * roster read of a clan he founded, and auto-follow (0205/0206) turns a
 * clan read only for its tracked players into a tracked one: diffed
 * against that one row, every other member would have read as joining.
 */
async function baselineScratch(suffix) {
  const scratch = await scratchDb(suffix);
  const clan = structuredClone(await fixture("clan/roster.json"));
  clan.tag = "#2QQQ";
  const {
    rows: [a],
  } = await scratch.db.query(
    `insert into account (email_hash, status, role)
     values ($1, 'approved', 'member') returning account_id`,
    [`baseline-${suffix}`],
  );
  const trackPlayer = async (tag, at) => {
    await scratch.db.query(
      `insert into player (player_tag) values ($1) on conflict do nothing`,
      [tag],
    );
    await scratch.db.query(
      `insert into recording (subject_type, subject_tag, requested_by, status, scope, created_at)
       values ('player', $1, $2, 'active', 'comprehensive', $3)`,
      [tag, a.account_id, at],
    );
  };
  const trackClan = (at) =>
    scratch.db.query(
      `insert into recording (subject_type, subject_tag, requested_by, status, scope, created_at)
       values ('clan', '#2QQQ', $1, 'active', 'activity', $2)`,
      [a.account_id, at],
    );
  const read = (payload, observedAt, windowStart) =>
    ingestClanRoster(scratch.db, { payload, observedAt, windowStart });
  const joins = async () =>
    (await clanEvents(scratch.db))
      .filter((e) => e.event_type === "member_joined")
      .map((e) => e.payload.player_tag);
  const baseline = async (tag) =>
    (
      await scratch.db.query(
        `select baseline from clan_membership
          where clan_tag = '#2QQQ' and player_tag = $1 and left_observed_at is null`,
        [tag],
      )
    ).rows[0]?.baseline;
  return { scratch, clan, trackPlayer, trackClan, read, joins, baseline };
}

test("first read of a tracked 49-member clan: zero joins; the next read's newcomer is exactly one", async () => {
  const t = await baselineScratch("baseline_first");
  try {
    await t.trackClan("2026-10-08T21:00:00Z");
    const r1 = await t.read(t.clan, "2026-10-08T21:30:00Z", null);
    assert.equal(r1.joined, 0);
    assert.equal(r1.baselined, 49);
    assert.deepEqual(await t.joins(), [], "no member_joined on a first read");
    assert.equal(await t.baseline(t.clan.memberList[0].tag), true);

    const next = structuredClone(t.clan);
    next.memberList.push({ ...t.clan.memberList[0], tag: "#2GUY2PY" });
    const r2 = await t.read(
      next,
      "2026-10-08T21:45:00Z",
      "2026-10-08T21:30:00Z",
    );
    assert.equal(r2.joined, 1);
    assert.equal(r2.baselined, 0);
    assert.deepEqual(await t.joins(), ["#2GUY2PY"]);
    assert.equal(await t.baseline("#2GUY2PY"), false, "an observed join");
  } finally {
    await t.scratch.drop();
  }
});

test("a clan read for one tracked player that becomes tracked: the rest are a baseline, not 48 joins", async () => {
  const t = await baselineScratch("baseline_follow");
  try {
    const [alex] = t.clan.memberList;
    await t.trackPlayer(alex.tag, "2026-10-08T21:28:00Z");
    // The clan's first read, before Elixir follows it: alex only.
    const r1 = await t.read(t.clan, "2026-10-08T21:30:00Z", null);
    assert.equal(r1.baselined, 1);
    assert.equal(await t.baseline(alex.tag), true, "alex was not seen joining");
    // Elixir follows the primary's clan; the next read records everyone.
    await t.trackClan("2026-10-08T21:31:00Z");
    const promoted = structuredClone(t.clan);
    const other = promoted.memberList.find(
      (m) => m.tag !== alex.tag && m.role === "member",
    );
    other.role = "elder";
    const r2 = await t.read(
      promoted,
      "2026-10-08T21:45:00Z",
      "2026-10-08T21:30:00Z",
    );
    assert.equal(r2.joined, 0, "the previous read could not see them absent");
    assert.equal(r2.baselined, 48);
    assert.equal(
      r2.roleChanged,
      0,
      "a role seen for the first time is no change",
    );
    assert.deepEqual(await t.joins(), []);
    // From here on the clan reads whole: a newcomer is a join.
    const next = structuredClone(promoted);
    next.memberList.push({ ...t.clan.memberList[1], tag: "#2GUY2PY" });
    const r3 = await t.read(
      next,
      "2026-10-08T22:00:00Z",
      "2026-10-08T21:45:00Z",
    );
    assert.equal(r3.joined, 1);
    assert.deepEqual(await t.joins(), ["#2GUY2PY"]);
  } finally {
    await t.scratch.drop();
  }
});

test("a partly read clan: a newly tracked player is a baseline, one tracked before is a join", async () => {
  const t = await baselineScratch("baseline_partial");
  try {
    const [first, second, third] = t.clan.memberList;
    await t.trackPlayer(first.tag, "2026-10-01T00:00:00Z");
    await t.trackPlayer(third.tag, "2026-10-01T00:00:00Z");
    const before = structuredClone(t.clan);
    before.memberList = before.memberList.filter((m) => m.tag !== third.tag);
    await t.read(before, "2026-10-02T00:00:00Z", null);
    // second is tracked after that read; third, tracked since before it,
    // was seen absent and now appears.
    await t.trackPlayer(second.tag, "2026-10-02T06:00:00Z");
    const r = await t.read(
      t.clan,
      "2026-10-02T12:00:00Z",
      "2026-10-02T00:00:00Z",
    );
    assert.equal(r.joined, 1);
    assert.equal(r.baselined, 1);
    assert.deepEqual(await t.joins(), [third.tag]);
    assert.equal(await t.baseline(second.tag), true);
    assert.equal(await t.baseline(third.tag), false);
  } finally {
    await t.scratch.drop();
  }
});
