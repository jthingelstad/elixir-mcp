/**
 * The retention trim (packages/record/src/retention.mjs): one declared
 * list classifies every table, and the trim takes exactly what is past
 * its window, with what goes with it, and nothing else.
 *
 * The guard reads the schema every migration builds: a new table that
 * no list names fails here, so a table cannot start keeping history
 * forever by being forgotten. Every write in this file is to a scratch
 * database made for the run.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRIMMED,
  OWN_TRIMS,
  CHILDREN,
  KEPT,
  retentionTrim,
  retentionDryRun,
} from "@elixir-mcp/record/retention";
import {
  scratchDb,
  seedReceipt,
} from "../../../packages/ingest/test/helpers.mjs";

const A = "#0PYLQ2";
const B = "#0GRJCUV";
const CLAN = "#0Q2L8";

let scratch;
let db;
before(async () => {
  scratch = await scratchDb("retention");
  db = scratch.db;
});
after(async () => {
  await scratch?.drop();
});

test("every table is in exactly one list, and every list names a real table", async () => {
  const { rows } = await db.query(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = new Set(rows.map((r) => r.tablename));
  const named = [
    ...TRIMMED.map((e) => e.table),
    ...Object.keys(OWN_TRIMS),
    ...Object.keys(CHILDREN),
    ...Object.keys(KEPT),
  ];
  const twice = named.filter((t, i) => named.indexOf(t) !== i);
  assert.deepEqual(twice, [], "a table classified twice");
  const unclassified = [...tables].filter((t) => !named.includes(t)).sort();
  assert.deepEqual(
    unclassified,
    [],
    "a table no retention list names: declare its window or why it is kept",
  );
  const stale = named.filter((t) => !tables.has(t));
  assert.deepEqual(stale, [], "a retention entry for a table that is gone");
});

test("each trimmed entry's time column exists and holds a time", async () => {
  const { rows } = await db.query(
    `select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public'`,
  );
  const types = new Map(
    rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type]),
  );
  for (const entry of TRIMMED) {
    for (const column of entry.columns ?? [entry.column]) {
      const type = types.get(`${entry.table}.${column}`);
      assert.ok(
        type === "date" || type === "timestamp with time zone",
        `${entry.table}.${column} is ${type ?? "missing"}`,
      );
    }
    assert.ok(["1 year", "28 days"].includes(entry.window), entry.table);
    if (entry.held) assert.equal(typeof entry.held, "string");
  }
});

async function seed() {
  await seedReceipt(db);
  const {
    rows: [{ account_id }],
  } = await db.query(
    `select account_id from account where email_hash = 'test-owner'`,
  );
  await db.query(`insert into player (player_tag) values ($1), ($2)`, [A, B]);
  await db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);
  await db.query(
    `insert into deck (deck_hash, card_count, first_seen_at, last_seen_at)
     values ('deck-shared', 8, now() - interval '400 days', now())`,
  );
  // An old battle and a new one, the same deck in both.
  for (const [id, age] of [
    ["old-battle", "400 days"],
    ["new-battle", "2 days"],
  ]) {
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, now() - $2::interval, 'PvP', 'pvp')`,
      [id, age],
    );
    for (const [tag, side] of [
      [A, 0],
      [B, 1],
    ])
      await db.query(
        `insert into battle_participant
           (battle_id, player_tag, side, battle_time, type_class, type, deck_hash)
         values ($1, $2, $3, now() - $4::interval, 'pvp', 'PvP', 'deck-shared')`,
        [id, tag, side, age],
      );
    await db.query(
      `insert into battle_participant_round (battle_id, player_tag, round)
       values ($1, $2, 1)`,
      [id, A],
    );
    await db.query(
      `insert into battle_highlight (player_tag, battle_id, account_id)
       values ($1, $2, $3)`,
      [A, id, account_id],
    );
    // An event the battle produced, stamped recent so only the battle
    // can take it.
    await db.query(
      `insert into player_event
         (player_tag, event_type, timing, window_start, window_end, battle_id)
       values ($1, 'badge_earned', 'exact', now() - interval '1 day', now(), $2)`,
      [A, id],
    );
  }
  await db.query(
    `insert into mcp_call_audit (tool, created_at)
     values ('old_call', now() - interval '29 days'),
            ('new_call', now() - interval '27 days')`,
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at)
     values ($1, $2, now() - interval '500 days', now() - interval '400 days'),
            ($1, $3, now() - interval '500 days', null)`,
    [CLAN, A, B],
  );
  await db.query(
    `insert into feedback (account_id, surface, message, status, created_at)
     values ($1, 'web', 'old and answered', 'done', now() - interval '400 days'),
            ($1, 'web', 'old and open', 'new', now() - interval '400 days')`,
    [account_id],
  );
  for (const [season, age] of [
    [100, "400 days"],
    [200, "10 days"],
  ]) {
    await db.query(
      `insert into war_week (clan_tag, season_id, section_index, closed_at)
       values ($1, $2, 0, now() - $3::interval)`,
      [CLAN, season, age],
    );
    await db.query(
      `insert into war_participation (clan_tag, season_id, section_index, player_tag)
       values ($1, $2, 0, $3)`,
      [CLAN, season, A],
    );
  }
  await db.query(
    `update api_receipt set fetched_at = now() - interval '40 days'`,
  );
}

const count = async (sql, params = []) =>
  Number((await db.query(sql, params)).rows[0].n);

test("the trim takes what is past its window, with what goes with it", async () => {
  await seed();
  const before = await retentionDryRun(db);
  const due = Object.fromEntries(before.tables.map((t) => [t.table, t]));
  assert.equal(due.battle.rows_due, 1);
  assert.deepEqual(due.battle.children_due, {
    battle_participant: 2,
    battle_participant_round: 1,
    battle_highlight: 1,
  });
  assert.equal(due.mcp_call_audit.rows_due, 1);
  assert.equal(due.api_receipt.rows_due, 1);
  assert.equal(due.api_receipt.held, true);
  assert.equal(due.war_week.rows_due, 1);
  assert.equal(due.feedback.rows_due, 1);
  assert.equal(due.clan_membership.rows_due, 1);
  assert.ok(
    before.tables.every((t) => !t.error),
    JSON.stringify(before),
  );

  const out = await retentionTrim(db);
  assert.deepEqual(out.held, ["api_receipt"]);
  assert.equal(out.tables.battle.deleted, 1);
  assert.deepEqual(out.tables.battle.children, {
    player_event: 1,
    battle_participant_round: 1,
    battle_participant: 2,
  });
  assert.ok(
    Object.values(out.tables).every((t) => !t.error),
    JSON.stringify(out),
  );

  assert.equal(await count(`select count(*) n from battle`), 1);
  assert.equal(
    await count(`select count(*) n from battle where battle_id = 'new-battle'`),
    1,
  );
  assert.equal(await count(`select count(*) n from battle_participant`), 2);
  assert.equal(
    await count(`select count(*) n from battle_participant_round`),
    1,
  );
  assert.equal(await count(`select count(*) n from battle_highlight`), 1);
  assert.equal(await count(`select count(*) n from player_event`), 1);
  assert.equal(
    await count(`select count(*) n from deck where deck_hash = 'deck-shared'`),
    1,
    "a deck a surviving battle points at stays",
  );
  assert.equal(
    await count(
      `select count(*) n from mcp_call_audit where tool = 'new_call'`,
    ),
    1,
  );
  assert.equal(await count(`select count(*) n from mcp_call_audit`), 1);
  assert.equal(
    await count(
      `select count(*) n from clan_membership where left_observed_at is null`,
    ),
    1,
    "an open membership stays however old",
  );
  assert.equal(await count(`select count(*) n from clan_membership`), 1);
  assert.equal(
    await count(`select count(*) n from feedback where status = 'new'`),
    1,
    "an unresolved feedback item stays however old",
  );
  assert.equal(await count(`select count(*) n from feedback`), 1);
  assert.equal(await count(`select count(*) n from war_week`), 1);
  assert.equal(
    await count(
      `select count(*) n from war_participation where season_id = 200`,
    ),
    1,
  );
  assert.equal(await count(`select count(*) n from war_participation`), 1);
  assert.equal(
    await count(`select count(*) n from api_receipt`),
    1,
    "a held entry is not run",
  );

  // Held entries, when run, take the audit row before its receipt.
  const { rows: r } = await db.query(
    `select receipt_id from api_receipt limit 1`,
  );
  await db.query(
    `insert into capture_audit (receipt_id, subject_tag, gap, fetched_at)
     values ($1, $2, false, now() - interval '40 days')`,
    [r[0].receipt_id, A],
  );
  const held = await retentionTrim(db, { runHeld: true });
  assert.equal(held.tables.capture_audit.deleted, 1);
  assert.equal(held.tables.api_receipt.deleted, 1);
  assert.equal(await count(`select count(*) n from api_receipt`), 0);

  const again = await retentionTrim(db);
  assert.ok(
    Object.values(again.tables).every((t) => t.deleted === 0 && t.done),
    "a second run finds nothing left",
  );
});

test("the trim stops at its caps and leaves the rest for the next run", async () => {
  await db.query(
    `insert into mcp_call_audit (tool, created_at)
     select 'old_call', now() - interval '60 days' from generate_series(1, 5)`,
  );
  const capped = await retentionTrim(db, {
    limits: { batchRows: 2, tableStatements: 1 },
  });
  assert.equal(capped.tables.mcp_call_audit.deleted, 2);
  assert.equal(capped.tables.mcp_call_audit.done, false);
  assert.equal(
    await count(
      `select count(*) n from mcp_call_audit where tool = 'old_call'`,
    ),
    3,
  );
  const stopped = await retentionTrim(db, {
    limits: { batchRows: 2, runStatements: 1 },
  });
  assert.equal(stopped.stopped, "statements");
  assert.equal(stopped.statements, 1);
  let now = 0;
  const timed = await retentionTrim(db, {
    limits: { budgetMs: 10 },
    clock: () => (now += 100),
  });
  assert.equal(timed.stopped, "time");
  assert.equal(timed.statements, 0);
  const rest = await retentionTrim(db);
  assert.equal(rest.tables.mcp_call_audit.done, true);
  assert.equal(
    await count(
      `select count(*) n from mcp_call_audit where tool = 'old_call'`,
    ),
    0,
  );
});

test("a captured call's body expires with its call log row", () => {
  // The call record page finds a body only through its mcp_call_audit
  // row, so a body that outlives the row is unreachable and kept for
  // nothing. The archive bucket's calls/ rule runs on the same clock.
  const template = readFileSync(
    new URL("../../../infra/template.yaml", import.meta.url),
    "utf8",
  );
  const rule = template.match(
    /- Id: calls-expire\n(?:\s+[A-Za-z].*\n)*?\s+ExpirationInDays: (\d+)/,
  );
  assert.ok(rule, "the calls-expire lifecycle rule is in the template");
  const audit = TRIMMED.find((e) => e.table === "mcp_call_audit");
  assert.equal(`${rule[1]} days`, audit.window);
});

// One lifecycle rule's block from the template, by its Id: from its
// "- Id:" line to the next line indented no deeper than that dash.
function lifecycleRule(template, id) {
  const lines = template.split("\n");
  const at = lines.findIndex((l) => l.trimStart() === `- Id: ${id}`);
  if (at < 0) return null;
  const indent = lines[at].indexOf("-");
  const block = [lines[at]];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() && line.search(/\S/) <= indent) break;
    block.push(line);
  }
  return block.join("\n") + "\n";
}

test("the payload and sent-mail archives keep a year, then purge every version", () => {
  // A year like the record (Jamie, 2026-11-13). On the versioned
  // bucket an expiry only writes a delete marker, so each prefix also
  // needs its purge rule, or the body stays as a noncurrent version
  // under expire-superseded-versions for another year.
  const template = readFileSync(
    new URL("../../../infra/template.yaml", import.meta.url),
    "utf8",
  );
  const sends = TRIMMED.find((e) => e.table === "email_issue");
  assert.equal(sends.window, "1 year");
  for (const [expire, purge, prefix] of [
    ["payloads-to-ia", "payloads-purge-expired", "payloads/"],
    ["mail-sent-expire", "mail-sent-purge-expired", "mail/sent/"],
  ]) {
    const e = lifecycleRule(template, expire);
    assert.ok(e, `${expire} is in the template`);
    assert.match(e, new RegExp(`Prefix: ${prefix}\\n`));
    assert.match(e, /ExpirationInDays: 365\n/);
    const p = lifecycleRule(template, purge);
    assert.ok(p, `${purge} is in the template`);
    assert.match(p, new RegExp(`Prefix: ${prefix}\\n`));
    assert.match(p, /NoncurrentDays: 1\n/);
    assert.match(p, /ExpiredObjectDeleteMarker: true/);
  }
});
