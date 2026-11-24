/**
 * {integration_accounts_remove}: the integration accounts are deleted
 * (Jamie, 2026-11-23: "Approved: delete the three integration accounts
 * and remove the integration account kind from Elixir"). A dry run is the
 * default and writes nothing; a real run with history rows and no choice
 * is refused; a run deletes every integration, its name and its keys,
 * keeps the logs detached, re-points what must point somewhere to the
 * owner, and never touches a person or a test account, nor the keys,
 * sign-in grants and Clan facts they hold.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { integrationAccountsRemoveOp } from "../src/ops-owned-accounts-remove.mjs";
import { issueServiceToken } from "../../../packages/auth/src/index.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_integration_accounts_remove_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const SIGN_IN = "https://elixir.poapkings.com/api/v1";

let db;
const ids = {};
const keyIds = {};

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

async function account(sql, params = []) {
  return (await one(sql, params)).account_id;
}

/** Every row of every table that points at one of `accountIds` through a
 *  foreign key to account, as one fingerprint per table. */
async function footprint(accountIds, skip = []) {
  const { rows: refs } = await db.query(
    `select c.conrelid::regclass::text as t, a.attname as col
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'account'::regclass
      order by 1, 2`,
  );
  const out = {};
  for (const { t, col } of refs) {
    if (skip.includes(t)) continue;
    const { rows } = await db.query(
      `select count(*)::int as n,
              md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h
         from ${t} x where ${col} = any($1::uuid[])`,
      [accountIds],
    );
    out[`${t}.${col}`] = rows[0];
  }
  return out;
}

