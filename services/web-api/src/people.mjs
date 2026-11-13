/**
 * People to follow (Home's side panel) and Find's From your battles and Your
 * clan sections (2026-11-12, the canvas's remaining pieces).
 *
 * Every person here is named by their game name and tag, never a nickname,
 * and carries what following them would cost (`playerCosts`: free when
 * Elixir records them already, else a slot). Each says why they are here as
 * a fact from the record: you played them, they are in your clan, a player
 * you follow follows them. Nothing here is ranked by skill or record:
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
  poolLimits,
  poolOwner,
  pooledUsage,
} from "@elixir-mcp/claims";
import { CLANMATE_TYPES, FRIENDLY_TYPES } from "@elixir-mcp/contracts";
import { homeClan } from "./routes/clans.mjs";
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

/** The account's own players: never suggested to it. */
const OWN_SQL = `select player_tag from claim where account_id = $1
  and (is_primary or relationship in ('primary', 'alt'))`;

/** Everyone the account already has a claim on: its own, its follows, its
 *  watched players. None of them is suggested. */
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
              and bp.battle_time >= now() - make_interval(days => $2)) me
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
       join battle_participant o on o.battle_id = m.battle_id
       join player p on p.player_tag = o.player_tag
      where o.player_tag <> all($3::text[])
        and o.player_tag not in (select player_tag from own)
      group by o.player_tag, p.name
      order by (count(*) filter (where o.side <> m.side and m.type = any($4::text[])) > 0) desc,
               (count(*) filter (where o.side = m.side) > 0) desc,
               count(*) desc, max(m.battle_time) desc, o.player_tag`,
    [accountId, days, exclude, FRIENDLY_TYPES, CLANMATE_TYPES],
  );
  return rows;
}

/** The home clan's members now who are not the account's, nor claimed by
 *  it, in name order. With `lastBattle`, each carries their last battle
 *  time: one probe of the member's own player/time cover, never the
 *  clan's whole history. */
async function clanmates(db, clanTag, exclude, { lastBattle = false } = {}) {
  const { rows } = await db.query(
    `select cm.player_tag, p.name, cm.role${
      lastBattle
        ? `,
            (select max(bp.battle_time) from battle_participant bp
              where bp.player_tag = cm.player_tag) as last_battle`
        : ""
    }
       from clan_membership cm
       left join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null
        and cm.player_tag <> all($2::text[])
      order by lower(coalesce(p.name, cm.player_tag)), cm.player_tag`,
    [clanTag, exclude],
  );
  return rows;
}

/** Players followed by the accounts that verified the players this account
 *  follows. Each counts how many of those follow them and names one by the
 *  player it verified (the earliest name in order, so the line is stable). */
async function followedByFriends(db, accountId, exclude) {
  const { rows } = await db.query(
    `with friends as (
       select player_tag from claim
        where account_id = $1 and relationship = 'friend' and not is_primary),
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
      where f.relationship = 'friend' and not f.is_primary
        and f.player_tag <> all($2::text[])
      group by f.player_tag, p.name
      order by count(distinct t.account_id) desc,
               lower(coalesce(p.name, f.player_tag)), f.player_tag`,
    [accountId, exclude],
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
        // Recorded for this pool already (watched, or an agent's): free.
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

/**
 * The people sources every suggestion reads (2026-11-13: one
 * implementation for Home's side panel, Find's Suggested and the starter
 * set): the account's claimed players, left out of every source; the
 * players its own players met in the last `days` (metInBattles, the
 * friendly battles and 2v2 teammates first); its home clan's current
 * members; and, with `friends`, the players followed by the accounts that
 * verified the players it follows.
 */
async function peopleSources(
  db,
  accountId,
  { days, friends = true, lastBattle = false },
) {
  const { rows: claimed } = await db.query(CLAIMED_SQL, [accountId]);
  const exclude = claimed.map((r) => r.player_tag);
  const met = await metInBattles(db, accountId, days, exclude);
  const home = await homeClan(db, accountId);
  const clan = home
    ? await clanmates(db, home.clan_tag, exclude, { lastBattle })
    : [];
  const followed = friends
    ? await followedByFriends(db, accountId, exclude)
    : [];
  return { met, home, clan, followed };
}

/**
 * Suggestions taken in turn from three sources so no one source fills the
 * list: players your own players met (`met` keeps which), players followed
 * by the accounts that verified the players you follow, and your clan's
 * members. A player in more than one source is listed once, with every
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
  const clan = s.clan.map((r) => ({
    tag: r.player_tag,
    name: r.name ?? null,
    why: { kind: "clan", clan_name: s.home?.name ?? null },
  }));
  const all = interleave([met, friends, clan], Infinity);
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
 * your follows' accounts follow, and your clan, in turn.
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
 * your follows' accounts follow, and your clan, in turn; `more` counts the
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
/** Home offers the set while an account follows fewer players than this,
 *  its own (primary and alts) not counted, nor clans [engineering,
 *  2026-11-13]. */
const STARTER_UNDER = 5;
/** How long "Not now" keeps the set off Home's top. */
export const STARTER_HIDDEN_DAYS = 30;

/**
 * The starter set (2026-11-13): who an account following few players is
 * offered to follow at the top of Home, on every visit until it follows
 * more (Jamie, 2026-11-13: "if someone isn't following players (or a super
 * small amount) that we should bring the suggested user list even if it
 * isn't their first login"), from facts Elixir already has, in this order:
 *
 *  1. clanmates Elixir records already, free to follow (playerCosts), not
 *     counted against the cap;
 *  2. people from your own players' battles of the last BATTLES_DAYS:
 *     friendly-battle opponents, then 2v2 teammates, then clanmates you
 *     battled in clan chat (the battle's own type, FRIENDLY_TYPES and
 *     CLANMATE_TYPES); a free one is not counted against the cap;
 *  3. your other current clanmates, the most recently active first (their
 *     last battle), to fill what is left.
 *
 * At most STARTER_SLOTS that would take a slot (fewer when fewer are
 * left), and STARTER_MAX in all. Offered while the account follows fewer
 * than STARTER_UNDER players and has not said "Not now" in the last
 * STARTER_HIDDEN_DAYS (`account.starter_hidden_at`); an offer may hold
 * nobody, and Home then says where to look instead. Nothing here follows
 * anyone: the set is a list the person ticks and confirms through the one
 * follow-all.
 */
export async function starterSet(db, accountId) {
  const { rows: gate } = await db.query(
    `select a.starter_hidden_at > now() - make_interval(days => $2) as hidden,
            (select count(*)::int from claim c
              where c.account_id = a.account_id and c.relationship = 'friend'
                and not c.is_primary) as following,
            (select count(*)::int from claim c
              where c.account_id = a.account_id
                and (c.is_primary or c.relationship in ('primary', 'alt'))) as own
       from account a where a.account_id = $1`,
    [accountId, STARTER_HIDDEN_DAYS],
  );
  const g = gate[0];
  if (!g || g.hidden || g.following >= STARTER_UNDER)
    return { offer: false, people: [] };
  if (g.own === 0) return { offer: true, people: [] };
  const s = await peopleSources(db, accountId, {
    days: BATTLES_DAYS,
    friends: false,
    lastBattle: true,
  });
  const met = s.met.filter(
    (r) => knownFromBattles(r) || r.clanmate_battles > 0,
  );
  const slots = await slotsOf(db, accountId);
  const costs = await costsOf(db, slots.owner.account_id, [
    ...new Set([
      ...s.clan.map((r) => r.player_tag),
      ...met.map((r) => r.player_tag),
    ]),
  ]);
  const clanName = s.home?.name ?? null;
  const freeOf = (tag) => Boolean(costs.get(tag)?.free);
  const recent = (r) => (r.last_battle ? Date.parse(r.last_battle) : -Infinity);
  const candidates = [
    ...s.clan
      .filter((r) => freeOf(r.player_tag))
      .map((r) => ({
        r,
        why: { kind: "clan", clan_name: clanName, recorded: true },
      })),
    ...met.map((r) => ({ r, why: metWhy(r, BATTLES_DAYS) })),
    ...s.clan
      .filter((r) => !freeOf(r.player_tag))
      .sort(
        (a, b) =>
          recent(b) - recent(a) || (a.player_tag < b.player_tag ? -1 : 1),
      )
      .map((r) => ({
        r,
        why: {
          kind: "clan",
          clan_name: clanName,
          last_battle: iso(r.last_battle),
        },
      })),
  ];
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
  const { rows: follows } = await db.query(
    `select player_tag from claim
      where account_id = $1 and relationship = 'friend' and not is_primary`,
    [accountId],
  );
  const following = new Set(follows.map((r) => r.player_tag));
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
      following: following.has(r.player_tag),
      ...costs.get(r.player_tag),
    })),
    more: Math.max(0, rows.length - shown.length),
    used: slots.used,
    limit: slots.limit,
  };
}

/** Find's Your clan: your primary player's clan now, its members priced as
 *  follow-my-clan prices them. No clan: none. */
export async function clanPeople(db, accountId) {
  const home = await homeClan(db, accountId);
  if (!home) return { clan: null };
  const members = await clanmates(db, home.clan_tag, []);
  const plan = await followPlan(
    db,
    accountId,
    members.map((m) => m.player_tag),
  );
  const role = new Map(members.map((m) => [m.player_tag, m.role ?? null]));
  return {
    clan: { clan_tag: home.clan_tag, name: home.name ?? null },
    ...plan,
    players: plan.players.map((p) => ({
      ...p,
      role: role.get(p.player_tag) ?? null,
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
