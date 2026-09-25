import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate, loadMigrations } from "../src/migrate.mjs";
import { schemaFingerprint } from "../src/fingerprint.mjs";
import { pollReplay } from "../src/ops-analysis.mjs";
import { ledger, stats } from "../src/ops-diagnostics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const MIGRATIONS_DIR = path.join(repoRoot, "db/migrations");
const FINGERPRINT_FILE = path.join(repoRoot, "db/schema.fingerprint");

// Scratch database per run — never a shared dev DB (AGENTS.md rule 9).
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
});

after(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("migrations are dense, ordered, well-named", async () => {
  const migrations = await loadMigrations(MIGRATIONS_DIR);
  assert.ok(migrations.length >= 1);
  assert.equal(migrations[0].name, "0001_recorder_core.sql");
});

test("ladder applies cleanly and is idempotent", async () => {
  const first = await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: MIGRATIONS_DIR,
  });
  assert.equal(first.applied, 0);
  assert.ok(first.ran >= 1);
  const second = await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: MIGRATIONS_DIR,
  });
  assert.equal(second.ran, 0);
});

test("a new session on a migrated database reads UTC, whatever the server's default (0155)", async () => {
  // The server's own default is the machine's zone on a laptop, which is
  // exactly the case this pins: the clock-edge of 2026-09-23.
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select current_setting('TimeZone') as tz,
              ('2026-09-23T03:00:00Z'::timestamptz)::date::text as day`,
    );
    assert.equal(rows[0].tz, "UTC");
    // 03:00Z is still the 22nd in Chicago; the UTC session says the 23rd.
    assert.equal(rows[0].day, "2026-09-23");
  } finally {
    await db.end();
  }
});

test("schema fingerprint matches the committed pin", async () => {
  const actual = await schemaFingerprint(SCRATCH_URL);
  const pinned = (await readFile(FINGERPRINT_FILE, "utf8")).trim();
  assert.equal(
    actual,
    pinned,
    "schema drift: if this change is intentional, run `node src/cli.mjs fingerprint --update` against a freshly migrated scratch DB and commit the new pin",
  );
});

test("core invariants hold", async () => {
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    // Tag check constraint rejects non-canonical tags.
    await assert.rejects(
      db.query(`insert into player (player_tag) values ('#oops!')`),
      /check constraint/,
    );
    // budget_state is a seeded singleton.
    const { rows } = await db.query(
      "select count(*)::int as n from budget_state",
    );
    assert.equal(rows[0].n, 1);
    await assert.rejects(db.query("insert into budget_state default values"));
    // One open clan membership per player.
    await db.query(`insert into player (player_tag) values ('#2PP0V90Y')`);
    await db.query(`insert into clan (clan_tag) values ('#J2RGCRVG')`);
    await db.query(`insert into clan_membership (clan_tag, player_tag, joined_observed_at)
                    values ('#J2RGCRVG', '#2PP0V90Y', now())`);
    await assert.rejects(
      db.query(`insert into clan_membership (clan_tag, player_tag, joined_observed_at)
                values ('#J2RGCRVG', '#2PP0V90Y', now() + interval '1 hour')`),
      /duplicate key/,
    );
  } finally {
    await db.end();
  }
});

test("stats exposes board cadence and ranking-presence readiness", async () => {
  const out = await stats(SCRATCH_URL);
  const health = out.ranking_health;
  assert.equal(typeof health.enabled_locations, "number");
  assert.equal(typeof health.fresh_locations, "number");
  assert.equal(typeof health.stale_locations, "number");
  assert.equal(typeof health.global_tick_receipts, "number");
  assert.equal(typeof health.ranking_recordings, "number");
  assert.equal(
    health.enabled_locations,
    health.fresh_locations + health.stale_locations,
  );
  assert.equal(out.fetch_errors_24h.total, 0);
  assert.deepEqual(out.fetch_errors_24h.by_endpoint, []);
});

test("stats groups bounded non-200 collector outcomes by endpoint", async () => {
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    const {
      rows: [account],
    } = await db.query(
      `insert into account (email_hash, status) values ('stats-fetch-errors', 'approved')
       returning account_id`,
    );
    const {
      rows: [gateway],
    } = await db.query(
      `insert into gateway (owner_account_id, name, static_ip, status)
       values ($1, 'stats-fetch-errors-gw', '127.0.0.8', 'active')
       returning gateway_id`,
      [account.account_id],
    );
    await db.query(
      `insert into collector_fetch_error
         (gateway_id, endpoint, entity_key, fetched_at, http_status, error_kind)
       values
         ($1, 'rankings_pol', 'us', now(), 404, 'http'),
         ($1, 'rankings_pol', 'ca', now() + interval '1 second', 404, 'http'),
         ($1, 'player', '#STATS', now() + interval '2 seconds', null, 'transport')`,
      [gateway.gateway_id],
    );

    const out = await stats(SCRATCH_URL);
    assert.deepEqual(out.fetch_errors_24h, {
      total: 3,
      by_endpoint: [
        {
          endpoint: "rankings_pol",
          count: 2,
          outcomes: [{ http_status: "404", kind: "http", count: 2 }],
        },
        {
          endpoint: "player",
          count: 1,
          outcomes: [{ http_status: "none", kind: "transport", count: 1 }],
        },
      ],
    });
  } finally {
    await db.end();
  }
});

test("ledger ops inspect and selectively requeue dead collector work", async () => {
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    const {
      rows: [account],
    } = await db.query(
      `insert into account (email_hash, status)
       values ('ledger-ops', 'approved') returning account_id`,
    );
    const {
      rows: [gateway],
    } = await db.query(
      `insert into gateway (owner_account_id, name, card_name, status)
       values ($1, 'ledger-ops-gateway', 'Ledger Ops', 'active')
       returning gateway_id`,
      [account.account_id],
    );
    const {
      rows: [recoverable],
    } = await db.query(
      `insert into job (endpoint, entity_key, lane, status, attempts, leased_by, done_at)
       values ('player', '#LEDGERA', 'bulk', 'dead', 5, $1, now())
       returning job_id`,
      [gateway.gateway_id],
    );
    const {
      rows: [blocked],
    } = await db.query(
      `insert into job (endpoint, entity_key, lane, status, attempts, done_at)
       values ('clan', '#LEDGERB', 'bulk', 'dead', 5, now())
       returning job_id`,
    );
    await db.query(
      `insert into job (endpoint, entity_key, lane) values ('clan', '#LEDGERB', 'bulk')`,
    );
    const {
      rows: [receiptBackedDead],
    } = await db.query(
      `insert into job (endpoint, entity_key, lane, status, attempts, done_at)
       values ('clan', '#LEDGERC', 'bulk', 'dead', 5, now()) returning job_id`,
    );
    const {
      rows: [receiptBackedTwin],
    } = await db.query(
      `insert into job (endpoint, entity_key, lane, status, done_at)
       values ('clan', '#LEDGERC', 'bulk', 'done', now()) returning job_id`,
    );
    await db.query(
      `insert into api_receipt
         (endpoint, entity_key, payload_hash, gateway_id, admission, job_id)
       values ('clan', '#LEDGERC', 'receipt-backed', $1, 'admitted', $2)`,
      [gateway.gateway_id, receiptBackedTwin.job_id],
    );

    const inspected = await ledger(SCRATCH_URL, { op: "dead" });
    assert.deepEqual(
      inspected.dead
        .filter((job) =>
          [recoverable.job_id, blocked.job_id].includes(job.job_id),
        )
        .map((job) => job.job_id),
      [recoverable.job_id, blocked.job_id],
    );

    const recovered = await ledger(SCRATCH_URL, {
      op: "requeue",
      job_ids: [recoverable.job_id, blocked.job_id],
    });
    assert.deepEqual(
      recovered.requeued.map((job) => job.job_id),
      [recoverable.job_id],
    );
    assert.deepEqual(recovered.skipped, [blocked.job_id]);
    const folded = await ledger(SCRATCH_URL, {
      op: "fold",
      job_ids: [blocked.job_id],
    });
    assert.deepEqual(
      folded.folded.map((job) => job.job_id),
      [blocked.job_id],
    );
    assert.deepEqual(folded.skipped, []);
    const receiptBackedFold = await ledger(SCRATCH_URL, {
      op: "fold",
      job_ids: [receiptBackedDead.job_id],
    });
    assert.deepEqual(
      receiptBackedFold.folded.map((job) => job.job_id),
      [receiptBackedDead.job_id],
    );
    const {
      rows: [job],
    } = await db.query(
      `select status, attempts, leased_by, done_at from job where job_id = $1`,
      [recoverable.job_id],
    );
    assert.deepEqual(job, {
      status: "queued",
      attempts: 0,
      leased_by: null,
      done_at: null,
    });
    const {
      rows: [foldedJob],
    } = await db.query(`select status from job where job_id = $1`, [
      blocked.job_id,
    ]);
    assert.equal(foldedJob.status, "done");
  } finally {
    await db.end();
  }
});

test("tables op: every user table's size and churn, the memory settings, no payloads", async () => {
  process.env.DATABASE_URL = SCRATCH_URL;
  const { handler } = await import("../src/lambda.mjs");
  const out = await handler({ tables: true });
  assert.ok(out.database_bytes > 0);
  assert.ok("shared_buffers" in out.settings && "work_mem" in out.settings);
  const names = out.tables.map((t) => t.table_name);
  for (const t of ["battle", "api_receipt", "ranking_entry", "player"])
    assert.ok(names.includes(t), `${t} is listed`);
  const battle = out.tables.find((t) => t.table_name === "battle");
  assert.equal(typeof battle.total_bytes, "number");
  assert.equal(typeof battle.inserted, "number");
  assert.ok(
    !JSON.stringify(out).includes("body_gzip"),
    "sizes and counters only; nothing from a payload",
  );
});

test("probe op: hourly census counts live fetches, excludes the backfill gateway", async () => {
  // The elixir-bot import's receipts are attributed to the
  // 'backfill-elixir-bot' gateway, which production still holds: its
  // battles show as harvests, its fetches must NOT show as capture
  // volume.
  process.env.DATABASE_URL = SCRATCH_URL;
  const { handler } = await import("../src/lambda.mjs");
  const { ingestBattlelog } = await import("../../ingest/src/battles.mjs");
  const metaJson = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/meta.json"), "utf8"),
  );
  const fixture = "player_battlelog/with_path_of_legend.json";

  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status) values ('probe-owner', 'approved')
     returning account_id`,
  );
  const {
    rows: [backfill],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'backfill-elixir-bot', '127.0.0.1', 'active')
     returning gateway_id`,
    [owner.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'probe-live-gw', '10.0.0.9', 'active')
     returning gateway_id`,
    [owner.account_id],
  );
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('player_battlelog', $1, now(), 'probe-backfill-hash', $2, 'admitted'),
            ('player_battlelog', '#PROBE1', now(), 'probe-hash', $3, 'admitted')`,
    [metaJson[fixture].entity_key, backfill.gateway_id, gw.gateway_id],
  );
  await ingestBattlelog(db, {
    observerTag: metaJson[fixture].entity_key,
    payload: JSON.parse(
      await readFile(path.join(repoRoot, "fixtures", fixture), "utf8"),
    ),
  });
  await db.end();

  const result = await handler({ probe: true });
  assert.ok(Array.isArray(result.hours), "hours array");
  const totalBattlelog = result.hours.reduce((s, h) => s + h.battlelog, 0);
  const totalBattles = result.hours.reduce((s, h) => s + h.battles, 0);
  assert.equal(totalBattlelog, 1, "only the live gateway's fetch counts");
  assert.ok(totalBattles > 0, "the recorded battles appear as harvests");
  assert.match(result.hours[0].hour, /^\d{2}-\d{2}T\d{2}Z$/);
});

test("capture-audit op: reports only gap subjects with their scheduler evidence", async () => {
  process.env.DATABASE_URL = SCRATCH_URL;
  const { handler } = await import("../src/lambda.mjs");
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const gateway = (
    await db.query(
      `select gateway_id from gateway where name = 'probe-live-gw'`,
    )
  ).rows[0];
  const { rows: receipts } = await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('player_battlelog', '#2GAP1', now() - interval '2 hours', 'gap-1', $1, 'admitted'),
            ('player_battlelog', '#2GAP1', now() - interval '1 hour', 'gap-2', $1, 'admitted'),
            ('player_battlelog', '#2NOGAP', now(), 'gap-3', $1, 'admitted')
     returning receipt_id, entity_key, fetched_at`,
    [gateway.gateway_id],
  );
  await db.query(
    `insert into capture_audit (receipt_id, subject_tag, gap, fetched_at)
     values ($1, '#2GAP1', true, $2),
            ($3, '#2GAP1', false, $4),
            ($5, '#2NOGAP', false, $6)`,
    [
      receipts[0].receipt_id,
      receipts[0].fetched_at,
      receipts[1].receipt_id,
      receipts[1].fetched_at,
      receipts[2].receipt_id,
      receipts[2].fetched_at,
    ],
  );
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_planned_at, last_admitted_at)
     values ('#2GAP1', 'player_battlelog', now() - interval '30 minutes', now() - interval '1 hour')`,
  );
  await db.end();

  const result = await handler({ capture_audit: { days: 1 } });
  assert.ok(
    result.polls >= 3,
    "includes audited polls in the requested window",
  );
  assert.ok(result.gaps >= 1, "includes aggregate gap count");
  const gap = result.gaps_by_subject.find(
    (row) => row.subject_tag === "#2GAP1",
  );
  assert.deepEqual(
    { polls: gap.polls, gaps: gap.gaps },
    { polls: 2, gaps: 1 },
    "one subject's gap and non-gap polls stay distinguishable",
  );
  assert.ok(gap.last_planned_at, "includes scheduler planning evidence");
  assert.ok(gap.last_admitted_at, "includes scheduler admission evidence");
  assert.equal(
    result.gaps_by_subject.some((row) => row.subject_tag === "#2NOGAP"),
    false,
    "non-gap subjects stay out of the diagnostic list",
  );
});

test("payload sweep: only superseded rows with an S3 twin leave Postgres", async () => {
  process.env.DATABASE_URL = SCRATCH_URL;
  process.env.ARCHIVE_BUCKET = "test-archive";
  const { archiveKey } = await import("../../ingest/src/pipeline.mjs");
  const { sweepPayloads } = await import("../../jobs/src/index.mjs");

  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  // Two versions of one entity: v1 superseded, v2 latest.
  const { rows: versions } = await db.query(
    `insert into api_payload (endpoint, entity_key, payload_hash, payload_json, first_fetched_at, last_fetched_at)
     values ('player', '#SWEEP1', 'hash-v1', '{"v":1}', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z'),
            ('player', '#SWEEP1', 'hash-v2', '{"v":2}', '2026-09-02T10:00:00Z', '2026-09-02T10:00:00Z')
     returning endpoint, entity_key, payload_hash, first_fetched_at`,
  );
  await db.end();

  const stored = new Set();
  const fakeS3 = {
    async send(cmd) {
      const name = cmd.constructor.name;
      if (name === "HeadObjectCommand") {
        if (!stored.has(cmd.input.Key)) throw new Error("NotFound");
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };

  // Nothing archived yet: the superseded row has no twin and stays.
  const dry = await sweepPayloads(SCRATCH_URL, fakeS3);
  assert.equal(dry.swept, 0);
  assert.ok(dry.missing >= 1, "untwinned rows are never deleted");

  // Both versions archived under the ingest key scheme, as admission
  // writes them.
  for (const v of versions)
    stored.add(
      archiveKey(
        v.endpoint,
        v.entity_key,
        v.first_fetched_at.toISOString(),
        v.payload_hash,
      ),
    );

  // Sweep again: v1 (superseded, twinned) leaves; v2 (latest) stays.
  const swept = await sweepPayloads(SCRATCH_URL, fakeS3);
  assert.ok(swept.swept >= 1);
  const check = new pg.Client({ connectionString: SCRATCH_URL });
  await check.connect();
  const left = await check.query(
    `select payload_hash from api_payload where entity_key = '#SWEEP1' order by payload_hash`,
  );
  assert.deepEqual(
    left.rows.map((r) => r.payload_hash),
    ["hash-v2"],
    "latest content stays hot in Postgres",
  );
  await check.end();
});

test("operational sweep: dead weight leaves, live rows and replay-memory stay", async () => {
  process.env.DATABASE_URL = SCRATCH_URL;
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ('b-old', now() - interval '8 days', 1),
            ('b-live', now() - interval '1 hour', 1)`,
  );
  await db.query(
    `insert into magic_login (token_hash, email_hash, code_hash, expires_at)
     values ('t-old', 'e', 'c', now() - interval '31 days'),
            ('t-live', 'e', 'c', now() + interval '15 minutes')`,
  );
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status) values ('sweep-op', 'approved') returning account_id`,
  );
  await db.query(
    `insert into session (session_id, account_id, sliding_expires_at, absolute_expires_at)
     values ('s-old', $1, now() - interval '31 days', now() - interval '1 day'),
            ('s-live', $1, now() + interval '5 days', now() + interval '80 days')`,
    [acct.account_id],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, tool, args, created_at)
     values ($1, 'old_tool', '{"x":1}', now() - interval '91 days'),
            ($1, 'new_tool', '{"x":2}', now())`,
    [acct.account_id],
  );
  await db.end();

  // The operational sweep moved to the jobs Lambda (review item 5).
  const { handler: jobsHandler } = await import("../../jobs/src/index.mjs");
  const result = await jobsHandler({ sweep_operational: true });
  assert.equal(result.rate_limit, 1);
  assert.equal(result.magic_login, 1);
  assert.equal(result.session, 1);
  assert.equal(result.audit_args_nulled, 1);

  const check = new pg.Client({ connectionString: SCRATCH_URL });
  await check.connect();
  const rl = await check.query(`select bucket from rate_limit`);
  assert.deepEqual(
    rl.rows.map((r) => r.bucket).filter((b) => b.startsWith("b-")),
    ["b-live"],
  );
  const sess = await check.query(
    `select session_id from session where session_id like 's-%'`,
  );
  assert.deepEqual(
    sess.rows.map((r) => r.session_id),
    ["s-live"],
  );
  const audit = await check.query(
    `select tool, args from mcp_call_audit where tool in ('old_tool','new_tool') order by tool desc`,
  );
  assert.equal(audit.rows[0].args, null, "old args nulled, row kept");
  assert.ok(audit.rows[1].args, "recent args untouched");
  await check.end();
});

