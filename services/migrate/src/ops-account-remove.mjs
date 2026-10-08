/**
 * Remove a person's account on their request ({account_remove: {...}}, #129).
 *
 *   {account_remove: {email: "<address>"}}        dry run: what would go
 *   {account_remove: {account_id: "<uuid>"}}      dry run, by id
 *   {account_remove: {..., dry_run: false}}       remove it
 *
 * The privacy page promises that an account and its address can be
 * removed on request (admin@poapkings.com). This is the one way to do it,
 * so a removal is never hand-written SQL.
 *
 * What goes, for the person and every agent they own: the address, the
 * claims and watches (claim, account_clan, and the recordings only they
 * kept alive, stopped through the claims package's own reconcile), the
 * sessions, OAuth grants and codes and tokens,
 * service tokens, the call log and its refusal log, feedback, account
 * events, mail sent and its switches and milestones, nicknames, timeline
 * read pointers, agent identities, and pending sign-in links.
 *
 * What stays: canonical game data (lossless by policy; stopping a
 * recording deletes nothing it recorded); a recording's `requested_by`,
 * attested clan facts (a clan's record, labelled with the attesting
 * player's tag; this module never reads them) and a revoked
 * collector's history, all of which point at the account row. That row
 * therefore stays as an anonymous tombstone: no address, a hash that is
 * no one's (`removed:<account_id>`), status disabled, nothing personal.
 * The same address can ask for access again and gets a new account.
 *
 * Refused, before anything is written (and reported by a dry run):
 * not a person (an agent goes with its owner), the owner account, an
 * owner of an integration (admin-provisioned: retire it first), a live
 * collector (revoke it first through the collector door's own revoke),
 * and already removed accounts. Inert historical Collection grants do not block removal.
 *
 * Not reachable from here, so listed in `manual`: the newsletter address
 * at Buttondown, sent-mail bodies under mail/sent/ in the archive bucket
 * (the keys are returned; this function holds no DeleteObject), and call
 * captures under calls/, which expire on their own 90-day rule.
 *
 * Dry run by default: `dry_run` must be false to write. One transaction.
 * The address in the payload is never returned or logged.
 */

import pg from "pg";
import { reconcileRecording } from "@elixir-mcp/claims";
import { sentMailKey } from "@elixir-mcp/mail/archive";

export async function accountRemoveOp(databaseUrl, spec = {}) {
  const dryRun = spec?.dry_run !== false;
  let hash = null;
  if (spec?.email) {
    const { emailHash } = await import("@elixir-mcp/auth/crypto");
    hash = emailHash(String(spec.email));
  }
  const accountId = spec?.account_id ? String(spec.account_id) : null;
  if (!hash && !accountId) return { error: "email or account_id required" };

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin");
    try {
      const result = await removeAccount(db, { hash, accountId, dryRun });
      await db.query(dryRun || result.refused ? "rollback" : "commit");
      return result;
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
  } finally {
    await db.end();
  }
}

