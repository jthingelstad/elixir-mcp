/** Web push's fifth kind, "Close friends' play" (2026-11-17, 0284,
 *  docs/notes/2026-11-17-close-friends-push.md).
 *
 *  The owner, 2026-11-17: "overall the app doesn't have enough to bring
 *  people back." The other kinds tell what was done to you; this one tells
 *  the account that starred a close friend (claim.close, 0281) when that
 *  friend finished a session worth telling, or had a headline moment.
 *
 *  Worth telling (DECISIONS "A close friend's play is told once it is
 *  over"):
 *   - a session of CLOSE_MIN_BATTLES or more battles, or a shorter one
 *     that holds a challenge run reaching CLOSE_RUN_WINS wins or a Ranked
 *     climb; never the short sessions the Timeline folds;
 *   - a headline moment: a new best, a new league in Ranked, a new Arena
 *     (up; a move down is not a headline), told by the timeline's own
 *     sentence.
 *  Only once the session is over, by the timeline's boundary (no battle
 *  for 30 minutes, entries.mjs SESSION_GAP_MS), and only while its last
 *  battle is under CLOSE_FRESH_MS old by battle time, never by when Elixir
 *  learned it: a backfill is not activity. A moment waits while its
 *  player is still playing, so a session and its moment are one notice.
 *  Each session is told once (its start must be after the end of the last
 *  session told of that player, so a session that later grows is never
 *  told again) and each moment once (`told`, push_notice 0284).
 *
 *  Private (DECISIONS "A close friend is a private mark", firm): a notice
 *  goes only to the starring account's own devices; the friend, any other
 *  account, mail, the digest, Discord, RSS, MCP and `/api/v1` never see
 *  it. A block either way between the owner and the friend's account
 *  stops it. Names are the game's names (never a nickname, the reader's
 *  own included: DECISIONS "The bell reaches you when you are away"); the
 *  service worker strips control and direction characters as for every
 *  notice. */
import { blockedSql } from "@elixir-mcp/claims";
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { sessionHeadline, sessionPathOf } from "@elixir-mcp/ui/session-story";
import { clipText, proofOf } from "@elixir-mcp/tools/activity/bell";
import {
  buildTimeline,
  itemVisibility,
} from "@elixir-mcp/tools/activity/entries";

export const CLOSE_KIND = "close_friends";
/** At most this many close friends notices a day: below the drain's day
 *  cap, so they never crowd out cheers. */
export const CLOSE_DAILY_CAP = 3;
/** A session of this many battles is worth telling on its own. */
export const CLOSE_MIN_BATTLES = 3;
/** A challenge run reaching this many wins makes a short session worth it. */
export const CLOSE_RUN_WINS = 5;
/** Nothing older than this is told: a session by its last battle, a moment
 *  by when it happened. */
export const CLOSE_FRESH_MS = 2 * 3_600_000;
/** A session is over after this long without a battle: the timeline's own
 *  boundary (packages/tools entries.mjs SESSION_GAP_MS). */
export const SESSION_OVER_MS = 30 * 60_000;
/** Friends finishing near each other are one notice: wait this long after
 *  the newest became tellable, but never past CLOSE_HOLD_MAX_MS for the
 *  oldest. */
export const CLOSE_SETTLE_MS = 5 * 60_000;
export const CLOSE_HOLD_MAX_MS = 15 * 60_000;
/** How far back the told record is read; longer than any told item stays
 *  fresh. */
const TOLD_LOOKBACK_HOURS = 12;
/** How far back a friend's battles are read to find their last session. */
const SESSION_LOOKBACK_HOURS = 6;
const HEADLINES = ["best_trophies_band", "ranked_promotion", "arena_changed"];
const SITE = "https://elixir.poapkings.com";
/** The Timeline with the Close friends chip lit (Feed.jsx honours it). */
export const CLOSE_TIMELINE = "/timeline?show=close";