// related_tools is text[]; the ops lane is typed by hand and a
// comma-separated string is the natural thing to send. It threw
// "malformed array literal" in production (2026-09-09 09:17Z).
test("feedback_respond accepts related_tools as an array or a comma string", async () => {
  const { normalizeRelatedTools } = await import("../src/ops-feedback.mjs");
  assert.deepEqual(normalizeRelatedTools(["a", "b"]), ["a", "b"]);
  assert.deepEqual(normalizeRelatedTools("battles_query,players_search"), [
    "battles_query",
    "players_search",
  ]);
  assert.deepEqual(normalizeRelatedTools("battles_query, players_search "), [
    "battles_query",
    "players_search",
  ]);
  assert.deepEqual(normalizeRelatedTools("solo"), ["solo"]);
  assert.deepEqual(normalizeRelatedTools(["a", " ", "", "b"]), ["a", "b"]);
  // null/undefined stay null so coalesce leaves the column unchanged;
  // an explicit empty list is a deliberate clear.
  assert.equal(normalizeRelatedTools(null), null);
  assert.equal(normalizeRelatedTools(undefined), null);
  assert.deepEqual(normalizeRelatedTools([]), []);
  assert.deepEqual(normalizeRelatedTools(""), []);
});

test("feedback_pending returns the attached request id needed for triage", async () => {
  const { feedbackPending } = await import("../src/ops-feedback.mjs");
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    const {
      rows: [account],
    } = await db.query(
      `insert into account (email_hash, status)
       values ('feedback-pending-request', 'approved') returning account_id`,
    );
    const requestId = "00000000-0000-4000-8000-000000000067";
    await db.query(
      `insert into feedback (account_id, surface, message, request_id)
       values ($1, 'mcp', 'show the call attachment to the loop', $2)`,
      [account.account_id, requestId],
    );
    const result = await feedbackPending(SCRATCH_URL);
    const item = result.items.find(
      (feedback) => feedback.message === "show the call attachment to the loop",
    );
    assert.equal(item.request_id, requestId);
  } finally {
    await db.end();
  }
});

