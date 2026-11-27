/**
 * People to follow (Home's side panel) and Find's From your battles and Your
 * clan sections (2026-11-12, the canvas's remaining pieces).
 *
 * Every person here is named by their game name and tag, never a nickname,
 * and carries what following them would cost (`playerCosts`: free when
 * Elixir records them already, else a slot). Each says why they are here as
 * a fact from the record: you played them, they are in your clan, a player
 * you follow played a friendly battle with them, a player you follow
 * follows them. Nothing here is ranked by skill or record:
 * DECISIONS "Facts, not advice" and "No player rating". The order is by
 * the facts themselves (how often you met, then how recently; how many of
 * the players you follow follow them), never by trophies, wins or level.
 *
 * Who an account follows is public among members only for an account that
 * verified a player (DECISIONS "What is public about an account"), so the
 * friends-follow source reads only those, and names each by the player it
 * verified.
 */
import {
  playerCosts,
  currentClanmates,
  currentOwnClansSql,
  clanmatePlayersSql,
  playerConnections,
  poolLimits,
  poolOwner,
  pooledUsage,
  ownerBlockedSql,
  visibleFriendSql,
} from "@elixir-mcp/claims";
import { CLANMATE_TYPES, FRIENDLY_TYPES } from "@elixir-mcp/contracts";
import { notBoatDefense } from "@elixir-mcp/record/boat-defense-sql";
import { readNearYou, readPlayerMap } from "@elixir-mcp/auth/clan-context";
import { MAP_ATTRIBUTION, placeName, resolvePlace } from "./player-places.mjs";
import { clanPlay } from "./clan-play.mjs";
import { FOLLOW_ALL_MAX, followPlan } from "./routes/player.mjs";

/** The side panel's window and size. */
const SUGGEST_DAYS = 7;
const SUGGEST_MAX = 5;
/** An opponent met once is the ladder's draw; twice in a week is a fact
 *  worth saying. A teammate (2v2) counts once. */
const MET_AT_LEAST = 2;
/** Find's From your battles: a month, at most this many. */
const BATTLES_DAYS = 30;
const BATTLES_MAX = 30;
/** Your friends' friendly battles (2026-11-27): a month on Home's panel
 *  and on Find alike, since friendlies are sparse [engineering]. */
const FRIEND_FRIENDLY_DAYS = 30;

/** The account's own players: never suggested to it. */
const OWN_SQL = `select player_tag from claim where account_id = $1
  and (is_primary or relationship in ('primary', 'alt'))`;

/** Everyone the account already has a claim on: its own, its follows, its
 *  followed players. None of them is suggested. */
const CLAIMED_SQL = `select player_tag from claim where account_id = $1`;

/** The players the account's own players met in the window: opponents and
 *  2v2 teammates, each with how often, how it went for you (your side's
 *  outcome), when last, and their clan then. A battle counts once however
 *  many of your players were in it. `friendly` counts the friendly battles
 *  against them (FRIENDLY_TYPES: a friend's invite) and `clanmate_battles`
 *  the clan-chat friendlies (CLANMATE_TYPES), both the record's own battle
 *  types from @elixir-mcp/contracts. The people who show who you know come
 *  first (2026-11-13): a friendly battle, then a 2v2 teammate, then the
 *  rest by how often and how recently. Never by trophies, wins or a score.
 *
 *  A boat battle is never a meeting (2026-11-23): one side attacked the
 *  other's clan boat, whose defense is a static deck, so nobody played
 *  anybody. Its participant row's own type says so (boatBattleSide is
 *  sent for boat battles only), so no battle lookup is needed to leave
 *  it out; the pair record (record/player-pair.mjs) applies the same rule.
 *
 *  Each of your players is one range of its own player/time cover, never
 *  `player_tag = any(...)`; each battle's other side is read by its key. */
