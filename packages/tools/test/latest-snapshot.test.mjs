/**
 * #512: a latest-snapshot read serves the newest observation, never the
 * frozen pre_reset row. Inside the weekly donation window (the hour to
 * Monday 00:10Z) one observation writes both a `daily` and a `pre_reset`
 * row; after it only `daily` moves, on the same game day (the game day
 * turns at 10:00Z). Ordering by kind name served the window's last read
 * until 10:00Z. Here the real ingest writes both rows at 00:05Z and the
 * daily row again at 00:20Z, and every reader that wants the latest row
 * must answer from 00:20Z.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { projectPlayerSnapshot } from "../../ingest/src/snapshots.mjs";
import { ingestClanRoster } from "../../ingest/src/roster.mjs";
import { projectClanSeries } from "../../ingest/src/series.mjs";
import { projectPlayerCards } from "../../ingest/src/cards.mjs";
import {
  fixture,
  scratchDb,
  seedReceipt,
  trackClans,
} from "../../ingest/test/helpers.mjs";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { readRecordedProfile } from "@elixir-mcp/record/recorded-profile";
import { latestSnapshotOrder } from "@elixir-mcp/record/latest-snapshot";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

const CLAN = "#J2RGCRVG";
const P = "#0LYQ8RCP2"; // invented
const Q = "#0VJ9GU2YL"; // invented
const IN_WINDOW = "2026-11-16T00:05:00Z"; // Monday, before the 00:10Z reset
const AFTER = "2026-11-16T00:20:00Z"; // same game day (2026-11-15)
const DAY = "2026-11-15";

let ctx;
let invoke;
let webInvoke;
let early;
let late;

function profileOf(base, tag, name, bump) {
  const p = structuredClone(base);
  p.tag = tag;
  p.name = name;
  p.trophies += bump;
  p.wins += bump;
  p.battleCount += bump;
  p.collectionLevel += bump;
  return p;
}

/** A roster read as the pipeline projects it: membership, then the series. */
async function observeRoster(db, { payload, observedAt }) {
  await ingestClanRoster(db, { payload, observedAt });
  await projectClanSeries(db, { payload, observedAt });
}

function rosterOf(base, members) {
  const r = structuredClone(base);
  r.tag = CLAN;
  r.memberList = members.map(([tag, name, trophies, clanRank], i) => ({
    ...base.memberList[i],
    tag,
    name,
    trophies,
    clanRank,
    previousClanRank: clanRank,
  }));
  return r;
}

before(async () => {
  ctx = await scratchDb("latest_snapshot");
  const { db } = ctx;
  await ensureSeasonsAround(db);
  await trackClans(db, [CLAN]);
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS') on conflict do nothing`,
    [CLAN],
  );
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Early Bird'), ($2, 'Second')`,
    [P, Q],
  );
  const base = await fixture("player/profile.json");
  const roster = await fixture("clan/roster.json");
  early = {
    p: profileOf(base, P, "Early Bird", 0),
    q: profileOf(base, Q, "Second", 0),
  };
  late = {
    p: profileOf(base, P, "Early Bird", 99),
    q: profileOf(base, Q, "Second", 50),
  };

  // Inside the window: the roster and the profiles write daily + pre_reset.
  await observeRoster(db, {
    payload: rosterOf(roster, [
      [P, "Early Bird", early.p.trophies, 2],
      [Q, "Second", early.q.trophies, 1],
    ]),
    observedAt: IN_WINDOW,
  });
  for (const tag of [P, Q]) {
    const receiptId = await seedReceipt(db, {
      endpoint: "player",
      entityKey: tag,
    });
    await projectPlayerSnapshot(db, {
      playerTag: tag,
      payload: tag === P ? early.p : early.q,
      fetchedAt: IN_WINDOW,
      receiptId,
    });
  }
  // After the window: only the daily row moves.
  await observeRoster(db, {
    payload: rosterOf(roster, [
      [P, "Early Bird", late.p.trophies, 1],
      [Q, "Second", late.q.trophies, 2],
    ]),
    observedAt: AFTER,
  });
  for (const tag of [P, Q]) {
    const receiptId = await seedReceipt(db, {
      endpoint: "player",
      entityKey: tag,
    });
    await projectPlayerSnapshot(db, {
      playerTag: tag,
      payload: tag === P ? late.p : late.q,
      fetchedAt: AFTER,
      receiptId,
    });
  }
  // The collection table the collection read needs (the pipeline writes it
  // beside the snapshot).
  await projectPlayerCards(db, {
    playerTag: P,
    payload: late.p,
    fetchedAt: AFTER,
    moments: false,
  });

  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('latest-owner', 'approved', true)
     returning account_id`,
  );
  for (const tag of [P, Q])
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', $3)`,
      [owner.account_id, tag, tag === P],
    );
  const account = {
    accountId: owner.account_id,
    isOwner: true,
    timezone: "UTC",
  };
  invoke = makeInvoker({ db, account, registry: makeRegistry() });
  webInvoke = makeInvoker({
    db,
    account,
    registry: makeRegistry(),
    surface: "web",
  });
});

