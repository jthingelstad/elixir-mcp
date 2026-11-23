/**
 * {agent_accounts_remove: {...}}: delete every agent account (DECISIONS,
 * "The old agent accounts are deleted"; Jamie, 2026-11-23: "Delete the
 * old agent accounts.").
 *
 *   {agent_accounts_remove: true} or {}          dry run: what would happen
 *   {agent_accounts_remove: {dry_run: false,
 *                            history: "owner"}}  delete them
 *
 * Elixir has people, not agents: nothing has minted, authenticated or
 * served an agent since the one MCP endpoint (#1219), and the migration
 * that narrows `account.kind` to person and integration refuses to run
 * while any agent row is left. This op is how those rows go, so the
 * removal is never hand-written SQL. It touches rows of `kind = 'agent'`
 * accounts and nothing else: every statement is scoped to the ids its
 * first read selected by kind, so a person (a test account included) or
 * an integration is never read for writing.
 *
 * Per table, by what the schema allows:
 *
 * - Deleted, the agent's own machinery: service tokens, OAuth grants,
 *   tokens and codes, sessions, claims and clan follows (the recordings
 *   only they kept alive are stopped through the claims package's own
 *   reconcile), nicknames, read pointers, the timeline's Discord
 *   cross-post (its sealed webhook and what it told), agent identities,
 *   Clan's remembered clan, rate counters and every social row (cheers,
 *   comments, posts, blocks, follows, passport, push), which an agent
 *   never had a door to write but which the op clears all the same.
 * - Kept and detached, history whose pointer may be null: the call log
 *   (`mcp_call_audit`) and the refusal log (`credential_refusal`) keep
 *   their rows with account, key and grant set to null, and age out on
 *   their own 28- and 30-day rules; a game conversation keeps its comments
 *   and loses a stale owner stamp. An attested fact keeps its fact and
 *   loses its attester through its foreign key's own ON DELETE SET NULL,
 *   so the op neither names nor counts that table (only the record's read
 *   and write name it, services/mcp/test/attested-readers.test.mjs).
 * - Re-pointed to the agent's owner: a recording's `requested_by`
 *   (not null; the recording is the record's, and the owner's pooled
 *   slots were what an agent followed in).
 * - Kept untouched: `discord_post`, the cross-post quality ledger, which
 *   names an account without a foreign key.
 * - History that cannot outlive its account (`feedback` and
 *   `account_event`, both `account_id not null`): the operator chooses.
 *   `history: "owner"` re-points the rows to the agent's owner (the
 *   feedback, its answer and its thread stay, and read as the owner's);
 *   `history: "delete"` deletes them (a feedback's refs go with it, a
 *   later item that followed it keeps its words and loses the link). A
 *   run with such rows and no choice is refused, writing nothing.
 *
 * Refused, before anything is written (and reported by a dry run): an
 * agent that owns an account, a collector or an integration row, none of
 * which an agent could have. Dry run by default: `dry_run` must be false
 * to write. One transaction; a real run that detached call-log rows
 * vacuums `mcp_call_audit` after it commits.
 */

import pg from "pg";
import { reconcileRecording } from "@elixir-mcp/claims";
import { vacuumAnalyze } from "./vacuum.mjs";

const HISTORY = new Set(["owner", "delete"]);

export async function agentAccountsRemoveOp(databaseUrl, spec = {}) {
  const args = spec === true || spec == null ? {} : spec;
  const dryRun = args.dry_run !== false;
  const history = args.history ?? null;
  if (history !== null && !HISTORY.has(history))
    return { error: "invalid_history", allowed: [...HISTORY] };

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin");
    let result;
    try {
      result = await removeAgents(db, { dryRun, history });
      await db.query(dryRun || result.refused ? "rollback" : "commit");
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
    if (!dryRun && !result.refused && result.detached?.mcp_call_audit > 0)
      result.vacuumed = [await vacuumAnalyze(db, "mcp_call_audit")];
    return result;
  } finally {
    await db.end();
  }
}