async function metInBattles(db, accountId, days, exclude) {
  const { rows } = await db.query(
    `with own as (${OWN_SQL}),
     mine as (
       select distinct on (me.battle_id) me.battle_id, me.side, me.outcome,
              me.battle_time, me.type
         from own
         cross join lateral (
           select bp.battle_id, bp.side, bp.outcome, bp.battle_time, bp.type,
                  bp.player_tag
             from battle_participant bp
            where bp.player_tag = own.player_tag
              and bp.battle_time >= now() - make_interval(days => $2)
              and bp.type <> 'boatBattle') me
        order by me.battle_id, me.player_tag)
     select o.player_tag, p.name,
            count(*) filter (where o.side <> m.side)::int as against,
            count(*) filter (where o.side = m.side)::int as with_you,
            count(*) filter (where o.side <> m.side and m.type = any($4::text[]))::int as friendly,
            count(*) filter (where o.side <> m.side and m.type = any($5::text[]))::int as clanmate_battles,
            count(*) filter (where o.side <> m.side and m.outcome = 'win')::int as wins,
            count(*) filter (where o.side <> m.side and m.outcome = 'loss')::int as losses,
            count(*) filter (where o.side <> m.side and m.outcome = 'draw')::int as draws,
            max(m.battle_time) as last_met,
            (array_agg(o.clan_tag order by m.battle_time desc))[1] as clan_tag
       from mine m
       -- OFFSET 0 keeps it a probe of each battle's key: flattened into a
       -- join, the planner guessed thousands of battles in mine and hashed
       -- every participant row in the record (13,060 buffers, 2026-11-13).
       cross join lateral (
         select o.player_tag, o.side, o.clan_tag from battle_participant o
          where o.battle_id = m.battle_id
            and o.player_tag <> all($3::text[])
            and o.player_tag not in (select player_tag from own)
         offset 0) o
       join player p on p.player_tag = o.player_tag
      group by o.player_tag, p.name
      order by (count(*) filter (where o.side <> m.side and m.type = any($4::text[])) > 0) desc,
               (count(*) filter (where o.side = m.side) > 0) desc,
               count(*) desc, max(m.battle_time) desc, o.player_tag`,
    [accountId, days, exclude, FRIENDLY_TYPES, CLANMATE_TYPES],
  );
  return rows;
}

/** Players followed by the accounts that verified the players this account
 *  follows. Each counts how many of those follow them and names one by the
 *  player it verified (the earliest name in order, so the line is stable). */
async function followedByFriends(db, accountId, exclude) {
  const { rows } = await db.query(
    `with friends as (
       select c.player_tag from claim c
        where c.account_id = $1 and ${visibleFriendSql("c")}),
     theirs as (
       select distinct on (v.account_id) v.account_id, v.player_tag as via_tag
         from claim v join account a on a.account_id = v.account_id
        where v.player_tag in (select player_tag from friends)
          and v.status = 'verified'
          and (v.is_primary or v.relationship in ('primary', 'alt'))
          and coalesce(a.kind, 'person') = 'person'
          and v.account_id <> $1
        order by v.account_id, v.verified_at)
     select f.player_tag, p.name,
            count(distinct t.account_id)::int as friends,
            (array_agg(t.via_tag order by lower(coalesce(vp.name, t.via_tag)), t.via_tag))[1] as via_tag,
            (array_agg(vp.name order by lower(coalesce(vp.name, t.via_tag)), t.via_tag))[1] as via_name
       from claim f
       join theirs t on t.account_id = f.account_id
       left join player p on p.player_tag = f.player_tag
       left join player vp on vp.player_tag = t.via_tag
      where ${visibleFriendSql("f")}
        and f.player_tag <> all($2::text[])
      group by f.player_tag, p.name
      order by count(distinct t.account_id) desc,
               lower(coalesce(p.name, f.player_tag)), f.player_tag`,
    [accountId, exclude],
  );
  return rows;
}

/** The players your friends (the players you follow, as `followedByFriends`
 *  reads them) played friendly battles with in the window (2026-11-27;
 *  Jamie: "Tyler is my friend and I may know some of the folks he does
 *  friendly battles with"). A friendly is the friend's own participant row
 *  typed FRIENDLY_TYPES (a friend's invite) or CLANMATE_TYPES (clan chat),
 *  so never a boat battle; everyone else in it counts, opponents and 2v2
 *  teammates alike. One battle is enough; a battle counts once however
 *  many of your friends were in it. Each row says how many such battles,
 *  when last, how many of your friends played them, and names the friend
 *  who played them most (ties by name, then tag, so the line is stable).
 *  Ranked by how many, then how recently, then tag: never by trophies,
 *  wins or a score.
 *
 *  Nobody across a block: not a candidate whose verified owner is in a
 *  block with you, either way, nor a friend's battle with someone their
 *  owner is in a block with (as `followedByFriends` leaves out that edge).
 *  The exclude list holds your claims and current clanmates, so a friend
 *  is never suggested back to you, nor your clanmate from a clan-chat
 *  friendly.
 *
 *  Each friend is one range of its own player/time cover, never
 *  `player_tag = any(...)`; each battle's other players are read by its
 *  key. */
