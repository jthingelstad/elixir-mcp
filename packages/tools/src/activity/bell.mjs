/**
 * The bell's reads about you (2026-11-12), shared since 2026-11-16 so the
 * bell, its push notices and the activity mail tell one set of items
 * (docs/notes/2026-11-16-reach-you.md). The web-api's bell
 * (services/web-api/src/bell.mjs) adds your account's own lines and Stamps;
 * the jobs Lambda's activity mail and push drain read these three sections
 * with `since` set to what the person has already been told.
 *
 * Who sees what, and no more:
 *  - Reactions: cheers by other people on the items about your own verified
 *    players, as counts per cheer. Never who cheered (DECISIONS "Reactions,
 *    not comments": counts only, never who).
 *  - Followers: people who follow one of your own verified players, named
 *    only as DECISIONS "What is public about an account" names them on that
 *    player's page; an account with none is counted, never named. Mail and
 *    push carry the counts only (`fresh_by`), never who.
 *  - Answers: your own feedback's answers.
 *
 * An agent has no bell, and none of this reaches MCP or `/api/v1`.
 */
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { shownAt } from "./entries.mjs";
import { ownVerifiedPlayers, readBellWeek } from "./home-feed.mjs";

export { ownVerifiedPlayers };

/** Followers and answers look back thirty days. */
export const BELL_DAYS = 30;
export const BELL_LIST_CAP = 20;
const LIST_CAP = BELL_LIST_CAP;

/** The facts a moment names its proving battle under (web-api follow.mjs). */
const PROOFS = ["promoted_by", "crossed_by", "best_win"];
/** The battle that proved a moment, or null (the feed and the bell). */
export const proofOf = (it) => {
  for (const k of PROOFS) {
    const id = it.facts?.[k]?.battle_id;
    if (id) return String(id);
  }
  return null;
};

/** When the account last opened the bell, or null for never. */
export async function bellSeenAt(db, accountId) {
  const { rows } = await db.query(
    `select seen_at from bell_seen where account_id = $1`,
    [accountId],
  );
  return rows[0]?.seen_at ?? null;
}

/** Opening the bell: everything in it up to now is seen. */
export async function markBellSeen(db, accountId) {
  const { rows } = await db.query(
    `insert into bell_seen (account_id, seen_at) values ($1, now())
     on conflict (account_id) do update set seen_at = excluded.seen_at
     returning seen_at`,
    [accountId],
  );
  return rows[0].seen_at;
}

/** Other people's cheers on your own players' items of the last seven
 *  days (the cheer window), grouped by item. `seen` is the instant after
 *  which a cheer is new (null: all of them); `fresh` on an item counts its
 *  new cheers. `maxAgeMs` (the jobs' reads) serves the stored week only
 *  while it is younger than that, so an item made since is in it. */
export async function readReactions(
  db,
  accountId,
  own,
  seen,
  { wake = null, perf = null, maxAgeMs = null } = {},
) {
  if (own.length === 0) return { items: [], new: 0, fresh: 0 };
  const week = await readBellWeek(db, accountId, { own, wake, maxAgeMs });
  if (perf) {
    perf.stored = week.stored;
    perf.age_ms = week.ageMs;
  }
  const byId = new Map(week.items.map((it) => [it.id, it]));
  if (byId.size === 0) return { items: [], new: 0, fresh: 0 };
  const { rows } = await db.query(
    `select item_id, cheer, count(*)::int as n,
            count(*) filter (where $3::timestamptz is null
                               or updated_at > $3)::int as fresh,
            max(updated_at) as last_at
       from timeline_cheer
      where item_id = any($1::text[]) and account_id <> $2
      group by item_id, cheer`,
    [[...byId.keys()], accountId, seen],
  );
  const grouped = new Map();
  for (const r of rows) {
    const g = grouped.get(r.item_id) ?? {
      item_id: r.item_id,
      cheers: {},
      total: 0,
      fresh: 0,
      last_at: r.last_at,
    };
    g.cheers[r.cheer] = r.n;
    g.total += r.n;
    g.fresh += r.fresh;
    if (r.last_at > g.last_at) g.last_at = r.last_at;
    grouped.set(r.item_id, g);
  }
  const top = [...grouped.values()]
    .sort((a, b) => b.last_at - a.last_at)
    .slice(0, LIST_CAP);
  // Each row opens its battle, as the feed does: a highlight's own, else
  // the battle that proved a moment (feed.mjs annotateFeed's read).
  const proofs = top.map((g) => proofOf(byId.get(g.item_id)));
  const links = await battleLinks(db, proofs.filter(Boolean));
  const items = top.map((g, i) => {
    const it = byId.get(g.item_id);
    return {
      item_id: g.item_id,
      text: String(it.text ?? ""),
      at: shownAt(it) || null,
      battle_url:
        it.facts?.battle?.url ??
        (proofs[i] ? links.get(proofs[i])?.url : null) ??
        null,
      // The player the item is about, for a link when it has no battle.
      subject_tag: it.subject_tag ?? it.subjects?.[0]?.tag ?? null,
      cheers: g.cheers,
      total: g.total,
      new: g.fresh > 0,
      fresh: g.fresh,
    };
  });
  return {
    items,
    new: items.filter((i) => i.new).length,
    fresh: items.reduce((s, i) => s + i.fresh, 0),
  };
}