const tagPath = (tag) =>
  encodeURIComponent(String(tag ?? "").replace(/^#/, ""));
const ms = (v) => (v ? new Date(v).getTime() : null);

/**
 * The accounts that may be told, each with the close friends who have
 * something new: one statement, index-backed and bounded.
 *
 * It starts from push_subscription (a few rows per person who turned a
 * device on; its account index), takes each such approved person's close
 * marks through claim's primary key (account_id, player_tag), and for
 * each distinct marked tag reads:
 *  - its battles of the last SESSION_LOOKBACK_HOURS on
 *    battle_participant_player_time_cover (player_tag, battle_time desc),
 *    to find the last session (a battle 30 minutes or more after the one
 *    before starts a session) and its battle count;
 *  - its headline moments of the last CLOSE_FRESH_MS on player_event_window
 *    (player_tag, window_end desc);
 * and the owner's told record from push_notice_account (account_id,
 * created_at desc). Nothing scales with accounts that have no device or
 * no mark, or with the record's size. Rows: one per (account, tag) with
 * something to consider.
 */
export const CANDIDATES_SQL = `with devices as (
       select s.account_id, min(s.created_at) as first_device
         from push_subscription s
         join account a on a.account_id = s.account_id
                       and a.kind = 'person' and a.status = 'approved'
        where ($2::uuid is null or s.account_id = $2)
        group by s.account_id
     ), marks as (
       select d.account_id, d.first_device, c.player_tag
         from devices d
         join claim c on c.account_id = d.account_id and c.close
        -- A block either way with the account that owns the player (its
        -- one verified claim, claim_one_verified_per_tag).
        where not exists (
                select 1 from claim o
                 where o.player_tag = c.player_tag
                   and o.status = 'verified'
                   and o.account_id <> c.account_id
                   and ${blockedSql("o.account_id", "c.account_id")})
     ), tags as (
       select distinct player_tag from marks
     ), last_session as (
       select t.player_tag, s.started_at, s.ended_at, s.battles, s.maybe
         from tags t
         cross join lateral (
           select min(x.battle_time) as started_at,
                  max(x.battle_time) as ended_at,
                  count(*)::int as battles,
                  bool_or(x.maybe) as maybe
             from (
               select g.battle_time, g.maybe,
                      sum(g.starts) over (order by g.battle_time desc
                                          rows unbounded preceding) as back
                 from (
                   -- A battle that can make a short session worth it: a
                   -- challenge's (its run) or a Ranked one (a climb the
                   -- battles' league stamps show, with or without a
                   -- profile's ranked_promotion yet; Codex on #1090).
                   select bp.battle_time,
                          (b.event_tag is not null or b.league_number is not null) as maybe,
                          -- The newer battle is 30 minutes or more after
                          -- this one: the session ends here.
                          case when lag(bp.battle_time) over (order by bp.battle_time desc)
                                    - bp.battle_time >= interval '30 minutes'
                               then 1 else 0 end as starts
                     from battle_participant bp
                     join battle b on b.battle_id = bp.battle_id
                    where bp.player_tag = t.player_tag
                      and bp.battle_time > $1::timestamptz - make_interval(hours => $3)
                      and bp.battle_time <= $1::timestamptz
                      -- A boat defense is not the player's battle (0171).
                      and not (b.boat_battle_side is not null
                               and (b.boat_battle_side = 'defender') = (bp.side = 0))
                 ) g
             ) x
            where x.back = 0
         ) s
        where s.ended_at is not null
     ), moments as (
       -- One index range per player (player_event_window), never a range
       -- over every player's recent rows.
       select t.player_tag, mo.moment_at
         from tags t
         cross join lateral (
           select max(coalesce(e.occurred_at, e.window_end)) as moment_at
             from player_event e
            where e.player_tag = t.player_tag
              and e.window_end > $1::timestamptz - make_interval(secs => $4)
              and coalesce(e.occurred_at, e.window_end) > $1::timestamptz - make_interval(secs => $4)
              and e.event_type = any($5::text[])
              and not (e.event_type = 'arena_changed'
                       and coalesce(e.arena_to < e.arena_from, false))
         ) mo
        where mo.moment_at is not null
     ), told as (
       select n.account_id, el->>'tag' as player_tag,
              max((el->>'sessions_through')::timestamptz) as sessions_through,
              max((el->>'moments_through')::timestamptz) as moments_through
         from devices d
         join push_notice n on n.account_id = d.account_id
          and n.kind = $6 and n.status in ('sending', 'sent')
          and n.created_at > $1::timestamptz - make_interval(hours => $7)
         cross join lateral jsonb_array_elements(coalesce(n.told, '[]'::jsonb)) el
        group by n.account_id, el->>'tag'
     )
     select m.account_id, m.player_tag, m.first_device,
            s.started_at, s.ended_at, s.battles, s.maybe,
            mo.moment_at, t.sessions_through, t.moments_through
       from marks m
       left join last_session s on s.player_tag = m.player_tag
       left join moments mo on mo.player_tag = m.player_tag
       left join told t on t.account_id = m.account_id
                       and t.player_tag = m.player_tag
      where (s.ended_at is not null or mo.moment_at is not null)
      order by m.account_id, m.player_tag`;

/**
 * Whether a close friends notice may still go, at delivery: every friend
 * it names is still a close mark of the account's, and no block either
 * way stands with the player's verified owner. A notice written before a
 * block or an unstar and retried after it (an outbox write that failed)
 * is dropped, never delivered (Codex on #1090).
 */
export async function closeStillWanted(db, accountId, told) {
  const tags = (Array.isArray(told) ? told : [])
    .map((t) => t?.tag)
    .filter((t) => typeof t === "string");
  if (tags.length === 0) return false;
  const {
    rows: [r],
  } = await db.query(
    `select count(*)::int as ok
       from claim c
      where c.account_id = $1 and c.player_tag = any($2::text[]) and c.close
        and not exists (
              select 1 from claim o
               where o.player_tag = c.player_tag
                 and o.status = 'verified'
                 and o.account_id <> c.account_id
                 and ${blockedSql("o.account_id", "c.account_id")})`,
    [accountId, [...new Set(tags)]],
  );
  return r.ok === new Set(tags).size;
}

/** The statement's parameters. */
export const candidateParams = (now, accountId = null) => [
  now,
  accountId,
  SESSION_LOOKBACK_HOURS,
  CLOSE_FRESH_MS / 1000,
  HEADLINES,
  CLOSE_KIND,
  TOLD_LOOKBACK_HOURS,
];

export async function closeCandidates(db, { now, accountId = null }) {
  const { rows } = await db.query(
    CANDIDATES_SQL,
    candidateParams(now, accountId),
  );
  const nowMs = now.getTime();
  const byAccount = new Map();
  for (const r of rows) {
    const want = wanted(r, nowMs);
    if (!want) continue;
    const list = byAccount.get(r.account_id) ?? [];
    list.push({ ...r, ...want });
    byAccount.set(r.account_id, list);
  }
  return byAccount;
}

/** What one candidate row may tell, from the statement's facts alone, or
 *  null: the last session once it is over, fresh, after the last one told
 *  and of a size that could be worth it; a moment that is new, fresh and
 *  not mid-session. */
export function wanted(r, nowMs) {
  const floor = Math.max(nowMs - CLOSE_FRESH_MS, ms(r.first_device) ?? 0);
  const end = ms(r.ended_at);
  const playing = end !== null && nowMs - end < SESSION_OVER_MS;
  if (playing) return null;
  const session =
    end !== null &&
    end > floor &&
    (r.sessions_through === null ||
      ms(r.started_at) > ms(r.sessions_through)) &&
    // A short session is worth it only for a challenge run's wins or a
    // Ranked climb; the build reads which, so a short session with a
    // challenge or Ranked battle goes on to it.
    (r.battles >= CLOSE_MIN_BATTLES || r.maybe === true);
  const moment =
    r.moment_at !== null &&
    ms(r.moment_at) > floor &&
    (r.moments_through === null || ms(r.moment_at) > ms(r.moments_through));
  if (!session && !moment) return null;
  // When it became tellable: a session once it was over; a moment when it
  // happened, or once its session was over.
  const ready = Math.max(
    end !== null ? end + SESSION_OVER_MS : 0,
    moment ? ms(r.moment_at) : 0,
  );
  return { session, moment, ready };
}

/** One build of the public record for the friends this run must look at,
 *  the session page's own read (web-api routes/player.mjs pageTimeline):
 *  no account, so no nickname and nothing but the public record. */
export async function friendItems(db, tags, { now }) {
  if (tags.length === 0) return new Map();
  const nowMs = now.getTime();
  const built = await buildTimeline(
    db,
    tags.map((tag) => ({
      kind: "player",
      tag,
      relationship: null,
      nickname: null,
    })),
    {
      fromMs: nowMs - SESSION_LOOKBACK_HOURS * 3_600_000,
      toMs: nowMs,
      accountId: null,
      basis: "occurred",
      lateCounts: false,
      filter: (it) => ["public", "member"].includes(itemVisibility(it)),
    },
  );
  const by = new Map(tags.map((t) => [t, []]));
  for (const it of built.timeline ?? []) {
    const tag = it.facts?.player_tag ?? it.subject_tag;
    if (by.has(tag)) by.get(tag).push(it);
  }
  return by;
}

const isHeadline = (it) =>
  HEADLINES.includes(it.kind) &&
  !(
    it.kind === "arena_changed" &&
    typeof it.facts?.to === "number" &&
    typeof it.facts?.from === "number" &&
    it.facts.to < it.facts.from
  );

/** What makes a short session worth telling: a Ranked climb, or a
 *  challenge run that reached CLOSE_RUN_WINS. Facts, never a rating. */
function notableFact(f = {}) {
  const ups = f.ranked?.promotions ?? [];
  if (ups.length)
    return `Climbed ${ups[0]?.from_name} to ${ups.at(-1)?.to_name}`;
  for (const e of f.events ?? [])
    if (
      e?.name &&
      typeof e.run_wins === "number" &&
      e.run_wins >= CLOSE_RUN_WINS
    )
      return `${e.name}: up to ${e.run_wins} wins`;
  return null;
}

/** Whether a session item is worth telling: CLOSE_MIN_BATTLES battles, or
 *  a shorter one with a climb or a long run. */
export function worthTelling(it) {
  if (it?.kind !== "battle_session") return false;
  const f = it.facts ?? {};
  return (f.battles ?? 0) >= CLOSE_MIN_BATTLES || notableFact(f) !== null;
}

/** A moment's short words for a notice that names several friends. */
function momentWords(it) {
  const f = it.facts ?? {};
  switch (it.kind) {
    case "best_trophies_band":
      return typeof f.best === "number"
        ? `New best, ${f.best.toLocaleString("en-US")} trophies`
        : "New best";
    case "ranked_promotion":
      return f.to_name
        ? `New league in Ranked: ${f.to_name}`
        : "New league in Ranked";
    case "arena_changed":
      return f.to_name ? `New Arena: ${f.to_name}` : "New Arena";
    default:
      return clipText(it.text, 80);
  }
}

/** A session's body: its fact headline, and the climb or run that made a
 *  short one worth it. */
function sessionWords(it) {
  const f = it.facts ?? {};
  const head = sessionHeadline(f);
  const extra = (f.battles ?? 0) < CLOSE_MIN_BATTLES ? notableFact(f) : null;
  return extra ? `${head}. ${extra}` : head;
}

/**
 * The one thing to tell about one friend, or null: their newest fresh
 * headline moment not yet told, else their last session if it is over,
 * fresh, after the last told and worth telling. `told` is what the notice
 * will record for them either way, so a short session never comes back.
 */
export function friendStory(items, cand, nowMs) {
  const floor = Math.max(nowMs - CLOSE_FRESH_MS, ms(cand.first_device) ?? 0);
  const sessions = items.filter(
    (it) =>
      it.kind === "battle_session" &&
      it.facts?.open !== true &&
      it.evidence?.open !== true,
  );
  // Never mid-session: a session still open holds everything about them.
  if (
    items.some(
      (it) =>
        it.kind === "battle_session" && (it.facts?.open || it.evidence?.open),
    )
  )
    return null;
  const last = sessions
    .filter((it) => ms(it.facts?.ended_at) !== null)
    .sort((a, b) => ms(b.facts.ended_at) - ms(a.facts.ended_at))[0];
  const lastEnd = last ? ms(last.facts.ended_at) : null;
  const sessionOk =
    last &&
    lastEnd > floor &&
    nowMs - lastEnd >= SESSION_OVER_MS &&
    (cand.sessions_through === null ||
      ms(last.facts.started_at) > ms(cand.sessions_through)) &&
    worthTelling(last);
  const moments = items
    .filter((it) => isHeadline(it))
    .filter((it) => {
      const at = ms(it.at);
      return (
        at !== null &&
        at > floor &&
        (cand.moments_through === null || at > ms(cand.moments_through))
      );
    })
    .sort((a, b) => ms(b.at) - ms(a.at));
  const told = {
    tag: cand.player_tag,
    sessions_through:
      lastEnd !== null && lastEnd > floor && nowMs - lastEnd >= SESSION_OVER_MS
        ? last.facts.ended_at
        : (cand.sessions_through?.toISOString?.() ??
          cand.sessions_through ??
          null),
    moments_through: moments[0]
      ? moments[0].at
      : (cand.moments_through?.toISOString?.() ?? cand.moments_through ?? null),
  };
  const name =
    last?.facts?.name ??
    moments[0]?.facts?.name ??
    moments[0]?.subject_name ??
    last?.subject_name ??
    null;
  if (moments[0])
    return { kind: "moment", item: moments[0], name, told, ready: cand.ready };
  if (sessionOk)
    return { kind: "session", item: last, name, told, ready: cand.ready };
  return null;
}

/** Where one story opens: a session its own page; a moment its proving
 *  battle, else its player. */
async function storyPath(db, story) {
  const it = story.item;
  const tag = it.facts?.player_tag ?? it.subject_tag;
  if (story.kind === "session") {
    const path = sessionPathOf(it);
    if (path) return path;
  } else {
    const proof = proofOf(it);
    if (proof) {
      const url = (await battleLinks(db, [proof])).get(proof)?.url ?? null;
      if (typeof url === "string" && url.startsWith(`${SITE}/battle/`))
        return url.slice(SITE.length);
    }
  }
  return `/home/player/${tagPath(tag)}`;
}

/** The notice for the stories this run tells, newest ready first. One
 *  friend: their game name, the session's fact headline or the moment's
 *  own sentence, opening it. Several: "Vijay and 2 other close friends
 *  played", each one's words, opening the Timeline on Close friends. */
export async function closeNotice(db, stories) {
  if (stories.length === 0) return null;
  const sorted = [...stories].sort((a, b) => b.ready - a.ready);
  const lead = sorted[0];
  const leadName = clipText(lead.name ?? "A close friend", 60);
  if (sorted.length === 1) {
    return {
      title: leadName,
      body: clipText(
        lead.kind === "session" ? sessionWords(lead.item) : lead.item.text,
        200,
      ),
      url: await storyPath(db, lead),
    };
  }
  const others = sorted.length - 1;
  return {
    title: clipText(
      `${leadName} and ${others} other close ${others === 1 ? "friend" : "friends"} played`,
      120,
    ),
    body: clipText(
      sorted
        .map(
          (s) =>
            `${clipText(s.name ?? "A close friend", 40)}: ${
              s.kind === "session" ? sessionWords(s.item) : momentWords(s.item)
            }`,
        )
        .join(". "),
      200,
    ),
    url: CLOSE_TIMELINE,
  };
}

/**
 * The close friends notice for one account this run, or null. `cands` is
 * the account's rows from closeCandidates; `cache` holds the friends
 * already built this run (one build per friend a run, whoever starred
 * them). Waits CLOSE_SETTLE_MS after the newest became tellable, so
 * friends finishing together are one notice, but never longer than
 * CLOSE_HOLD_MAX_MS after the oldest.
 */
export async function pickClose(db, cands, { now, cache }) {
  const nowMs = now.getTime();
  if (!cands?.length) return null;
  const newest = Math.max(...cands.map((c) => c.ready));
  const oldest = Math.min(...cands.map((c) => c.ready));
  if (nowMs - newest < CLOSE_SETTLE_MS && nowMs - oldest < CLOSE_HOLD_MAX_MS)
    return null;
  const missing = cands.map((c) => c.player_tag).filter((t) => !cache.has(t));
  if (missing.length) {
    const built = await friendItems(db, missing, { now });
    for (const [t, items] of built) cache.set(t, items);
  }
  const stories = cands
    .map((c) => friendStory(cache.get(c.player_tag) ?? [], c, nowMs))
    .filter(Boolean);
  const notice = await closeNotice(db, stories);
  return notice
    ? {
        kind: CLOSE_KIND,
        ...notice,
        through: now,
        told: stories.map((s) => s.told),
      }
    : null;
}
