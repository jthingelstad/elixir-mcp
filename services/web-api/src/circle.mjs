/**
 * Your circle this week (Jamie, 2026-11-16: "I love 'your circle this
 * week'... a way to show close friends versus just follows"): how each of
 * the players you marked a close friend (claim.close, 0281) played since
 * Monday's reset, the week Your week reads.
 *
 * Facts only, and nobody is ranked: each friend's battles, days played
 * and sittings this week, and at most two of the moments the timeline
 * already told about them, in the timeline's own words. The order is when
 * they last played, newest first; a friend with no battle recorded this
 * week follows, in name order, said as a fact ("No battles this week")
 * and never as a nudge. No rate, no wins against losses, no comparison:
 * modes are different games, and a count of battles pools no rate.
 *
 * Two statements and the stored week, whatever the circle's size, and
 * every marked friend in the answer: follows can pass the player slots
 * (a player already recorded, staff), so no cap would be safe to drop at.
 *
 * - the marks and each friend's battles (`friendsWeek`): one statement, a
 *   range of each friend's own (player_tag, battle_time) cover, boat
 *   defenses out (they are not the member's battle);
 * - the sittings and moments come from Home's stored week (home_feed),
 *   the same read the feed serves, never the record again, and never a
 *   read per friend. A friend whose sittings the stored week does not hold
 *   (notify off, or past a busy week's cap) still has their battles; the
 *   row then names no sitting rather than guess.
 *
 * With no close friend marked, the circle offers some instead: up to six
 * of the players you follow, the ones who follow you back first, then your
 * clanmates, then the rest in name order. Each says why as a fact.
 *
 * The mark is the reader's own. This read answers only the reader, and
 * nothing in it reaches another member, the bell, mail or MCP.
 */
import { notBoatDefense } from "@elixir-mcp/record/boat-defense-sql";
import { gameWeekStartMs } from "@elixir-mcp/record/form";
import { shownAt } from "@elixir-mcp/tools/activity/entries";
import { readHomeWeek } from "@elixir-mcp/tools/activity/home-feed";
import { verifiedAvatars } from "./avatars.mjs";
import { homeClan } from "./routes/clans.mjs";

/** A sitting: Home's session card draws these kinds. */
const SITTINGS = new Set(["battle_session", "session_standout"]);
/** Items that are about a clan or a person's account, not their play. */
const NOT_MOMENTS = new Set([
  "battle_highlight",
  "member_joined",
  "member_left",
  "member_role_changed",
]);
/** At most this many moments a friend, newest first. */
const MOMENTS_MAX = 2;
/** At most this many suggestions while nobody is marked. */
const SUGGEST_MAX = 6;

/** Your own players, as a subquery on $1. */
const OWN = `select player_tag from claim where account_id = $1
  and (is_primary or relationship in ('primary', 'alt'))`;

/**
 * The marks and each friend's week from the record, in one statement:
 * battles since `fromMs`, the days they fell on in the reader's time zone,
 * and the last one. A friend with none has zeros and a null.
 */
async function friendsWeek(db, accountId, { fromMs, timezone }) {
  const { rows } = await db.query(
    `select c.player_tag, p.name, w.battles, w.days, w.last_at
       from claim c
       cross join lateral (
         select p.name from player p where p.player_tag = c.player_tag
          limit 1) p
       cross join lateral (
         select count(*)::int as battles,
                count(distinct (bp.battle_time at time zone $3)::date)::int
                  as days,
                max(bp.battle_time) as last_at
           from battle_participant bp
          where bp.player_tag = c.player_tag
            and bp.battle_time >= $2::timestamptz
            and ${notBoatDefense("bp", { lookupByKey: true })}) w
      where c.account_id = $1 and c.close
      order by c.player_tag`,
    [accountId, new Date(fromMs).toISOString(), timezone],
  );
  return rows;
}

/** The tags an item names. */
const tagsOf = (it) =>
  new Set(
    [it.subject_tag, ...(it.subjects ?? []).map((s) => s.tag)].filter(Boolean),
  );

/** Whether an item is a moment about a player's play: not a sitting, a
 *  post about a battle, a clan's line or an account's news. */
const isMoment = (it) =>
  !SITTINGS.has(it.kind) &&
  !NOT_MOMENTS.has(it.kind) &&
  it.section !== "people" &&
  (it.subjects ?? []).some((s) => s.kind === "player");

/**
 * Each friend's sittings and moments this week, from the stored week's
 * items. Pure: the items and the week's start in, a map by tag out, each
 * `{ sittings, session, moments }`, `session` the newest sitting that has
 * a page (`{ id, started_at }`).
 */
