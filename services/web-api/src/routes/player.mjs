import { checkRateLimit } from "@elixir-mcp/auth";
import {
  addPlayer,
  playerCosts,
  poolLimits,
  poolOwner,
  pooledUsage,
} from "@elixir-mcp/claims";
import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";
import { enqueueJob } from "@elixir-mcp/ledger";
import { makeLive, requestFirstRead } from "@elixir-mcp/tools/live";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import {
  buildTimeline,
  itemVisibility,
  NEWS_SOURCES,
  playerHighlights,
  shownAt,
} from "@elixir-mcp/tools/activity/entries";

import { json } from "../http.mjs";
import { homeClan } from "./clans.mjs";

/**
 * The player page (slice 6, #764) and the follows it starts.
 *
 * Every player name on the web opens one page (Jamie, 2026-11-12: "Yes, one
 * page"), for signed-in members. It shows what DECISIONS "What is public about
 * an account" makes public and nothing past it: the player's game record, the
 * account that verified the player (its follows, its followers and its
 * badges), never a nickname, an email or a Discord username.
 *
 * Follows and followers belong to an account, and an account is named on the
 * page by the player it verified. A player no account has verified has no
 * follows or followers to show [engineering, 2026-11-12: the narrow reading].
 * A follower is named by the player its account verified, game name and tag;
 * an account with no verified player is counted, never named.
 */

/** The page's timeline window, as Home's Timeline reads a week. */
const PAGE_DAYS = 30;
const HIGHLIGHTS = 30;
/** A follow list past this is cut, and the rest are counted. */
const LIST_CAP = 100;
/** One confirmed follow takes at most a clan's worth of players. */
const FOLLOW_ALL_MAX = 50;
const MOMENT_KINDS = new Set(NEWS_SOURCES.player_moments);

const tagOf = (raw) => {
  try {
    return normalizeTag(String(raw ?? ""));
  } catch (err) {
    if (err instanceof InvalidTagError) return null;
    throw err;
  }
};

/** A list of tags, comma-separated (a Follow me link's own spelling), each
 *  normalized, duplicates once, in the order given. Null when any is not a
 *  tag, so a bad link says so rather than following part of it. */
