// The clan directory's read budget (#768): one statement for a reader, and a
// plan that never scans the Clan ledger, the clan table, the clan series or
// the claim and membership tables whole. Asserted on query count and plan
// shape, never on milliseconds. The volumes are synthetic and only big
// enough that a scan would cost the planner more than an index: thirty
// thousand Clan ledger rows that are not policy pointers, twenty thousand
// recorded clans, sixty with a saved policy.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readClanDirectory } from "@elixir-mcp/auth/clan-context";

let scratch, me;

// An invented tag per number, over the game's alphabet ("#0" then digits
// mapped to letters), so no literal tag sits in this file.
const TAG = (expr) =>
  `'#0' || translate(lpad((${expr})::text, 6, '0'), '0123456789', '0289PYLQGR')`;

before(async () => {
  scratch = await scratchDb("clan_directory_plan");
  const db = scratch.db;
  await db.query(
    `insert into clan(clan_tag, name, type, description)
       select ${TAG("i")}, 'Example ' || i, 'open', 'Invented clan ' || i
         from generate_series(1, 20000) i`,
  );
  // A year of the series for the listed clans, a week for the rest.
  await db.query(
    `insert into clan_snapshot_daily
         (clan_tag, day, snapshot_kind, observed_at, members, required_trophies)
       select ${TAG("i")}, d::date, 'daily', d + interval '12 hours',
              10 + i % 40, 1000 * (i % 9)
         from generate_series(1, 20000) i,
              generate_series('2026-11-06'::timestamptz, '2026-11-12', interval '1 day') d`,
  );
  await db.query(
    `insert into clan_snapshot_daily
         (clan_tag, day, snapshot_kind, observed_at, members, required_trophies)
       select ${TAG("i * 300")}, d::date, 'daily', d + interval '12 hours', 30, 4000
         from generate_series(1, 60) i,
              generate_series('2025-11-13'::timestamptz, '2026-11-05', interval '1 day') d`,
  );
  // The Clan ledger: every listed clan's pointer and two versions, and
  // thirty thousand other rows (Actions, verdicts, schedules) beside them.
  await db.query(
    `insert into clan_state(pk, body)
       select pk, jsonb_build_object('pk', pk, 'version', 2,
                                     'saved_at', '2026-11-10T00:00:00Z')
         from (select 'policy#' || ${TAG("i * 300")} as pk
                 from generate_series(1, 60) i) p`,
  );
  await db.query(
    `insert into clan_state(pk, body)
       select pk, jsonb_build_object('pk', pk, 'gsi1pk', 'clan#' || t,
                'gsi1sk', 'policy#v' || v,
                'values', jsonb_build_object('war_intent', 'participating',
                  'posture', 'standard', 'leader_notes', 'private'))
         from (select ${TAG("i * 300")} as t, v,
                      'policy#' || ${TAG("i * 300")} || '#v' || v as pk
                 from generate_series(1, 60) i, generate_series(1, 2) v) p`,
  );
  await db.query(
    `insert into clan_state(pk, body)
       select pk, jsonb_build_object('pk', pk, 'gsi1pk', 'clan#' || t,
                'gsi1sk', 'action#' || n, 'note', repeat('x', 200))
         from (select ${TAG("1 + n % 20000")} as t, n,
                      'action#' || ${TAG("1 + n % 20000")} || '#' || n as pk
                 from generate_series(1, 30000) n) a`,
  );
  // The reader and thousands of other people's claims and memberships.
  me = (
    await db.query(
      "insert into account(email_hash,kind,status,role) values('plan-me','person','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  await db.query(
    `insert into player(player_tag)
       select ${TAG("900000 + i")} from generate_series(1, 5000) i`,
  );
  await db.query(
    `insert into account(email_hash, kind, status, role)
       select 'plan-other-' || i, 'person', 'approved', 'member'
         from generate_series(1, 5000) i`,
  );
  await db.query(
    `insert into claim(account_id, player_tag, status, is_primary, relationship)
       select a.account_id, ${TAG("900000 + i")}, 'verified', true, 'primary'
         from generate_series(2, 5000) i
         join account a on a.email_hash = 'plan-other-' || i`,
  );
  await db.query(
    `insert into claim(account_id, player_tag, status, is_primary, relationship)
       values ($1, ${TAG("900001")}, 'verified', true, 'primary')`,
    [me],
  );
  await db.query(
    `insert into clan_membership(clan_tag, player_tag, joined_observed_at, role, left_observed_at)
       select ${TAG("1 + i % 20000")}, ${TAG("900000 + i")}, now(), 'member', null
         from generate_series(1, 5000) i`,
  );
  await db.query(
    `update clan_membership set clan_tag = ${TAG("300")}
      where player_tag = ${TAG("900001")}`,
  );
  for (const t of [
    "clan",
    "clan_state",
    "clan_snapshot_daily",
    "claim",
    "clan_membership",
    "account",
  ])
    await db.query(`vacuum analyze ${t}`);
});
after(async () => scratch?.drop());

/** The reader on a client that records each statement it sends. */
async function readCounted(account) {
  const sent = [];
  const counting = {
    query: (text, values) => {
      sent.push({ text, values });
      return scratch.db.query(text, values);
    },
  };
  const got = await readClanDirectory(counting, account);
  return { got, sent };
}

function planNodes(plan) {
  const nodes = [];
  const walk = (n) => {
    nodes.push(n);
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(plan);
  return nodes;
}

test("a reader's directory is one statement", async () => {
  const { got, sent } = await readCounted({ accountId: me, kind: "person" });
  assert.equal(sent.length, 1);
  assert.equal(got.directory.clans.length, 60);
  assert.equal(got.directory.truncated, false);
  // Listed by name then tag, and the reader's own clan is marked.
  const names = got.directory.clans.map((c) => c.name.toLowerCase());
  assert.deepEqual(names, [...names].sort());
  assert.deepEqual(
    got.directory.clans.filter((c) => c.yours).map((c) => c.name),
    ["Example 300"],
  );
  // The newest day of the series is the tile's size.
  const mine = got.directory.clans.find((c) => c.yours);
  assert.equal(mine.members, 10 + (300 % 40));
});

test("its plan reads every large table by index, never whole", async () => {
  const { sent } = await readCounted({ accountId: me, kind: "person" });
  const [{ text, values }] = sent;
  const r = await scratch.db.query(
    `explain (analyze, format json) ${text}`,
    values,
  );
  const nodes = planNodes(r.rows[0]["QUERY PLAN"][0].Plan);
  const large = new Set([
    "clan",
    "clan_state",
    "clan_snapshot_daily",
    "claim",
    "clan_membership",
  ]);
  const scans = nodes.filter((n) => large.has(n["Relation Name"]));
  for (const n of scans)
    assert.notEqual(
      n["Node Type"],
      "Seq Scan",
      `${n["Relation Name"]} is scanned whole`,
    );
  // The ledger is entered through the pointer index alone, then each
  // pointer's saved version by key.
  const ledger = scans.filter((n) => n["Relation Name"] === "clan_state");
  assert.ok(
    ledger.some((n) => n["Index Name"] === "clan_state_policy_pointer"),
    JSON.stringify(ledger.map((n) => [n["Node Type"], n["Index Name"]])),
  );
  // The series is read once per listed clan at most, never per row of it.
  const series = scans.filter(
    (n) => n["Relation Name"] === "clan_snapshot_daily",
  );
  assert.equal(series.length, 1);
  assert.ok(series[0]["Actual Loops"] <= 60);
  assert.ok(series[0]["Actual Rows"] <= 3);
});

test("an empty directory is two statements: the read, then whether you may", async () => {
  const outsider = (
    await scratch.db.query(
      "insert into account(email_hash,kind,status,role) values('plan-off','person','disabled','member') returning account_id",
    )
  ).rows[0].account_id;
  const { got, sent } = await readCounted({
    accountId: outsider,
    kind: "person",
  });
  assert.deepEqual(got, { refused: "not_a_person" });
  assert.equal(sent.length, 2);
});
