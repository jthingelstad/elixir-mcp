import { isRetiredEmailKind } from "@elixir-mcp/contracts";
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
 *  of the Lambda's 900 left it stops taking recipients and says
 *  `incomplete`, and the handler fails the invocation so the async
 *  retry (EventInvokeConfig) carries on from where the ledger says it
 *  stopped, instead of every retry restarting from the oldest account
 *  and dying at the same place. */
import pg from "pg";
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
  // () => ms left in this invocation (the Lambda context's
  // getRemainingTimeInMillis); null runs to the end.
  remainingMs = null,
}) {
  if (isRetiredEmailKind(kind)) return { kind, skipped: "retired", sent: 0 };
  const started = Date.now();
  const own = !db;
  if (own) {
    db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
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
    if (kind === "tracking_report") await runDigest(run, recipients);
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

/** The digest's own day: Wednesday, the friends mail's day, kept for
 *  the weekly default; a daily reader gets one every day. The rule
 *  fires daily (infra/template.yaml, EmailTrackingReportRule) and a
 *  scheduled run takes the weekly readers only on this UTC weekday. */
const DIGEST_WEEKLY_DAY = 3;

/** Each recipient's digest cadence (0242): absent or null is weekly. */
async function digestCadences(db, accountIds) {
  const { rows } = await db.query(
    `select account_id, cadence from account_email_pref
      where kind = 'tracking_report' and account_id = any($1::uuid[])
        and cadence is not null`,
    [accountIds],
  );
  return new Map(rows.map((r) => [r.account_id, r.cadence]));
}

/** The folded kinds each recipient had turned off (clan_report,
 *  arena_week): their stored switches, inert as mail since 2026-11-12,
 *  still keep the digest from telling more than those mails did. */
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

/** When each recipient last had a scheduled digest (a manual send, with
 *  its ~m suffix, never moves the window). */
async function lastDigests(db, accountIds) {
  const { rows } = await db.query(
    `select s.account_id, max(s.enqueued_at) as at
       from email_send s join email_issue i on i.issue_id = s.issue_id
      where i.kind = 'tracking_report' and i.period_key not like '%~m%'
        and s.account_id = any($1::uuid[])
      group by s.account_id`,
    [accountIds],
  );
  return new Map(rows.map((r) => [r.account_id, r.at]));
}

/** tracking_report, the digest of the people you follow (#767): one
 *  issue per account per UTC day, the day its period. A scheduled run
 *  takes the daily readers every day and the weekly ones on Wednesday;
 *  an ops run (one account, or force) sends whatever the reader's
 *  cadence covers, any day. Nothing to tell is no mail. */
async function runDigest(run, recipients) {
  const { db, kind, now, result } = run;
  const periodKey = now.toISOString().slice(0, 10);
  const ids = recipients.map((a) => a.accountId);
  const cadences = await digestCadences(db, ids);
  const cadenceOf = (a) => cadences.get(a.accountId) ?? "weekly";
  let todo = recipients;
  if (run.scheduled && now.getUTCDay() !== DIGEST_WEEKLY_DAY) {
    todo = todo.filter((a) => cadenceOf(a) === "daily");
    result.skipped += recipients.length - todo.length;
  }
  if (!run.force) {
    const sent = await sentForPeriod(db, kind, periodKey);
    const before = todo.length;
    todo = todo.filter((a) => !sent.get(a.accountId)?.has(a.accountId));
    result.already_sent += before - todo.length;
  }
  const lastSent = await lastDigests(
    db,
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
      const cadence = cadenceOf(account);
      const facts = await buildDigest({
        db,
        account,
        cadence,
        window: digestWindow(now, cadence, lastSent.get(account.accountId)),
        fold: foldFor(account.accountId),
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
