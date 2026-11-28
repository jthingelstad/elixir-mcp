/**
 * Removing an account (#129; self-serve and Admin since 2026-11-23): the
 * one tested removal. The person deletes their own account in Settings
 * (web-api `POST /api/me/account/delete`), staff delete one from Admin
 * (`POST /api/admin/accounts/remove`), and ops run `{account_remove}`
 * (services/migrate). All three call `removeAccount` here, inside their
 * own transaction, so a removal is never hand-written SQL and never two
 * copies of the step list.
 *
 * What goes, for the person: the address, the
 * claims and watches (claim, account_clan, and the recordings only they
 * kept alive, stopped through the claims package's own reconcile), the
 * sessions, OAuth grants and codes and tokens, service tokens, the call
 * log and its refusal log and the rate counters, feedback, account
 * events and website visit days, mail sent and its switches, nicknames,
 * posts, comments and the conversations they joined, cheers, follows,
 * blocks, push devices, the stored Home and bell weeks, the passport and
 * Stamps, timeline read pointers, the timeline's Discord cross-post (its
 * sealed webhook, what it told, and its posts in the quality ledger),
 * Clan's remembered clan, and pending sign-in links. Removing an account
 * deletes the account, not the record (DECISIONS).
 *
 * What stays (KEPT_TABLES): canonical game data (lossless by policy;
 * stopping a recording deletes nothing it recorded); a recording's
 * `requested_by`, attested clan facts (a clan's record, labelled with the
 * attesting player's tag; this module never reads them) and a revoked
 * collector's history, all of which point at the account row. That row
 * therefore stays as an anonymous tombstone: no address, a hash that is
 * no one's (`removed:<account_id>`), status disabled, nothing personal.
 * The same address can sign up again and gets a new account.
 *
 * Refused, before anything is written (and reported by a dry run): not a
 * person, the owner account, a live collector (revoke it first through
 * the collector door's own revoke), and already removed accounts.
 *
 * Outside the database, each caller does what its role can: the web-api
 * removes the address from the mailing list (an email-lane
 * `newsletter_remove`) and deletes the sent-mail bodies (`sent_mail`,
 * keyed by `sentMailKey`); the ops op returns them to do by hand. Call
 * captures under calls/ expire on their own 28-day rule, and the relay's
 * timeline-discord-state/<account>/ records with the outbox's 14-day
 * rule.
 *
 * `packages/auth/test/account-remove-census.test.mjs` holds every
 * table that names an account to REMOVED_TABLES or KEPT_TABLES, and
 * every account column to the tombstone's two lists, so a new personal
 * table cannot be forgotten here.
 */

import { reconcileRecording } from "@elixir-mcp/claims";

/** Every personal row, deleted in an order the foreign keys accept: the
 *  call and refusal logs before the tokens and grants they name, tokens
 *  before their families, claim challenges with their claims. `params`
 *  takes the run's context; the default is the account ids. */
