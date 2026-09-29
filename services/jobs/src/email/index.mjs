/** The product email job: one op per kind, idempotent by the ledger.
 *
 *  runEmail asks the ledger first which recipients (and clans) already
 *  have this period's mail, composes only for the rest (or one, with
 *  account_id + force: the manual path), hands each rendered mail to the
 *  relay through the outbox, and records the send after the hand-off.
 *  Re-running a period sends only what the ledger lacks and never
 *  recomposes an issue already sent; `force` is the manual path and
 *  skips that check. Every kind is bulk under the mail policy, so every
 *  message carries the signed one-click unsubscribe URL for its
 *  recipient and kind.
 *
 *  A run watches its own clock (review 2026-09-27 §6.7): with about 90 s
 *  of the Lambda's 900 left it stops taking recipients and says
 *  `incomplete`, and the handler fails the invocation so the async
 *  retry (EventInvokeConfig) carries on from where the ledger says it
 *  stopped, instead of every retry restarting from the oldest account
 *  and dying at the same place. */
import { createHash } from "node:crypto";
import pg from "pg";
import { emailHash } from "@elixir-mcp/auth/crypto";
import { loadRecipients, accountCtx, callTool } from "./ctx.mjs";
import { lastGameWeek, lastCollectorWeek } from "./week.mjs";
import { upsertIssue } from "@elixir-mcp/mail/ledger";
import { deliver } from "@elixir-mcp/mail/deliver";
import { buildArena } from "./build-arena.mjs";
import { buildTracking } from "./build-tracking.mjs";
import { buildClan } from "./build-clan.mjs";
import { buildCollector } from "./build-collector.mjs";
import { buildMilestone, recordMilestones } from "./build-milestone.mjs";
import { recordFeaturedSent } from "./card-of-week-select.mjs";
import { tryTool } from "./shared.mjs";

/** The milestone window: 26 hours back from the account's last look that
 *  finished cleanly (email_milestone_look, 0194), so a failed or skipped
 *  run leaves no gap (#130); never more than seven days back. With no
 *  look on record it is the 26 hours ending now. */
const MILESTONE_LOOKBACK_MS = 26 * 3600_000;
const MILESTONE_MAX_LOOKBACK_MS = 7 * 86400_000;

export function milestoneFromMs(now, lookedAt) {
  const nowMs = now.getTime();
  const anchor = lookedAt ? Math.min(lookedAt.getTime(), nowMs) : nowMs;
  return Math.max(
    anchor - MILESTONE_LOOKBACK_MS,
    nowMs - MILESTONE_MAX_LOOKBACK_MS,
  );
}

async function lastMilestoneLooks(db, accountIds) {
  const { rows } = await db.query(
    `select account_id, looked_at from email_milestone_look
      where account_id = any($1::uuid[])`,
    [accountIds],
  );
  return new Map(rows.map((r) => [r.account_id, r.looked_at]));
}

async function recordMilestoneLook(db, accountId, now) {
  await db.query(
    `insert into email_milestone_look (account_id, looked_at) values ($1, $2)
     on conflict (account_id) do update set looked_at = excluded.looked_at
       where email_milestone_look.looked_at < excluded.looked_at`,
    [accountId, now],
  );
}
/** Stop taking recipients with this much of the invocation left: the
 *  longest single compose is well under it. */
const STOP_MARGIN_MS = 90_000;
const SITE = "https://elixir.poapkings.com";
const WRITTEN = new Set(["top_100", "card_of_week"]);

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
  // () => ms left in this invocation (the Lambda context's
  // getRemainingTimeInMillis); null runs to the end.
  remainingMs = null,
}) {
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
          account,
          facts,
          archive,
          force,
          now,
        });
        if (r.sent) result.sent += 1;
        else if (r.reason === "already_sent") result.already_sent += 1;
        else result.skipped += 1;
        return r;
      },
    };
    if (WRITTEN.has(kind)) await runWritten(run, recipients);
    else {
      const season = await seasonOf(db, recipients[0], now);
      if (kind === "clan_report") await runClans(run, recipients, season);
      else await runPerAccount(run, recipients, season);
    }
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