test("feedback operations bound oldest-first triage and read back replies without consuming them", async () => {
  const { feedbackPending, feedbackRead, feedbackRespond } =
    await import("../src/ops-feedback.mjs");
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const account = (
    await db.query(`insert into account (email_hash, status)
    values ('feedback-roundtrip', 'approved') returning account_id`)
  ).rows[0];
  try {
    const ids = [];
    for (let i = 0; i < 26; i++) {
      const row = (
        await db.query(
          `insert into feedback (account_id, surface, message, created_at)
        values ($1, 'mcp', 'bounded triage', now() - make_interval(days => $2)) returning feedback_id`,
          [account.account_id, i + 1],
        )
      ).rows[0];
      ids.push(row.feedback_id);
    }
    const pending = await feedbackPending(SCRATCH_URL);
    assert.ok(pending.pending >= 26);
    assert.equal(pending.items.length, 25);
    assert.equal(
      pending.items[0].feedback_id,
      ids.at(-1),
      "created time wins over id order",
    );
    const id = ids.at(-1);
    const before = await feedbackRead(SCRATCH_URL, { feedback_id: id });
    assert.equal(before.feedback.status, "new");
    assert.equal(before.feedback.response, null);
    const reply = {
      feedback_id: id,
      status: "seen",
      response: "The short window already exists.",
      expected: before.feedback,
    };
    assert.equal((await feedbackRespond(SCRATCH_URL, reply)).updated, 1);
    const after = await feedbackRead(SCRATCH_URL, { feedback_id: id });
    assert.equal(after.feedback.response, reply.response);
    assert.ok(after.feedback.responded_at);
    assert.equal(
      (await feedbackRespond(SCRATCH_URL, reply)).updated,
      0,
      "stale read cannot replay a response",
    );
    assert.equal(
      (
        await feedbackRespond(SCRATCH_URL, {
          ...reply,
          status: "planned",
          response: "A precise follow-up.",
          expected: after.feedback,
        })
      ).updated,
      1,
      "a fresh read of a non-null response timestamp remains writable",
    );
    const events = await db.query(
      `select count(*)::int as n from account_event
      where account_id=$1 and kind='feedback_responded'`,
      [account.account_id],
    );
    assert.equal(events.rows[0].n, 2);
  } finally {
    await db.query("delete from feedback where account_id=$1", [
      account.account_id,
    ]);
    await db.query("delete from account_event where account_id=$1", [
      account.account_id,
    ]);
    await db.query("delete from account where account_id=$1", [
      account.account_id,
    ]);
    await db.end();
  }
});

