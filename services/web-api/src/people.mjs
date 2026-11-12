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
import { homeClan } from "./routes/clans.mjs";
import { followPlan } from "./routes/player.mjs";

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
 *  many of your players were in it. */
async function metInBattles(db, accountId, days, exclude) {
  const { rows } = await db.query(
    `with own as (${OWN_SQL}),
     mine as (
       select distinct on (me.battle_id) me.battle_id, me.side, me.outcome,
              me.battle_time
         from battle_participant me
        where me.player_tag in (select player_tag from own)
          and me.battle_time >= now() - make_interval(days => $2)
        order by me.battle_id, me.player_tag)
     select o.player_tag, p.name,
            count(*) filter (where o.side <> m.side)::int as against,
            count(*) filter (where o.side = m.side)::int as with_you,
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
      order by count(*) desc, max(m.battle_time) desc, o.player_tag`,
    [accountId, days, exclude],
  );
  return rows;
}

/** The home clan's members now who are not the account's, nor claimed by
 *  it, in name order. */
async function clanmates(db, clanTag, exclude) {
  const { rows } = await db.query(
    `select cm.player_tag, p.name, cm.role
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

/**
 * Home's People to follow: up to SUGGEST_MAX players, taken in turn from
 * three sources so no one source fills the panel: players you met in the
 * last week (twice or more, or as your 2v2 teammate), your clan's members,
 * and players followed by players you follow. A player in more than one
 * source is listed once, with every reason.
 */
export async function suggestedPeople(db, accountId) {
  const { rows: claimed } = await db.query(CLAIMED_SQL, [accountId]);
  const exclude = claimed.map((r) => r.player_tag);
  const met = (await metInBattles(db, accountId, SUGGEST_DAYS, exclude))
    .filter((r) => r.against >= MET_AT_LEAST || r.with_you > 0)
    .map((r) => ({
      tag: r.player_tag,
      name: r.name ?? null,
      why: {
        kind: "battles",
        against: r.against,
        with_you: r.with_you,
        days: SUGGEST_DAYS,
      },
    }));
  const home = await homeClan(db, accountId);
  const clan = home
    ? (await clanmates(db, home.clan_tag, exclude)).map((r) => ({
        tag: r.player_tag,
        name: r.name ?? null,
        why: { kind: "clan", clan_name: home.name ?? null },
      }))
    : [];
  const friends = (await followedByFriends(db, accountId, exclude)).map(
    (r) => ({
      tag: r.player_tag,
      name: r.name ?? null,
      why: {
        kind: "followed_by",
        via: { tag: r.via_tag, name: r.via_name ?? null },
        others: Math.max(0, r.friends - 1),
      },
    }),
  );
  const people = interleave([met, clan, friends], SUGGEST_MAX);
  const slots = await slotsOf(db, accountId);
  const costs = await costsOf(
    db,
    slots.owner.account_id,
    people.map((p) => p.tag),
  );
  return {
    people: people.map((p) => ({ ...p, ...costs.get(p.tag) })),
    used: slots.used,
    limit: slots.limit,
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