export function circleItems(items, tags, fromMs) {
  const out = new Map(
    [...tags].map((t) => [t, { sittings: 0, session: null, moments: [] }]),
  );
  const newest = [...(items ?? [])]
    .filter((it) => Date.parse(shownAt(it)) >= fromMs)
    .sort((a, b) => Date.parse(shownAt(b)) - Date.parse(shownAt(a)));
  for (const it of newest) {
    const sitting = SITTINGS.has(it.kind);
    const moment = !sitting && isMoment(it);
    if (!sitting && !moment) continue;
    for (const tag of tagsOf(it)) {
      const row = out.get(tag);
      if (!row) continue;
      if (sitting) {
        // A sitting is its player's: a 2v2 partner it names has their own.
        if ((it.facts?.player_tag ?? it.subject_tag) !== tag) continue;
        row.sittings += 1;
        if (!row.session && it.id && it.evidence?.kind === "session")
          row.session = { id: it.id, started_at: it.facts?.started_at ?? null };
      } else if (
        row.moments.length < MOMENTS_MAX &&
        typeof it.text === "string"
      )
        row.moments.push({ kind: it.kind, text: it.text });
    }
  }
  return out;
}

/** The circle's order: who played most recently first, then the friends
 *  with no battle this week by name. Never by how they played. */
export function circleOrder(a, b) {
  const at = (r) => (r.last_battle_at ? Date.parse(r.last_battle_at) : null);
  const x = at(a);
  const y = at(b);
  if (x !== null && y !== null && x !== y) return y - x;
  if (x !== null && y === null) return -1;
  if (x === null && y !== null) return 1;
  return String(a.name ?? a.tag).localeCompare(String(b.name ?? b.tag));
}

/**
 * The players to offer while no close friend is marked: the reader's
 * friend follows, each with why as a fact, follows back first, then
 * clanmates, then the rest in name order. One statement.
 */
async function suggestions(db, accountId) {
  const home = await homeClan(db, accountId);
  const { rows } = await db.query(
    `with own as (${OWN})
     select c.player_tag, p.name,
            exists (
              select 1 from claim v
               where v.player_tag = c.player_tag and v.status = 'verified'
                 and (v.is_primary or v.relationship in ('primary', 'alt'))
                 and v.account_id <> $1
                 and (exists (select 1 from account_follow f
                               where f.account_id = v.account_id
                                 and f.followed_account_id = $1)
                      or exists (select 1 from claim back
                                  where back.account_id = v.account_id
                                    and back.relationship = 'friend'
                                    and back.player_tag in (select player_tag from own)))
            ) as follows_you,
            ($2::text is not null and p.clan_tag = $2::text) as clanmate
       from claim c
       cross join lateral (
         select p.name, p.last_known_clan_tag as clan_tag from player p
          where p.player_tag = c.player_tag limit 1) p
      where c.account_id = $1 and c.relationship = 'friend'
        and not c.is_primary and not c.close
      order by follows_you desc, clanmate desc, lower(p.name), c.player_tag
      limit ${SUGGEST_MAX}`,
    [accountId, home?.clan_tag ?? null],
  );
  return rows.map((r) => ({
    tag: r.player_tag,
    name: r.name ?? null,
    follows_you: r.follows_you === true,
    clanmate: r.clanmate === true,
  }));
}

/** Rows with their verified players' profile images, in one statement. */
async function withFaces(db, rows) {
  const avatars = await verifiedAvatars(
    db,
    rows.map((r) => r.tag),
  );
  return rows.map((r) =>
    avatars.has(r.tag) ? { ...r, avatar_card_id: avatars.get(r.tag) } : r,
  );
}

/**
 * The circle for one reader. `{ from, friends: [...] }` with at least one
 * close friend, else `{ from, friends: [], suggestions: [...] }`.
 */
export async function readCircle(
  db,
  account,
  { timezone, wake = null, now = Date.now() },
) {
  const fromMs = gameWeekStartMs(now);
  const from = new Date(fromMs).toISOString();
  const marked = await friendsWeek(db, account.accountId, {
    fromMs,
    timezone,
  });
  if (marked.length === 0)
    return {
      from,
      friends: [],
      suggestions: await withFaces(
        db,
        await suggestions(db, account.accountId),
      ),
    };
  // Home's stored week, as the feed reads it: built in the background, so
  // this is one row; a cold account builds it once for both reads.
  const week = await readHomeWeek(db, account.accountId, {
    timezone,
    now,
    wake,
  });
  const told = circleItems(
    week?.items ?? [],
    new Set(marked.map((r) => r.player_tag)),
    fromMs,
  );
  const friends = marked.map((r) => {
    const t = told.get(r.player_tag);
    const played = r.battles > 0;
    return {
      tag: r.player_tag,
      name: r.name ?? null,
      battles: r.battles,
      days: r.days,
      last_battle_at: r.last_at ? new Date(r.last_at).toISOString() : null,
      // Sittings only when the stored week told them: a count it cannot
      // see is unknown, never zero.
      sittings: played && t.sittings > 0 ? t.sittings : null,
      session: played ? t.session : null,
      moments: t.moments,
    };
  });
  return { from, friends: await withFaces(db, friends.sort(circleOrder)) };
}