async function removeAgents(db, { dryRun, history }) {
  const { rows: agents } = await db.query(
    `select a.account_id, a.status, a.created_at, a.removed_at,
            a.owned_by_account_id as owner_id,
            left(coalesce(o.email_hash, ''), 10) as owner_ref,
            o.kind as owner_kind,
            (select st.name from service_token st
              where st.account_id = a.account_id
              order by st.created_at, st.token_id limit 1) as name,
            (select max(c.created_at) from mcp_call_audit c
              where c.account_id = a.account_id) as last_call_at
       from account a
       left join account o on o.account_id = a.owned_by_account_id
      where a.kind = 'agent'
      order by a.created_at, a.account_id
      for update of a`,
  );
  const ids = agents.map((a) => a.account_id);
  const out = {
    dry_run: dryRun,
    agents: agents.map((a) => ({
      account_ref: a.account_id.slice(0, 8),
      name: a.name,
      status: a.status,
      removed_from_view: a.removed_at !== null,
      owner_ref: a.owner_ref,
      created_at: a.created_at,
      last_call_at: a.last_call_at,
    })),
  };
  if (ids.length === 0) return { ...out, nothing_to_do: true };

  // What an agent could never have; if one does, a person decides.
  const { rows: block } = await db.query(
    `select
       (select count(*)::int from account
         where owned_by_account_id = any($1::uuid[])) as owns_accounts,
       (select count(*)::int from gateway
         where owner_account_id = any($1::uuid[])) as owns_collectors,
       (select count(*)::int from collector_version_event
         where account_id = any($1::uuid[])) as collector_events,
       (select count(*)::int from integration
         where account_id = any($1::uuid[])) as integrations,
       (select count(*)::int from account a
         where a.account_id = any($2::uuid[]) and a.kind <> 'person') as owners_not_people`,
    [ids, [...new Set(agents.map((a) => a.owner_id))]],
  );
  const blockers = Object.fromEntries(
    Object.entries(block[0]).filter(([, n]) => n > 0),
  );
  if (Object.keys(blockers).length)
    return {
      ...out,
      refused: "agent_holds_more_than_agent_rows",
      blockers,
      hint: "Each blocker is something no agent could make; look at it before deleting anything.",
    };

  // History whose account_id is not null: the operator's choice.
  const { rows: hist } = await db.query(
    `select
       (select count(*)::int from feedback
         where account_id = any($1::uuid[])) as feedback,
       (select count(*)::int from feedback_ref r join feedback f using (feedback_id)
         where f.account_id = any($1::uuid[])) as feedback_ref,
       (select count(*)::int from account_event
         where account_id = any($1::uuid[])) as account_event`,
    [ids],
  );
  out.history = { ...hist[0], choice: history };
  const historyRows = hist[0].feedback + hist[0].account_event;
  if (!dryRun && historyRows > 0 && history === null)
    return {
      ...out,
      refused: "history_choice_required",
      hint: 'Add "history": "owner" to re-point feedback and account events to each agent\'s owner, or "history": "delete" to delete them.',
    };

  const { rows: tokens } = await db.query(
    `select token_id from service_token where account_id = any($1::uuid[])`,
    [ids],
  );
  const tokenIds = tokens.map((r) => r.token_id);
  const { rows: families } = await db.query(
    `select family_id from oauth_family where account_id = any($1::uuid[])`,
    [ids],
  );
  const familyIds = families.map((r) => r.family_id);
  // Rate counters are text-keyed and end in the account id; a key with
  // its own ceiling counts under mcp#token#<id>.
  const counterKeys = tokenIds.map((t) => `mcp#token#${t}`);

  // What the agents were a reason to record, in the claims package's
  // subject-lock order.
  const { rows: subjects } = await db.query(
    `select 'player' as kind, player_tag as tag from claim
      where account_id = any($1::uuid[])
     union
     select 'clan', clan_tag from account_clan
      where account_id = any($1::uuid[])
     order by 2, 1`,
    [ids],
  );
  if (!dryRun)
    for (const { tag } of subjects)
      await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [tag]);

  const run = async (countSql, writeSql, params) => {
    const sql = dryRun
      ? `select count(*)::int as n from ${countSql}`
      : `with w as (${writeSql} returning 1) select count(*)::int as n from w`;
    return (await db.query(sql, params)).rows[0].n;
  };

  // Detached first: the logs name the tokens and grants that go below.
  const detached = {};
  detached.mcp_call_audit = await run(
    `mcp_call_audit where account_id = any($1::uuid[])
        or token_id = any($2::bigint[]) or oauth_family_id = any($3::uuid[])`,
    `update mcp_call_audit
        set account_id = case when account_id = any($1::uuid[]) then null else account_id end,
            token_id = case when token_id = any($2::bigint[]) then null else token_id end,
            oauth_family_id = case when oauth_family_id = any($3::uuid[]) then null else oauth_family_id end
      where account_id = any($1::uuid[])
         or token_id = any($2::bigint[]) or oauth_family_id = any($3::uuid[])`,
    [ids, tokenIds, familyIds],
  );
  detached.credential_refusal = await run(
    `credential_refusal where account_id = any($1::uuid[])
        or token_id = any($2::bigint[])`,
    `update credential_refusal
        set account_id = case when account_id = any($1::uuid[]) then null else account_id end,
            token_id = case when token_id = any($2::bigint[]) then null else token_id end
      where account_id = any($1::uuid[]) or token_id = any($2::bigint[])`,
    [ids, tokenIds],
  );
  detached.timeline_comment_owner_stamp = await run(
    `timeline_comment where not owner_is_account
        and owner_account_id = any($1::uuid[]) and account_id <> all($1::uuid[])`,
    `update timeline_comment set owner_account_id = null
      where not owner_is_account
        and owner_account_id = any($1::uuid[]) and account_id <> all($1::uuid[])`,
    [ids],
  );

  const repointed = {};
  repointed.recording = await run(
    `recording where requested_by = any($1::uuid[])`,
    `update recording r set requested_by = a.owned_by_account_id
       from account a
      where a.account_id = r.requested_by and a.account_id = any($1::uuid[])`,
    [ids],
  );

  // Deleted, in an order the foreign keys accept.
  const steps = [
    ["service_token", `service_token where account_id = any($1::uuid[])`],
    [
      "oauth_token",
      `oauth_token where family_id = any($1::uuid[])`,
      [familyIds],
    ],
    ["oauth_family", `oauth_family where account_id = any($1::uuid[])`],
    ["oauth_code", `oauth_code where account_id = any($1::uuid[])`],
    ["session", `session where account_id = any($1::uuid[])`],
    ["claim_challenge", `claim_challenge where account_id = any($1::uuid[])`],
    ["claim", `claim where account_id = any($1::uuid[])`],
    ["account_clan", `account_clan where account_id = any($1::uuid[])`],
    [
      "account_clan_declined",
      `account_clan_declined where account_id = any($1::uuid[])`,
    ],
    ["player_nickname", `player_nickname where account_id = any($1::uuid[])`],
    ["timeline_cheer", `timeline_cheer where account_id = any($1::uuid[])`],
    [
      "timeline_feed_link",
      `timeline_feed_link where account_id = any($1::uuid[])`,
    ],
    ["comment_report", `comment_report where account_id = any($1::uuid[])`],
    [
      "timeline_comment",
      `timeline_comment where account_id = any($1::uuid[])
          or (owner_is_account and owner_account_id = any($1::uuid[]))`,
    ],
    ["comment_check", `comment_check where account_id = any($1::uuid[])`],
    [
      "comment_conversation",
      `comment_conversation where account_id = any($1::uuid[])`,
    ],
    ["post_report", `post_report where account_id = any($1::uuid[])`],
    ["account_post", `account_post where account_id = any($1::uuid[])`],
    [
      "account_block",
      `account_block where account_id = any($1::uuid[])
          or blocked_account_id = any($1::uuid[])`,
    ],
    ["comment_setting", `comment_setting where account_id = any($1::uuid[])`],
    ["bell_seen", `bell_seen where account_id = any($1::uuid[])`],
    [
      "push_subscription",
      `push_subscription where account_id = any($1::uuid[])`,
    ],
    [
      "account_push_pref",
      `account_push_pref where account_id = any($1::uuid[])`,
    ],
    ["push_notice", `push_notice where account_id = any($1::uuid[])`],
    ["home_feed", `home_feed where account_id = any($1::uuid[])`],
    ["bell_week", `bell_week where account_id = any($1::uuid[])`],
    ["home_clan_card", `home_clan_card where account_id = any($1::uuid[])`],
    [
      "account_stamp_fact",
      `account_stamp_fact where account_id = any($1::uuid[])`,
    ],
    [
      "account_stamp_earned",
      `account_stamp_earned where account_id = any($1::uuid[])`,
    ],
    [
      "account_profile_list",
      `account_profile_list where account_id = any($1::uuid[])`,
    ],
    ["account_passport", `account_passport where account_id = any($1::uuid[])`],
    [
      "account_follow",
      `account_follow where account_id = any($1::uuid[])
          or followed_account_id = any($1::uuid[])`,
    ],
    ["timeline_reader", `timeline_reader where account_id = any($1::uuid[])`],
    [
      "timeline_clan_reader",
      `timeline_clan_reader where account_id = any($1::uuid[])`,
    ],
    [
      "timeline_discord_told",
      `timeline_discord_told where account_id = any($1::uuid[])`,
    ],
    ["timeline_discord", `timeline_discord where account_id = any($1::uuid[])`],
    [
      "clan_state",
      `clan_state where pk = any($1::text[])`,
      [ids.map((id) => `account#${id}`)],
    ],
    ["agent_identity", `agent_identity where account_id = any($1::uuid[])`],
    ["account_discord", `account_discord where account_id = any($1::uuid[])`],
    ["discord_login", `discord_login where account_id = any($1::uuid[])`],
    ["email_send", `email_send where account_id = any($1::uuid[])`],
    [
      "account_email_pref",
      `account_email_pref where account_id = any($1::uuid[])`,
    ],
    [
      "rate_limit",
      `rate_limit where substring(bucket from '[#:]([^#:]+)$') = any($1::text[])
         or bucket = any($2::text[])`,
      [ids, counterKeys],
    ],
  ];
  const deleted = {};
  for (const [table, from, params = [ids]] of steps)
    deleted[table] = await run(from, `delete from ${from}`, params);

  // The history the operator chose for.
  const historyDone = { feedback: 0, account_event: 0 };
  if (!dryRun && history === "owner") {
    for (const table of ["feedback", "account_event"])
      historyDone[table] = (
        await db.query(
          `with w as (
             update ${table} t set account_id = a.owned_by_account_id
               from account a
              where a.account_id = t.account_id and a.account_id = any($1::uuid[])
             returning 1)
           select count(*)::int as n from w`,
          [ids],
        )
      ).rows[0].n;
  } else if (!dryRun && history === "delete") {
    for (const table of ["feedback", "account_event"])
      historyDone[table] = (
        await db.query(
          `with w as (delete from ${table} where account_id = any($1::uuid[]) returning 1)
           select count(*)::int as n from w`,
          [ids],
        )
      ).rows[0].n;
  }
  if (!dryRun) out.history = { ...out.history, done: historyDone };

  const { rows: kept } = await db.query(
    `select count(*)::int as n from discord_post where account_id = any($1::uuid[])`,
    [ids],
  );

  let recordingsStopped = null;
  let accountsDeleted = 0;
  if (!dryRun) {
    recordingsStopped = 0;
    for (const { kind, tag } of subjects) {
      const r = await reconcileRecording(db, kind, tag, null);
      if (r.stopped) recordingsStopped += 1;
    }
    // One event on each owner's account, so their history says so.
    const owners = new Map();
    for (const a of agents)
      owners.set(a.owner_id, (owners.get(a.owner_id) ?? 0) + 1);
    for (const [owner, n] of owners)
      await db.query(
        `insert into account_event (account_id, kind, detail)
         values ($1, 'agent_accounts_removed', $2)`,
        [owner, JSON.stringify({ via: "ops", agents: n, history })],
      );
    accountsDeleted = (
      await db.query(
        `with w as (delete from account
                     where account_id = any($1::uuid[]) and kind = 'agent'
                    returning 1)
         select count(*)::int as n from w`,
        [ids],
      )
    ).rows[0].n;
  }

  return {
    ...out,
    accounts: dryRun ? ids.length : accountsDeleted,
    deleted,
    detached,
    repointed,
    kept: { discord_post: kept[0].n },
    // A dry run names how many subjects an agent was a reason to record;
    // which stop depends on who else wants each, which only the run's
    // reconcile can say.
    subjects: subjects.length,
    recordings_stopped: recordingsStopped,
  };
}
