/** feedback_answer (0204; Jamie, 2026-10-08): one mail per answer the
 *  maintainer writes, to the person who filed the item, from any part of
 *  Elixir. The answer is mailed only when it has settled (a few minutes,
 *  so a typo fixed straight away is one mail) and the filer has not
 *  already read it where they filed it.
 *
 *  The journal is the item itself: response_mailed_at is the responded_at
 *  whose answer this drain has handled, sent or skipped. A revised answer
 *  moves responded_at and is owed a mail again. Each answer is its own
 *  issue (the item and the instant it was answered), so a retry after an
 *  enqueue that was not marked finds it already sent and only marks it.
 *  The jobs function has concurrency one. */
import pg from "pg";
import { upsertIssue } from "@elixir-mcp/mail/ledger";
import { deliver } from "@elixir-mcp/mail/deliver";

const SITE = "https://elixir.poapkings.com";
const SETTLE_MINUTES = 10;

export async function runFeedbackAnswers({
  databaseUrl,
  db = null,
  enqueue,
  secret,
  archive = null,
  settleMinutes = SETTLE_MINUTES,
  remainingMs = null,
}) {
  const own = !db;
  if (own) {
    db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
  }
  const result = { sent: 0, skipped: 0, details: [] };
  try {
    const { rows } = await db.query(
      `select f.feedback_id, f.account_id, f.area, f.category, f.status,
              f.message, f.created_at, f.response, f.responded_at,
              f.responded_at::text as responded_at_exact,
              f.response_seen_at, f.shipped_in,
              a.email, a.timezone, a.kind, a.status as account_status, a.is_owner,
              not exists (select 1 from account_email_pref p
                           where p.account_id = f.account_id
                             and p.kind = 'feedback_answer' and not p.enabled) as enabled
         from feedback f join account a on a.account_id = f.account_id
        where f.responded_at is not null
          and f.responded_at is distinct from f.response_mailed_at
          and f.responded_at < now() - make_interval(mins => $1)
        order by f.responded_at, f.feedback_id limit 100`,
      [settleMinutes],
    );
    for (const f of rows) {
      if (remainingMs && remainingMs() < 90_000) break;
      let outcome = "skipped";
      if (
        f.response_seen_at === null &&
        String(f.response ?? "").trim() &&
        f.enabled &&
        f.email &&
        f.kind === "person" &&
        f.account_status === "approved" &&
        !f.is_owner
      ) {
        const answeredAt = f.responded_at.toISOString();
        const facts = {
          feedback_id: String(f.feedback_id),
          area: f.area,
          category: f.category,
          status: f.status,
          message: String(f.message ?? "").slice(0, 600),
          filed_at: f.created_at.toISOString(),
          response: f.response,
          answered_at: answeredAt,
          shipped_in: f.shipped_in ?? null,
          link: `${SITE}/console/account/feedback/${f.feedback_id}`,
        };
        const issueKey = `feedback-answer/${f.feedback_id}/${answeredAt}`;
        const issueId = await upsertIssue(db, {
          kind: "feedback_answer",
          periodKey: issueKey,
          subjectKey: String(f.feedback_id),
          facts,
        });
        const sent = await deliver({
          db,
          enqueue,
          secret,
          archive,
          kind: "feedback_answer",
          issueId,
          issueKey,
          period: answeredAt.slice(0, 10),
          account: {
            accountId: f.account_id,
            email: f.email,
            timezone: f.timezone,
          },
          facts,
        });
        outcome = sent.sent ? "queued" : sent.reason;
        if (sent.sent) {
          result.sent++;
          result.details.push({
            feedback_id: String(f.feedback_id),
            send_id: sent.send_id,
          });
        }
      }
      if (outcome !== "queued") result.skipped++;
      // Only the answer this run read: one revised meanwhile stays owed.
      // Compared as the database's text, never a JS Date: a Date drops
      // the microseconds and would match nothing.
      await db.query(
        `update feedback set response_mailed_at = responded_at
          where feedback_id = $1 and responded_at = $2::timestamptz`,
        [f.feedback_id, f.responded_at_exact],
      );
    }
    return result;
  } finally {
    if (own) await db.end();
  }
}
