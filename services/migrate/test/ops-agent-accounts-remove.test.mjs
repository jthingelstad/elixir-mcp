/**
 * {agent_accounts_remove}: the old agent accounts are deleted (Jamie,
 * 2026-11-23). A dry run is the default and writes nothing; a real run
 * with history rows and no choice is refused; a run deletes every agent
 * and its machinery, keeps the logs detached, re-points what must point
 * somewhere to the owner, and never touches a person, a test account or
 * an integration.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { agentAccountsRemoveOp } from "../src/ops-agent-accounts-remove.mjs";
import { issueServiceToken } from "../../../packages/auth/src/index.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_agent_accounts_remove_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const AGENT_DOOR = "https://elixir.poapkings.com/a/leavingagent/mcp";

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

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();

  ids.owner = await account(
    `insert into account (email_hash, status, role) values ('owner-hash-0001', 'approved', 'member')
     returning account_id`,
  );
  ids.other = await account(
    `insert into account (email_hash, status, role) values ('other-hash', 'approved', 'member')
     returning account_id`,
  );
  ids.testAccount = await account(
    `insert into account (email_hash, status, role, test_name, onboarded_at)
     values ('test:gym', 'approved', 'member', 'gym', now()) returning account_id`,
  );
  ids.integration = await account(
    `insert into account (kind, owned_by_account_id, public_id, status, role)
     values ('integration', $1, 'stayingintg', 'approved', 'partner')
     returning account_id`,
    [ids.owner],
  );
  await db.query(
    `insert into integration (account_id, name) values ($1, 'elixir-clan')`,
    [ids.integration],
  );
  ids.agent = await account(
    `insert into account (kind, owned_by_account_id, public_id, status, role, created_at)
     values ('agent', $1, 'leavingagent', 'approved', 'member', now() - interval '2 days')
     returning account_id`,
    [ids.owner],
  );
  ids.suspended = await account(
    `insert into account (kind, owned_by_account_id, public_id, status, role, removed_at)
     values ('agent', $1, 'goneagent1', 'disabled', 'member', now())
     returning account_id`,
    [ids.owner],
  );

  await db.query(
    `insert into player (player_tag) values ('#0VQRR8U0'), ('#0RY8UJUL')`,
  );
  await db.query(
    `insert into clan (clan_tag) values ('#0CP08QUC'), ('#028RJP2U')`,
  );
  // #0VQRR8U0 only the agent wants; #028RJP2U the agent and the other
  // person follow; #0RY8UJUL the owner claims.
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship)
     values ($1, '#0VQRR8U0', false, 'watching'), ($2, '#0RY8UJUL', true, 'primary')`,
    [ids.agent, ids.owner],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, is_primary)
     values ($1, '#028RJP2U', true), ($2, '#028RJP2U', true), ($3, '#0CP08QUC', true)`,
    [ids.agent, ids.other, ids.testAccount],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, origin)
     values ('player', '#0VQRR8U0', $1, 'claim'), ('clan', '#028RJP2U', $1, 'claim'),
            ('player', '#0RY8UJUL', $2, 'claim'), ('clan', '#0CP08QUC', $3, 'claim')`,
    [ids.agent, ids.owner, ids.testAccount],
  );

  // Credentials: a key on every account, and the agent's OAuth grant.
  for (const [who, name] of [
    ["agent", "leaving-agent"],
    ["owner", "owner-key"],
    ["testAccount", "gym"],
    ["integration", "elixir-clan"],
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
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('agent-client', 'Agent client', array['https://example.com/cb'],
             now() + interval '1 day')`,
  );
  const fam = await one(
    `insert into oauth_family (client_id, account_id, absolute_expires_at, resource)
     values ('agent-client', $1, now() + interval '90 days', $2) returning family_id`,
    [ids.agent, AGENT_DOOR],
  );
  await db.query(
    `insert into oauth_token (token_hash, kind, family_id, expires_at)
     values ('agent-access', 'access', $1, now() + interval '1 hour'),
            ('agent-refresh', 'refresh', $1, now() + interval '30 days')`,
    [fam.family_id],
  );

  // History, on the agent and on everyone else.
  await db.query(
    `insert into mcp_call_audit (account_id, surface, tool, token_id, principal_kind, created_at)
     values ($1, 'mcp', 'war_current', $2, 'agent', now() - interval '1 hour'),
            ($1, 'mcp', 'players_summary', null, 'agent', now() - interval '3 hours'),
            ($3, 'mcp', 'war_current', $4, 'person', now()),
            ($5, 'mcp', 'war_current', $6, 'person', now())`,
    [
      ids.agent,
      keyIds.agent,
      ids.owner,
      keyIds.owner,
      ids.testAccount,
      keyIds.testAccount,
    ],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, surface, tool, oauth_family_id)
     values ($1, 'mcp', 'game_clock', $2)`,
    [ids.agent, fam.family_id],
  );
  await db.query(
    `insert into credential_refusal (credential_hash, token_id, account_id, kind, reason)
     values ('h-agent', $1, $2, 'service_token', 'agent_removed'),
            ('h-owner', $3, $4, 'service_token', 'revoked_key')`,
    [keyIds.agent, ids.agent, keyIds.owner, ids.owner],
  );
  await db.query(
    `insert into feedback (account_id, surface, message) values
       ($1, 'mcp', 'from the agent'), ($2, 'web', 'from the owner'),
       ($3, 'mcp', 'from the gym')`,
    [ids.agent, ids.owner, ids.testAccount],
  );
  await db.query(
    `insert into account_event (account_id, kind, detail) values
       ($1, 'agent_created', '{}'), ($2, 'signed_in', '{}')`,
    [ids.agent, ids.owner],
  );
  await db.query(
    `insert into attested_fact (subject_kind, clan_tag, fact_type, detail, visibility,
                                source, source_ref, attester_account_id, occurred_at)
     values ('clan', '#028RJP2U', 'clan_message', '{}', 'clan', 'clan', 'agent-1', $1, now()),
            ('clan', '#0CP08QUC', 'clan_message', '{}', 'clan', 'clan', 'intg-1', $2, now())`,
    [ids.agent, ids.integration],
  );

  // The agent's machinery.
  await db.query(
    `insert into agent_identity (account_id, external_id, player_tag)
     values ($1, 'discord:1', '#0VQRR8U0')`,
    [ids.agent],
  );
  await db.query(
    `insert into timeline_reader (account_id, reader, read_to)
     values ($1, 'agent-digest', now()), ($2, 'owner-digest', now())`,
    [ids.agent, ids.owner],
  );
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, '#0VQRR8U0', 'pal')`,
    [ids.agent],
  );
  const sealed = JSON.stringify({ v: 1, sealed: "x" });
  await db.query(
    `insert into timeline_discord (account_id, webhook_sealed, webhook_fp, webhook_display)
     values ($1, $3, '0123456789abcdef', '1234…abcd'), ($2, $3, 'fedcba9876543210', '5678…dcba')`,
    [ids.agent, ids.owner, sealed],
  );
  await db.query(
    `insert into timeline_discord_told (account_id, item_id, revision)
     values ($1, 'tl_00000000000000000001', 1)`,
    [ids.agent],
  );
  await db.query(
    `insert into discord_post (post_id, feature, account_id, clan_tag, destination, webhook_fp,
                               post_key, revision, action, mode, handed_at)
     values (gen_random_uuid(), 'timeline', $1, null, 'agent-dest', '0123456789abcdef',
             'tl_00000000000000000001', 1, 'post', 'line', now())`,
    [ids.agent],
  );
  for (const pk of [`account#${ids.agent}`, `account#${ids.owner}`])
    await db.query(`insert into clan_state (pk, body) values ($1, $2)`, [
      pk,
      JSON.stringify({ pk, selected: { clan_tag: "#028RJP2U" } }),
    ]);
  for (const bucket of [
    `mcp#${ids.agent}`,
    `mcpday#${ids.agent}`,
    `mcp#token#${keyIds.agent}`,
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

const bystanders = () => [ids.other, ids.testAccount, ids.integration];

test("an unknown history choice is refused", async () => {
  assert.deepEqual(
    await agentAccountsRemoveOp(SCRATCH_URL, { history: "keep" }),
    { error: "invalid_history", allowed: ["owner", "delete"] },
  );
});

test("an agent holding what no agent could make is refused, even on a dry run", async () => {
  await db.query(
    `insert into gateway (owner_account_id, name, status) values ($1, 'agent-box', 'revoked')`,
    [ids.agent],
  );
  const r = await agentAccountsRemoveOp(SCRATCH_URL, true);
  assert.equal(r.refused, "agent_holds_more_than_agent_rows");
  assert.deepEqual(r.blockers, { owns_collectors: 1 });
  await db.query(`delete from gateway where owner_account_id = $1`, [
    ids.agent,
  ]);
});

test("a dry run is the default: it lists the agents and what would happen, and writes nothing", async () => {
  const before = await footprint([...bystanders(), ids.owner, ids.agent]);
  const dry = await agentAccountsRemoveOp(SCRATCH_URL, true);
  assert.equal(dry.dry_run, true);
  assert.equal(dry.refused, undefined);
  assert.equal(dry.accounts, 2);
  assert.deepEqual(
    dry.agents.map((a) => [
      a.account_ref,
      a.name,
      a.status,
      a.removed_from_view,
    ]),
    [
      [ids.agent.slice(0, 8), "leaving-agent", "approved", false],
      [ids.suspended.slice(0, 8), null, "disabled", true],
    ],
  );
  assert.equal(dry.agents[0].owner_ref, "owner-hash");
  assert.ok(dry.agents[0].last_call_at instanceof Date);
  assert.equal(dry.agents[1].last_call_at, null);
  assert.deepEqual(dry.history, {
    feedback: 1,
    feedback_ref: 0,
    account_event: 1,
    choice: null,
  });
  assert.deepEqual(dry.detached, {
    mcp_call_audit: 3,
    credential_refusal: 1,
    timeline_comment_owner_stamp: 0,
  });
  assert.deepEqual(dry.repointed, { recording: 2 });
  assert.deepEqual(dry.kept, { discord_post: 1 });
  const nonZero = Object.fromEntries(
    Object.entries(dry.deleted).filter(([, n]) => n > 0),
  );
  assert.deepEqual(nonZero, {
    service_token: 1,
    oauth_token: 2,
    oauth_family: 1,
    claim: 1,
    account_clan: 1,
    player_nickname: 1,
    timeline_reader: 1,
    timeline_discord_told: 1,
    timeline_discord: 1,
    clan_state: 1,
    agent_identity: 1,
    rate_limit: 3,
  });
  assert.equal(dry.subjects, 2);
  assert.equal(dry.recordings_stopped, null);
  assert.deepEqual(
    await footprint([...bystanders(), ids.owner, ids.agent]),
    before,
  );
});

test("a real run with history rows and no choice is refused and writes nothing", async () => {
  const before = await footprint([...bystanders(), ids.owner, ids.agent]);
  const r = await agentAccountsRemoveOp(SCRATCH_URL, { dry_run: false });
  assert.equal(r.refused, "history_choice_required");
  assert.match(r.hint, /"history": "owner"/);
  assert.deepEqual(
    await footprint([...bystanders(), ids.owner, ids.agent]),
    before,
  );
});

test("history owner: the agents go, the owner keeps their history, and nobody else is touched", async () => {
  const bystandersBefore = await footprint(bystanders());
  const ownerBefore = await footprint(
    [ids.owner],
    ["account", "feedback", "account_event", "recording"],
  );
  const accountsBefore = (
    await db.query(
      `select * from account where kind <> 'agent' order by account_id`,
    )
  ).rows;

  const r = await agentAccountsRemoveOp(SCRATCH_URL, {
    dry_run: false,
    history: "owner",
  });
  assert.equal(r.refused, undefined);
  assert.equal(r.accounts, 2);
  assert.deepEqual(r.history.done, { feedback: 1, account_event: 1 });
  assert.equal(r.recordings_stopped, 1);
  assert.equal(r.vacuumed[0].table, "mcp_call_audit");

  assert.equal(
    (await one(`select count(*)::int as n from account where kind = 'agent'`))
      .n,
    0,
  );
  // Nobody else moved: every row pointing at a bystander, and every
  // non-agent account row, is as it was.
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
        `select * from account where kind <> 'agent' order by account_id`,
      )
    ).rows,
    accountsBefore,
  );

  // The logs stay, detached.
  const calls = await db.query(
    `select account_id, token_id, oauth_family_id, principal_kind from mcp_call_audit
      where principal_kind = 'agent' or tool = 'game_clock'`,
  );
  assert.equal(calls.rows.length, 3);
  for (const c of calls.rows) {
    assert.equal(c.account_id, null);
    assert.equal(c.token_id, null);
    assert.equal(c.oauth_family_id, null);
  }
  const refusal = await one(
    `select account_id, token_id from credential_refusal where credential_hash = 'h-agent'`,
  );
  assert.deepEqual(refusal, { account_id: null, token_id: null });
  assert.equal(
    (
      await one(
        `select attester_account_id from attested_fact where source_ref = 'agent-1'`,
      )
    ).attester_account_id,
    null,
  );
  assert.equal(
    (
      await one(
        `select count(*)::int as n from discord_post where destination = 'agent-dest'`,
      )
    ).n,
    1,
  );

  // The owner's history now holds the agent's.
  assert.equal(
    (
      await one(
        `select account_id from feedback where message = 'from the agent'`,
      )
    ).account_id,
    ids.owner,
  );
  assert.deepEqual(
    (
      await db.query(
        `select kind, detail from account_event where account_id = $1 order by event_id`,
        [ids.owner],
      )
    ).rows.map((e) => e.kind),
    ["agent_created", "signed_in", "agent_accounts_removed"],
  );

  // Recordings: the one only the agent wanted stopped and both now name
  // the owner; the clan the other person follows keeps recording.
  const recs = (
    await db.query(
      `select subject_tag, status, requested_by from recording
        where subject_tag in ('#0VQRR8U0', '#028RJP2U') order by subject_tag`,
    )
  ).rows;
  assert.deepEqual(recs, [
    { subject_tag: "#028RJP2U", status: "active", requested_by: ids.owner },
    { subject_tag: "#0VQRR8U0", status: "stopped", requested_by: ids.owner },
  ]);
  assert.deepEqual(
    (await db.query(`select bucket from rate_limit order by bucket`)).rows.map(
      (r) => r.bucket,
    ),
    [`mcp#${ids.owner}`, `mcp#token#${keyIds.testAccount}`].sort(),
  );
});

test("run again, there is nothing to do", async () => {
  const r = await agentAccountsRemoveOp(SCRATCH_URL, {
    dry_run: false,
    history: "owner",
  });
  assert.deepEqual(r, { dry_run: false, agents: [], nothing_to_do: true });
});

test("history delete: the agent's feedback and events go with it", async () => {
  const agent = await account(
    `insert into account (kind, owned_by_account_id, public_id, status, role)
     values ('agent', $1, 'lateagent1', 'disabled', 'member') returning account_id`,
    [ids.owner],
  );
  const fb = await one(
    `insert into feedback (account_id, surface, message) values ($1, 'mcp', 'late')
     returning feedback_id`,
    [agent],
  );
  await db.query(
    `insert into feedback (account_id, surface, message, follows_id)
     values ($1, 'web', 'a follow-up', $2)`,
    [ids.other, fb.feedback_id],
  );
  await db.query(
    `insert into account_event (account_id, kind) values ($1, 'agent_created')`,
    [agent],
  );
  const bystandersBefore = await footprint(bystanders(), ["feedback"]);

  const r = await agentAccountsRemoveOp(SCRATCH_URL, {
    dry_run: false,
    history: "delete",
  });
  assert.equal(r.accounts, 1);
  assert.deepEqual(r.history.done, { feedback: 1, account_event: 1 });
  assert.equal(r.vacuumed, undefined);
  assert.equal(
    (
      await one(
        `select count(*)::int as n from feedback where message = 'late'`,
      )
    ).n,
    0,
  );
  // The other person's follow-up keeps its words and loses the link.
  assert.equal(
    (await one(`select follows_id from feedback where message = 'a follow-up'`))
      .follows_id,
    null,
  );
  assert.deepEqual(
    await footprint(bystanders(), ["feedback"]),
    bystandersBefore,
  );
  assert.equal(
    (await one(`select count(*)::int as n from account where kind = 'agent'`))
      .n,
    0,
  );
});