/** Who started following one of your own verified players in the last
 *  thirty days: named by their account's verified player, else by the
 *  player it claims and has not verified (`verified: false`; a claim on a
 *  tag another account verified names nobody), as the followers list on a
 *  player page names them (packages/tools social.mjs followersOf). An
 *  account with no player at all is counted in `no_player`, never named.
 *  `fresh_by` counts the new ones per own player, naming nobody: what
 *  mail and push may say. */
export async function readFollowers(db, accountId, own, seen) {
  const empty = {
    players: [],
    count: 0,
    no_player: 0,
    unnamed: 0,
    new: 0,
    fresh_by: [],
  };
  if (own.length === 0) return empty;
  const { rows } = await db.query(
    `select f.player_tag as followed, v.player_tag as tag, p.name, v.verified,
            ($3::timestamptz is null or f.created_at > $3) as fresh,
            exists (select 1 from claim mine
                     where mine.account_id = $2
                       and mine.player_tag = v.player_tag) as claimed
       from claim f
       join account a on a.account_id = f.account_id
       left join lateral (
         select c.player_tag, c.status = 'verified' as verified from claim c
          where c.account_id = f.account_id
            and (c.is_primary or c.relationship in ('primary', 'alt'))
            and (c.status = 'verified' or not exists (
                  select 1 from claim o
                   where o.player_tag = c.player_tag and o.status = 'verified'
                     and o.account_id <> c.account_id))
          order by c.status = 'verified' desc, c.is_primary desc,
                   c.verified_at, c.created_at
          limit 1) v on true
       left join player p on p.player_tag = v.player_tag
      where f.player_tag = any($1::text[]) and f.relationship = 'friend'
        and coalesce(a.kind, 'person') = 'person'
        and f.account_id <> $2
        and f.created_at > now() - make_interval(days => $4)
      order by f.created_at desc, v.player_tag`,
    [own.map((p) => p.tag), accountId, seen, BELL_DAYS],
  );
  const names = new Map(own.map((p) => [p.tag, p.name]));
  const named = rows.filter((r) => r.tag);
  const freshBy = new Map();
  for (const r of rows)
    if (r.fresh) freshBy.set(r.followed, (freshBy.get(r.followed) ?? 0) + 1);
  return {
    players: named.slice(0, LIST_CAP).map((r) => ({
      tag: r.tag,
      name: r.name ?? null,
      // False: the player their account claims and has not verified,
      // named as the followers list names them (Jamie, 2026-11-14).
      verified: r.verified === true,
      followed_tag: r.followed,
      followed_name: names.get(r.followed) ?? null,
      new: r.fresh,
      // Follow back (2026-11-13): offered on their player, verified or
      // claimed, unless you own, follow or watch it already.
      can_follow_back: !r.claimed,
    })),
    count: rows.length,
    // Accounts with no player at all: counted, never named.
    no_player: rows.length - named.length,
    unnamed: rows.length - Math.min(named.length, LIST_CAP),
    new: rows.filter((r) => r.fresh).length,
    // Own players in the order you own them (primary first).
    fresh_by: own
      .filter((p) => freshBy.has(p.tag))
      .map((p) => ({ tag: p.tag, name: p.name, count: freshBy.get(p.tag) })),
  };
}

/** Answers to your own feedback: every unread one, and those of the last
 *  thirty days. Reading one in Settings marks it read, as it always has.
 *  Unread ones come first, so read answers never push one past the cap,
 *  and the unread count is over them all, not the rows shown. */
export async function readAnswers(db, accountId) {
  const { rows } = await db.query(
    `select feedback_id, message, status, responded_at,
            response_seen_at is null as unread,
            (count(*) filter (where response_seen_at is null) over ())::int
              as unread_total
       from feedback
      where account_id = $1 and responded_at is not null
        and (response_seen_at is null
             or responded_at > now() - make_interval(days => $2))
      order by (response_seen_at is null) desc, responded_at desc
      limit $3`,
    [accountId, BELL_DAYS, LIST_CAP],
  );
  const items = rows.map((r) => ({
    id: String(r.feedback_id),
    about: clipText(String(r.message ?? ""), 90),
    status: r.status,
    responded_at: r.responded_at,
    new: r.unread,
  }));
  return { items, new: rows[0]?.unread_total ?? 0 };
}

/** One line of text, at most `max` characters. */
export function clipText(text, max) {
  const one = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** What is about you since `since`: the bell's reactions and followers,
 *  read for a channel that tells a person away from the app (the activity
 *  mail; push). Counts only. `since` is never null here: a channel never
 *  tells the whole thirty days. `followersSince` (default `since`) lets a
 *  channel that told the two apart start each where it left off. */
export async function readAwayActivity(
  db,
  accountId,
  { since, followersSince = since, maxAgeMs = 15 * 60_000 } = {},
) {
  if (!since || !followersSince)
    throw new Error("readAwayActivity: since is required");
  const own = await ownVerifiedPlayers(db, accountId);
  if (own.length === 0) return { own, cheers: [], followers: [] };
  const reactions = await readReactions(db, accountId, own, since, {
    maxAgeMs,
  });
  const followers = await readFollowers(db, accountId, own, followersSince);
  return {
    own,
    cheers: reactions.items
      .filter((i) => i.fresh > 0)
      .map((i) => ({
        item_id: i.item_id,
        text: i.text,
        at: i.at,
        battle_url: i.battle_url,
        subject_tag: i.subject_tag,
        fresh: i.fresh,
        total: i.total,
      })),
    followers: followers.fresh_by,
  };
}
