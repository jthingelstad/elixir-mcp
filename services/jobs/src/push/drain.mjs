/** Web push's drain (2026-11-16, docs/notes/2026-11-16-web-push.md).
 *
 *  Jamie, 2026-11-16: "should we be sending push notifications via the
 *  web?" Every minute, for each person with a device turned on, this reads
 *  what the bell would show them that they have not been told (the bell's
 *  own read, @elixir-mcp/tools/activity/bell), coalesces it into at most
 *  one notice, records it, and writes one web-push/ object per device for
 *  the relay to send. Counts, never who.
 *
 *  Kinds, in the order one run picks them: a Clan Action that became
 *  yours (owed by Clan's morning run), an answer to your feedback, cheers
 *  on your own players' items, new followers of them, then a close
 *  friend's play (2026-11-17, close-friends.mjs). Each has its own switch
 *  (no row is on).
 *
 *  Caps: a notice at most every MIN_GAP_MS per account and DAILY_CAP a
 *  day, close friends' play at most CLOSE_DAILY_CAP of those; cheers
 *  wait until SETTLE_MS after the latest, so a burst is one "5 cheers"
 *  rather than five pushes. Each kind starts where the last
 *  notice of it, the last look at the bell, the first device or a day ago
 *  left off, whichever is latest. */
import { openJobsClient } from "../db.mjs";
import {
  clipText,
  readAnswers,
  readAwayActivity,
} from "@elixir-mcp/tools/activity/bell";
import {
  closeStillWanted,
  CLOSE_DAILY_CAP,
  CLOSE_KIND,
  closeCandidates,
  pickClose,
} from "./close-friends.mjs";

