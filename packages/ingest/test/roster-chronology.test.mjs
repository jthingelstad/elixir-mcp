import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { ingestClanRoster, rosterRecords } from "../src/roster.mjs";
import { processResult } from "../src/pipeline.mjs";
import { projectClanSeries } from "../src/series.mjs";
import {
  scratchDb,
  seedReceipt,
  trackClans,
  waitUntilBlocked,
} from "./helpers.mjs";

const A = "#0VGJQ28P",
  B = "#0L8P9LLJ";
const OWN = "#0RJ29CVY",
  PEER = "#0PGQ2UYL",
  PRIMARY = "#0LYQ8GRP";
const at = (hour) => `2026-11-10T${String(hour).padStart(2, "0")}:00:00.000Z`;
const roster = (clan, tags, role = "member") => ({
  tag: clan,
  name: "Invented Clan",
  members: tags.length,
  memberList: tags.map((tag) => ({
    tag,
    name: `Invented ${tag}`,
    role,
    trophies: 1000,
  })),
});
async function project(db, clan, tags, hour, extra = {}) {
  await db.query("begin");
  try {
    const result = await ingestClanRoster(db, {
      payload: roster(clan, tags),
      observedAt: at(hour),
      ...extra,
    });
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
const current = async (db, tag) =>
  (
    await db.query(
      "select clan_tag,role,joined_observed_at,left_observed_at from clan_membership where player_tag=$1 order by joined_observed_at,clan_tag",
      [tag],
    )
  ).rows;
const stamp = async (db, clan) =>
  (
    await db.query("select roster_observed_at from clan where clan_tag=$1", [
      clan,
    ])
  ).rows[0].roster_observed_at?.toISOString() ?? null;

test("older and equal-time clan rosters cannot resurrect a departure or change roles", async () => {
  const ctx = await scratchDb("roster_order");
  try {
    await trackClans(ctx.db, [A]);
    await project(ctx.db, A, [OWN, PEER], 10);
    await project(ctx.db, A, [OWN], 12);
    const before = await current(ctx.db, PEER);
    const events = (
      await ctx.db.query("select count(*)::int as n from clan_event")
    ).rows[0].n;
    for (const hour of [11, 12]) {
      const result = await project(ctx.db, A, [OWN, PEER], hour, {
        payload: roster(A, [OWN, PEER], "elder"),
      });
      assert.equal(result.facts, 0);
      assert.deepEqual(await current(ctx.db, PEER), before);
      assert.equal((await current(ctx.db, OWN))[0].role, "member");
      assert.equal(await stamp(ctx.db, A), at(12));
      assert.equal(
        (await ctx.db.query("select count(*)::int as n from clan_event"))
          .rows[0].n,
        events,
      );
    }
  } finally {
    await ctx.drop();
  }
});

test("an older foreign roster cannot move a member confirmed more recently elsewhere", async () => {
  const ctx = await scratchDb("roster_foreign");
  try {
    await trackClans(ctx.db, [A, B]);
    await project(ctx.db, B, [PEER], 9);
    await project(ctx.db, A, [], 10);
    await project(ctx.db, B, [PEER], 12);
    const before = await current(ctx.db, PEER);
    await project(ctx.db, A, [PEER], 11);
    assert.deepEqual(
      await current(ctx.db, PEER),
      before,
      "newest confirmation, not only the old join, wins",
    );
    assert.equal(
      await stamp(ctx.db, A),
      at(11),
      "the rest of this clan's actual observation can advance",
    );
  } finally {
    await ctx.drop();
  }
});

test("a closed foreign membership also prevents an older receipt from fabricating a return", async () => {
  const ctx = await scratchDb("roster_closed_foreign");
  try {
    await trackClans(ctx.db, [A, B]);
    await project(ctx.db, B, [PEER], 9);
    await project(ctx.db, B, [], 12);
    const before = await current(ctx.db, PEER);
    await project(ctx.db, A, [PEER], 11);
    assert.deepEqual(await current(ctx.db, PEER), before);
  } finally {
    await ctx.drop();
  }
});

test("an upgrade's NULL projection clock uses admissions only to reject older or equal replays", async () => {
  const ctx = await scratchDb("roster_upgrade_clock");
  try {
    await trackClans(ctx.db, [A]);
    await project(ctx.db, A, [OWN, PEER], 9);
    await project(ctx.db, A, [OWN], 11);
    await ctx.db.query(
      "update clan set roster_observed_at=null where clan_tag=$1",
      [A],
    );
    await ctx.db.query(
      "insert into poll_state(subject_tag,endpoint,last_admitted_at)values($1,'clan',$2)",
      [A, at(12)],
    );
    const before = await current(ctx.db, PEER);
    for (const hour of [10, 12]) {
      const replay = await project(ctx.db, A, [OWN, PEER], hour, {
        payload: roster(A, [OWN, PEER], "elder"),
      });
      assert.equal(replay.facts, 0);
      assert.equal(
        await stamp(ctx.db, A),
        null,
        "a receipt cannot become projected evidence",
      );
      assert.deepEqual(await current(ctx.db, PEER), before);
      assert.equal((await current(ctx.db, OWN))[0].role, "member");
    }
    await project(ctx.db, A, [OWN], 13);
    assert.equal(await stamp(ctx.db, A), at(13));
    assert.deepEqual(await current(ctx.db, PEER), before);
  } finally {
    await ctx.drop();
  }
});

test("equal-time foreign clan claims never invent a move in either arrival order", async () => {
  for (const [first, second] of [
    [A, B],
    [B, A],
  ]) {
    const ctx = await scratchDb(`roster_tie_${first === A ? "a" : "b"}`);
    try {
      await trackClans(ctx.db, [A, B]);
      await project(ctx.db, first, [PEER], 10);
      const before = await current(ctx.db, PEER);
      await project(ctx.db, second, [PEER], 10);
      assert.deepEqual(await current(ctx.db, PEER), before);
      assert.equal(
        (await ctx.db.query("select count(*)::int as n from clan_event"))
          .rows[0].n,
        0,
      );
    } finally {
      await ctx.drop();
    }
  }
});

test("overlapping clan transactions retain the newest member observation", async () => {
  const ctx = await scratchDb("roster_overlap");
  const newer = new pg.Client({ connectionString: ctx.url });
  const older = new pg.Client({ connectionString: ctx.url });
  let pending = null;
  try {
    await trackClans(ctx.db, [A, B]);
    await project(ctx.db, B, [PEER], 9);
    await project(ctx.db, A, [], 10);
    await newer.connect();
    await older.connect();
    await newer.query("begin");
    await ingestClanRoster(newer, {
      payload: roster(B, [PEER]),
      observedAt: at(12),
    });
    pending = project(older, A, [PEER], 11).then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
    await waitUntilBlocked(ctx.db, { pids: [older.processID] });
    await newer.query("commit");
    const outcome = await pending;
    if (outcome.error) throw outcome.error;
    const open = (await current(ctx.db, PEER)).filter(
      (row) => row.left_observed_at === null,
    );
    assert.equal(open.length, 1);
    assert.equal(open[0].clan_tag, B);
    assert.equal(await stamp(ctx.db, B), at(12));
  } finally {
    await newer.query("rollback").catch(() => {});
    await pending;
    await older.end();
    await newer.end();
    await ctx.drop();
  }
});

test("receipt-only clan admissions never supply the projected membership stamp or an event boundary", async () => {
  const ctx = await scratchDb("roster_projection_stamp");
  try {
    await trackClans(ctx.db, [A]);
    const receipt = await seedReceipt(ctx.db, {
      endpoint: "clan",
      entityKey: A,
    });
    const gateway = (
      await ctx.db.query(
        "select gateway_id from api_receipt where receipt_id=$1",
        [receipt],
      )
    ).rows[0].gateway_id;
    await ctx.db.query("delete from api_receipt where receipt_id=$1", [
      receipt,
    ]);
    const put = (tags, hour, deps = {}) =>
      processResult(
        ctx.db,
        {
          v: 1,
          job: { endpoint: "clan", entity_key: A, lane: "bulk" },
          gateway_id: gateway,
          fetched_at: at(hour),
          status: "ok",
          body_gzip_b64: gzipSync(
            Buffer.from(JSON.stringify(roster(A, tags))),
          ).toString("base64"),
        },
        deps,
      );
    await put([OWN, PEER], 10);
    assert.equal(await stamp(ctx.db, A), at(10));
    await put([OWN], 12, { skipProjection: true });
    assert.equal(await stamp(ctx.db, A), at(10));
    await put([OWN], 11);
    assert.equal(await stamp(ctx.db, A), at(11));
    const event = (
      await ctx.db.query(
        "select window_start,window_end from clan_event where event_type='member_left'",
      )
    ).rows[0];
    assert.equal(event.window_start.toISOString(), at(10));
    assert.equal(event.window_end.toISOString(), at(11));
    assert.equal(
      (
        await ctx.db.query(
          "select last_admitted_at from poll_state where subject_tag=$1 and endpoint='clan'",
          [A],
        )
      ).rows[0].last_admitted_at.toISOString(),
      at(12),
    );
  } finally {
    await ctx.drop();
  }
});

async function owner(
  db,
  suffix,
  { status = "approved", relationship = "alt", verified = true } = {},
) {
  const account = (
    await db.query(
      "insert into account(email_hash,status)values($1,'approved')returning account_id",
      [`${suffix}-owner`],
    )
  ).rows[0].account_id;
  if (status !== "approved")
    await db.query("update account set status=$2 where account_id=$1", [
      account,
      status,
    ]);
  await db.query(
    "insert into player(player_tag,name)values($1,'Invented Own')",
    [OWN],
  );
  await db.query(
    "insert into claim(account_id,player_tag,status,relationship,is_primary)values($1,$2,$3,$4,$5)",
    [
      account,
      OWN,
      verified ? "verified" : "unverified",
      relationship,
      relationship === "primary",
    ],
  );
  return account;
}

test("a verified alt's incidental roster retains automatic peers silently without recording them", async () => {
  const ctx = await scratchDb("roster_incidental_alt");
  try {
    const account = await owner(ctx.db, "incidental-alt");
    await ctx.db.query(
      "insert into player(player_tag,name)values($1,'Invented Primary')",
      [PRIMARY],
    );
    await ctx.db.query(
      "insert into claim(account_id,player_tag,status,relationship,is_primary)values($1,$2,'verified','primary',true)",
      [account, PRIMARY],
    );
    const result = await project(ctx.db, A, [OWN, PEER], 10);
    assert.equal(result.baselined, 2);
    assert.equal(result.joined, 0);
    assert.equal(
      (await ctx.db.query("select count(*)::int as n from clan_event")).rows[0]
        .n,
      0,
    );
    assert.equal((await current(ctx.db, PEER))[0].clan_tag, A);
    assert.equal(
      (
        await ctx.db.query("select name from player where player_tag=$1", [
          PEER,
        ])
      ).rows[0].name,
      `Invented ${PEER}`,
    );
    assert.deepEqual(
      [...(await rosterRecords(ctx.db, A, [OWN, PEER]))],
      [OWN],
      "series/recording scope stays narrow",
    );
    await projectClanSeries(ctx.db, {
      payload: roster(A, [OWN, PEER]),
      observedAt: at(10),
      moments: false,
    });
    assert.equal(
      (
        await ctx.db.query(
          "select count(*)::int as n from player_snapshot_daily where player_tag=$1",
          [PEER],
        )
      ).rows[0].n,
      0,
    );
    for (const table of ["account_clan", "recording", "job"])
      assert.equal(
        (await ctx.db.query(`select count(*)::int as n from ${table}`)).rows[0]
          .n,
        0,
        table,
      );
    assert.equal(
      (
        await ctx.db.query(
          "select count(*)::int as n from claim where player_tag=$1",
          [PEER],
        )
      ).rows[0].n,
      0,
    );
    const left = await project(ctx.db, A, [OWN], 11);
    assert.equal(left.departed, 1);
    assert.equal(
      (await current(ctx.db, PEER))[0].left_observed_at.toISOString(),
      at(11),
    );
    await project(ctx.db, A, [], 12);
    assert.equal(
      (await current(ctx.db, OWN))[0].left_observed_at.toISOString(),
      at(12),
    );
  } finally {
    await ctx.drop();
  }
});

test("unverified, friend and inactive claims do not expand incidental peer retention", async () => {
  for (const [label, options] of [
    ["unverified", { relationship: "primary", verified: false }],
    ["friend", { relationship: "friend", verified: false }],
    ["inactive", { status: "denied" }],
  ]) {
    const ctx = await scratchDb(`roster_incidental_${label}`);
    try {
      await owner(ctx.db, label, options);
      const result = await project(ctx.db, A, [OWN, PEER], 10);
      assert.equal(result.baselined, 1, label);
      assert.deepEqual(await current(ctx.db, PEER), [], label);
      assert.equal(
        (
          await ctx.db.query(
            "select count(*)::int as n from player where player_tag=$1",
            [PEER],
          )
        ).rows[0].n,
        0,
        label,
      );
    } finally {
      await ctx.drop();
    }
  }
});

test("chronology probes only the named players' history amid unrelated closed intervals", async () => {
  const ctx = await scratchDb("roster_history_plan");
  try {
    await trackClans(ctx.db, [A, B]);
    await project(ctx.db, B, [PEER], 9);
    await project(ctx.db, A, [], 10);
    await ctx.db.query(
      "insert into player(player_tag,name)values($1,'Invented Unrelated')",
      [PRIMARY],
    );
    await ctx.db.query(
      `insert into clan_membership(clan_tag,player_tag,role,joined_observed_at,left_observed_at)
       select $1,$2,'member',$3::timestamptz-n*interval '2 microseconds',
              $3::timestamptz-n*interval '2 microseconds'+interval '1 microsecond'
         from generate_series(1,10000)n`,
      [B, PRIMARY, at(8)],
    );
    await ctx.db.query("analyze clan_membership");
    const calls = [];
    const tracked = {
      query(sql, values) {
        calls.push({ sql, values });
        return ctx.db.query(sql, values);
      },
    };
    await project(tracked, A, [PEER], 11);
    const query = calls.find((call) => call.sql.includes("having max(case"));
    assert.ok(query, "the source checks the full named history");
    const result = await ctx.db.query(
      `explain(analyze,buffers,format json)${query.sql}`,
      query.values,
    );
    const nodes = (node) => [node, ...(node.Plans ?? []).flatMap(nodes)];
    const work = nodes(result.rows[0]["QUERY PLAN"][0].Plan)
      .filter((node) => node["Relation Name"] === "clan_membership")
      .reduce(
        (sum, node) =>
          sum +
          ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) *
            node["Actual Loops"],
        0,
      );
    assert.ok(
      work <= 20,
      `inspected ${work} intervals for one named player's history`,
    );
  } finally {
    await ctx.drop();
  }
});
