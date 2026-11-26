import {
  isActiveEmailKind,
  inactiveEmailReason,
  isDigestEmailKind,
} from "@elixir-mcp/contracts";
import { seasonFromDate } from "@elixir-mcp/record/war-clock";
/** The product email job: one op per kind, idempotent by the ledger.
 *
 *  runEmail asks the ledger first which recipients already
 *  have this period's mail, composes only for the rest (or one, with
 *  account_id + force: the manual path), hands each rendered mail to the
 *  relay through the outbox, and records the send after the hand-off.
 *  Re-running a period sends only what the ledger lacks and never
 *  recomposes an issue already sent; `force` is the manual path and
 *  skips that check. Every kind is bulk under the mail policy, so every
 *  message carries the signed one-click unsubscribe URL for its
 *  recipient and kind.
 *
 *  A run watches its own clock: with about 90 s
 *  of its run's deadline left (services/jobs/src/db.mjs) it stops taking recipients and says
 *  `incomplete`, and the handler fails the invocation so the async
 *  retry (EventInvokeConfig) carries on from where the ledger says it
 *  stopped, instead of every retry restarting from the oldest account
 *  and dying at the same place. */
import { openJobsClient } from "../db.mjs";
import { emailHash } from "@elixir-mcp/auth/crypto";
import { loadRecipients } from "./ctx.mjs";
import { lastCollectorWeek } from "./week.mjs";
import { upsertIssue } from "@elixir-mcp/mail/ledger";
import { deliver } from "@elixir-mcp/mail/deliver";
import { buildDigest, digestWindow } from "./build-digest.mjs";
import { buildCollector } from "./build-collector.mjs";
import { readerDoors } from "./reader.mjs";

/** Stop taking recipients with this much of the invocation left: the
 *  longest single compose is well under it. */
const STOP_MARGIN_MS = 90_000;

export async function runEmail({
  databaseUrl,
  db = null,
  kind,
  now = new Date(),
  enqueue,
  secret,
  accountId = null,
  accountEmail = null,
  force = false,
  archive = null,
  // (path) => whether the card-art mirror holds that file (deliver's
  // cardArt); null draws every card in its own form.
  cardArt = null,
  posts = process.env.POSTS_ENABLED === "true",
  // () => ms left before this run's deadline (db.mjs runRemainingMs);
  // null runs to the end.
  remainingMs = null,
}) {
  if (!isActiveEmailKind(kind))
    return { kind, skipped: inactiveEmailReason(kind), sent: 0 };
  const started = Date.now();
  const own = !db;
  if (own) {
    db = await openJobsClient(databaseUrl, { op: "email" });
  }
  const result = {
    kind,
    recipients: 0,
    composed: 0,
    sent: 0,
    skipped: 0,
    already_sent: 0,
    failed: 0,
    remaining: 0,
    incomplete: false,
    ms: 0,
    details: [],
  };
  try {
    // An ops invocation names the person by address; the address is
    // hashed here and never logged.
    if (!accountId && accountEmail) {
      const { rows } = await db.query(
        `select account_id from account where email_hash = $1`,
        [emailHash(accountEmail)],
      );
      accountId = rows[0]?.account_id ?? "00000000-0000-0000-0000-000000000000";
    }
    const recipients = await loadRecipients(db, kind, { accountId });
    result.recipients = recipients.length;
    if (recipients.length === 0) return result;
    const run = {
      db,
      kind,
      now,
      force,
      scheduled: !force && !accountId,
      posts,
      enqueue,
      result,
      manual: force ? `~m${now.getTime()}` : "",
      outOfTime: () =>
        typeof remainingMs === "function" && remainingMs() < STOP_MARGIN_MS,
      send: async ({ issueId, issueKey, period, account, facts }) => {
        const r = await deliver({
          db,
          enqueue,
          secret,
          kind,
          issueId,
          issueKey,
          period,
          // Which door a name opens for this reader, and their own rows.
          account: {
            ...account,
            ...(await readerDoors(db, account.accountId)),
          },
          facts,
          archive,
          force,
          now,
          cardArt,
        });
        if (r.sent) result.sent += 1;
        else if (r.reason === "already_sent") result.already_sent += 1;
        else result.skipped += 1;
        return r;
      },
    };
    if (isDigestEmailKind(kind)) await runDigest(run, recipients);
    else await runPerAccount(run, recipients);
    return result;
  } finally {
    result.ms = Date.now() - started;
    if (own) await db.end();
  }
}