const STEPS = [
  {
    table: "mcp_call_audit",
    from: `mcp_call_audit where account_id = any($1::uuid[])
         or token_id = any($2::bigint[]) or oauth_family_id = any($3::uuid[])`,
    params: (c) => [c.ids, c.tokenIds, c.familyIds],
  },
  {
    table: "credential_refusal",
    from: `credential_refusal where account_id = any($1::uuid[])
         or token_id = any($2::bigint[])`,
    params: (c) => [c.ids, c.tokenIds],
  },
  {
    table: "service_token",
    from: `service_token where account_id = any($1::uuid[])`,
  },
  {
    table: "oauth_token",
    from: `oauth_token where family_id = any($1::uuid[])`,
    params: (c) => [c.familyIds],
  },
  {
    table: "oauth_family",
    from: `oauth_family where account_id = any($1::uuid[])`,
  },
  {
    table: "oauth_code",
    from: `oauth_code where account_id = any($1::uuid[])`,
  },
  { table: "session", from: `session where account_id = any($1::uuid[])` },
  {
    table: "magic_login",
    from: `magic_login where email_hash = $1`,
    params: (c) => [c.emailHash],
  },
  {
    table: "claim_challenge",
    from: `claim_challenge where account_id = any($1::uuid[])`,
  },
  { table: "claim", from: `claim where account_id = any($1::uuid[])` },
  {
    table: "account_clan",
    from: `account_clan where account_id = any($1::uuid[])`,
  },
  {
    table: "account_clan_declined",
    from: `account_clan_declined where account_id = any($1::uuid[])`,
  },
  {
    table: "player_nickname",
    from: `player_nickname where account_id = any($1::uuid[])`,
  },
  // Their cheers leave the counts with them, and their RSS link stops
  // (0243, #765).
  {
    table: "timeline_cheer",
    from: `timeline_cheer where account_id = any($1::uuid[])`,
  },
  {
    table: "timeline_feed_link",
    from: `timeline_feed_link where account_id = any($1::uuid[])`,
  },
  // My conversations (0303): the threads they joined and their read
  // receipts, before the comments, so each counts its own rows (a
  // deleted comment would take its receipts with it).
  {
    table: "comment_conversation_read",
    from: `comment_conversation_read where account_id = any($1::uuid[])`,
  },
  {
    table: "comment_conversation",
    from: `comment_conversation where account_id = any($1::uuid[])`,
  },
  // Comments (0282): their reports, their comments and every comment on
  // their account-owned/current-player items (their reports go with the
  // comments), their checks and the words of their refused ones, their
  // blocks either way and their comment setting.
  {
    table: "comment_report",
    from: `comment_report where account_id = any($1::uuid[])`,
  },
  {
    table: "timeline_comment",
    from: `timeline_comment where account_id = any($1::uuid[])
          or (owner_is_account and owner_account_id = any($1::uuid[]))
          or (not owner_is_account and subject_tag = any($2::text[]))`,
    params: (c) => [c.ids, c.verifiedTags],
  },
  {
    table: "comment_check",
    from: `comment_check where account_id = any($1::uuid[])`,
  },
  // Posts (0285): their reports of posts, then their posts (the reports
  // on them, and a share link to one, go with them; the comments on them
  // went above, as comments on their items).
  {
    table: "post_report",
    from: `post_report where account_id = any($1::uuid[])`,
  },
  {
    table: "account_post",
    from: `account_post where account_id = any($1::uuid[])`,
  },
  {
    table: "account_block",
    from: `account_block where account_id = any($1::uuid[])
          or blocked_account_id = any($1::uuid[])`,
  },
  {
    table: "comment_setting",
    from: `comment_setting where account_id = any($1::uuid[])`,
  },
  // When they last opened the bell (0244).
  { table: "bell_seen", from: `bell_seen where account_id = any($1::uuid[])` },
  // Their push devices, switches and notices (0283): a device's endpoint
  // is private account machinery and goes with them.
  {
    table: "push_subscription",
    from: `push_subscription where account_id = any($1::uuid[])`,
  },
  {
    table: "account_push_pref",
    from: `account_push_pref where account_id = any($1::uuid[])`,
  },
  {
    table: "push_notice",
    from: `push_notice where account_id = any($1::uuid[])`,
  },
  // Their stored Home week (0245), bell week (0247) and Home clan card
  // (0248), #649.
  { table: "home_feed", from: `home_feed where account_id = any($1::uuid[])` },
  { table: "bell_week", from: `bell_week where account_id = any($1::uuid[])` },
  {
    table: "home_clan_card",
    from: `home_clan_card where account_id = any($1::uuid[])`,
  },
  // Their passport, Stamps, ladder facts and profile list (0269, #1015).
  // The tombstone fires no cascade, so each goes by name; a share link to
  // their page goes with the passport (0294).
  {
    table: "account_stamp_fact",
    from: `account_stamp_fact where account_id = any($1::uuid[])`,
  },
  {
    table: "account_stamp_earned",
    from: `account_stamp_earned where account_id = any($1::uuid[])`,
  },
  {
    table: "account_profile_list",
    from: `account_profile_list where account_id = any($1::uuid[])`,
  },
  {
    table: "account_passport",
    from: `account_passport where account_id = any($1::uuid[])`,
  },
  // Their follows of other accounts, and other people's follows of them
  // (0277): a removed account has no page to follow.
  {
    table: "account_follow",
    from: `account_follow where account_id = any($1::uuid[])
          or followed_account_id = any($1::uuid[])`,
  },
  {
    table: "timeline_reader",
    from: `timeline_reader where account_id = any($1::uuid[])`,
  },
  // A home-clan reader's own position (0308).
  {
    table: "timeline_clan_reader",
    from: `timeline_clan_reader where account_id = any($1::uuid[])`,
  },
  {
    table: "timeline_discord_told",
    from: `timeline_discord_told where account_id = any($1::uuid[])`,
  },
  {
    table: "timeline_discord",
    from: `timeline_discord where account_id = any($1::uuid[])`,
  },
  // Only the timeline cross-post names an account; Clan's posts name the
  // clan and stay.
  {
    table: "discord_post",
    from: `discord_post where account_id = any($1::uuid[])`,
  },
  // Clan's account items, and the person's place: written under each of
  // their verified tags as `place#<tag>`, stamped with the account that
  // set it (0276). The claims go below, so no reader would show it, but
  // it is their personal data, and it goes too (2026-11-23).
  {
    table: "clan_state",
    from: `clan_state where pk = any($1::text[])
              or (pk like 'place#%' and body ->> 'account_id' = any($2::text[]))`,
    params: (c) => [c.ids.map((id) => `account#${id}`), c.ids.map(String)],
  },
  {
    table: "account_discord",
    from: `account_discord where account_id = any($1::uuid[])`,
  },
  {
    table: "discord_login",
    from: `discord_login where account_id = any($1::uuid[])`,
  },
  { table: "feedback", from: `feedback where account_id = any($1::uuid[])` },
  {
    table: "collector_version_event",
    from: `collector_version_event where account_id = any($1::uuid[])`,
  },
  {
    table: "email_send",
    from: `email_send where account_id = any($1::uuid[])`,
  },
  {
    table: "account_email_pref",
    from: `account_email_pref where account_id = any($1::uuid[])`,
  },
  {
    table: "account_event",
    from: `account_event where account_id = any($1::uuid[])`,
  },
  // The days they used the website signed in (0321).
  {
    table: "account_visit_day",
    from: `account_visit_day where account_id = any($1::uuid[])`,
  },
  // Rate counters are text-keyed (packages/tools quota and live, the MCP
  // and REST doors, Verify, sign-in mail): most end in the account id; a
  // key with its own ceiling counts under mcp#token#<id>; sign-in mail
  // under the address hash.
  {
    table: "rate_limit",
    from: `rate_limit where substring(bucket from '[#:]([^#:]+)$') = any($1::text[])
         or bucket = any($2::text[])`,
    params: (c) => [c.ids, c.counterKeys],
  },
];

