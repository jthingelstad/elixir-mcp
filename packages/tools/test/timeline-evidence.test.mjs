import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { emitEvent } from "../../ingest/src/events.mjs";
import { pinArenaMoment } from "../../ingest/src/snapshots.mjs";
import {
  buildTimeline,
  subjectsFor,
  readTimelineEvidence,
} from "../src/activity/entries.mjs";
import { elixir_timeline } from "../src/tools/elixir/timeline.mjs";
import { accountRoutes } from "../../../services/web-api/src/routes/account.mjs";
const TAG = "#P0YQ2L8";
const FROM = Date.parse("2026-10-03T12:00:00Z");
const at = (n) => new Date(FROM + n * 60000).toISOString();
const id = (n) => n.toString(16).padStart(64, "0");
let scratch, db, owner, other;
before(async () => {
  scratch = await scratchDb("timeline_evidence");
  db = scratch.db;
  await db.query(
    "insert into player (player_tag,name) values ($1,'Example Player')",
    [TAG],
  );
  const accounts = await db.query(
    "insert into account (email_hash,status,timezone) values ('evidence-owner','approved','UTC'),('evidence-other','approved','UTC') returning account_id",
  );
  [owner, other] = accounts.rows.map((r) => r.account_id);
  await db.query(
    "insert into claim (account_id,player_tag,status,notify) values ($1,$2,'unverified',true)",
    [owner, TAG],
  );
  for (let n = 1; n <= 30; n++) {
    await db.query(
      "insert into battle (battle_id,battle_time,type,type_class,created_at) values ($1,$2,'PvP','pvp',$3)",
      [id(n), at(n), at(n + 2)],
    );
    await db.query(
      "insert into battle_participant (battle_id,player_tag,battle_time,side,type,type_class,outcome,starting_trophies,trophy_change,crowns) values ($1,$2,$3,0,'PvP','pvp','win',$4,30,3)",
      [id(n), TAG, at(n), n === 9 ? 5990 : 5900],
    );
  }
  // Neither an enemy attacking the boat nor a game captured days late is
  // the sitting's constituent. Fresh capture delay, not window width.
  await db.query(
    "insert into battle (battle_id,battle_time,type,type_class,boat_battle_side,created_at) values ($1,$2,'boatBattle','boat','defender',$3),($4,$5,'PvP','pvp',null,$6)",
    [id(101), at(15), at(16), id(102), at(20), at(20 + 2880)],
  );
  for (const n of [101, 102])
    await db.query(
      "insert into battle_participant (battle_id,player_tag,battle_time,side,type,type_class,outcome) values ($1,$2,$3,0,$4,$5,'win')",
      [
        id(n),
        TAG,
        at(n === 101 ? 15 : 20),
        n === 101 ? "boatBattle" : "PvP",
        n === 101 ? "boat" : "pvp",
      ],
    );
  await db.query(
    "insert into arena (arena_id,name) values (54000101,'Example Arena')",
  );
  await db.query(
    "insert into player_snapshot_daily (player_tag,snapshot_date,snapshot_kind,trophies,arena_id,profile_observed_at) values ($1,'2026-10-03','daily',6000,54000101,$2)",
    [TAG, at(11)],
  );
});
after(async () => scratch.drop());
async function feed(from = FROM, to = FROM + 60 * 60000, accountId = owner) {
  return buildTimeline(db, await subjectsFor(db, accountId), {
    fromMs: from,
    toMs: to,
    accountId,
    timezone: "UTC",
    interactive: true,
  });
}
test("session references are exact, ordered and paged with exclusions and honest completeness", async () => {
  const built = await feed();
  const item = built.timeline.find((x) => x.kind === "battle_session");
  assert.equal(item.revision, 30);
  assert.equal(item.evidence.count, 30);
  assert.equal(item.evidence.capture_completeness, "unknown");
  assert.equal(item.evidence.completeness, "recorded_sitting");
  const page = await readTimelineEvidence(db, item, {
    limit: 25,
    expectedVersion: item.evidence.version,
  });
  assert.deepEqual(
    page.battles.map((b) => b.battle_id),
    Array.from({ length: 25 }, (_, i) => id(i + 1)),
  );
  assert.ok(
    page.battles.every(
      (b) =>
        b.relation === "constituent" &&
        b.url.startsWith("https://elixir.poapkings.com/battle/"),
    ),
  );
  const next = await readTimelineEvidence(db, item, {
    offset: page.next_offset,
    limit: 25,
    expectedVersion: item.evidence.version,
  });
  assert.deepEqual(
    next.battles.map((b) => b.battle_id),
    Array.from({ length: 5 }, (_, i) => id(i + 26)),
  );
  assert.equal(next.next_offset, null);
  const recent = (await feed(FROM + 25 * 60000)).timeline.find(
    (x) => x.kind === "battle_session",
  );
  assert.equal(recent.id, item.id);
  assert.equal(recent.evidence.count, 30);
  assert.deepEqual(
    await readTimelineEvidence(db, { ...JSON.parse(JSON.stringify(item)) }),
    { error: "evidence_unavailable" },
    "wire facts are not authority",
  );
  assert.deepEqual(await readTimelineEvidence(db, item, { offset: -1 }), {
    error: "invalid_page",
  });
});
test("late arena proof freezes the legacy duplicate origin and records a new evidence observation", async () => {
  for (const n of [10, 11])
    await emitEvent(db, "arena_changed", {
      tag: TAG,
      payload: { from: 54000100, to: 54000101, to_name: "Example Arena" },
      windowStart: at(0),
      windowEnd: at(n),
    });
  // Simulate old deployed writers: two legacy rows, neither stamped.
  await db.query(
    "update player_event set origin_event_id=null,evidence_version=null,evidence_observed_at=null where player_tag=$1",
    [TAG],
  );
  const before = (await feed()).timeline.filter(
    (x) => x.kind === "arena_changed",
  );
  assert.equal(before.length, 1);
  assert.equal(before[0].evidence.status, "unknown");
  assert.deepEqual((await readTimelineEvidence(db, before[0])).battles, []);
  const pinned = await pinArenaMoment(db, {
    playerTag: TAG,
    arenaName: "Example Arena",
    fetchedAt: at(40),
  });
  assert.ok(pinned);
  assert.equal(
    (await feed(FROM, FROM + 15 * 60000)).timeline.filter(
      (x) => x.kind === "arena_changed",
    ).length,
    0,
    "a past observation window never serves later proof",
  );
  assert.deepEqual(
    await readTimelineEvidence(db, before[0], {
      expectedVersion: before[0].evidence.version,
    }),
    { error: "evidence_changed" },
    "proof attached after the item read requires refresh",
  );

  const after = (await feed()).timeline.filter(
    (x) => x.kind === "arena_changed",
  );
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before[0].id);
  assert.notEqual(after[0].evidence.version, before[0].evidence.version);
  assert.equal(after[0].observed_at, at(40));
  assert.equal(after[0].evidence.observed_at, at(40));
  assert.equal(after[0].evidence.observation_window.to, at(10));
  const late = (await feed(FROM + 35 * 60000)).timeline.find(
    (x) => x.kind === "arena_changed",
  );
  assert.equal(late.id, before[0].id);
  const proof = await readTimelineEvidence(db, late);
  assert.equal(proof.status, "proved");
  assert.deepEqual(
    proof.battles.map((b) => b.battle_id),
    [id(9)],
  );
  assert.equal(proof.battles[0].relation, "proved_crossing");
  assert.deepEqual(
    await readTimelineEvidence(db, late, {
      expectedVersion: before[0].evidence.version,
    }),
    { error: "evidence_changed" },
  );
  assert.equal(
    await pinArenaMoment(db, {
      playerTag: TAG,
      arenaName: "Example Arena",
      fetchedAt: at(41),
    }),
    null,
    "an older duplicate cannot be proved twice",
  );
  await emitEvent(db, "arena_changed", {
    tag: TAG,
    payload: { from: 54000100, to: 54000101, to_name: "Example Arena" },
    windowStart: at(40),
    windowEnd: at(45),
  });
  const duplicate = (await feed()).timeline.filter(
    (x) => x.kind === "arena_changed",
  );
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].id, before[0].id);
  assert.equal(duplicate[0].evidence.status, "proved");
  assert.equal(duplicate[0].evidence.version, after[0].evidence.version);
  const narrow = (
    await feed(FROM + 39 * 60000, FROM + 46 * 60000)
  ).timeline.find((x) => x.kind === "arena_changed");
  assert.equal(narrow.evidence.status, "proved");
  assert.equal(
    (await readTimelineEvidence(db, narrow)).battles[0].battle_id,
    id(9),
  );
  // A legacy duplicate observed after the proof also resolves to that
  // proof; its original raw window must not move the canonical observation.
  await db.query(
    "update player_event set origin_event_id=null,evidence_version=null,evidence_observed_at=null,battle_id=null,floor=null,occurred_at=null,timing='estimated' where event_id=(select max(event_id) from player_event where player_tag=$1)",
    [TAG],
  );
  assert.equal(
    (await feed(FROM + 41 * 60000, FROM + 46 * 60000)).timeline.filter(
      (x) => x.kind === "arena_changed",
    ).length,
    0,
  );
  await db.query(
    "insert into clan (clan_tag,name) values ('#P0YQ2L2','Example Clan')",
  );
  await db.query(
    "insert into clan_membership (clan_tag,player_tag,role,joined_observed_at) values ('#P0YQ2L2',$1,'member',$2)",
    [TAG, at(0)],
  );
  await db.query(
    "insert into account_clan (account_id,clan_tag,scope,notify) values ($1,'#P0YQ2L2','comprehensive',true)",
    [owner],
  );
  assert.equal(
    (await feed(FROM + 41 * 60000, FROM + 46 * 60000)).timeline.filter(
      (x) => x.kind === "arena_changed",
    ).length,
    0,
    "clan path also honors resolved observation bounds",
  );
  assert.equal(
    (await feed(FROM, FROM + 15 * 60000)).timeline.filter(
      (x) => x.kind === "arena_changed",
    ).length,
    0,
    "clan past window never sees later proof",
  );
});
test("authorized tool and browser reads preserve pointers, refuse forged IDs, and pin evidence pages", async () => {
  const built = await feed();
  const item = built.timeline.find((x) => x.kind === "battle_session");
  await db.query("update account set activity_seen_at=$2 where account_id=$1", [
    owner,
    at(1),
  ]);
  const args = {
    from: at(0),
    to: at(60),
    evidence_item_id: item.id,
    expected_evidence_version: item.evidence.version,
  };
  const answer = await elixir_timeline.handler(
    { db, account: { accountId: owner, timezone: "UTC", isOwner: true } },
    args,
  );
  assert.equal(answer.applied.mark_read, false);
  assert.equal(answer.evidence.battles.length, 25);
  assert.equal(
    (
      await db.query(
        "select activity_seen_at from account where account_id=$1",
        [owner],
      )
    ).rows[0].activity_seen_at.toISOString(),
    at(1),
  );
  await assert.rejects(
    () =>
      elixir_timeline.handler(
        { db, account: { accountId: other, timezone: "UTC" } },
        args,
      ),
    /evidence_unavailable/,
  );
  const routes = accountRoutes({
    resolveAccount: async (_db, event) =>
      event.accountId ? { accountId: event.accountId } : null,
    logEvent: async () => {},
  });
  const route = routes["GET /api/me/timeline"];
  const q = { ...args, evidence_offset: "25" };
  const allowed = await route(db, {
    accountId: owner,
    queryStringParameters: q,
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(JSON.parse(allowed.body).battles.length, 5);
  assert.equal(
    (await route(db, { accountId: other, queryStringParameters: q }))
      .statusCode,
    404,
  );
  assert.equal((await route(db, { queryStringParameters: q })).statusCode, 401);
  assert.equal(
    (
      await route(db, {
        accountId: owner,
        queryStringParameters: { ...q, expected_evidence_version: "ev_old" },
      })
    ).statusCode,
    409,
  );
});

test("a bounded sitting discloses an incomplete anchor, ties sort by canonical ID and open stays explicit", async () => {
  const tag = "#P0YQ2L9";
  await db.query(
    "insert into player (player_tag,name) values ($1,'Example Long Sitting')",
    [tag],
  );
  await db.query(
    "insert into claim (account_id,player_tag,status,notify) values ($1,$2,'unverified',true)",
    [owner, tag],
  );
  await db.query(
    `insert into battle (battle_id,battle_time,type,type_class,created_at)
    select lpad(to_hex(1000+n),64,'0'),$1::timestamptz+n*interval '1 minute','PvP','pvp',$1::timestamptz+n*interval '1 minute'+interval '1 second' from generate_series(1,206) n`,
    [at(0)],
  );
  await db.query(
    `update battle set battle_time=$1::timestamptz,created_at=$1::timestamptz+interval '1 second' where battle_id=$2`,
    [at(205), id(1206)],
  );
  await db.query(
    `insert into battle_participant (battle_id,player_tag,battle_time,side,type,type_class,outcome)
    select battle_id,$1,battle_time,0,type,type_class,'win' from battle where battle_id between $2 and $3`,
    [tag, id(1001), id(1206)],
  );
  const item = (
    await feed(FROM + 204 * 60000, FROM + 210 * 60000)
  ).timeline.find((x) => x.subject_tag === tag && x.kind === "battle_session");
  assert.equal(item.evidence.open, true);
  assert.equal(item.evidence.completeness, "anchor_bound");
  assert.equal(item.evidence.capture_completeness, "unknown");
  const last = await readTimelineEvidence(db, item, {
    offset: item.evidence.count - 2,
    limit: 2,
    expectedVersion: item.evidence.version,
  });
  assert.deepEqual(
    last.battles.map((x) => x.battle_id),
    [id(1205), id(1206)],
  );
  const prior = item.evidence.version;
  // Outcome corrections do not change the exact reference membership.
  await db.query(
    "update battle_participant set outcome='loss' where battle_id=$1 and player_tag=$2",
    [id(1205), tag],
  );
  assert.equal(
    (await feed(FROM + 204 * 60000, FROM + 210 * 60000)).timeline.find(
      (x) => x.subject_tag === tag && x.kind === "battle_session",
    ).evidence.version,
    prior,
    "game membership stays the same when an outcome is corrected",
  );
});

test("a capture between the item and page statement rejects stale membership rather than shifting offsets", async () => {
  const item = (await feed()).timeline.find(
    (x) => x.subject_tag === TAG && x.kind === "battle_session",
  );
  let injected = false;
  const racedDb = {
    query: async (text, params) => {
      if (!injected && text.includes("with records as materialized")) {
        injected = true;
        await db.query(
          "insert into battle (battle_id,battle_time,type,type_class,created_at) values ($1,$2,'PvP','pvp',$3)",
          [id(3000), at(14.5), at(50)],
        );
        await db.query(
          "insert into battle_participant (battle_id,player_tag,battle_time,side,type,type_class,outcome) values ($1,$2,$3,0,'PvP','pvp','win')",
          [id(3000), TAG, at(14.5)],
        );
      }
      return db.query(text, params);
    },
  };
  assert.deepEqual(
    await readTimelineEvidence(racedDb, item, {
      offset: 25,
      expectedVersion: item.evidence.version,
    }),
    { error: "evidence_changed" },
  );
  const fresh = (await feed()).timeline.find(
    (x) => x.subject_tag === TAG && x.kind === "battle_session",
  );
  assert.notEqual(fresh.evidence.version, item.evidence.version);
  assert.equal(fresh.evidence.count, item.evidence.count + 1);
});

test("ranked proof and ladder sessions keep canonical mode and result provenance separate", async () => {
  await db.query(
    "insert into battle (battle_id,battle_time,type,type_class,league_number,created_at) values ($1,$2,'pathOfLegend','pvp',2,$3)",
    [id(4000), at(55), at(56)],
  );
  await db.query(
    "insert into battle_participant (battle_id,player_tag,battle_time,side,type,type_class,outcome,crowns,trophy_change) values ($1,$2,$3,0,'pathOfLegend','pvp','win',1,30)",
    [id(4000), TAG, at(55)],
  );
  await emitEvent(db, "ranked_promotion", {
    tag: TAG,
    payload: { from: 2, to: 3 },
    windowStart: at(50),
    windowEnd: at(54),
  });
  await emitEvent(db, "ranked_promotion", {
    tag: TAG,
    payload: { from: 2, to: 3, promoted_by: { battle_id: id(4000) } },
    windowStart: at(50),
    windowEnd: at(57),
    occurredAt: at(55),
  });
  await db.query(
    "update player_event set origin_event_id=null,evidence_version=null,evidence_observed_at=null where event_type='ranked_promotion' and player_tag=$1",
    [TAG],
  );
  const ranked = (await feed()).timeline.find(
    (x) => x.kind === "ranked_promotion",
  );
  const evidence = await readTimelineEvidence(db, ranked);
  assert.equal(evidence.battles.length, 1);
  assert.equal(evidence.observed_at_basis, "legacy_window");
  assert.equal(evidence.battles[0].battle_id, id(4000));
  assert.equal(evidence.battles[0].mode_group, "ranked");
  assert.equal(evidence.battles[0].type, "pathOfLegend");
  assert.equal(evidence.battles[0].trophy_change, 30);
  assert.equal(evidence.battles[0].outcome, "win");
  const arena = (await feed()).timeline.find((x) => x.kind === "arena_changed");
  const arenaEvidence = await readTimelineEvidence(db, arena);
  assert.equal(arenaEvidence.battles[0].mode_group, "ladder");
  assert.equal(arenaEvidence.battles[0].battle_id, id(9));
  assert.notEqual(
    arenaEvidence.battles[0].battle_id,
    evidence.battles[0].battle_id,
  );
});