async function integration(name, publicId, createdAt) {
  const id = await account(
    `insert into account (kind, owned_by_account_id, public_id, status, role, created_at)
     values ('integration', $1, $2, 'approved', 'partner', $3) returning account_id`,
    [ids.owner, publicId, createdAt],
  );
  await db.query(`insert into integration (account_id, name) values ($1, $2)`, [
    id,
    name,
  ]);
  return id;
}

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();

  ids.owner = await account(
    `insert into account (email_hash, status, role) values ('owner-hash-0001', 'approved', 'owner')
     returning account_id`,
  );
  ids.other = await account(
    `insert into account (email_hash, status, role) values ('other-hash', 'approved', 'member')
     returning account_id`,
  );
  ids.testAccount = await account(
    `insert into account (email_hash, status, role, test_name, onboarded_at)
     values ('test:acceptance', 'approved', 'member', 'acceptance', now()) returning account_id`,
  );
  ids.clan = await integration(
    "elixir-clan",
    "clanintg01",
    "2026-09-01T00:00:00Z",
  );
  ids.drop = await integration(
    "elixir-drop",
    "dropintg01",
    "2026-09-02T00:00:00Z",
  );
  ids.site = await integration(
    "poapkings-com",
    "siteintg01",
    "2026-09-03T00:00:00Z",
  );

  await db.query(`insert into clan (clan_tag) values ('#0CP08QUC')`);
  // The test account follows a clan; the clan site's integration once
  // followed it too.
  await db.query(
    `insert into account_clan (account_id, clan_tag, is_primary)
     values ($1, '#0CP08QUC', true), ($2, '#0CP08QUC', true)`,
    [ids.site, ids.testAccount],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, origin)
     values ('clan', '#0CP08QUC', $1, 'claim')`,
    [ids.site],
  );

  // Keys: each integration's revoked JSON API key, the test account's
  // live MCP key and the owner's.
  for (const [who, name] of [
    ["clan", "elixir-clan"],
    ["drop", "elixir-drop"],
    ["site", "poapkings-com"],
    ["testAccount", "acceptance"],
    ["owner", "owner-key"],
  ]) {
    await issueServiceToken(db, { accountId: ids[who], name });
    keyIds[who] = (
      await one(
        `select token_id from service_token where account_id = $1 and name = $2`,
        [ids[who], name],
      )
    ).token_id;
  }
  await db.query(
    `update service_token set audience = 'integration_api', revoked_at = now(),
            last_used_at = '2026-11-12T12:00:00Z'
      where token_id = any($1::bigint[])`,
    [[keyIds.clan, keyIds.drop, keyIds.site]],
  );
  // Drop's sign-in: a person's grant at /api/v1 through a family client,
  // which no integration row holds.
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('drop-client', 'Elixir Drop', array['https://drop.poapkings.com/cb'], 'infinity')`,
  );
  await db.query(
    `insert into family_oauth_client (client_id, app) values ('drop-client', 'drop')`,
  );
  await db.query(
    `insert into oauth_family (client_id, account_id, absolute_expires_at, resource)
     values ('drop-client', $1, now() + interval '90 days', $2)`,
    [ids.other, SIGN_IN],
  );

  // History, on an integration and on everyone else.
  await db.query(
    `insert into mcp_call_audit (account_id, surface, tool, token_id, principal_kind, created_at)
     values ($1, 'mcp', 'game_clock', $2, 'integration', now() - interval '1 hour'),
            ($3, 'mcp', 'war_current', $4, 'person', now())`,
    [ids.drop, keyIds.drop, ids.testAccount, keyIds.testAccount],
  );
  await db.query(
    `insert into credential_refusal (credential_hash, token_id, account_id, kind, reason)
     values ('h-site', $1, $2, 'service_token', 'revoked_key')`,
    [keyIds.site, ids.site],
  );
  await db.query(
    `insert into feedback (account_id, surface, message) values
       ($1, 'api', 'from the clan site'), ($2, 'web', 'from the owner')`,
    [ids.site, ids.owner],
  );
  await db.query(
    `insert into account_event (account_id, kind, detail) values
       ($1, 'integration_created', '{}'), ($2, 'integration_revoke', '{}')`,
    [ids.drop, ids.owner],
  );
  // Clan's award standing, attested by the integration Clan once wrote
  // through; it stays and loses only its attester.
  await db.query(
    `insert into attested_fact (subject_kind, clan_tag, fact_type, detail, visibility,
                                source, source_ref, attester_account_id, occurred_at)
     values ('clan', '#0CP08QUC', 'clan_message', '{}', 'clan', 'elixir-clan', 'clan-1', $1, now())`,
    [ids.clan],
  );
  for (const bucket of [
    `api#${ids.drop}`,
    `mcp#token#${keyIds.site}`,
    `mcp#${ids.owner}`,
    `mcp#token#${keyIds.testAccount}`,
  ])
    await db.query(
      `insert into rate_limit (bucket, window_start, count) values ($1, current_date, 3)`,
      [bucket],
    );
});

after(async () => {
  await db?.end();
  await dropScratch(SCRATCH);
});

const bystanders = () => [ids.other, ids.testAccount];

test("an unknown history choice is refused", async () => {
  assert.deepEqual(
    await integrationAccountsRemoveOp(SCRATCH_URL, { history: "keep" }),
    { error: "invalid_history", allowed: ["owner", "delete"] },
  );
});

test("an integration holding what no integration could make is refused, even on a dry run", async () => {
  await db.query(
    `insert into gateway (owner_account_id, name, status) values ($1, 'intg-box', 'revoked')`,
    [ids.drop],
  );
  const r = await integrationAccountsRemoveOp(SCRATCH_URL, true);
  assert.equal(r.refused, "integration_holds_more_than_integration_rows");
  assert.deepEqual(r.blockers, { owns_collectors: 1 });
  await db.query(`delete from gateway where owner_account_id = $1`, [ids.drop]);
});