/** clan_report: one issue per clan, composed once for everyone tracking
 *  it (build-clan.mjs is reader-invariant), each reader's days named in
 *  their own zone by the render. */
async function runClans(run, recipients, season) {
  const { db, kind, result } = run;
  const week = lastGameWeek(run.now);
  const { rows } = await db.query(
    `select clan_tag, account_id from account_clan
      where account_id = any($1::uuid[]) order by clan_tag`,
    [recipients.map((r) => r.accountId)],
  );
  const trackers = new Map();
  for (const r of rows) {
    if (!trackers.has(r.clan_tag)) trackers.set(r.clan_tag, new Set());
    trackers.get(r.clan_tag).add(r.account_id);
  }
  const sent = run.force ? new Map() : await sentForPeriod(db, kind, week.key);
  const clans = [...trackers].map(([clanTag, who]) => {
    // Recipients' order (oldest account first), as before.
    const members = recipients.filter((r) => who.has(r.accountId));
    const done = sent.get(clanTag) ?? new Set();
    return {
      clanTag,
      members,
      todo: members.filter((m) => !done.has(m.accountId)),
      anySent: done.size > 0,
    };
  });
  for (const c of clans)
    result.already_sent += c.members.length - c.todo.length;
  const queue = clans.filter((c) => c.todo.length > 0);
  for (let i = 0; i < queue.length; i++) {
    const { clanTag, members, todo, anySent } = queue[i];
    if (run.outOfTime()) {
      stop(
        run,
        queue.slice(i).reduce((n, c) => n + c.todo.length, 0),
      );
      break;
    }
    try {
      const periodKey = week.key + run.manual;
      // An issue some trackers already have is the issue the rest get:
      // it is never recomposed or overwritten.
      let issueId = null;
      let facts = null;
      if (anySent) {
        const { rows: had } = await db.query(
          `select issue_id, facts from email_issue
            where kind = $1 and period_key = $2 and subject_key = $3 and facts is not null`,
          [kind, periodKey, clanTag],
        );
        issueId = had[0]?.issue_id ?? null;
        facts = had[0]?.facts ?? null;
      }
      if (!facts) {
        facts = await buildClan({
          db,
          account: members[0],
          clanTag,
          week,
          season,
        });
        if (!facts) {
          result.skipped += todo.length;
          continue;
        }
        issueId = await upsertIssue(db, {
          kind,
          periodKey,
          subjectKey: clanTag,
          facts,
          status: "queued",
        });
        result.composed += 1;
      }
      for (const account of todo)
        await run.send({
          issueId,
          issueKey: `${kind}/${week.key}/${clanTag}`,
          period: week.key,
          account,
          facts,
        });
    } catch (err) {
      failed(run, { clan: clanTag }, err);
    }
  }
}

/** A stable key for a set of moments: the mail's identity is what it
 *  congratulates, so two moments on one UTC day are two mails, and the
 *  same moments re-composed by a retry are the same mail. */
export function milestonePeriodKey(now, moments) {
  const ids = moments
    .map((m) => `${m.subject_tag}|${m.kind}|${m.key}`)
    .sort()
    .join("\n");
  const hash = createHash("sha256").update(ids).digest("hex").slice(0, 10);
  return `${now.toISOString().slice(0, 10)}.${hash}`;
}

/** The per-account kinds: arena_week, tracking_report,
 *  collector_activity and milestone. */