// The column itself accepts what the normalizer produces.
test("normalized related_tools round-trips through the text[] column", async () => {
  const { normalizeRelatedTools } = await import("../src/ops-feedback.mjs");
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    const { rows } = await db.query(`select $1::text[] as tools`, [
      normalizeRelatedTools("battles_opponents, cards_synergy"),
    ]);
    assert.deepEqual(rows[0].tools, ["battles_opponents", "cards_synergy"]);
  } finally {
    await db.end();
  }
});

test("poll_replay reads an empty week as zero counts with every section present", async () => {
  const out = await pollReplay(SCRATCH_URL, {
    days: 7,
    to: "2020-01-08T00:00:00Z",
  });
  assert.equal(out.window.days, 7);
  assert.equal(out.polls.total, 0);
  assert.equal(out.replay.actual.polls, 0);
  assert.equal(out.replay.rule.length, 24);
  for (const cell of out.replay.rule) assert.equal(cell.polls, 0);
  assert.equal(out.session_control.prev_empty.n, 0);
  assert.equal(out.loss.intervals, 0);
  assert.equal(out.loss.estimated_lost_battles, 0);
  assert.equal(out.loss.estimated_lost_share, null);
});

// The 0091 backfill rehearsal (batches rebuild the projections from the
// deck JSON and agree with the dual-write) retired with the JSON column
// in 0097; the backfill ran once in production on 2026-09-15. What
// remains testable is the census and the closing-FK gate.
test("0091 census: ingest leaves no participant without its deck or played rows, and the closing FKs would validate", async () => {
  await migrate({ databaseUrl: SCRATCH_URL, migrationsDir: MIGRATIONS_DIR });
  const { ingestBattlelog } = await import("../../ingest/src/battles.mjs");
  const { deckCensus } = await import("../src/deck-backfill.mjs");
  const metaJson = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/meta.json"), "utf8"),
  );
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    for (const name of [
      "player_battlelog/with_boat_and_duel.json",
      "player_battlelog/with_path_of_legend.json",
    ]) {
      await ingestBattlelog(db, {
        observerTag: metaJson[name].entity_key,
        payload: JSON.parse(
          await readFile(path.join(repoRoot, "fixtures", name), "utf8"),
        ),
      });
    }
    const census = await deckCensus(SCRATCH_URL);
    assert.ok(census.participants_with_deck > 20);
    assert.equal(census.participants_without_deck, 0);
    assert.equal(census.participants_without_played_rows, 0);
    assert.equal(census.collection_rows_without_card, 0);
    assert.ok(census.stub_cards > 0, "no catalog loaded: everything is a stub");
    await db.query(
      `alter table battle_participant add constraint rehearsal_deck_fk
       foreign key (deck_hash) references deck`,
    );
    await db.query(
      `alter table player_card add constraint rehearsal_card_fk
       foreign key (card_id) references card`,
    );
    await db.query(
      `alter table battle_participant drop constraint rehearsal_deck_fk`,
    );
    await db.query(`alter table player_card drop constraint rehearsal_card_fk`);
  } finally {
    await db.end();
  }
});