async function friendliesOfFriends(db, accountId, days, exclude) {
  const { rows } = await db.query(
    `with own as (${OWN_SQL}),
     friends as (
       select c.player_tag from claim c
        where c.account_id = $1 and ${visibleFriendSql("c")}),
     theirs as (
       select f.player_tag as friend_tag, fr.battle_id, fr.battle_time
         from friends f
         cross join lateral (
           select bp.battle_id, bp.battle_time
             from battle_participant bp
            where bp.player_tag = f.player_tag
              and bp.battle_time >= now() - make_interval(days => $2)
              and bp.type = any($4::text[])) fr),
     met as (
       select o.player_tag, t.friend_tag, t.battle_id, t.battle_time
         from theirs t
         -- OFFSET 0 keeps it a probe of each battle's key, as in
         -- metInBattles: flattened into a join, the planner may hash every
         -- participant row in the record.
         cross join lateral (
           select o.player_tag from battle_participant o
            where o.battle_id = t.battle_id
              and o.player_tag <> t.friend_tag
              and o.player_tag <> all($3::text[])
              and o.player_tag not in (select player_tag from own)
           offset 0) o
        where not exists (
          select 1 from claim fo
           where fo.player_tag = t.friend_tag
             and fo.status = 'verified'
             and (fo.is_primary or fo.relationship in ('primary', 'alt'))
             and ${ownerBlockedSql("fo.account_id", "o.player_tag")})),
     by_friend as (
       select m.player_tag, m.friend_tag,
              count(distinct m.battle_id)::int as battles
         from met m group by m.player_tag, m.friend_tag),
     via as (
       select b.player_tag, count(*)::int as friends,
              (array_agg(b.friend_tag order by b.battles desc,
                 lower(coalesce(fp.name, b.friend_tag)), b.friend_tag))[1] as via_tag,
              (array_agg(fp.name order by b.battles desc,
                 lower(coalesce(fp.name, b.friend_tag)), b.friend_tag))[1] as via_name
         from by_friend b
         left join player fp on fp.player_tag = b.friend_tag
        group by b.player_tag),
     totals as (
       select m.player_tag, count(distinct m.battle_id)::int as battles,
              max(m.battle_time) as last_met
         from met m group by m.player_tag)
     select t.player_tag, p.name, t.battles, t.last_met,
            v.friends, v.via_tag, v.via_name
       from totals t
       join via v on v.player_tag = t.player_tag
       join player p on p.player_tag = t.player_tag
      where not ${ownerBlockedSql("$1::uuid", "t.player_tag")}
      order by t.battles desc, t.last_met desc, t.player_tag`,
    [accountId, days, exclude, [...FRIENDLY_TYPES, ...CLANMATE_TYPES]],
  );
  return rows;
}

/** The pool's slots in use and its limit (null when unlimited). */
async function slotsOf(db, ownerId) {
  const owner = await poolOwner(db, ownerId);
  const limits = poolLimits(owner);
  return {
    owner,
    used: (await pooledUsage(db, owner.account_id)).players_used,
    limit: limits.player_slots === Infinity ? null : limits.player_slots,
  };
}