/** The accounts already sent each subject's mail for a period:
 *  subject_key -> Set(account_id). One query, before any compose. */
async function sentForPeriod(db, kind, periodKey) {
  const { rows } = await db.query(
    `select i.subject_key, s.account_id
       from email_issue i join email_send s on s.issue_id = i.issue_id
      where i.kind = $1 and i.period_key = $2`,
    [kind, periodKey],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.subject_key)) out.set(r.subject_key, new Set());
    out.get(r.subject_key).add(r.account_id);
  }
  return out;
}

function stop(run, left) {
  run.result.incomplete = true;
  run.result.remaining += left;
}

function failed(run, who, err) {
  run.result.failed += 1;
  run.result.details.push({ ...who, error: err?.message });
  console.error(
    "email_compose_failed",
    run.kind,
    who.clan ?? who.account,
    err?.message,
  );
}

/** The weekly recap's day: Monday, right after the game's weekly reset
 *  (Jamie, 2026-11-13); its rule fires only then (infra/template.yaml,
 *  EmailTrackingReportRule), and a scheduled run on another UTC day
 *  sends nothing. */
const WEEKLY_RECAP_DAY = 1;
const DAY_MS = 86400_000;

/** Which digest a scheduled run may send now, and its period: the daily
 *  brief any day (the UTC date); the weekly recap on a Monday (the UTC
 *  date, as the digest keyed it before); the season recap only on the
 *  day a season starts (the season clock's first-Monday 10:00 UTC reset,
 *  @elixir-mcp/record/war-clock), keyed by the season it closes (`S136`).
 *  Its rule fires every Monday, so the other Mondays send nothing. An
 *  ops run (one account, or force) sends any day. */
export function digestSlot(kind, now, { scheduled }) {
  const day = now.toISOString().slice(0, 10);
  if (kind === "digest_season") {
    const { seasonStartMs } = seasonFromDate(now.getTime());
    const closed = seasonFromDate(seasonStartMs - 1);
    const rolledToday = now.getTime() - seasonStartMs < DAY_MS;
    return {
      due: !scheduled || rolledToday,
      periodKey: `S${closed.seasonId}`,
      season: closed.seasonId,
      seasonStartMs: closed.seasonStartMs,
    };
  }
  if (kind === "tracking_report")
    return {
      due: !scheduled || now.getUTCDay() === WEEKLY_RECAP_DAY,
      periodKey: day,
    };
  return { due: true, periodKey: day };
}

/** The folded kinds each recipient has off (clan_report, arena_week):
 *  inert as mail since 2026-11-12. Arena week's keeps the digest from
 *  telling more about alts than that mail did; the clan report's is the
 *  digest's clan part, which Settings › Emails turns on and off since
 *  2026-11-13 (`clan_part` on `PUT /api/me/email`). */
async function foldedOff(db, accountIds) {
  const { rows } = await db.query(
    `select account_id, kind from account_email_pref
      where kind in ('clan_report', 'arena_week') and not enabled
        and account_id = any($1::uuid[])`,
    [accountIds],
  );
  const off = new Map();
  for (const r of rows) {
    if (!off.has(r.account_id)) off.set(r.account_id, new Set());
    off.get(r.account_id).add(r.kind);
  }
  return (accountId) => {
    const kinds = off.get(accountId);
    return {
      clan: !kinds?.has("clan_report"),
      arena: !kinds?.has("arena_week"),
    };
  };
}

/** When each recipient last had a scheduled mail of this digest kind (a
 *  manual send, with its ~m suffix, never moves the window). Each kind
 *  keeps its own: a weekly recap never skips what a daily brief told. */
