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

test("re-ingest of the same roster is a no-op", async () => {
  const clan = await fixture("clan/roster.json");
  const result = await ingestClanRoster(ctx.db, {
    payload: clan,
    observedAt: "2026-09-03T14:55:34Z",
  });
  assert.equal(result.joined, 0);
  assert.equal(result.departed, 0);
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
