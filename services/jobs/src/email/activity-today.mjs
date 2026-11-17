/** activity_today (2026-11-16): the activity mail, "Cheers on your play".
 *
 *  Jamie, 2026-11-16: "we need a way to let members know about activity on
 *  their games without them logging in… if the email they get normally is
 *  weekly, would we send something operational about engagement on their
 *  posts today." Cheers on your own players' items and new followers of
 *  them that you have not seen in Elixir, counted, never who. Event mail
 *  in the family of Clan's actions mail, apart from the digest: at most one
 *  a day, in the evening of the person's own zone, and only when there is
 *  something.
 *
 *  What it says is the bell's own read (@elixir-mcp/tools/activity/bell,
 *  readAwayActivity) with `since` set to what the person has been told
 *  already: the later of their last look at the bell, their last activity
 *  mail and a day ago (and, with web push, the notices they opened). The
 *  SQL here only finds whom to ask: accounts whose own verified players
 *  had cheers (0280's subject tags) or new followers in the last day.
 *
 *  An hourly rule runs it; each run mails the accounts whose local hour is
 *  ACTIVITY_HOUR. The ledger's issue is the person's local day, so a retry
 *  or a second run in the hour sends nothing twice. */
import { openJobsClient } from "../db.mjs";
import { upsertIssue } from "@elixir-mcp/mail/ledger";
import { deliver } from "@elixir-mcp/mail/deliver";
import { readAwayActivity } from "@elixir-mcp/tools/activity/bell";
import { emailKindDefault } from "@elixir-mcp/contracts";

export const ACTIVITY_KIND = "activity_today";
/** The local hour the mail goes in: the evening, after a day's play. */
export const ACTIVITY_HOUR = 18;
/** The furthest back a mail looks: one day. */
const DAY_MS = 86_400_000;
/** Lines one mail lists; the rest are counted in the subject. */
const LINE_CAP = 10;

/** The hour and date in a zone; UTC when the zone is not one. */
export function localClock(timezone, now) {
  const fmt = (tz) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  let parts;
  try {
    parts = fmt(timezone || "UTC");
  } catch {
    parts = fmt("UTC");
  }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    hour: Number(get("hour")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Person accounts with the mail on whose own verified players had a
 *  cheer from someone else, or a new follower, since `from`. */
async function candidates(db, { from, accountId }) {
  const { rows } = await db.query(
    `with own as (
       select c.account_id, c.player_tag from claim c
        where c.status = 'verified'
          and (c.is_primary or c.relationship in ('primary', 'alt'))
     ), touched as (
       select o.account_id from timeline_cheer t
         join own o on o.player_tag = any(t.subject_tags)
                   and o.account_id <> t.account_id
        where t.updated_at > $1
       union
       select o.account_id from claim f
         join own o on o.player_tag = f.player_tag
                   and o.account_id <> f.account_id
         join account fa on fa.account_id = f.account_id
        where f.relationship = 'friend' and f.created_at > $1
          and coalesce(fa.kind, 'person') = 'person'
     )
     select a.account_id, a.email, a.timezone,
            greatest(
              (select seen_at from bell_seen b where b.account_id = a.account_id),
              (select max(s.enqueued_at) from email_send s
                 join email_issue i on i.issue_id = s.issue_id
                where s.account_id = a.account_id and i.kind = $2)
            ) as told_at
       from account a
      where a.account_id in (select account_id from touched)
        and a.kind = 'person' and a.status = 'approved' and a.email is not null
        and ($4::uuid is null or a.account_id = $4)
        and coalesce((select p.enabled from account_email_pref p
                       where p.account_id = a.account_id and p.kind = $2),
                     $3::boolean)
      order by a.created_at`,
    [from, ACTIVITY_KIND, emailKindDefault(ACTIVITY_KIND), accountId],
  );
  return rows;
}

/** The mail's facts from the bell's read: counts and the items' own
 *  lines, never who. */
export function activityFacts(activity) {
  const cheers = activity.cheers.slice(0, LINE_CAP);
  const followers = activity.followers.slice(0, LINE_CAP);
  return {
    cheers: cheers.map((i) => ({
      item_id: i.item_id,
      text: i.text,
      at: i.at,
      battle_url: i.battle_url,
      subject_tag: i.subject_tag,
      fresh: i.fresh,
      total: i.total,
    })),
    followers: followers.map((p) => ({
      tag: p.tag,
      name: p.name,
      count: p.count,
    })),
    // What the lines leave out still counts in the subject.
    more_cheers: activity.cheers
      .slice(LINE_CAP)
      .reduce((s, i) => s + i.fresh, 0),
  };
}

export async function runActivityMail({
  databaseUrl,
  db = null,
  enqueue,
  secret,
  archive = null,
  now = new Date(),
  hour = ACTIVITY_HOUR,
  accountId = null,
  // (accountId) => {cheers, followers}: through when a push the person
  // opened told each, or null (web push, 2026-11-16). Null reads none.
  pushToldAt = null,
  remainingMs = null,
}) {
  const own = !db;
  if (own) db = await openJobsClient(databaseUrl, { op: "activity_mail" });
  const result = { candidates: 0, due: 0, sent: 0, skipped: 0, details: [] };
  try {
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const rows = await candidates(db, { from: dayAgo, accountId });
    result.candidates = rows.length;
    for (const r of rows) {
      const clock = localClock(r.timezone, now);
      if (clock.hour !== hour) continue;
      result.due++;
      // Out of time: the rest are this hour's too, so the run says it
      // stopped short and dispatch throws for the async retry, which
      // starts again here; told_at skips whoever was just mailed (Codex
      // on #1071).
      if (remainingMs && remainingMs() < 90_000) {
        result.incomplete = true;
        result.remaining = (result.remaining ?? 0) + 1;
        continue;
      }
      const pushed = pushToldAt ? await pushToldAt(r.account_id) : null;
      const after = (extra) =>
        new Date(
          Math.max(
            dayAgo.getTime(),
            r.told_at ? new Date(r.told_at).getTime() : 0,
            extra ? new Date(extra).getTime() : 0,
          ),
        );
      const activity = await readAwayActivity(db, r.account_id, {
        since: after(pushed?.cheers),
        followersSince: after(pushed?.followers),
      });
      if (activity.cheers.length === 0 && activity.followers.length === 0) {
        result.skipped++;
        result.details.push({ skipped: "nothing_new" });
        continue;
      }
      const facts = activityFacts(activity);
      const issueKey = `${ACTIVITY_KIND}/${clock.date}/${r.account_id}`;
      const issueId = await upsertIssue(db, {
        kind: ACTIVITY_KIND,
        periodKey: clock.date,
        subjectKey: String(r.account_id),
        facts,
      });
      const sent = await deliver({
        db,
        enqueue,
        secret,
        archive,
        kind: ACTIVITY_KIND,
        issueId,
        issueKey,
        period: clock.date,
        account: {
          accountId: r.account_id,
          email: r.email,
          timezone: r.timezone,
        },
        facts,
        now,
      });
      if (sent.sent) {
        result.sent++;
        // Counts and the send id; never an address or a name.
        result.details.push({
          send_id: sent.send_id,
          cheers: facts.cheers.length,
          followers: facts.followers.length,
        });
      } else {
        result.skipped++;
        result.details.push({ skipped: sent.reason });
      }
    }
    return result;
  } finally {
    if (own) await db.end();
  }
}