/** The tables a removal deletes from, in order. */
export const REMOVED_TABLES = Object.freeze(STEPS.map((s) => s.table));

/** Tables that name an account and keep their rows, and why. */
export const KEPT_TABLES = Object.freeze({
  // The tombstone itself.
  account: "the anonymous tombstone the kept rows point at",
  // The game record's own bookkeeping: who first asked for a subject.
  // Stopping a recording deletes nothing it recorded.
  recording: "requested_by: the record's provenance, on the tombstone",
  // A clan's record, labelled with the attesting player's tag.
  attested_fact: "a clan's fact stays the clan's",
  // A revoked collector's history (a live one refuses the removal).
  gateway: "a revoked collector's history, on the tombstone",
});

/** The tombstone's account columns: what it clears or resets, and what
 *  it keeps because nothing in it is personal. */
export const ACCOUNT_COLUMNS_CLEARED = Object.freeze([
  "email",
  "email_hash",
  "status",
  "role",
  "request_note",
  "requested_player_tag",
  "timezone",
  "newsletter_opt_in",
  "onboarded_at",
  "activity_seen_at",
  "console_timeline_seen_at",
  "age_attested_at",
  "welcome_finished_at",
  "starter_hidden_at",
  "auto_follow_clan",
  "own_refresh_at",
  "avatar_card_id",
  "avatar_set_at",
  "handle",
  "handle_set_at",
  "test_name",
]);
export const ACCOUNT_COLUMNS_KEPT = Object.freeze([
  "account_id",
  "kind",
  "is_owner",
  "created_at",
  "decided_at",
  "mcp_daily_quota",
  "max_player_recordings",
  "live_daily_quota",
]);