test("service_token_limits sets a key's own ceilings by name, clears with null, refuses junk", async () => {
  const { serviceTokenLimitsOp } = await import("../src/ops-accounts.mjs");
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    const {
      rows: [a],
    } = await db.query(
      `insert into account (email_hash, status) values ('stl-owner', 'approved') returning account_id`,
    );
    await db.query(
      `insert into service_token (account_id, name, token_hash) values ($1, 'acceptance', repeat('a', 64))`,
      [a.account_id],
    );
  } finally {
    await db.end();
  }
  const set = await serviceTokenLimitsOp(SCRATCH_URL, {
    name: "acceptance",
    hourly_rate_limit: 600,
  });
  assert.equal(set.ok, true);
  assert.equal(set.token.hourly_rate_limit, 600);
  assert.equal(set.token.daily_quota, null, "untouched");
  const cleared = await serviceTokenLimitsOp(SCRATCH_URL, {
    name: "acceptance",
    hourly_rate_limit: null,
  });
  assert.equal(cleared.token.hourly_rate_limit, null);
  assert.deepEqual(
    await serviceTokenLimitsOp(SCRATCH_URL, {
      name: "acceptance",
      hourly_rate_limit: -1,
    }),
    {
      error: "limits must be positive integers or null",
    },
  );
  assert.deepEqual(
    await serviceTokenLimitsOp(SCRATCH_URL, {
      name: "nobody",
      hourly_rate_limit: 5,
    }),
    {
      error: "not_found",
    },
  );
});
