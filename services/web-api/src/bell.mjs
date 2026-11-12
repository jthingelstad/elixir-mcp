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
 *  - Your account: the account's own administration of the last seven days
 *    (players and clans added, recording started or stopped, a player no
 *    longer yours, connections and the like), out of Home's feed since
 *    2026-11-12. A burst is one line per kind ("Recording started for 24
 *    players"). Sign-ins stay in Settings › Sign-ins & devices; answers are
 *    their own section.
 *
 * Nothing here goes to mail, Discord, MCP or `/api/v1`, and an agent has no
 * bell. Reads are bounded: your own players' last seven days (the window a
 * cheer can be given in) come from their stored week (bell_week, 0247;
 * readBellWeek), built on the read only when there is none, your players
 * changed or it is past three hours, and four small queries. Highlights,
 * attested facts and cheers are read live. Clan's waiting Actions are not
 * here: Home's needs read asks Clan on every request.
 */
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { shownAt } from "@elixir-mcp/tools/activity/entries";
import {
  ownVerifiedPlayers,
  readBellWeek,
} from "@elixir-mcp/tools/activity/home-feed";
import { proofOf } from "./feed.mjs";

/** Followers and answers look back thirty days. */
const BELL_DAYS = 30;
const LIST_CAP = 20;
/** Your account's lines look back as far as Home's feed did. */
const ACCOUNT_DAYS = 7;
/** Events of one kind this close together are one burst, one line, however
 *  other kinds interleave (adding a player logs "claim added" and then
 *  "recording started", so a run of follows alternates the two). */
const ACCOUNT_BURST_MS = 10 * 60_000;
/** How many of an account's events one read folds: a burst past this is
 *  still one line, counted from what was read. */
const ACCOUNT_READ_CAP = 500;
/** Kinds the bell does not tell: sign-ins are in Settings › Sign-ins &
 *  devices, and answers to feedback are their own section. */
const NOT_ACCOUNT_LINES = ["signed_in", "feedback_responded"];
/** How many reads of the bell one person may make in an hour: the dot reads
 *  it every few minutes, and opening the sheet reads it again. */
export const BELL_READS_PER_HOUR = 120;

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

/** Other people's cheers on your own players' items of the last seven
 *  days (the cheer window), grouped by item. */
async function readReactions(db, accountId, own, seen, { wake, perf }) {
  if (own.length === 0) return { items: [], new: 0 };
  const week = await readBellWeek(db, accountId, { own, wake });
  if (perf) {
    perf.stored = week.stored;
    perf.age_ms = week.ageMs;
  }
  const byId = new Map(week.items.map((it) => [it.id, it]));
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

/** Your account's own lines, each burst of one kind folded into one: what
 *  it is, how many players and clans it names (a few by name, for a line
 *  about one), when it last moved, and whether that was since you last
 *  opened the bell. Names are the game's, never a nickname. */
async function readAccountLines(db, accountId, seen) {
  const { rows } = await db.query(
    `select e.kind, e.created_at,
            e.detail->>'player_tag' as player_tag,
            e.detail->>'clan_tag' as clan_tag,
            coalesce(p.name, c.name) as name
       from account_event e
       left join player p on p.player_tag = e.detail->>'player_tag'
       left join clan c
         on e.detail->>'player_tag' is null
        and c.clan_tag = e.detail->>'clan_tag'
      where e.account_id = $1
        and e.created_at > now() - make_interval(days => $2)
        and e.kind <> all($3::text[])
      order by e.created_at desc, e.event_id desc
      limit $4`,
    [accountId, ACCOUNT_DAYS, NOT_ACCOUNT_LINES, ACCOUNT_READ_CAP],
  );
  return foldAccountLines(rows, seen);
}

/** Rows newest first → lines newest first. Pure, for the tests. */
export function foldAccountLines(rows, seen) {
  const seenMs = seen ? new Date(seen).getTime() : null;
  const lines = [];
  const open = new Map();
  for (const r of rows) {
    const at = new Date(r.created_at).getTime();
    let line = open.get(r.kind);
    if (!line || line.oldestMs - at > ACCOUNT_BURST_MS) {
      line = {
        kind: r.kind,
        at: new Date(at).toISOString(),
        oldestMs: at,
        events: 0,
        players: new Map(),
        clans: new Map(),
      };
      open.set(r.kind, line);
      lines.push(line);
    }
    line.oldestMs = at;
    line.events += 1;
    if (r.player_tag) line.players.set(r.player_tag, r.name ?? null);
    else if (r.clan_tag) line.clans.set(r.clan_tag, r.name ?? null);
  }
  const items = lines.slice(0, LIST_CAP).map((l) => {
    const named = [...l.players, ...l.clans].slice(0, 3);
    return {
      kind: l.kind,
      at: l.at,
      events: l.events,
      players: l.players.size,
      clans: l.clans.size,
      subjects: named.map(([tag, name]) => ({
        tag,
        name,
        kind: l.players.has(tag) ? "player" : "clan",
      })),
      new: seenMs === null || Date.parse(l.at) > seenMs,
    };
  });
  return { items, new: items.filter((i) => i.new).length };
}

function clip(text, max) {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** The bell's four sections and how many things in them are new. */
export async function readBell(
  db,
  accountId,
  { wake = null, perf = null } = {},
) {
  const seen = await seenAt(db, accountId);
  const own = await ownVerifiedPlayers(db, accountId);
  const reactions = await readReactions(db, accountId, own, seen, {
    wake,
    perf,
  });
  const followers = await readFollowers(db, accountId, own, seen);
  const answers = await readAnswers(db, accountId);
  const account = await readAccountLines(db, accountId, seen);
  return {
    seen_at: seen,
    players: own.length,
    new: reactions.new + followers.new + answers.new + account.new,
    reactions,
    followers,
    answers,
    account,
  };
}
