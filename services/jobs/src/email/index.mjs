/** The product email job: one op per kind, idempotent by the ledger.
 *
 *  runEmail composes for every eligible recipient (or one, for the
 *  account page's "send me this now"), enqueues each rendered mail on
 *  the email queue the relay drains, and records the send after the
 *  enqueue. Re-running a period sends only what the ledger lacks;
 *  `force` is the manual path and skips that check. Every kind is
 *  bulk under the mail policy, so every message carries the signed
 *  one-click unsubscribe URL for its recipient and kind. */
import pg from "pg";
import { emailHash } from "../../../auth/src/crypto.mjs";
import { loadRecipients, accountCtx, callTool } from "./ctx.mjs";
import { lastGameWeek, lastCollectorWeek } from "./week.mjs";
import { upsertIssue } from "./ledger.mjs";
import { deliver } from "./deliver.mjs";
import { buildArena } from "./build-arena.mjs";
import { buildTracking } from "./build-tracking.mjs";
import { buildClan } from "./build-clan.mjs";
import { buildCollector } from "./build-collector.mjs";
import { buildMilestone, recordMilestones } from "./build-milestone.mjs";
import { recordFeaturedSent } from "./card-of-week-select.mjs";
import { tryTool } from "./shared.mjs";

const MILESTONE_LOOKBACK_MS = 26 * 3600_000;

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
}) {
  const own = !db;
  if (own) {
    db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
  }
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
    const result = {
      kind,
      recipients: recipients.length,
      composed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };
    if (recipients.length === 0) return result;
    const season = await seasonOf(db, recipients[0], now);
    const manual = force ? `~m${now.getTime()}` : "";
    const send = async ({ issueId, issueKey, period, account, facts }) => {
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
      else result.skipped += 1;
      return r;
    };
    if (kind === "clan_report") {
      const week = lastGameWeek(now);
      const { rows: clans } = await db.query(
        `select distinct ac.clan_tag from account_clan ac where ac.account_id = any($1::uuid[]) order by ac.clan_tag`,
        [recipients.map((r) => r.accountId)],
      );
      for (const { clan_tag } of clans) {
        const { rows: who } = await db.query(
          `select account_id from account_clan where clan_tag = $1`,
          [clan_tag],
        );
        const members = recipients.filter((r) =>
          who.some((w) => w.account_id === r.accountId),
        );
        if (members.length === 0) continue;
        try {
          const facts = await buildClan({
            db,
            account: members[0],
            clanTag: clan_tag,
            week,
            season,
          });
          if (!facts) {
            result.skipped += members.length;
            continue;
          }
          const issueId = await upsertIssue(db, {
            kind,
            periodKey: week.key + manual,
            subjectKey: clan_tag,
            facts,
            status: "queued",
          });
          result.composed += 1;
          for (const account of members)
            await send({
              issueId,
              issueKey: `${kind}/${week.key}/${clan_tag}`,
              period: week.key,
              account,
              facts,
            });
        } catch (err) {
          result.failed += 1;
          result.details.push({ clan: clan_tag, error: err?.message });
          console.error("email_compose_failed", kind, clan_tag, err?.message);
        }
      }
      return result;
    }
    for (const account of recipients) {
      try {
        let facts = null;
        let week = null;
        let periodKey = null;
        if (kind === "arena_week") {
          week = lastGameWeek(now);
          facts = await buildArena({ db, account, week, season });
          periodKey = week.key;
        } else if (kind === "tracking_report") {
          week = lastGameWeek(now);
          facts = await buildTracking({ db, account, week, season });
          periodKey = week.key;
        } else if (kind === "collector_activity") {
          week = lastCollectorWeek(now);
          facts = await buildCollector({ db, account, week });
          periodKey = week.key;
        } else if (kind === "milestone") {
          const fromMs = now.getTime() - MILESTONE_LOOKBACK_MS;
          facts = await buildMilestone({
            db,
            account,
            fromMs,
            toMs: now.getTime(),
          });
          periodKey = now.toISOString().slice(0, 10);
        } else if (kind === "top_100") {
          facts = await latestWritten(db, "top_100");
          periodKey = facts?.issue?.date ?? now.toISOString().slice(0, 10);
        } else if (kind === "card_of_week") {
          facts = await latestWritten(db, "card_of_week");
          periodKey = facts?.issue?.date ?? lastGameWeek(now).key;
        } else {
          throw new Error(`unknown kind ${kind}`);
        }
        if (!facts) {
          result.skipped += 1;
          continue;
        }
        // A written kind is ONE issue for everyone, so it has no
        // per-account subject key.
        const written = kind === "top_100" || kind === "card_of_week";
        const subjectKey = written ? "" : account.accountId;
        const { _moments, ...stored } = facts;
        const issueId = await upsertIssue(db, {
          kind,
          periodKey: periodKey + manual,
          subjectKey,
          facts: written ? null : stored,
          status: "queued",
        });
        result.composed += 1;
        const r = await send({
          issueId,
          issueKey: `${kind}/${periodKey}/${subjectKey || "all"}`,
          period: periodKey,
          account,
          facts,
        });
        if (kind === "milestone" && r.sent)
          await recordMilestones(db, account.accountId, _moments ?? []);
        // The card is consumed by a SEND, never by a selection: a dry
        // run or an issue that failed its verifier leaves it eligible.
        if (kind === "card_of_week" && r.sent)
          await recordFeaturedSent(db, { periodKey, at: now });
      } catch (err) {
        result.failed += 1;
        result.details.push({
          account: account.accountId,
          error: err?.message,
        });
        console.error(
          "email_compose_failed",
          kind,
          account.accountId,
          err?.message,
        );
      }
    }
    return result;
  } finally {
    if (own) await db.end();
  }
}

async function seasonOf(db, account, now) {
  const clock = await tryTool(callTool, accountCtx(db, account), "game_clock", {
    at: now.toISOString(),
  });
  return clock?.season_id ?? null;
}

/** The newest composed issue's facts for a WRITTEN kind (the editor
 *  pipeline wrote them); null when there is none to send. An issue that
 *  failed its lint has no facts and is therefore never picked up here,
 *  which is how a failing issue does not send. */
async function latestWritten(db, kind) {
  const { rows } = await db.query(
    `select facts from email_issue where kind = $1 and subject_key = '' and facts is not null
      order by composed_at desc limit 1`,
    [kind],
  );
  return rows[0]?.facts ?? null;
}
