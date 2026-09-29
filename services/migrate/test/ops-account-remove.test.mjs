/**
 * {account_remove} (#129): the privacy page promises an account and its
 * address can be removed on request, and until this op a removal would
 * have been hand-written SQL. A dry run reports and writes nothing; a
 * run removes the person and their agents' personal rows, stops only the
 * recordings nobody else wants, keeps the game record, and leaves an
 * anonymous tombstone for the rows that must keep pointing somewhere.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { accountRemoveOp } from "../src/ops-account-remove.mjs";
import { emailHash } from "../../../packages/auth/src/crypto.mjs";
import {
  issueServiceToken,
  validateServiceToken,
  registerClient,
  mintTokens,
  validateAccessToken,
} from "../../../packages/auth/src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_account_remove_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const RESOURCE = "https://elixir.poapkings.com/mcp";
const ADDRESS = "leaving@example.com";

let db;
const ids = {};
let agentKey;
let personAccess;

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (sql, params = []) => (await one(sql, params)).n;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();

  ids.owner = (
    await one(
      `insert into account (email_hash, status, is_owner, role)
       values ($1, 'approved', true, 'owner') returning account_id`,
      [emailHash("owner@example.com")],
    )
  ).account_id;
  ids.person = (
    await one(
      `insert into account (email_hash, email, status, role, request_note, timezone)
       values ($1, $2, 'approved', 'member', 'let me in', 'America/Chicago')
       returning account_id`,
      [emailHash(ADDRESS), ADDRESS],
    )
  ).account_id;
  ids.other = (
    await one(
      `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
       returning account_id`,
      [emailHash("staying@example.com")],
    )
  ).account_id;
  ids.agent = (
    await one(
      `insert into account (status, role, kind, owned_by_account_id, public_id)
       values ('approved', 'member', 'agent', $1, 'leavingagent')
       returning account_id`,
      [ids.person],
    )
  ).account_id;

  // The game record: two players and a clan, recorded.
  await db.query(
    `insert into player (player_tag) values ('#2PP0V9PP'), ('#2PP0V9QQ'), ('#2PP0V9RR')`,
  );
  await db.query(
    `insert into clan (clan_tag) values ('#2PP0V9UU'), ('#2PP0V9YY')`,
  );
  // #2PP0V9PP only the leaver claims; #2PP0V9QQ the other person claims too.
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship)
     values ($1, '#2PP0V9PP', true, 'primary'), ($1, '#2PP0V9QQ', false, 'friend'),
            ($2, '#2PP0V9QQ', true, 'primary')`,
    [ids.person, ids.other],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, is_primary)
     values ($1, '#2PP0V9UU', false), ($2, '#2PP0V9YY', true), ($3, '#2PP0V9YY', false)`,
    [ids.person, ids.agent, ids.other],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, origin)
     values ('player', '#2PP0V9PP', $1, 'claim'), ('player', '#2PP0V9QQ', $1, 'claim'),
            ('clan', '#2PP0V9UU', $1, 'claim'), ('clan', '#2PP0V9YY', $2, 'claim'),
            ('player', '#2PP0V9RR', $1, 'collection')`,
    [ids.person, ids.other],
  );
  const col = await one(
    `insert into collection (slug, title, kind, owner_account)
     values ('leavers-list', 'Leaver''s list', 'player', $1)
     returning collection_id`,
    [ids.person],
  );
  await db.query(
    `insert into collection_member (collection_id, subject_tag) values ($1, '#2PP0V9RR')`,
    [col.collection_id],
  );

  // Credentials: the agent's key and the person's OAuth grant.
  agentKey = await issueServiceToken(db, {
    accountId: ids.agent,
    name: "leaving-agent",
  });
  const { clientId } = await registerClient(db, {
    clientName: "leaver-client",
    redirectUris: ["https://l.example/cb"],
  });
  const tokens = await mintTokens(db, {
    clientId,
    accountId: ids.person,
    scope: "cr:read",
    resource: RESOURCE,
  });
  personAccess = tokens.accessToken;
  const fam = await one(
    `select family_id from oauth_family where account_id = $1`,
    [ids.person],
  );
  const tok = await one(`select token_id from service_token where name = $1`, [
    "leaving-agent",
  ]);

  // The personal records.
  await db.query(
    `insert into session (session_id, account_id, sliding_expires_at, absolute_expires_at)
     values ('s-leaver', $1, now() + interval '1 day', now() + interval '30 days')`,
    [ids.person],
  );
  await db.query(
    `insert into magic_login (token_hash, email_hash, code_hash, expires_at)
     values ('t-leaver', $1, 'c-leaver', now() + interval '15 minutes')`,
    [emailHash(ADDRESS)],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, surface, tool, oauth_family_id)
     values ($1, 'mcp', 'players_summary', $2), ($1, 'web', 'explore', null),
            ($3, 'mcp', 'war_current', null)`,
    [ids.person, fam.family_id, ids.agent],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, surface, tool, token_id)
     values ($1, 'mcp', 'war_current', $2), ($3, 'mcp', 'war_current', null)`,
    [ids.agent, tok.token_id, ids.other],
  );
  await db.query(
    `insert into credential_refusal (credential_hash, token_id, account_id, kind, reason)
     values ('h1', $1, $2, 'service_token', 'revoked_key')`,
    [tok.token_id, ids.agent],
  );
  await db.query(
    `insert into feedback (account_id, surface, message) values ($1, 'web', 'bye'),
            ($2, 'web', 'still here')`,
    [ids.person, ids.other],
  );
  await db.query(
    `insert into account_event (account_id, kind, detail) values ($1, 'signed_in', '{}')`,
    [ids.person],
  );
  const issue = await one(
    `insert into email_issue (kind, period_key) values ('weekly_report', '2026-W39')
     returning issue_id`,
  );
  await db.query(
    `insert into email_send (issue_id, account_id, archived)
     values ($1, $2, true), ($1, $3, true)`,
    [issue.issue_id, ids.person, ids.other],
  );
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, '#2PP0V9QQ', 'buddy')`,
    [ids.person],
  );
  await db.query(
    `insert into attested_fact (subject_kind, clan_tag, fact_type, detail, visibility,
                                source, source_ref, attester_account_id, attester_tag, occurred_at)
     values ('clan', '#2PP0V9UU', 'clan_message', '{}', 'clan', 'clan', 'r1', $1, '#2PP0V9PP', now())`,
    [ids.person],
  );
  await db.query(
    `insert into gateway (owner_account_id, name, status) values ($1, 'leaver-box', 'active')`,
    [ids.person],
  );
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("a dry run is the default: it reports what would go and writes nothing", async () => {
  const r = await accountRemoveOp(SCRATCH_URL, {
    email: " Leaving@Example.com",
  });
  // The live collector is refused first, even on a dry run.
  assert.equal(r.refused, "collectors_live");
  assert.equal(r.dry_run, true);
  await db.query(
    `update gateway set status = 'revoked' where owner_account_id = $1`,
    [ids.person],
  );

  const dry = await accountRemoveOp(SCRATCH_URL, { email: ADDRESS });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.refused, undefined);
  assert.equal(dry.agents, 1);
  assert.deepEqual(dry.removed, {
    mcp_call_audit: 4,
    credential_refusal: 1,
    service_token: 1,
    oauth_token: 2,
    oauth_family: 1,
    oauth_code: 0,
    session: 1,
    magic_login: 1,
    claim_challenge: 0,
    claim: 2,
    account_clan: 2,
    collection: 1,
    player_nickname: 1,
    timeline_reader: 0,
    agent_identity: 0,
    feedback: 1,
    email_send: 1,
    email_milestone: 0,
    email_milestone_look: 0,
    account_email_pref: 0,
    account_event: 2, // signed_in, and the grant's agent_connected
  });
  assert.deepEqual(dry.kept, {
    recordings_requested: 4,
    revoked_collectors: 1,
  });
  assert.equal(dry.mail_archived, 1);
  assert.equal(dry.mail_archive_keys, undefined);
  assert.equal(dry.recordings_stopped, null);
  assert.ok(
    !JSON.stringify(dry).includes(ADDRESS),
    "the address never returns",
  );

  // Nothing moved.
  assert.equal(
    await count(`select count(*)::int as n from claim where account_id = $1`, [
      ids.person,
    ]),
    2,
  );
  assert.equal(
    (await one(`select email from account where account_id = $1`, [ids.person]))
      .email,
    ADDRESS,
  );
  assert.ok(await validateServiceToken(db, agentKey));
});

test("refusals: the owner, an agent, an unknown address, an integration's owner", async () => {
  assert.equal(
    (
      await accountRemoveOp(SCRATCH_URL, {
        account_id: ids.owner,
        dry_run: false,
      })
    ).refused,
    "owner_account",
  );
  assert.equal(
    (
      await accountRemoveOp(SCRATCH_URL, {
        account_id: ids.agent,
        dry_run: false,
      })
    ).refused,
    "not_a_person",
  );
  assert.equal(
    (await accountRemoveOp(SCRATCH_URL, { email: "nobody@example.com" })).error,
    "not_found",
  );
  assert.ok((await accountRemoveOp(SCRATCH_URL, {})).error);

  const partner = await one(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'partner')
     returning account_id`,
    [emailHash("partner@example.com")],
  );
  await db.query(
    `insert into account (status, role, kind, owned_by_account_id)
     values ('approved', 'partner', 'integration', $1)`,
    [partner.account_id],
  );
  assert.equal(
    (
      await accountRemoveOp(SCRATCH_URL, {
        account_id: partner.account_id,
        dry_run: false,
      })
    ).refused,
    "owns_integration",
  );
});

test("the run removes the person and their agent, keeps the game record, and leaves a tombstone", async () => {
  const r = await accountRemoveOp(SCRATCH_URL, {
    email: ADDRESS,
    dry_run: false,
  });
  assert.equal(r.dry_run, false);
  assert.equal(r.refused, undefined);
  assert.equal(r.removed.claim, 2);
  assert.equal(r.mail_archive_keys.length, 1);
  assert.match(
    r.mail_archive_keys[0],
    /^mail\/sent\/dt=\d{4}-\d{2}-\d{2}\/send_id=/,
  );
  // #2PP0V9PP, #2PP0V9UU and #2PP0V9RR had no other reason; #2PP0V9QQ and #2PP0V9YY do.
  assert.equal(r.recordings_stopped, 3);

  const acct = await one(
    `select email, email_hash, status, request_note, timezone, newsletter_opt_in
       from account where account_id = $1`,
    [ids.person],
  );
  assert.deepEqual(acct, {
    email: null,
    email_hash: `removed:${ids.person}`,
    status: "disabled",
    request_note: null,
    timezone: null,
    newsletter_opt_in: false,
  });
  assert.equal(
    (await one(`select status from account where account_id = $1`, [ids.agent]))
      .status,
    "disabled",
  );

  // Every personal row of the person and the agent is gone.
  for (const table of [
    "claim",
    "account_clan",
    "session",
    "oauth_family",
    "service_token",
    "feedback",
    "email_send",
    "player_nickname",
    "credential_refusal",
    "mcp_call_audit",
  ]) {
    assert.equal(
      await count(
        `select count(*)::int as n from ${table} where account_id = any($1::uuid[])`,
        [[ids.person, ids.agent]],
      ),
      0,
      table,
    );
  }
  assert.equal(
    await count(
      `select count(*)::int as n from magic_login where email_hash = $1`,
      [emailHash(ADDRESS)],
    ),
    0,
  );
  assert.equal(
    await count(
      `select count(*)::int as n from collection where slug = 'leavers-list'`,
    ),
    0,
  );
  // The only event left is the removal itself.
  assert.deepEqual(
    (
      await db.query(`select kind from account_event where account_id = $1`, [
        ids.person,
      ])
    ).rows.map((e) => e.kind),
    ["account_removed"],
  );

  // Credentials are dead.
  assert.equal(await validateServiceToken(db, agentKey), null);
  assert.equal(
    await validateAccessToken(db, personAccess, { resource: RESOURCE }),
    null,
  );

  // Recordings: stopped where nobody else wants them, never deleted.
  const rec = Object.fromEntries(
    (
      await db.query(
        `select subject_tag, status from recording order by subject_tag`,
      )
    ).rows.map((x) => [x.subject_tag, x.status]),
  );
  assert.deepEqual(rec, {
    "#2PP0V9PP": "stopped",
    "#2PP0V9QQ": "active",
    "#2PP0V9RR": "stopped",
    "#2PP0V9UU": "stopped",
    "#2PP0V9YY": "active",
  });

  // The game record and everyone else are untouched.
  assert.equal(await count(`select count(*)::int as n from player`), 3);
  assert.equal(
    await count(`select count(*)::int as n from claim where account_id = $1`, [
      ids.other,
    ]),
    1,
  );
  assert.equal(
    await count(
      `select count(*)::int as n from feedback where account_id = $1`,
      [ids.other],
    ),
    1,
  );
  assert.equal(
    await count(
      `select count(*)::int as n from mcp_call_audit where account_id = $1`,
      [ids.other],
    ),
    1,
  );
  const fact = await one(
    `select attester_account_id, attester_tag from attested_fact`,
  );
  // A clan's fact stays the clan's; its account link is the tombstone.
  assert.deepEqual(fact, {
    attester_account_id: ids.person,
    attester_tag: "#2PP0V9PP",
  });
  assert.equal(
    await count(
      `select count(*)::int as n from gateway where owner_account_id = $1`,
      [ids.person],
    ),
    1,
    "a revoked collector's history stays, on the tombstone",
  );

  // Removing it again is refused; the address now finds nothing.
  assert.equal(
    (
      await accountRemoveOp(SCRATCH_URL, {
        account_id: ids.person,
        dry_run: false,
      })
    ).refused,
    "already_removed",
  );
  assert.equal(
    (await accountRemoveOp(SCRATCH_URL, { email: ADDRESS })).error,
    "not_found",
  );
});