test("a dry run is the default: it lists each integration and what would happen, and writes nothing", async () => {
  const everyone = [...bystanders(), ids.owner, ids.clan, ids.drop, ids.site];
  const before = await footprint(everyone);
  const dry = await integrationAccountsRemoveOp(SCRATCH_URL, true);
  assert.equal(dry.dry_run, true);
  assert.equal(dry.refused, undefined);
  assert.equal(dry.accounts, 3);
  assert.deepEqual(
    dry.integrations.map((i) => [i.account_ref, i.name, i.status, i.keys]),
    [
      [
        ids.clan.slice(0, 8),
        "elixir-clan",
        "approved",
        { live: 0, revoked: 1 },
      ],
      [
        ids.drop.slice(0, 8),
        "elixir-drop",
        "approved",
        { live: 0, revoked: 1 },
      ],
      [
        ids.site.slice(0, 8),
        "poapkings-com",
        "approved",
        { live: 0, revoked: 1 },
      ],
    ],
  );
  assert.equal(dry.integrations[0].owner_ref, "owner-hash");
  assert.deepEqual(
    dry.integrations[0].created_at,
    new Date("2026-09-01T00:00:00Z"),
  );
  assert.deepEqual(
    dry.integrations[1].last_key_use_at,
    new Date("2026-11-12T12:00:00Z"),
  );
  assert.ok(dry.integrations[1].last_call_at instanceof Date);
  assert.equal(dry.integrations[0].last_call_at, null);
  assert.deepEqual(dry.history, {
    feedback: 1,
    feedback_ref: 0,
    account_event: 1,
    choice: null,
  });
  assert.deepEqual(dry.detached, {
    mcp_call_audit: 1,
    credential_refusal: 1,
    timeline_comment_owner_stamp: 0,
  });
  assert.deepEqual(dry.repointed, { recording: 1 });
  assert.deepEqual(dry.kept, { discord_post: 0 });
  const nonZero = Object.fromEntries(
    Object.entries(dry.deleted).filter(([, n]) => n > 0),
  );
  assert.deepEqual(nonZero, {
    service_token: 3,
    account_clan: 1,
    rate_limit: 2,
    integration: 3,
  });
  assert.equal(dry.subjects, 1);
  assert.equal(dry.recordings_stopped, null);
  assert.deepEqual(await footprint(everyone), before);
});

