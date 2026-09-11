import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestClanRoster } from "../src/roster.mjs";
import { fixture, scratchDb } from "./helpers.mjs";

let ctx;

before(async () => {
  ctx = await scratchDb("roster");
});

after(async () => ctx.drop());

test("roster seeds players and opens memberships (clan auto-follow payoff)", async () => {
  const clan = await fixture("clan/roster.json");
  const result = await ingestClanRoster(ctx.db, {
    payload: clan,
    observedAt: "2026-09-03T14:40:34Z",
  });
  assert.equal(result.members, 49);
  assert.equal(result.joined, 49);
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