/**
 * Remove one person's account, inside the caller's transaction on `db`.
 * `hash` (an address hash) or `accountId` names it. A dry run counts and
 * writes nothing; so does a refusal. The caller commits or rolls back:
 * roll back on `dryRun`, `refused` or `error`.
 *
 * `via` ("ops" | "self" | "admin") and, for Admin, `actorAccountId` go on
 * the `account_removed` event. The address is never read or returned.
 * A real run returns `sent_mail` ({send_id, enqueued_at} of each archived
 * body), for the caller to delete or hand on as keys.
 */
export async function removeAccount(
  db,
  {
    hash = null,
    accountId = null,
    dryRun = true,
    via = "ops",
    actorAccountId = null,
  },
) {
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

  const ids = [person.account_id];

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
  const counterKeys = [
    `auth#${person.email_hash}`,
    ...tokenIds.map((t) => `mcp#token#${t}`),
  ];

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

  // Comment ownership follows the current verified player, not a former
  // owner's historical stamp. Capture this before the claim deletion.
  const { rows: verified } = await db.query(
    `select c.player_tag from claim c join account a on a.account_id=c.account_id
      where c.account_id=any($1::uuid[]) and c.status='verified'
        and (c.is_primary or c.relationship in ('primary','alt'))
        and a.kind='person' and a.status='approved'`,
    [ids],
  );
  const verifiedTags = verified.map((r) => r.player_tag);

  const ctx = {
    ids,
    tokenIds,
    familyIds,
    counterKeys,
    verifiedTags,
    emailHash: person.email_hash,
  };
  const removed = {};
  for (const { table, from, params = (c) => [c.ids] } of STEPS) {
    const sql = dryRun
      ? `select count(*)::int as n from ${from}`
      : `with gone as (delete from ${from} returning 1)
         select count(*)::int as n from gone`;
    const { rows } = await db.query(sql, params(ctx));
    removed[table] = rows[0].n;
  }

  // Keep other people's reassigned game conversations while removing the
  // former owner's incidental stamp. A dry run reports the same scope.
  const staleStamps = `not owner_is_account
    and owner_account_id=any($1::uuid[]) and account_id <> all($1::uuid[])
    and not coalesce(subject_tag=any($2::text[]),false)`;
  const { rows: cleared } = await db.query(
    dryRun
      ? `select count(*)::int as n from timeline_comment where ${staleStamps}`
      : `with cleared as (update timeline_comment set owner_account_id=null where ${staleStamps} returning 1)
       select count(*)::int as n from cleared`,
    [ids, verifiedTags],
  );

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
    // The tombstone: the rows that stay point here, and nothing here is
    // anyone's any more (ACCOUNT_COLUMNS_CLEARED). test_name goes with
    // the 'test:' hash its check ties it to (0316).
    await db.query(
      `update account
          set email = null,
              email_hash = 'removed:' || account_id::text,
              status = 'disabled', role = 'member', request_note = null,
              requested_player_tag = null, timezone = null,
              newsletter_opt_in = false, onboarded_at = null,
              activity_seen_at = null, console_timeline_seen_at = null,
              age_attested_at = null, welcome_finished_at = null,
              starter_hidden_at = null, auto_follow_clan = false,
              own_refresh_at = null,
              avatar_card_id = null, avatar_set_at = null,
              handle = null, handle_set_at = null, test_name = null
        where account_id = any($1::uuid[])`,
      [ids],
    );
    await db.query(
      `insert into account_event (account_id, kind, detail)
       values ($1, 'account_removed', $2)`,
      [
        person.account_id,
        JSON.stringify({
          via,
          ...(via === "admin" && actorAccountId ? { by: actorAccountId } : {}),
        }),
      ],
    );
  }

  return {
    ...out,
    removed,
    cleared_comment_owner_stamps: cleared[0].n,
    // A dry run names how many recordings were someone's reason; which of
    // them stop depends on who else wants each subject, which only the
    // run's reconcile can say.
    subjects: subjects.length,
    recordings_stopped: dryRun ? null : recordingsStopped,
    kept: {
      recordings_requested: requested[0].n,
      revoked_collectors: gw[0].revoked,
    },
    mail_archived: mail.length,
    sent_mail: dryRun ? undefined : mail,
  };
}
