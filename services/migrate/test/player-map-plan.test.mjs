// The player map's and Near you's read budget (#768): one statement each,
// and plans that never scan the Clan ledger, the claim or account tables
// whole. Asserted on plan shape and rows read, never on milliseconds. The
// volumes are synthetic and only big enough that a scan would cost the
// planner more than an index: thirty thousand Clan ledger rows that are
// not places, and twenty thousand approved people with a verified claim,
// of whom a thousand have set a place (most people never do), spread over
// two countries and their regions, each place stamped by and under its own
// person's claim.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readNearYou, readPlayerMap } from "@elixir-mcp/auth/clan-context";

let scratch, me;

// An invented tag per number, over the game's alphabet ("#0" then digits
// mapped to letters), so no literal tag sits in this file.
const TAG = (expr) =>
  `'#0' || translate(lpad((${expr})::text, 6, '0'), '0123456789', '0289PYLQGR')`;

const REGIONS = ["TX", "CA", "NY", "FL", "WA", "IL", "OH", "GA"];

before(async () => {
  scratch = await scratchDb("player_map_plan");
  const db = scratch.db;
  await db.query(
    `insert into account(email_hash, kind, status, role)
       select 'pmap-' || i, 'person', 'approved', 'member'
         from generate_series(1, 20000) i`,
  );
  await db.query(
    `insert into player(player_tag, name)
       select ${TAG("700000 + i")}, 'Invented ' || i from generate_series(1, 20000) i`,
  );
  await db.query(
    `insert into claim(account_id, player_tag, status, is_primary, relationship, verified_at)
       select a.account_id, ${TAG("700000 + i")}, 'verified', true, 'primary',
              '2026-10-01T00:00:00Z'
         from generate_series(1, 20000) i
         join account a on a.email_hash = 'pmap-' || i`,
  );
  // A place for every fifth of the first five thousand, stamped with its
  // owner's account.
  await db.query(
    `insert into clan_state(pk, body)
       select 'place#' || p.t, jsonb_build_object(
                'pk', 'place#' || p.t, 'player_tag', p.t,
                'account_id', a.account_id::text,
                'country', case when i % 3 = 0 then 'CA' else 'US' end,
                'region', case when i % 3 = 0 then '08'
                               else ($1::text[])[1 + i % 8] end,
                'city', null, 'set_at', '2026-11-05T00:00:00.000Z')
         from (select i, ${TAG("700000 + i")} as t
                 from generate_series(1, 5000) i where i % 5 = 0) p
         join account a on a.email_hash = 'pmap-' || p.i`,
    [REGIONS],
  );
  await db.query(
    `insert into clan_state(pk, body)
       select pk, jsonb_build_object('pk', pk, 'gsi1pk', 'clan#' || t,
                'gsi1sk', 'action#' || n, 'note', repeat('x', 200))
         from (select ${TAG("1 + n % 20000")} as t, n,
                      'action#' || ${TAG("1 + n % 20000")} || '#' || n as pk
                 from generate_series(1, 30000) n) a`,
  );
  // The reader: person 5 (US, Illinois).
  me = (
    await db.query(`select account_id from account where email_hash = 'pmap-5'`)
  ).rows[0].account_id;
  for (const t of ["clan_state", "claim", "account", "player"])
    await db.query(`vacuum analyze ${t}`);
});
after(async () => scratch?.drop());

async function readCounted(fn) {
  const sent = [];
  const counting = {
    query: (text, values) => {
      sent.push({ text, values });
      return scratch.db.query(text, values);
    },
  };
  const got = await fn(counting, { accountId: me, kind: "person" });
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

async function scansOf({ text, values }) {
  const r = await scratch.db.query(
    `explain (analyze, format json) ${text}`,
    values,
  );
  // The tables' scans, and the bitmap index scans that feed a heap scan
  // (they name the index, not the table).
  return planNodes(r.rows[0]["QUERY PLAN"][0].Plan).filter(
    (n) =>
      ["clan_state", "claim", "account"].includes(n["Relation Name"]) ||
      n["Node Type"] === "Bitmap Index Scan",
  );
}

test("the player map is one statement that enters the ledger by its index", async () => {
  const { got, sent } = await readCounted(readPlayerMap);
  assert.equal(sent.length, 1);
  assert.equal(got.entries.length, 1000);
  assert.equal(got.truncated, false);
  const scans = await scansOf(sent[0]);
  for (const n of scans)
    assert.notEqual(n["Node Type"], "Seq Scan", `${n["Relation Name"]} whole`);
  assert.ok(
    scans.some((n) => n["Index Name"] === "clan_state_place"),
    JSON.stringify(scans.map((n) => [n["Node Type"], n["Index Name"]])),
  );
});

test("Near you is one statement that reads only its region's places", async () => {
  const { got, sent } = await readCounted(readNearYou);
  assert.equal(sent.length, 1);
  assert.equal(got.place.region, "IL");
  assert.ok(got.people.length > 0);
  const scans = await scansOf(sent[0]);
  for (const n of scans)
    assert.notEqual(n["Node Type"], "Seq Scan", `${n["Relation Name"]} whole`);
  const ledger = scans.filter((n) => n["Index Name"] === "clan_state_place");
  assert.equal(ledger.length, 1);
  // The region's places on the player map, never the whole map's.
  const read =
    ((ledger[0]["Actual Rows"] ?? 0) +
      (ledger[0]["Rows Removed by Filter"] ?? 0)) *
    (ledger[0]["Actual Loops"] ?? 1);
  assert.ok(read <= 200, `${read} places read`);
});