export const MIN_GAP_MS = 10 * 60_000;
export const DAILY_CAP = 8;
export const SETTLE_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
const SITE = "https://elixir.poapkings.com";
/** The feed (2026-11-17; `/home` forwards there for a notice already sent). */
const TIMELINE = "/timeline";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tagPath = (tag) =>
  encodeURIComponent(String(tag ?? "").replace(/^#/, ""));

/** A session's own page, as the bell's read stored it (session-story's
 *  sessionPathOf), or null: never any other path. */
function sessionPathOk(path) {
  return typeof path === "string" &&
    /^\/home\/player\/[^/?#]+\/session\/[^/?#]+(\?[^#]*)?$/.test(path)
    ? path
    : null;
}

/** A battle on Elixir's own origin opens as its path; anything else is
 *  not a link a notice may carry. */
function battlePath(url) {
  const s = String(url ?? "");
  if (!s.startsWith(`${SITE}/battle/`)) return null;
  return s.slice(SITE.length);
}

/** The cheers notice: one item names it, several count them. One item opens
 *  where its bell row does: a session its own page (2026-11-16), else the
 *  battle, else the player; several open the Timeline. */
export function cheersNotice(cheers) {
  const total = cheers.reduce((s, i) => s + i.fresh, 0);
  if (total === 0) return null;
  const title = `${plural(total, "cheer")} on your play`;
  if (cheers.length === 1) {
    const [i] = cheers;
    return {
      title,
      body: clipText(i.text, 120),
      url:
        sessionPathOk(i.session_path) ??
        battlePath(i.battle_url) ??
        (i.subject_tag ? `/home/player/${tagPath(i.subject_tag)}` : TIMELINE),
    };
  }
  return {
    title,
    body: `On ${cheers.length} of your battles and moments`,
    url: TIMELINE,
  };
}

/** The followers notice: counted per own player, never who. */
export function followersNotice(followers) {
  const total = followers.reduce((s, p) => s + p.count, 0);
  if (total === 0) return null;
  const one = followers.length === 1 ? followers[0] : null;
  return {
    title: plural(total, "new follower"),
    body: one ? `On ${clipText(one.name ?? one.tag, 60)}` : "On your players",
    url: one ? `/home/player/${tagPath(one.tag)}` : TIMELINE,
  };
}

/** Accounts with a device whose own players had a cheer or a follow, or
 *  whose feedback was answered, in the last hour, or with a notice owed. */
async function candidates(db, { now, accountId }) {
  const { rows } = await db.query(
    `with own as (
       select c.account_id, c.player_tag from claim c
        where c.status = 'verified'
          and (c.is_primary or c.relationship in ('primary', 'alt'))
     ), touched as (
       select o.account_id, max(t.updated_at) as last_cheer_at
         from timeline_cheer t
         join own o on o.player_tag = any(t.subject_tags)
                   and o.account_id <> t.account_id
        where t.updated_at > $1::timestamptz - interval '1 hour'
        group by o.account_id
       union all
       select o.account_id, null from claim f
         join own o on o.player_tag = f.player_tag
                   and o.account_id <> f.account_id
         join account fa on fa.account_id = f.account_id
        where f.relationship = 'friend'
          and f.created_at > $1::timestamptz - interval '1 hour'
          and coalesce(fa.kind, 'person') = 'person'
       union all
       select account_id, null from feedback
        where responded_at > $1::timestamptz - interval '1 hour'
          and response_seen_at is null
       union all
       select account_id, null from push_notice where status = 'owed'
     )
     select a.account_id, max(t.last_cheer_at) as last_cheer_at,
            (select seen_at from bell_seen b where b.account_id = a.account_id)
              as bell_seen,
            (select min(created_at) from push_subscription s
              where s.account_id = a.account_id) as first_device
       from touched t
       join account a on a.account_id = t.account_id
      where a.kind = 'person' and a.status = 'approved'
        and exists (select 1 from push_subscription s
                     where s.account_id = a.account_id)
        and ($2::uuid is null or a.account_id = $2)
      group by a.account_id
      order by a.account_id`,
    [now, accountId],
  );
  return rows;
}

/** When each kind was last told, and how many notices went lately. */
async function told(db, accountId, now) {
  const { rows } = await db.query(
    `select kind, max(through) as through,
            max(sent_at) as last_sent,
            count(*) filter (where sent_at > $2::timestamptz - interval '1 day')::int
              as today
       from push_notice
      where account_id = $1 and status in ('sent', 'sending')
      group by kind`,
    [accountId, now],
  );
  const by = new Map(rows.map((r) => [r.kind, r]));
  const lastSent = rows.reduce(
    (m, r) => (r.last_sent && r.last_sent > m ? r.last_sent : m),
    new Date(0),
  );
  const today = rows.reduce((s, r) => s + r.today, 0);
  return { by, lastSent, today };
}

/** How long a notice whose relay objects could not all be written keeps
 *  being retried: past it, it is stale news and is given up. */
const RETRY_MS = 12 * 3_600_000;

/** One notice recorded as sending, with every device of the account
 *  pending; then its relay objects are written. */
async function send(db, outbox, accountId, notice) {
  const { rows: subs } = await db.query(
    `select subscription_id from push_subscription
      where account_id = $1 order by subscription_id`,
    [accountId],
  );
  const pending = subs.map((s) => s.subscription_id);
  let id = notice.notice_id;
  if (id) {
    await db.query(
      `update push_notice set status = 'sending', sent_at = now(),
              devices = $2, pending = $3::bigint[]
        where notice_id = $1`,
      [id, pending.length, pending],
    );
  } else {
    const { rows } = await db.query(
      `insert into push_notice
         (account_id, kind, title, body, url, through, status, sent_at,
          devices, pending, told)
       values ($1, $2, $3, $4, $5, $6, 'sending', now(), $7, $8::bigint[],
               $9::jsonb)
       returning notice_id`,
      [
        accountId,
        notice.kind,
        notice.title.slice(0, 120),
        notice.body.slice(0, 200),
        notice.url,
        notice.through,
        pending.length,
        pending,
        // Close friends only (0284): who it told and how far, so a session
        // is told once. Never in the relay's object.
        notice.told ? JSON.stringify(notice.told) : null,
      ],
    );
    id = rows[0].notice_id;
  }
  const delivered = await deliver(db, outbox, id);
  return {
    notice_id: id,
    kind: notice.kind,
    devices: pending.length,
    delivered,
  };
}

/**
 * Write a sending notice's relay objects, one per device still pending,
 * taking each off `pending` only once its object is written; a device
 * removed since is simply taken off. The notice turns sent when none is
 * left. A failed write stops here and leaves the rest pending for the
 * next run (a write that landed but was not taken off may go twice; the
 * worker's tag shows it once). Returns whether it is all written.
 */
async function deliver(db, outbox, noticeId) {
  const {
    rows: [n],
  } = await db.query(
    `select notice_id, account_id, kind, title, body, url, pending, told
       from push_notice where notice_id = $1 and status = 'sending'`,
    [noticeId],
  );
  if (!n) return true;
  // A kind switched off since stops what it still owed (Codex on #1077):
  // nothing more is written. Some devices told: it stays a sent notice;
  // none: dropped, so it never counts toward the caps.
  const {
    rows: [pref],
  } = await db.query(
    `select enabled from account_push_pref
      where account_id = $1 and kind = $2`,
    [n.account_id, n.kind],
  );
  // A close friends notice whose friend was unstarred, or a block made,
  // since it was written is stopped the same way (Codex on #1090).
  const stale =
    n.kind === CLOSE_KIND &&
    !(await closeStillWanted(db, n.account_id, n.told));
  if ((pref && pref.enabled === false) || stale) {
    await db.query(
      `update push_notice
          set status = case when cardinality(pending) < devices
                            then 'sent' else 'dropped' end,
              pending = '{}'
        where notice_id = $1 and status = 'sending'`,
      [n.notice_id],
    );
    return true;
  }
  const { rows: subs } = await db.query(
    `select subscription_id, endpoint, p256dh, auth from push_subscription
      where account_id = $1 and subscription_id = any($2::bigint[])
      order by subscription_id`,
    [n.account_id, n.pending],
  );
  // Devices removed since are no longer owed anything.
  await db.query(
    `update push_notice set pending = $2::bigint[] where notice_id = $1`,
    [n.notice_id, subs.map((s) => s.subscription_id)],
  );
  for (const s of subs) {
    try {
      await outbox("web-push", {
        v: 1,
        subscription_id: String(s.subscription_id),
        endpoint: s.endpoint,
        p256dh: s.p256dh,
        auth: s.auth,
        notice: {
          notice_id: n.notice_id,
          kind: n.kind,
          title: n.title.slice(0, 120),
          body: n.body.slice(0, 200),
          url: n.url,
        },
      });
    } catch {
      return false;
    }
    await db.query(
      `update push_notice set pending = array_remove(pending, $2::bigint)
        where notice_id = $1`,
      [n.notice_id, s.subscription_id],
    );
  }
  await db.query(
    `update push_notice set status = 'sent'
      where notice_id = $1 and status = 'sending' and cardinality(pending) = 0`,
    [n.notice_id],
  );
  return true;
}

/** Notices left sending by a failed write or a run cut short: written
 *  first, before anything new is told; past RETRY_MS, given up. */
async function resumeSending(db, outbox, { now, accountId, remainingMs }) {
  await db.query(
    `update push_notice set status = 'sent', pending = '{}'
      where status = 'sending' and sent_at < $1::timestamptz - make_interval(secs => $3)
        and ($2::uuid is null or account_id = $2)`,
    [now, accountId, RETRY_MS / 1000],
  );
  const { rows } = await db.query(
    `select notice_id from push_notice
      where status = 'sending' and ($1::uuid is null or account_id = $1)
      order by sent_at`,
    [accountId],
  );
  let resumed = 0;
  let waiting = 0;
  for (const r of rows) {
    if (remainingMs && remainingMs() < 30_000) {
      waiting++;
      continue;
    }
    if (await deliver(db, outbox, r.notice_id)) resumed++;
    else waiting++;
  }
  return { resumed, waiting };
}

export async function runWebPush({
  databaseUrl,
  db = null,
  outbox,
  now = new Date(),
  accountId = null,
  remainingMs = null,
}) {
  const own = !db;
  if (own) db = await openJobsClient(databaseUrl, { op: "web_push" });
  const result = {
    candidates: 0,
    sent: 0,
    held: 0,
    resumed: 0,
    waiting: 0,
    details: [],
  };
  try {
    if (!outbox) return { ...result, skipped: "no_outbox" };
    const back = await resumeSending(db, outbox, {
      now,
      accountId,
      remainingMs,
    });
    result.resumed = back.resumed;
    result.waiting = back.waiting;
    const rows = await candidates(db, { now, accountId });
    // Close friends' play (2026-11-17): accounts with a device and a mark
    // whose close friends have something new, merged in after the rest.
    const close = await closeCandidates(db, { now, accountId });
    const listed = new Set(rows.map((r) => r.account_id));
    for (const id of [...close.keys()].sort())
      if (!listed.has(id)) rows.push({ account_id: id, close_only: true });
    result.candidates = rows.length;
    // Each friend is built at most once a run, whoever starred them.
    const built = new Map();
    for (const r of rows) {
      if (remainingMs && remainingMs() < 30_000) break;
      const history = await told(db, r.account_id, now);
      if (
        history.today >= DAILY_CAP ||
        now.getTime() - history.lastSent.getTime() < MIN_GAP_MS
      ) {
        result.held++;
        continue;
      }
      const { rows: prefs } = await db.query(
        `select kind, enabled from account_push_pref where account_id = $1`,
        [r.account_id],
      );
      const on = (k) => prefs.find((p) => p.kind === k)?.enabled ?? true;
      const since = (kind) =>
        new Date(
          Math.max(
            now.getTime() - DAY_MS,
            r.bell_seen ? new Date(r.bell_seen).getTime() : 0,
            r.first_device ? new Date(r.first_device).getTime() : 0,
            history.by.get(kind)?.through
              ? new Date(history.by.get(kind).through).getTime()
              : 0,
          ),
        );
      let notice = r.close_only ? null : await pick(db, r, { now, on, since });
      // Last in the order: only when nothing else is told this run, the
      // kind is on and under its own cap, and no cheers are settling (they
      // go first once settled).
      const cheersSettling =
        r.last_cheer_at &&
        on("cheers") &&
        now.getTime() - new Date(r.last_cheer_at).getTime() < SETTLE_MS;
      if (
        !notice &&
        close.has(r.account_id) &&
        on(CLOSE_KIND) &&
        !cheersSettling &&
        (history.by.get(CLOSE_KIND)?.today ?? 0) < CLOSE_DAILY_CAP
      )
        notice = await pickClose(db, close.get(r.account_id), {
          now,
          cache: built,
        });
      if (!notice) continue;
      const out = await send(db, outbox, r.account_id, notice);
      result.sent++;
      if (!out.delivered) result.waiting++;
      // The kind and how many devices; never an account's words or who.
      result.details.push({ kind: out.kind, devices: out.devices });
    }
    return result;
  } finally {
    if (own) await db.end();
  }
}

/** The one notice this run tells an account, or null. */
async function pick(db, r, { now, on, since }) {
  // An owed notice (a Clan Action) first; a switched-off kind's is dropped,
  // and so is one the caps held past twelve hours: it is stale news.
  await db.query(
    `update push_notice set status = 'dropped'
      where account_id = $1 and status = 'owed'
        and created_at < $2::timestamptz - interval '12 hours'`,
    [r.account_id, now],
  );
  const { rows: owed } = await db.query(
    `select notice_id, kind, title, body, url, through from push_notice
      where account_id = $1 and status = 'owed' order by created_at limit 1`,
    [r.account_id],
  );
  if (owed[0]) {
    if (on(owed[0].kind)) return owed[0];
    await db.query(
      `update push_notice set status = 'dropped' where notice_id = $1`,
      [owed[0].notice_id],
    );
  }
  if (on("answers")) {
    const answers = await readAnswers(db, r.account_id);
    const after = since("answers");
    const fresh = answers.items.filter(
      (a) => a.new && new Date(a.responded_at) > after,
    );
    if (fresh.length)
      return {
        kind: "answers",
        title:
          fresh.length === 1
            ? "Elixir answered your feedback"
            : `Elixir answered ${fresh.length} of your feedback notes`,
        body: fresh.length === 1 ? fresh[0].about : "Tap to read the answers",
        url:
          fresh.length === 1
            ? `/settings/feedback/${encodeURIComponent(fresh[0].id)}`
            : "/settings/feedback",
        through: now,
      };
  }
  const settled =
    !r.last_cheer_at ||
    now.getTime() - new Date(r.last_cheer_at).getTime() >= SETTLE_MS;
  const wantCheers = on("cheers") && settled;
  const wantFollowers = on("followers");
  if (!wantCheers && !wantFollowers) return null;
  const activity = await readAwayActivity(db, r.account_id, {
    since: since("cheers"),
    followersSince: since("followers"),
  });
  const cheers = wantCheers ? cheersNotice(activity.cheers) : null;
  if (cheers) return { kind: "cheers", ...cheers, through: now };
  const followers = wantFollowers ? followersNotice(activity.followers) : null;
  if (followers) return { kind: "followers", ...followers, through: now };
  return null;
}