async function runPerAccount(run, recipients, season) {
  const { db, kind, now, result } = run;
  const weekOf = {
    arena_week: () => lastGameWeek(now),
    tracking_report: () => lastGameWeek(now),
    collector_activity: () => lastCollectorWeek(now),
  }[kind];
  if (!weekOf && kind !== "milestone") throw new Error(`unknown kind ${kind}`);
  const week = weekOf ? weekOf() : null;
  // The weekly kinds know their period before composing, so the ledger
  // drops who already has it; the milestone's period is its moments.
  let todo = recipients;
  if (week && !run.force) {
    const sent = await sentForPeriod(db, kind, week.key);
    todo = recipients.filter((a) => !sent.get(a.accountId)?.has(a.accountId));
    result.already_sent += recipients.length - todo.length;
  }
  const looks =
    kind === "milestone"
      ? await lastMilestoneLooks(
          db,
          todo.map((a) => a.accountId),
        )
      : null;
  // A look that finished cleanly moves the account's window; a forced
  // (ops) send never does, and neither does a failure or a stop.
  const looked = async (account) => {
    if (kind === "milestone" && !run.force)
      await recordMilestoneLook(db, account.accountId, now);
  };
  for (let i = 0; i < todo.length; i++) {
    const account = todo[i];
    if (run.outOfTime()) {
      stop(run, todo.length - i);
      break;
    }
    try {
      let facts = null;
      let periodKey = week?.key ?? null;
      // The campaign period on links and the pixel: the date for a
      // milestone, never the per-mail key.
      let period = periodKey;
      if (kind === "arena_week")
        facts = await buildArena({ db, account, week, season });
      else if (kind === "tracking_report")
        facts = await buildTracking({ db, account, week, season });
      else if (kind === "collector_activity")
        facts = await buildCollector({ db, account, week });
      else {
        facts = await buildMilestone({
          db,
          account,
          fromMs: milestoneFromMs(now, looks.get(account.accountId)),
          toMs: now.getTime(),
        });
        if (facts) {
          periodKey = milestonePeriodKey(now, facts._moments ?? []);
          period = now.toISOString().slice(0, 10);
        }
      }
      if (!facts) {
        result.skipped += 1;
        await looked(account);
        continue;
      }
      const subjectKey = account.accountId;
      const { _moments, ...stored } = facts;
      if (kind === "milestone" && !run.force) {
        const sent = await sentForPeriod(db, kind, periodKey);
        if (sent.get(subjectKey)?.has(account.accountId)) {
          // Sent, but its moments were not recorded (the run died
          // between the two): record them now so the next pass is quiet.
          await recordMilestones(db, account.accountId, _moments ?? []);
          result.already_sent += 1;
          await looked(account);
          continue;
        }
      }
      const issueId = await upsertIssue(db, {
        kind,
        periodKey: periodKey + run.manual,
        subjectKey,
        facts: stored,
        status: "queued",
      });
      result.composed += 1;
      const r = await run.send({
        issueId,
        issueKey: `${kind}/${periodKey}/${subjectKey}`,
        period,
        account,
        facts,
      });
      if (kind === "milestone" && r.sent)
        await recordMilestones(db, account.accountId, _moments ?? []);
      if (r.sent || r.reason === "already_sent") await looked(account);
    } catch (err) {
      failed(run, { account: account.accountId }, err);
    }
  }
}

/** The period a scheduled send of a WRITTEN kind is for: the Top 100
 *  goes out on the Thursday its board was read, Card of the Week on the
 *  Friday after the game week it covers. */
function expectedWrittenPeriod(kind, now) {
  return kind === "top_100"
    ? now.toISOString().slice(0, 10)
    : lastGameWeek(now).key;
}

/** The scheduled send slot of each WRITTEN kind: UTC weekday and hour,
 *  the EventBridge crons in infra/template.yaml (EmailTop100Rule,
 *  EmailCardOfWeekRule; a test pins them together). */
export const WRITTEN_SEND_SLOT = {
  top_100: { day: 4, hour: 14 },
  card_of_week: { day: 5, hour: 14 },
};

