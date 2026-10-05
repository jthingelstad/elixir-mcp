import { isRetiredEmailKind } from "@elixir-mcp/contracts";
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
    {
      // Weekly mail describes the completed period, not the send-time season.
      // The Monday boundary belongs to the next week/season on game_clock.
      const seasonAt = [
        "clan_report",
        "arena_week",
        "tracking_report",
      ].includes(kind)
        ? new Date(lastGameWeek(now).to.getTime() - 1)
        : now;
      const season = await seasonOf(db, recipients[0], seasonAt);
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
  // Each reader's own players (primary and alts): the report is the
  // clan's, but the render marks the reader's own rows "you".
  const { rows: claims } = await db.query(
    `select account_id, player_tag from claim
      where account_id = any($1::uuid[]) and (is_primary or relationship = 'alt')`,
    [recipients.map((r) => r.accountId)],
  );
  const tagsOf = new Map();
  for (const r of claims)
    tagsOf.set(r.account_id, [
      ...(tagsOf.get(r.account_id) ?? []),
      r.player_tag,
    ]);
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
          account: { ...account, tags: tagsOf.get(account.accountId) ?? [] },
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
        facts = await buildCollector({ db, account, week, now });
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

async function seasonOf(db, account, now) {
  const clock = await tryTool(callTool, accountCtx(db, account), "game_clock", {
    at: now.toISOString(),
  });
  return clock?.season_id ?? null;
}