async function lastDigests(db, kind, accountIds) {
  const { rows } = await db.query(
    `select s.account_id, max(s.enqueued_at) as at
       from email_send s join email_issue i on i.issue_id = s.issue_id
      where i.kind = $1 and i.period_key not like '%~m%'
        and s.account_id = any($2::uuid[])
      group by s.account_id`,
    [kind, accountIds],
  );
  return new Map(rows.map((r) => [r.account_id, r.at]));
}

/** The three digests of the people you follow (#767; three kinds since
 *  2026-11-26): the daily brief, the weekly recap and the season recap,
 *  one issue per account per period (digestSlot). The recipients are
 *  the accounts with that kind on (loadRecipients, the kind's default
 *  for an absent row). Nothing to tell is no mail. */
async function runDigest(run, recipients) {
  const { db, kind, now, result } = run;
  const slot = digestSlot(kind, now, { scheduled: run.scheduled });
  if (!slot.due) {
    result.skipped += recipients.length;
    return;
  }
  const { periodKey } = slot;
  let todo = recipients;
  if (!run.force) {
    const sent = await sentForPeriod(db, kind, periodKey);
    const before = todo.length;
    todo = todo.filter((a) => !sent.get(a.accountId)?.has(a.accountId));
    result.already_sent += before - todo.length;
  }
  const lastSent = await lastDigests(
    db,
    kind,
    todo.map((a) => a.accountId),
  );
  const foldFor = await foldedOff(
    db,
    todo.map((a) => a.accountId),
  );
  for (let i = 0; i < todo.length; i++) {
    const account = todo[i];
    if (run.outOfTime()) {
      stop(run, todo.length - i);
      break;
    }
    try {
      const facts = await buildDigest({
        db,
        account,
        kind,
        window: digestWindow(
          now,
          kind,
          lastSent.get(account.accountId),
          slot.seasonStartMs ?? null,
        ),
        season: slot.season ?? null,
        fold: foldFor(account.accountId),
        posts: run.posts,
      });
      if (!facts) {
        result.skipped += 1;
        continue;
      }
      const subjectKey = account.accountId;
      const issueId = await upsertIssue(db, {
        kind,
        periodKey: periodKey + run.manual,
        subjectKey,
        facts,
        status: "queued",
      });
      result.composed += 1;
      await run.send({
        issueId,
        issueKey: `${kind}/${periodKey}/${subjectKey}`,
        period: periodKey,
        account,
        facts,
      });
    } catch (err) {
      failed(run, { account: account.accountId }, err);
    }
  }
}

/** The per-account weekly kind left beside the digest:
 *  collector_activity, one mail per collector owner. clan_report,
 *  arena_week and milestone folded into the digest on 2026-11-12 and
 *  are refused above, before any I/O. */
async function runPerAccount(run, recipients) {
  const { db, kind, now, result } = run;
  if (kind !== "collector_activity") throw new Error(`unknown kind ${kind}`);
  const week = lastCollectorWeek(now);
  // The ledger drops who already has this period's mail.
  let todo = recipients;
  if (!run.force) {
    const sent = await sentForPeriod(db, kind, week.key);
    todo = recipients.filter((a) => !sent.get(a.accountId)?.has(a.accountId));
    result.already_sent += recipients.length - todo.length;
  }
  for (let i = 0; i < todo.length; i++) {
    const account = todo[i];
    if (run.outOfTime()) {
      stop(run, todo.length - i);
      break;
    }
    try {
      const facts = await buildCollector({ db, account, week, now });
      if (!facts) {
        result.skipped += 1;
        continue;
      }
      const subjectKey = account.accountId;
      const issueId = await upsertIssue(db, {
        kind,
        periodKey: week.key + run.manual,
        subjectKey,
        facts,
        status: "queued",
      });
      result.composed += 1;
      await run.send({
        issueId,
        issueKey: `${kind}/${week.key}/${subjectKey}`,
        period: week.key,
        account,
        facts,
      });
    } catch (err) {
      failed(run, { account: account.accountId }, err);
    }
  }
}