export function tagsOf(raw) {
  const parts = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out = [];
  for (const p of parts) {
    const t = tagOf(p);
    if (!t) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** The trophies on the player's latest snapshot. */
async function latestTrophies(db, tag) {
  const { rows } = await db.query(
    `select trophies from player_snapshot_daily where player_tag = $1
      order by snapshot_date desc, snapshot_kind desc limit 1`,
    [tag],
  );
  return rows[0]?.trophies ?? null;
}

/** The account that verified the player as itself: one at most, since
 *  verifying ends every other account's claim to be them (#556). People
 *  only; an agent never claims a player as itself. */
async function verifiedAccount(db, tag) {
  const { rows } = await db.query(
    `select c.account_id,
            exists (select 1 from account_discord d
                     where d.account_id = c.account_id) as discord
       from claim c join account a using (account_id)
      where c.player_tag = $1 and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
        and coalesce(a.kind, 'person') = 'person'
      order by c.verified_at limit 1`,
    [tag],
  );
  return rows[0] ?? null;
}

/** Who the account follows: its friends (Home's Follow), by game name and
 *  tag. Watched players and its agents' players are not follows. */
async function followsOf(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag as tag, p.name, count(*) over ()::int as total
       from claim c left join player p using (player_tag)
      where c.account_id = $1 and c.relationship = 'friend'
        and not c.is_primary
      order by lower(coalesce(p.name, c.player_tag)), c.player_tag
      limit $2`,
    [accountId, LIST_CAP],
  );
  return {
    count: rows[0]?.total ?? 0,
    players: rows.map((r) => ({ tag: r.tag, name: r.name ?? null })),
  };
}

/** Who follows the player: people with a friend claim on them, each named
 *  by the player their account verified (game name and tag), the rest
 *  counted. The account that is the player is not its own follower. */
async function followersOf(db, tag, selfAccountId) {
  const { rows } = await db.query(
    `select f.account_id, v.player_tag as tag, p.name
       from claim f
       join account a on a.account_id = f.account_id
       left join lateral (
         select c.player_tag from claim c
          where c.account_id = f.account_id and c.status = 'verified'
            and (c.is_primary or c.relationship in ('primary', 'alt'))
          order by c.is_primary desc, c.verified_at limit 1) v on true
       left join player p on p.player_tag = v.player_tag
      where f.player_tag = $1 and f.relationship = 'friend'
        and coalesce(a.kind, 'person') = 'person'
        and f.account_id is distinct from $2
      order by lower(coalesce(p.name, v.player_tag)) nulls last, v.player_tag`,
    [tag, selfAccountId],
  );
  const named = rows.filter((r) => r.tag);
  return {
    count: rows.length,
    players: named
      .slice(0, LIST_CAP)
      .map((r) => ({ tag: r.tag, name: r.name ?? null })),
    unnamed: rows.length - Math.min(named.length, LIST_CAP),
  };
}

/** The reader and this player: theirs, followed, or a member of the reader's
 *  home clan (which door Ladder and Clan are on the page). */
async function readerSide(db, accountId, tag, clanTag) {
  const { rows } = await db.query(
    `select is_primary, relationship from claim
      where account_id = $1 and player_tag = $2`,
    [accountId, tag],
  );
  const claim = rows[0] ?? null;
  const own = Boolean(
    claim &&
    (claim.is_primary || ["primary", "alt"].includes(claim.relationship)),
  );
  const home = await homeClan(db, accountId);
  return {
    own,
    following: Boolean(claim) && !own,
    relationship: own ? "own" : (claim?.relationship ?? null),
    clanmate:
      !own && home && clanTag && home.clan_tag === clanTag
        ? home.clan_tag
        : null,
  };
}

/** One item, as the page draws it: its sentence and, for a highlight, its
 *  battle. Never its facts whole: the page needs none of the rest. */
const pageItem = (it) => ({
  id: it.id ?? null,
  kind: it.kind,
  at: shownAt(it) || it.at || null,
  text: String(it.text ?? ""),
  ...(it.kind === "battle_highlight"
    ? {
        words: it.facts?.words ?? null,
        battle_url: it.facts?.battle?.url ?? null,
      }
    : {}),
});

/** The whole page, for one signed-in reader. */
export async function readPlayerPage(db, account, tag, now = Date.now()) {
  const { rows } = await db.query(
    `select p.player_tag, p.name, cm.clan_tag, cl.name as clan_name,
            exists (select 1 from recording r where r.subject_type = 'player'
                     and r.subject_tag = p.player_tag and r.status = 'active')
              as recorded
       from player p
       left join clan_membership cm on cm.player_tag = p.player_tag
        and cm.left_observed_at is null
       left join clan cl on cl.clan_tag = cm.clan_tag
      where p.player_tag = $1
      limit 1`,
    [tag],
  );
  const p = rows[0];
  if (!p) return null;
  const timezone = account.timezone ?? "UTC";
  const self = await verifiedAccount(db, tag);
  // The reader's own nickname for this player never reaches the page, and
  // nobody else's does either: the subject goes in with no nickname.
  const subjects = [
    { kind: "player", tag, relationship: null, nickname: null },
  ];
  const built = await buildTimeline(db, subjects, {
    fromMs: now - PAGE_DAYS * 86_400_000,
    toMs: now,
    timezone,
    // No account: none of the reader's own items, and no attested fact,
    // which has its own reader rules. The page is the public record.
    accountId: null,
    basis: "occurred",
    filter: (it) => itemVisibility(it) === "public",
  });
  const timeline = (built.timeline ?? []).map(pageItem);
  const highlights = (
    await playerHighlights(db, tag, { timezone, limit: HIGHLIGHTS, now })
  ).map(pageItem);
  return {
    player: {
      tag: p.player_tag,
      name: p.name ?? null,
      clan_tag: p.clan_tag ?? null,
      clan_name: p.clan_name ?? null,
      trophies: await latestTrophies(db, tag),
      recorded: p.recorded === true,
    },
    you: await readerSide(db, account.accountId, tag, p.clan_tag),
    badges: {
      verified_player: Boolean(self),
      // That the account linked a Discord, never which.
      discord: self?.discord === true,
    },
    // No verified account, nothing to show: follows are an account's.
    follows: self ? await followsOf(db, self.account_id) : null,
    followers: self ? await followersOf(db, tag, self.account_id) : null,
    window_days: PAGE_DAYS,
    timeline,
    timeline_more: built.timeline_more ?? 0,
    moments: timeline.filter((it) => MOMENT_KINDS.has(it.kind)),
    highlights,
  };
}

/** What following each of `tags` would cost the reader's pool, as one plan:
 *  each player priced, and how many are free, how many take a slot, how
 *  many the pool follows already, against the slots left. */
export async function followPlan(db, accountId, tags) {
  const owner = await poolOwner(db, accountId);
  const limits = poolLimits(owner);
  const { rows: own } = await db.query(
    `select player_tag from claim where account_id = $1
        and (is_primary or relationship in ('primary', 'alt'))`,
    [accountId],
  );
  const yours = new Set(own.map((r) => r.player_tag));
  const wanted = tags.filter((t) => !yours.has(t));
  const costs = await playerCosts(db, owner.account_id, wanted);
  const { rows: names } = await db.query(
    `select player_tag, name from player where player_tag = any($1::text[])`,
    [wanted],
  );
  const nameOf = new Map(names.map((r) => [r.player_tag, r.name]));
  const used = (await pooledUsage(db, owner.account_id)).players_used;
  const players = costs.map((c) => ({
    player_tag: c.player_tag,
    name: nameOf.get(c.player_tag) ?? null,
    following: c.following,
    free: c.free,
    reason: c.reason,
  }));
  const fresh = players.filter((p) => !p.following);
  const slots = fresh.filter((p) => !p.free).length;
  const limit = limits.player_slots === Infinity ? null : limits.player_slots;
  return {
    players,
    yours: tags.filter((t) => yours.has(t)),
    to_follow: fresh.length,
    free: fresh.length - slots,
    slots,
    following: players.length - fresh.length,
    used,
    limit,
    fits: limit == null || used + slots <= limit,
  };
}

/** The plain words for a follow-all refused at the limit. */
export function followAllRefusal(plan) {
  const left = Math.max(0, plan.limit - plan.used);
  return `Following everyone here needs ${plan.slots} player slot${plan.slots === 1 ? "" : "s"} and ${left} of your ${plan.limit} ${left === 1 ? "is" : "are"} left (${plan.used} in use). Nobody was followed. Following a player Elixir already records stays free: a member of a clan recorded in full, or a player another account follows.`;
}

/** A clan's current members, for follow-my-clan. */
async function clanMembers(db, clanTag) {
  const { rows } = await db.query(
    `select player_tag from clan_membership
      where clan_tag = $1 and left_observed_at is null
      order by player_tag limit $2`,
    [clanTag, FOLLOW_ALL_MAX],
  );
  return rows.map((r) => r.player_tag);
}

/** The players a plan or a follow-all names: `player_tags` (a Follow me
 *  link's), or `clan_tag` (everyone in that clan now). */
async function namedPlayers(db, { player_tags, clan_tag }) {
  if (clan_tag != null && clan_tag !== "") {
    const clan = tagOf(clan_tag);
    if (!clan) return { error: "invalid_tag" };
    return { tags: await clanMembers(db, clan), clan_tag: clan };
  }
  const tags = tagsOf(player_tags);
  if (!tags) return { error: "invalid_tag" };
  if (tags.length > FOLLOW_ALL_MAX) return { error: "too_many" };
  return { tags, clan_tag: null };
}

const named = (r) =>
  r.error === "too_many"
    ? json(400, {
        error: "too_many",
        message: `Name at most ${FOLLOW_ALL_MAX} players at once.`,
      })
    : json(400, { error: "invalid_tag" });

export function playerRoutes({ resolveAccount, live = null }) {
  const liveRead = live ?? makeLive({ enqueue: enqueueJob });
  const rate = (db, account) =>
    checkRateLimit(db, {
      bucket: `mcp#${account.accountId}`,
      max: HOURLY_RATE_LIMIT,
    });
  return {
    // The player page: one read, one charge on the hourly bucket /mcp and
    // Explore share.
    "GET /api/player": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const tag = tagOf(event.queryStringParameters?.tag);
      if (!tag) return json(400, { error: "invalid_tag" });
      if (!(await rate(db, account)))
        return json(429, { error: "rate_limited" });
      const page = await readPlayerPage(db, account, tag);
      if (!page)
        return json(404, {
          error: "not_found",
          message: "Elixir has not recorded that player.",
        });
      return json(200, page);
    },

    // What following several players would cost, said before the tap: a
    // Follow me link's players, or everyone in a clan.
    "GET /api/me/follow-plan": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const q = event.queryStringParameters ?? {};
      const asked = await namedPlayers(db, q);
      if (asked.error) return named(asked);
      const plan = await followPlan(db, account.accountId, asked.tags);
      return json(200, { clan_tag: asked.clan_tag, ...plan });
    },

    // Follow every one of them, in one confirmed act. Priced again here, and
    // refused whole, never in part, when the slots it needs are not left.
    "POST /api/me/follow-all": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      if (account.kind === "agent") return json(403, { error: "not_entitled" });
      const asked = await namedPlayers(db, body ?? {});
      if (asked.error) return named(asked);
      const plan = await followPlan(db, account.accountId, asked.tags);
      if (!plan.fits)
        return json(429, {
          error: "quota_exceeded",
          message: followAllRefusal(plan),
          used: plan.used,
          limit: plan.limit,
          slots: plan.slots,
        });
      const followed = [];
      for (const p of plan.players) {
        if (p.following) continue;
        const r = await addPlayer(db, account, {
          tag: p.player_tag,
          follow: true,
          via: "web",
        });
        if (!r.ok) {
          // A slot taken meanwhile, or no player of your own: stop and say
          // how far it got.
          return json(r.error === "quota_exceeded" ? 429 : 409, {
            error: r.error,
            message:
              r.error === "no_own_player"
                ? "Add your own player first."
                : (r.message ?? "That did not work. Try again."),
            followed,
          });
        }
        followed.push(p.player_tag);
        // A player Elixir starts recording because of this gets their first
        // read; one already recorded has theirs.
        if (r.recordingStarted)
          await requestFirstRead(db, liveRead, p.player_tag, account.accountId);
      }
      return json(200, { ok: true, followed, clan_tag: asked.clan_tag });
    },
  };
}