after(async () => {
  await ctx?.drop();
});

test("the window left a frozen pre_reset row beside a newer daily row on one game day", async () => {
  const { rows } = await ctx.db.query(
    `select snapshot_kind, trophies, observed_at, profile_observed_at, roster_observed_at
       from player_snapshot_daily where player_tag = $1 and snapshot_date = $2
      order by snapshot_kind`,
    [P, DAY],
  );
  assert.deepEqual(
    rows.map((r) => r.snapshot_kind),
    ["daily", "pre_reset"],
  );
  const [daily, pre] = rows;
  assert.equal(daily.trophies, late.p.trophies);
  assert.equal(pre.trophies, early.p.trophies);
  for (const col of [
    "observed_at",
    "profile_observed_at",
    "roster_observed_at",
  ])
    assert.ok(pre[col] < daily[col], `pre_reset ${col} is the older one`);
});

test("the shared order picks the daily row for every stamp, and daily on a tie", async () => {
  for (const stamp of [
    "observed_at",
    "profile_observed_at",
    "roster_observed_at",
  ]) {
    const {
      rows: [r],
    } = await ctx.db.query(
      `select s.snapshot_kind from player_snapshot_daily s where s.player_tag = $1
         and s.${stamp} is not null
       order by ${latestSnapshotOrder({ alias: "s", stamp })} limit 1`,
      [P],
    );
    assert.equal(r.snapshot_kind, "daily", stamp);
  }
  // One read inside the window writes both rows at the same instant (an
  // earlier week here); the latest read wants the counter as it stands,
  // not pre_reset's high-water mark.
  await ctx.db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, donations, observed_at, profile_observed_at, roster_observed_at)
     values ($1, '2026-11-08', 'pre_reset', 300, $2, $2, $2), ($1, '2026-11-08', 'daily', 0, $2, $2, $2)`,
    [Q, "2026-11-09T00:05:00Z"],
  );
  for (const stamp of [
    "observed_at",
    "profile_observed_at",
    "roster_observed_at",
  ]) {
    const {
      rows: [tie],
    } = await ctx.db.query(
      `select snapshot_kind, donations from player_snapshot_daily
        where player_tag = $1 and snapshot_date <= '2026-11-08'
        order by ${latestSnapshotOrder({ stamp })} limit 1`,
      [Q],
    );
    assert.deepEqual(
      { ...tie },
      { snapshot_kind: "daily", donations: 0 },
      stamp,
    );
  }
  assert.throws(() => latestSnapshotOrder({ stamp: "snapshot_kind" }));
});

test("readRecordedProfile serves the newest profile", async () => {
  const r = await readRecordedProfile(ctx.db, P);
  assert.equal(r.snapshot_kind, "daily");
  assert.equal(r.trophies, late.p.trophies);
  assert.equal(r.wins, late.p.wins);
});

test("players_profile, players_summary and players_collection serve the newest row", async () => {
  const profile = await invoke("players_profile", { player_tag: P });
  assert.equal(
    profile.isError,
    false,
    JSON.stringify(profile.body).slice(0, 300),
  );
  assert.equal(profile.body.snapshot.trophies, late.p.trophies);

  const summary = await invoke("players_summary", { player_tag: P });
  assert.equal(
    summary.isError,
    false,
    JSON.stringify(summary.body).slice(0, 300),
  );
  assert.equal(summary.body.trophies, late.p.trophies);

  const collection = await invoke("players_collection", { player_tag: P });
  assert.equal(
    collection.isError,
    false,
    JSON.stringify(collection.body).slice(0, 300),
  );
  assert.equal(collection.body.collection_level, late.p.collectionLevel);
});

test("players_search shows the newest trophies", async () => {
  const r = await invoke("players_search", { query: "Early Bird" });
  assert.equal(r.isError, false, JSON.stringify(r.body).slice(0, 300));
  const hit = r.body.matches.find((m) => m.player_tag === P);
  assert.ok(hit, "found");
  assert.equal(hit.trophies, late.p.trophies);
});

test("clans_roster serves each member's newest row, roster columns and profile block", async () => {
  // The web surface, where the roster's own columns (clan_rank) are served.
  const r = await webInvoke("clans_roster", {
    clan_tag: CLAN,
    verbosity: "full",
  });
  assert.equal(r.isError, false, JSON.stringify(r.body).slice(0, 300));
  const m = r.body.members.find((x) => x.player_tag === P);
  assert.ok(m, JSON.stringify(r.body.members).slice(0, 300));
  assert.equal(m.trophies, late.p.trophies);
  assert.equal(m.clan_rank, 1);
  assert.equal(m.lifetime.wins, late.p.wins);
});

test("battles_compare reads each player's newest profile", async () => {
  const r = await invoke("battles_compare", { player_tags: [P, Q] });
  assert.equal(r.isError, false, JSON.stringify(r.body).slice(0, 300));
  const byTag = Object.fromEntries(
    r.body.players.map((x) => [x.player_tag, x]),
  );
  assert.equal(byTag[P].trophies, late.p.trophies);
  assert.equal(byTag[Q].trophies, late.q.trophies);
});