/** Whether an issue accepted now for `period` has missed its scheduled
 *  send (review 2026-09-27 §6.7): the kind's slot has passed and that
 *  slot's send was for this very period, which is still the period a
 *  send now would take. An accept before the slot is left to the
 *  schedule; an accept for an older period, or one landing after the
 *  period has moved on, never sends on its own. */
export function writtenSendDue(kind, period, now = new Date()) {
  const slot = WRITTEN_SEND_SLOT[kind];
  if (!slot || !period) return false;
  const at = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      slot.hour,
    ),
  );
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() - slot.day + 7) % 7));
  if (at > now) at.setUTCDate(at.getUTCDate() - 7);
  return (
    expectedWrittenPeriod(kind, at) === period &&
    expectedWrittenPeriod(kind, now) === period
  );
}

/** The accepted issue for a WRITTEN kind's period (the editor pipeline
 *  wrote its facts); null when there is none. An issue that failed its
 *  lint has no facts and is never picked up here, which is how a
 *  failing issue does not send. With no period (the operator's forced
 *  send), the newest accepted issue. */
async function writtenIssue(db, kind, periodKey) {
  const { rows } = await db.query(
    `select issue_id, period_key, facts from email_issue
      where kind = $1 and subject_key = '' and facts is not null
        and ($2::text is null or period_key = $2)
      order by composed_at desc limit 1`,
    [kind, periodKey],
  );
  return rows[0] ?? null;
}

/** top_100 and card_of_week: ONE issue for everyone, tied to its period
 *  (review 2026-09-27 §6.7). Last week's issue is never sent as this
 *  week's: with no accepted issue for the period, nothing sends and the
 *  owner hears so. The send leaves the issue row as the pipeline wrote
 *  it (its status and its `issue <key>` note). */
async function runWritten(run, recipients) {
  const { db, kind, now, result } = run;
  const expected = expectedWrittenPeriod(kind, now);
  const issue = await writtenIssue(db, kind, run.force ? null : expected);
  if (!issue) {
    result.skipped += recipients.length;
    result.details.push({ no_issue: expected });
    if (run.scheduled && run.enqueue)
      await run.enqueue({
        v: 1,
        kind: "owner_notify",
        to: process.env.OWNER_NOTIFY_EMAIL || "elixir@poapkings.com",
        note: `${kind} ${expected}: no accepted issue at send time, so nothing was sent. The period's row in email_issue says why (failed lint, or the editor has not answered).`,
        link: `${SITE}/console/admin`,
      });
    return;
  }
  const periodKey = issue.period_key;
  let issueId = issue.issue_id;
  let todo = recipients;
  if (run.force)
    // The manual path records its sends on a row of its own.
    issueId = await upsertIssue(db, {
      kind,
      periodKey: periodKey + run.manual,
      subjectKey: "",
      status: "queued",
    });
  else {
    const sent = (await sentForPeriod(db, kind, periodKey)).get("");
    todo = recipients.filter((a) => !sent?.has(a.accountId));
    result.already_sent += recipients.length - todo.length;
  }
  result.composed = 1;
  let anySent = false;
  for (let i = 0; i < todo.length; i++) {
    const account = todo[i];
    if (run.outOfTime()) {
      stop(run, todo.length - i);
      break;
    }
    try {
      const r = await run.send({
        issueId,
        issueKey: `${kind}/${periodKey}/all`,
        period: periodKey,
        account,
        facts: issue.facts,
      });
      anySent ||= r.sent;
    } catch (err) {
      failed(run, { account: account.accountId }, err);
    }
  }
  // The card is consumed by a SEND, never by a selection: a dry run or
  // an issue that failed its verifier leaves it eligible.
  if (kind === "card_of_week" && anySent)
    await recordFeaturedSent(db, { periodKey, at: now });
}

async function seasonOf(db, account, now) {
  const clock = await tryTool(callTool, accountCtx(db, account), "game_clock", {
    at: now.toISOString(),
  });
  return clock?.season_id ?? null;
}
