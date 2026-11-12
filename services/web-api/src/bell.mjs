/**
 * The bell (2026-11-12): what is about you, not your friends. Jamie's go,
 * 2026-11-12: "Approved: build the remaining canvas pieces (bell, …)", the
 * design canvas's bell: reactions to your items, new followers, actions
 * waiting (leaders) and answers to your feedback. Actions waiting are Clan's
 * own read (`/api/me/home/needs`); this module is the other three and the
 * account's seen marker (`bell_seen`, 0244).
 *
 * Who sees what, and no more:
 *  - Reactions: cheers by other people on the items about your own verified
 *    players, as counts per cheer. Never who cheered (DECISIONS "Reactions,
 *    not comments": counts only, never who).
 *  - Followers: people who follow one of your own verified players, named
 *    only as DECISIONS "What is public about an account" names them on that
 *    player's page (their account's verified player, by game name and tag);
 *    an account with none is counted, never named. No follow time is shown.
 *  - Answers: your own feedback's answers, which you already read in
 *    Settings › Feedback.
 *
 * Nothing here goes to mail, Discord, MCP or `/api/v1`, and an agent has no
 * bell. Reads are bounded: one rebuild of your own players' last seven days
 * (the window a cheer can be given in) and three small queries.
 */
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { buildTimeline, shownAt } from "@elixir-mcp/tools/activity/entries";
import { proofOf } from "./feed.mjs";

/** Reactions come from items of the last seven days: the cheer window. */
const REACTION_DAYS = 7;
/** Followers and answers look back thirty days. */
const BELL_DAYS = 30;
const LIST_CAP = 20;
/** How many reads of the bell one person may make in an hour: the dot reads
 *  it every few minutes, and opening the sheet reads it again. */
export const BELL_READS_PER_HOUR = 120;

const cheerable = (it) => Boolean(it?.id) && it.section !== "account";

/** Your own players that you verified: the only players the bell speaks of. */
async function ownVerified(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag, p.name
       from claim c left join player p using (player_tag)
      where c.account_id = $1 and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
      order by c.is_primary desc, c.player_tag`,
    [accountId],
  );
  return rows.map((r) => ({ tag: r.player_tag, name: r.name ?? null }));
}

/** When the account last opened the bell, or null for never. */
async function seenAt(db, accountId) {
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

/** Other people's cheers on your own players' items, grouped by item. */
async function readReactions(db, accountId, own, seen) {
  if (own.length === 0) return { items: [], new: 0 };
  const toMs = Date.now();
  const built = await buildTimeline(
    db,
    own.map((p) => ({
      kind: "player",
      tag: p.tag,
      relationship: "primary",
      nickname: null,
    })),
    {
      fromMs: toMs - REACTION_DAYS * 86_400_000,
      toMs,
      accountId,
      interactive: true,
    },
  );
  const byId = new Map(
    built.timeline.filter(cheerable).map((it) => [it.id, it]),
  );
  if (byId.size === 0) return { items: [], new: 0 };
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
      cheers: g.cheers,
      total: g.total,
      new: g.fresh > 0,
    };
  });
  return { items, new: items.filter((i) => i.new).length };
}

/** Who started following one of your own verified players in the last
 *  thirty days: named by their account's verified player, else counted. */
async function readFollowers(db, accountId, own, seen) {
  const empty = { players: [], count: 0, unnamed: 0, new: 0 };
  if (own.length === 0) return empty;
  const { rows } = await db.query(
    `select f.player_tag as followed, v.player_tag as tag, p.name,
            ($3::timestamptz is null or f.created_at > $3) as fresh
       from claim f
       join account a on a.account_id = f.account_id
       left join lateral (
         select c.player_tag from claim c
          where c.account_id = f.account_id and c.status = 'verified'
            and (c.is_primary or c.relationship in ('primary', 'alt'))
          order by c.is_primary desc, c.verified_at limit 1) v on true
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
  return {
    players: named.slice(0, LIST_CAP).map((r) => ({
      tag: r.tag,
      name: r.name ?? null,
      followed_tag: r.followed,
      followed_name: names.get(r.followed) ?? null,
      new: r.fresh,
    })),
    count: rows.length,
    unnamed: rows.length - Math.min(named.length, LIST_CAP),
    new: rows.filter((r) => r.fresh).length,
  };
}

/** Answers to your own feedback: every unread one, and those of the last
 *  thirty days. Reading one in Settings marks it read, as it always has.
 *  Unread ones come first, so read answers never push one past the cap,
 *  and the unread count is over them all, not the rows shown. */
async function readAnswers(db, accountId) {
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
    about: clip(String(r.message ?? ""), 90),
    status: r.status,
    responded_at: r.responded_at,
    new: r.unread,
  }));
  return { items, new: rows[0]?.unread_total ?? 0 };
}

function clip(text, max) {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** The bell's three sections and how many things in them are new. */
export async function readBell(db, accountId) {
  const seen = await seenAt(db, accountId);
  const own = await ownVerified(db, accountId);
  const reactions = await readReactions(db, accountId, own, seen);
  const followers = await readFollowers(db, accountId, own, seen);
  const answers = await readAnswers(db, accountId);
  return {
    seen_at: seen,
    players: own.length,
    new: reactions.new + followers.new + answers.new,
    reactions,
    followers,
    answers,
  };
}