async function removeAccount(db, { hash, accountId, dryRun }) {
  const { rows: found } = await db.query(
    `select account_id, email_hash, kind, status, role, is_owner
       from account
      where ($1::text is not null and email_hash = $1)
         or ($2::text is not null and account_id::text = $2)
      for update`,
    [hash, accountId],
  );
  if (found.length !== 1) return { error: "not_found" };
  const person = found[0];
  const out = {
    dry_run: dryRun,
    account_id: person.account_id,
    account_ref: String(person.email_hash ?? "").slice(0, 10),
    status: person.status,
  };
  const refuse = (refused, extra = {}) => ({ ...out, refused, ...extra });

  if (person.kind !== "person") return refuse("not_a_person");
  if (person.is_owner || person.role === "owner")
    return refuse("owner_account");
  if (String(person.email_hash).startsWith("removed:"))
    return refuse("already_removed");

  const { rows: owned } = await db.query(
    `select account_id, kind from account
      where owned_by_account_id = $1 order by account_id for update`,
    [person.account_id],
  );
  const integrations = owned.filter((r) => r.kind === "integration").length;
  if (integrations > 0) return refuse("owns_integration", { integrations });
  const ids = [person.account_id, ...owned.map((r) => r.account_id)];
  out.agents = owned.length;

  const { rows: gw } = await db.query(
    `select count(*) filter (where status <> 'revoked')::int as live,
            count(*) filter (where status = 'revoked')::int as revoked
       from gateway where owner_account_id = any($1::uuid[])`,
    [ids],
  );
  if (gw[0].live > 0)
    return refuse("collectors_live", { collectors: gw[0].live });

  // Identifiers the credential tables hang off.
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

  // What the removal would stop being a reason to record, taken before
  // the rows go, in one sorted order (the claims package's subject lock).
  const { rows: subjects } = await db.query(
    `select 'player' as kind, player_tag as tag from claim
      where account_id = any($1::uuid[])
     union
     select 'clan', clan_tag from account_clan
      where account_id = any($1::uuid[])
     order by 2, 1`,
    [ids],
  );

  const { rows: mail } = await db.query(
    `select send_id, enqueued_at from email_send
      where account_id = any($1::uuid[]) and archived
      order by enqueued_at`,
    [ids],
  );

  // The subject locks, in the claims package's order (account rows
  // first, above; then each subject, sorted), before any reason goes.
  if (!dryRun)
    for (const { tag } of subjects)
      await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [tag]);

  // Every personal row, deleted in an order the foreign keys accept:
  // the call and refusal logs before the tokens and grants they name,
  // tokens before their families, claim challenges with their claims.
  const steps = [
    [
      "mcp_call_audit",
      `mcp_call_audit where account_id = any($1::uuid[])
         or token_id = any($2::bigint[]) or oauth_family_id = any($3::uuid[])`,
      [ids, tokenIds, familyIds],
    ],
    [
      "credential_refusal",
      `credential_refusal where account_id = any($1::uuid[])
         or token_id = any($2::bigint[])`,
      [ids, tokenIds],
    ],
    ["service_token", `service_token where account_id = any($1::uuid[])`],
    [
      "oauth_token",
      `oauth_token where family_id = any($1::uuid[])`,
      [familyIds],
    ],
    ["oauth_family", `oauth_family where account_id = any($1::uuid[])`],
    ["oauth_code", `oauth_code where account_id = any($1::uuid[])`],
    ["session", `session where account_id = any($1::uuid[])`],
    ["magic_login", `magic_login where email_hash = $1`, [person.email_hash]],
    ["claim_challenge", `claim_challenge where account_id = any($1::uuid[])`],
    ["claim", `claim where account_id = any($1::uuid[])`],
    ["account_clan", `account_clan where account_id = any($1::uuid[])`],
    [
      "account_clan_declined",
      `account_clan_declined where account_id = any($1::uuid[])`,
    ],
    ["player_nickname", `player_nickname where account_id = any($1::uuid[])`],
    ["timeline_reader", `timeline_reader where account_id = any($1::uuid[])`],
    ["agent_identity", `agent_identity where account_id = any($1::uuid[])`],
    ["feedback", `feedback where account_id = any($1::uuid[])`],
    [
      "collector_version_event",
      `collector_version_event where account_id = any($1::uuid[])`,
    ],
    ["email_send", `email_send where account_id = any($1::uuid[])`],
    ["email_milestone", `email_milestone where account_id = any($1::uuid[])`],
    [
      "email_milestone_look",
      `email_milestone_look where account_id = any($1::uuid[])`,
    ],
    [
      "account_email_pref",
      `account_email_pref where account_id = any($1::uuid[])`,
    ],
    ["account_event", `account_event where account_id = any($1::uuid[])`],
  ];

  const removed = {};
  for (const [table, from, params = [ids]] of steps) {
    const sql = dryRun
      ? `select count(*)::int as n from ${from}`
      : `with gone as (delete from ${from} returning 1)
         select count(*)::int as n from gone`;
    const { rows } = await db.query(sql, params);
    removed[table] = rows[0].n;
  }

  const { rows: requested } = await db.query(
    `select count(*)::int as n from recording
      where requested_by = any($1::uuid[])`,
    [ids],
  );

  let recordingsStopped = 0;
  if (!dryRun) {
    for (const { kind, tag } of subjects) {
      const r = await reconcileRecording(db, kind, tag, null);
      if (r.stopped) recordingsStopped += 1;
    }
    // The tombstone: the rows that stay point here, and nothing here
    // is anyone's any more.
    await db.query(
      `update account
          set email = null,
              email_hash = case when kind = 'person'
                                then 'removed:' || account_id::text end,
              status = 'disabled', request_note = null,
              requested_player_tag = null, timezone = null,
              newsletter_opt_in = false, onboarded_at = null,
              activity_seen_at = null
        where account_id = any($1::uuid[])`,
      [ids],
    );
    await db.query(
      `insert into account_event (account_id, kind, detail)
       values ($1, 'account_removed', $2)`,
      [person.account_id, JSON.stringify({ via: "ops", agents: owned.length })],
    );
  }

  return {
    ...out,
    removed,
    // A dry run names how many recordings were someone's reason; which of
    // them stop depends on who else wants each subject, which only the
    // run's reconcile can say.
    subjects: subjects.length,
    recordings_stopped: dryRun ? null : recordingsStopped,
    kept: {
      recordings_requested: requested[0].n,
      revoked_collectors: gw[0].revoked,
    },
    manual: [
      "Remove the address from the Buttondown newsletter list by hand.",
      mail.length
        ? `Delete ${mail.length} sent-mail bodies from the archive bucket (mail_archive_keys).`
        : "No sent-mail bodies are archived.",
      "Call captures under calls/ expire on their own 90-day rule.",
    ],
    mail_archived: mail.length,
    mail_archive_keys: dryRun
      ? undefined
      : mail.map((m) => sentMailKey(m.enqueued_at, m.send_id)),
  };
}