/** Each tag's cost to follow: free, or a slot. */
async function costsOf(db, ownerId, tags) {
  const costs = await playerCosts(db, ownerId, tags);
  return new Map(
    costs.map((c) => [
      c.player_tag,
      {
        // Recorded for this pool already: free.
        free: c.free || c.following,
        reason: c.reason ?? (c.following ? "recorded_for_you" : null),
      },
    ]),
  );
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** A battle source's reason, as data: the words are the client's. */
const metWhy = (r, days) => ({
  kind: "battles",
  against: r.against,
  with_you: r.with_you,
  friendly: r.friendly,
  clanmate_battles: r.clanmate_battles,
  days,
});

/** Who shows you know them: a friendly battle, or your 2v2 teammate. */
const knownFromBattles = (r) => r.friendly > 0 || r.with_you > 0;

/** Recruiting excludes current automatic connections before source counts
 * and caps, alongside the reader's saved players. */
async function peopleSources(
  db,
  accountId,
  { days, friends = true, automatic = null },
) {
  const { rows: claimed } = await db.query(CLAIMED_SQL, [accountId]);
  const mateTags = automatic
    ? [...automatic.keys()]
    : (
        await db.query(
          `select player_tag from (${clanmatePlayersSql("$1", { names: false })}) current`,
          [accountId],
        )
      ).rows.map((r) => r.player_tag);
  const exclude = [
    ...new Set([...claimed.map((r) => r.player_tag), ...mateTags]),
  ];
  return {
    met: await metInBattles(db, accountId, days, exclude),
    // Second-degree guesses never reach the starter set's pre-ticked
    // follow-all, so it reads neither (friends: false).
    friendFriendlies: friends
      ? await friendliesOfFriends(db, accountId, FRIEND_FRIENDLY_DAYS, exclude)
      : [],
    followed: friends ? await followedByFriends(db, accountId, exclude) : [],
  };
}

/**
 * Suggestions take turns between familiar battle players, the players your
 * Friends played friendly battles with, and players followed by the
 * accounts that verified your Friends. Automatic clanmates
 * are already connected and excluded before this list is formed. A player in more than one source is listed once, with every
 * reason; each is priced from the read itself.
 */
async function suggest(db, accountId, { days, max, keep }) {
  const s = await peopleSources(db, accountId, { days });
  const met = s.met.filter(keep).map((r) => ({
    tag: r.player_tag,
    name: r.name ?? null,
    why: metWhy(r, days),
  }));
  const friends = s.followed.map((r) => ({
    tag: r.player_tag,
    name: r.name ?? null,
    why: {
      kind: "followed_by",
      via: { tag: r.via_tag, name: r.via_name ?? null },
      others: Math.max(0, r.friends - 1),
    },
  }));
  const friendlies = s.friendFriendlies.map((r) => ({
    tag: r.player_tag,
    name: r.name ?? null,
    why: {
      kind: "friend_friendly",
      via: { tag: r.via_tag, name: r.via_name ?? null },
      battles: r.battles,
      others: Math.max(0, r.friends - 1),
      days: FRIEND_FRIENDLY_DAYS,
    },
  }));
  const all = interleave([met, friendlies, friends], Infinity);
  const people = all.slice(0, max);
  const slots = await slotsOf(db, accountId);
  const costs = await costsOf(
    db,
    slots.owner.account_id,
    people.map((p) => p.tag),
  );
  return {
    people: people.map((p) => ({ ...p, ...costs.get(p.tag) })),
    more: all.length - people.length,
    used: slots.used,
    limit: slots.limit,
  };
}

/**
 * Home's People to follow: up to SUGGEST_MAX players from the last week
 * (met twice or more, a friendly battle, or your 2v2 teammate), players
 * your Friends played friendly battles with in the last month, and players
 * your Friends' accounts follow, in turn. Automatic clanmates are excluded.
 */
export async function suggestedPeople(db, accountId) {
  const out = await suggest(db, accountId, {
    days: SUGGEST_DAYS,
    max: SUGGEST_MAX,
    keep: (r) => r.against >= MET_AT_LEAST || knownFromBattles(r),
  });
  // The panel shows what fits and never says how many more.
  delete out.more;
  return out;
}

/** Find's Suggested (2026-11-13): the same sources over a month, enough to
 *  click through. Jamie: "give me a list to just click on of suggested
 *  follows and give me a line on why". */
const FIND_DAYS = BATTLES_DAYS;
const FIND_MAX = 30;

/**
 * Find's Suggested: up to FIND_MAX players from the last month's battles
 * (a friendly battle, your 2v2 teammate, or met twice or more), the players
 * your Friends played friendly battles with, the players your Friends'
 * accounts follow, in turn; `more` counts the
 * rest the sources held.
 */
export async function findPeople(db, accountId) {
  return {
    ...(await suggest(db, accountId, {
      days: FIND_DAYS,
      max: FIND_MAX,
      keep: (r) => r.against >= MET_AT_LEAST || knownFromBattles(r),
    })),
    days: FIND_DAYS,
  };
}

/** The starter set's caps (2026-11-13): about ten that would take a slot,
 *  and never more in all than one follow-all names. */
const STARTER_SLOTS = 10;
const STARTER_MAX = FOLLOW_ALL_MAX;
/** Home offers the set while fewer than this many of the players an
 *  account follows have a recorded battle in the last PLAYED_DAYS, its own
 *  (primary and alts) not counted, nor clans [engineering, 2026-11-13;
 *  engineering, 2026-11-14 (#1016): played, not merely followed, so ten
 *  quiet follows do not end the offer]. A boat defense is not their battle
 *  (boat-defense-sql.mjs), so a raid on their boat is not play. */
const STARTER_UNDER = 5;
const PLAYED_DAYS = 7;
/** How long "Not now" keeps the set off Home's top. */
export const STARTER_HIDDEN_DAYS = 30;

/** Optional Friend suggestions from recorded familiar battles. Current
 * clanmates connect automatically and are returned separately, including
 * when the person has dismissed the voluntary starter offer. */
export async function starterSet(db, accountId) {
  const { rows: gate } = await db.query(
    `select a.starter_hidden_at > now() - make_interval(days => $2) as hidden,
            (select count(*)::int from (
               select 1 from claim c
                where c.account_id = a.account_id and ${visibleFriendSql("c")}
                  and exists (
                    select 1 from battle_participant bp
                     where bp.player_tag = c.player_tag
                       and bp.battle_time >= now() - make_interval(days => $3)
                       and bp.battle_time <= now()
                       and ${notBoatDefense("bp", { lookupByKey: true })})
                limit $4) p) as played,
            (select count(*)::int from claim c
              where c.account_id = a.account_id
                and (c.is_primary or c.relationship in ('primary', 'alt'))) as own
       from account a where a.account_id = $1`,
    [accountId, STARTER_HIDDEN_DAYS, PLAYED_DAYS, STARTER_UNDER],
  );
  // The connection summary is independent of recruiting eligibility.
  const automatic = await currentClanmates(db, accountId);
  const summary = {
    clanmate_count: automatic.size,
    clanmates: [...automatic.values()].map((p) => ({
      tag: p.player_tag,
      name: p.name ?? null,
      connection: p.connection,
      clanmate: p.clanmate,
      shared_clan: p.shared_clan,
      close: p.close,
    })),
  };
  const g = gate[0];
  if (!g || g.hidden || g.played >= STARTER_UNDER)
    return { offer: false, people: [], ...summary };
  if (g.own === 0) return { offer: true, people: [], ...summary };
  const s = await peopleSources(db, accountId, {
    days: BATTLES_DAYS,
    friends: false,
    automatic,
  });
  const met = s.met.filter(
    (r) => knownFromBattles(r) || r.clanmate_battles > 0,
  );
  const slots = await slotsOf(db, accountId);
  const costs = await costsOf(
    db,
    slots.owner.account_id,
    met.map((r) => r.player_tag),
  );
  const freeOf = (tag) => Boolean(costs.get(tag)?.free);
  const candidates = met.map((r) => ({ r, why: metWhy(r, BATTLES_DAYS) }));
  const cap =
    slots.limit == null
      ? STARTER_SLOTS
      : Math.max(0, Math.min(STARTER_SLOTS, slots.limit - slots.used));
  const picked = new Map();
  let paid = 0;
  for (const { r, why } of candidates) {
    const tag = r.player_tag;
    const kept = picked.get(tag);
    if (kept) {
      kept.why.push(why);
      continue;
    }
    if (picked.size >= STARTER_MAX) continue;
    const free = freeOf(tag);
    if (!free && paid >= cap) continue;
    if (!free) paid += 1;
    picked.set(tag, {
      tag,
      name: r.name ?? null,
      why: [why],
      ...costs.get(tag),
    });
  }
  return {
    offer: true,
    people: [...picked.values()],
    used: slots.used,
    limit: slots.limit,
    slots_cap: cap,
    ...summary,
  };
}

/** Up to `max` people from the sources in turn, one new person from each
 *  source a round; a person already listed gains the later source's reason
 *  instead of a second row. */
export function interleave(sources, max) {
  const out = [];
  const byTag = new Map();
  const queues = sources.map((s) => [...s]);
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      while (q.length > 0) {
        const next = q.shift();
        const kept = byTag.get(next.tag);
        if (kept) {
          kept.why.push(next.why);
          continue;
        }
        if (out.length < max) {
          const one = { tag: next.tag, name: next.name, why: [next.why] };
          byTag.set(next.tag, one);
          out.push(one);
        }
        break;
      }
    }
  }
  return out;
}