test("a real run with history rows and no choice is refused and writes nothing", async () => {
  const everyone = [...bystanders(), ids.owner, ids.clan, ids.drop, ids.site];
  const before = await footprint(everyone);
  const r = await integrationAccountsRemoveOp(SCRATCH_URL, { dry_run: false });
  assert.equal(r.refused, "history_choice_required");
  assert.match(r.hint, /each integration's owner/);
  assert.deepEqual(await footprint(everyone), before);
});

test("history owner: the integrations go, the owner keeps their history, and no person, test account or sign-in is touched", async () => {
  const bystandersBefore = await footprint(bystanders());
  const ownerBefore = await footprint(
    [ids.owner],
    ["account", "feedback", "account_event", "recording"],
  );
  const accountsBefore = (
    await db.query(
      `select * from account where kind = 'person' order by account_id`,
    )
  ).rows;
  const signInBefore = (
    await db.query(
      `select * from oauth_family f join family_oauth_client c using (client_id)`,
    )
  ).rows;

  const r = await integrationAccountsRemoveOp(SCRATCH_URL, {
    dry_run: false,
    history: "owner",
  });
  assert.equal(r.refused, undefined);
  assert.equal(r.accounts, 3);
  assert.equal(r.deleted.integration, 3);
  assert.deepEqual(r.history.done, { feedback: 1, account_event: 1 });
  // The clan the test account follows keeps recording.
  assert.equal(r.recordings_stopped, 0);
  assert.equal(r.vacuumed[0].table, "mcp_call_audit");

  for (const sql of [
    `select count(*)::int as n from account where kind = 'integration'`,
    `select count(*)::int as n from integration`,
    `select count(*)::int as n from service_token where audience = 'integration_api'`,
  ])
    assert.equal((await one(sql)).n, 0, sql);

  // Nobody else moved.
  assert.deepEqual(await footprint(bystanders()), bystandersBefore);
  assert.deepEqual(
    await footprint(
      [ids.owner],
      ["account", "feedback", "account_event", "recording"],
    ),
    ownerBefore,
  );
  assert.deepEqual(
    (
      await db.query(
        `select * from account where kind = 'person' order by account_id`,
      )
    ).rows,
    accountsBefore,
  );
  assert.deepEqual(
    (
      await db.query(
        `select * from oauth_family f join family_oauth_client c using (client_id)`,
      )
    ).rows,
    signInBefore,
  );
  assert.equal(
    (
      await one(
        `select count(*)::int as n from service_token
          where token_id = $1 and revoked_at is null`,
        [keyIds.testAccount],
      )
    ).n,
    1,
  );

  // The logs stay, detached; Clan's fact stays, with no attester.
  const call = await one(
    `select account_id, token_id from mcp_call_audit where principal_kind = 'integration'`,
  );
  assert.deepEqual(call, { account_id: null, token_id: null });
  assert.deepEqual(
    await one(
      `select account_id, token_id from credential_refusal where credential_hash = 'h-site'`,
    ),
    { account_id: null, token_id: null },
  );
  assert.deepEqual(
    await one(
      `select source, attester_account_id from attested_fact where source_ref = 'clan-1'`,
    ),
    { source: "elixir-clan", attester_account_id: null },
  );

  // The owner's history now holds the integrations'.
  assert.equal(
    (
      await one(
        `select account_id from feedback where message = 'from the clan site'`,
      )
    ).account_id,
    ids.owner,
  );
  const events = (
    await db.query(
      `select kind, detail from account_event where account_id = $1 order by event_id`,
      [ids.owner],
    )
  ).rows;
  assert.deepEqual(
    events.map((e) => e.kind),
    [
      "integration_created",
      "integration_revoke",
      "integration_accounts_removed",
    ],
  );
  assert.deepEqual(events[2].detail, {
    via: "ops",
    integrations: 3,
    history: "owner",
  });
  assert.deepEqual(
    await one(
      `select status, requested_by from recording where subject_tag = '#0CP08QUC'`,
    ),
    { status: "active", requested_by: ids.owner },
  );
  assert.deepEqual(
    (await db.query(`select bucket from rate_limit order by bucket`)).rows.map(
      (r) => r.bucket,
    ),
    [`mcp#${ids.owner}`, `mcp#token#${keyIds.testAccount}`].sort(),
  );
});

test("run again, there is nothing to do", async () => {
  const r = await integrationAccountsRemoveOp(SCRATCH_URL, {
    dry_run: false,
    history: "owner",
  });
  assert.deepEqual(r, {
    dry_run: false,
    integrations: [],
    nothing_to_do: true,
  });
});

test("history delete: the integration's feedback and events go with it", async () => {
  const late = await integration("late-intg", "lateintg01", "2026-09-04");
  await db.query(
    `insert into feedback (account_id, surface, message) values ($1, 'api', 'late')`,
    [late],
  );
  await db.query(
    `insert into account_event (account_id, kind) values ($1, 'integration_created')`,
    [late],
  );
  const bystandersBefore = await footprint(bystanders());

  const r = await integrationAccountsRemoveOp(SCRATCH_URL, {
    dry_run: false,
    history: "delete",
  });
  assert.equal(r.accounts, 1);
  assert.deepEqual(r.history.done, { feedback: 1, account_event: 1 });
  assert.equal(
    (
      await one(
        `select count(*)::int as n from feedback where message = 'late'`,
      )
    ).n,
    0,
  );
  assert.deepEqual(await footprint(bystanders()), bystandersBefore);
  assert.equal((await one(`select count(*)::int as n from integration`)).n, 0);
});

test("an agent is not an integration: the op leaves it for its own op", async () => {
  const agent = await account(
    `insert into account (kind, owned_by_account_id, public_id, status, role)
     values ('agent', $1, 'staysagent', 'disabled', 'member') returning account_id`,
    [ids.owner],
  );
  const r = await integrationAccountsRemoveOp(SCRATCH_URL, {
    dry_run: false,
    history: "owner",
  });
  assert.equal(r.nothing_to_do, true);
  assert.equal(
    (await one(`select kind from account where account_id = $1`, [agent])).kind,
    "agent",
  );
  await db.query(`delete from account where account_id = $1`, [agent]);
});