/** Find's From your battles: everyone your players met in the last month,
 *  opponents and teammates, how often and how it went, most met first. The
 *  players you follow are marked, never hidden. */
export async function battlePeople(db, accountId) {
  const rows = await metInBattles(db, accountId, BATTLES_DAYS, []);
  const shown = rows.slice(0, BATTLES_MAX);
  const connections = await playerConnections(
    db,
    accountId,
    shown.map((r) => r.player_tag),
  );
  const slots = await slotsOf(db, accountId);
  const costs = await costsOf(
    db,
    slots.owner.account_id,
    shown.map((r) => r.player_tag),
  );
  return {
    days: BATTLES_DAYS,
    people: shown.map((r) => ({
      tag: r.player_tag,
      name: r.name ?? null,
      against: r.against,
      with_you: r.with_you,
      friendly: r.friendly,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      last_met: iso(r.last_met),
      following: connections.get(r.player_tag)?.connection === "friend",
      ...connections.get(r.player_tag),
      ...costs.get(r.player_tag),
    })),
    more: Math.max(0, rows.length - shown.length),
    used: slots.used,
    limit: slots.limit,
  };
}

/** Current automatic peers across every verified own player's clan. */
export async function clanPeople(db, accountId) {
  const { rows: clans } = await db.query(
    currentOwnClansSql() + " order by cm.clan_tag",
    [accountId],
  );
  if (!clans.length) {
    const { rows } = await db.query(
      `select exists(select 1 from claim where account_id=$1 and status='verified'
                      and (is_primary or relationship in ('primary','alt'))) as verified`,
      [accountId],
    );
    return {
      clan: null,
      clans: [],
      clanmate_count: 0,
      players: [],
      requires_verification: !rows[0].verified,
    };
  }
  const members = await currentClanmates(db, accountId);
  const overlap = members.size ? await clanPlay(db, accountId) : new Map();
  const clan = { clan_tag: clans[0].clan_tag, name: clans[0].name ?? null };
  const plan = await followPlan(db, accountId, [...members.keys()], {
    connections: members,
  });
  return {
    clan,
    clans: clans.map((c) => ({ clan_tag: c.clan_tag, name: c.name ?? null })),
    clanmate_count: members.size,
    requires_verification: false,
    ...plan,
    shared_clan: clan,
    players: plan.players.map((p) => ({
      ...p,
      role: members.get(p.player_tag)?.role ?? null,
      ...(overlap.has(p.player_tag)
        ? { shared_play: overlap.get(p.player_tag) }
        : {}),
    })),
  };
}

/** "Not now" on Home's starter set: it stays off Home's top for
 *  STARTER_HIDDEN_DAYS. Find still lists everyone. */
export async function hideStarter(db, accountId) {
  const { rows } = await db.query(
    `update account set starter_hidden_at = now() where account_id = $1
     returning starter_hidden_at`,
    [accountId],
  );
  return { hidden_at: rows[0]?.starter_hidden_at?.toISOString() ?? null };
}

/**
 * Find's Near you (#768): the people on the player map in the reader's
 * region (the same country and state or region; a country with no regions
 * is one region), each as the player they verified, with why as a fact
 * ("Plays near you, in <their city, else region>") and what following
 * costs. Never ranked: the reader's city first, then by name. Only for a
 * reader who has set a place; `place: null` otherwise.
 */
export async function nearPeople(db, accountId) {
  const got = await readNearYou(db, { accountId, kind: "person" });
  if (got.refused || !got.place) return { place: null, people: [] };
  const mine = await resolvePlace(got.place);
  if (!mine) return { place: null, people: [] };
  const listed = [];
  for (const p of got.people) {
    const place = await resolvePlace(p.place);
    if (!place) continue;
    listed.push({
      tag: p.player_tag,
      name: p.name ?? null,
      why: [{ kind: "near", place_name: placeName(place) }],
    });
  }
  const slots = await slotsOf(db, accountId);
  const costs = await costsOf(
    db,
    slots.owner.account_id,
    listed.map((p) => p.tag),
  );
  return {
    place: {
      name: placeName(mine),
      region_name: mine.region_name ?? mine.country_name,
    },
    people: listed.map((p) => ({ ...p, ...costs.get(p.tag) })),
    truncated: got.truncated,
    used: slots.used,
    limit: slots.limit,
  };
}

/**
 * The player map (#768): everyone who has set a place, each a pin at their
 * picked place as the clan map draws it (the place's own point and time
 * zone), with their verified player's game name and tag; `you` marks the
 * reader's own.
 */
export async function playerMap(db, accountId) {
  const got = await readPlayerMap(db, { accountId, kind: "person" });
  if (got.refused) return { entries: [], on_map: 0, truncated: false };
  const entries = [];
  for (const e of got.entries) {
    const place = await resolvePlace(e.place);
    if (!place) continue;
    entries.push({
      player_tag: e.player_tag,
      name: e.name,
      you: e.you,
      place,
    });
  }
  return {
    entries,
    on_map: entries.length,
    truncated: got.truncated,
    attribution: MAP_ATTRIBUTION,
  };
}
