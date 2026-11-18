import { handlesOfVerified } from "../handle.mjs";
import { latestSnapshotOrder } from "@elixir-mcp/record/latest-snapshot";
import { checkRateLimit } from "@elixir-mcp/auth";
import {
  addPlayer,
  linkAfterFollow,
  playerCosts,
  poolLimits,
  poolOwner,
  pooledFollows,
  pooledUsage,
} from "@elixir-mcp/claims";
import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";
import { enqueueJob } from "@elixir-mcp/ledger";
import { makeLive, requestFirstRead } from "@elixir-mcp/tools/live";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import { socialOf } from "@elixir-mcp/tools/social";
import { readPlayerPassport } from "@elixir-mcp/stamps";
import { verifiedAvatars, withAvatar } from "../avatars.mjs";
import {
  buildTimeline,
  itemVisibility,
  NEWS_SOURCES,
  readTimelineEvidence,
  sessionDeck,
  sessionSpark,
  shownAt,
} from "@elixir-mcp/tools/activity/entries";

import { battleLinks } from "@elixir-mcp/record/battle-links";
import { proofOf, scoresOf, sparkOf } from "../feed.mjs";
import { claimantsOf } from "../account-page.mjs";
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
 * A Claimed player's page names the accounts claiming it, each linking to
 * its account page (Jamie, 2026-11-15: "This is important so you know what
 * account is making the claim"); `claimants`, from claimantsOf.
 * A follower is named by the player its account verified, game name and tag,
 * else by the player it claims, marked unverified (Jamie, 2026-11-14); an
 * account with no player at all is counted, never named.
 */

/** The page's timeline window, as Home's Timeline reads a week. */
const PAGE_DAYS = 30;
/** One confirmed follow takes at most a clan's worth of players. */
export const FOLLOW_ALL_MAX = 50;
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
      order by ${latestSnapshotOrder()} limit 1`,
    [tag],
  );
  return rows[0]?.trophies ?? null;
}

/** The reader and this player: theirs, followed, or a member of the reader's
 *  home clan (which door Stats and Clan are on the page). */
async function readerSide(db, accountId, tag, clanTag) {
  const { rows } = await db.query(
    // One statement: the reader's claim on the tag, if any, and whether
    // the reader blocked the account that verified it (Codex on #1081).
    `select c.is_primary, c.relationship, c.close,
            exists (
              select 1 from account_block b
                join claim v on v.account_id = b.blocked_account_id
               where b.account_id = $1 and v.player_tag = $2
                 and v.status = 'verified'
                 and (v.is_primary or v.relationship in ('primary', 'alt'))
            ) as blocked
       from (select 1) one
       left join claim c on c.account_id = $1 and c.player_tag = $2`,
    [accountId, tag],
  );
  const claim = rows[0]?.is_primary == null ? null : rows[0];
  const own = Boolean(
    claim &&
    (claim.is_primary || ["primary", "alt"].includes(claim.relationship)),
  );
  const home = await homeClan(db, accountId);
  return {
    own,
    // Following is the reader's own Follow, a friend claim.
    following: !own && claim?.relationship === "friend",
    // A close friend (0281): the reader's own private mark, in the reader's
    // own block, never anywhere another member reads.
    close: !own && claim?.relationship === "friend" && claim?.close === true,
    relationship: own ? "own" : (claim?.relationship ?? null),
    // Whether the reader blocked this player's verified owner
    // (2026-11-16): their own block only, for Unblock in place of Follow
    // and Block. A block the other way is never said.
    blocked: !own && rows[0]?.blocked === true,
    clanmate:
      !own && home && clanTag && home.clan_tag === clanTag
        ? home.clan_tag
        : null,
  };
}

/** The kinds that are a sitting: Home's session row draws them. */
const SITTINGS = new Set(["battle_session", "session_standout"]);

/** The canonical item with the page's common session decoration. Identity,
 * visibility and facts stay attached at the source, for every reader. */
const pageItem = (it, fallbackDeck = null) => {
  const spark = SITTINGS.has(it.kind) ? sparkOf(it) : null;
  const scores = SITTINGS.has(it.kind) ? scoresOf(sessionSpark(it)) : null;
  const deck = SITTINGS.has(it.kind) ? (sessionDeck(it) ?? fallbackDeck) : null;
  return {
    ...it,
    at: shownAt(it) || it.at || null,
    ...(spark ? { spark } : {}),
    ...(scores ? { scores } : {}),
    ...(deck ? { deck } : {}),
  };
};

/** The page's timeline as the record has it now: the player's public items
 *  in the page's window. The page and its games' read build the same one,
 *  so an item's id and evidence version agree between them. */
const pageTimeline = (
  db,
  tag,
  timezone,
  now,
  window = null,
  { publicOnly = false } = {},
) =>
  buildTimeline(
    db,
    // The reader's own nickname for this player never reaches the page, and
    // nobody else's does either: the subject goes in with no nickname.
    [{ kind: "player", tag, relationship: null, nickname: null }],
    {
      fromMs: window?.fromMs ?? now - PAGE_DAYS * 86_400_000,
      toMs: window?.toMs ?? now,
      timezone,
      // No account: none of the reader's own items, and no attested fact,
      // which has its own reader rules. The page is the public record.
      accountId: null,
      basis: "occurred",
      // Its verification on Elixir, told on its page too (2026-11-15).
      people: { accounts: [], players: true },
      // Signed out (the public session page, 2026-11-17): what anyone
      // with the link may read, never a member's.
      filter: (it) =>
        (publicOnly ? ["public"] : ["public", "member"]).includes(
          itemVisibility(it),
        ),
    },
  );

/** The window a session's page reads, from the start its card names: an
 *  hour before it to a day after, so one sitting is read whole and never
 *  falls past the timeline's cap. A start the page cannot read, or one
 *  older than the page's 30 days, reads the page's own window. */
export function sessionWindow(at, now) {
  const start = Date.parse(String(at ?? ""));
  if (!Number.isFinite(start)) return null;
  if (start > now || start < now - PAGE_DAYS * 86_400_000) return null;
  return {
    fromMs: start - 3_600_000,
    toMs: Math.min(now, start + 86_400_000),
  };
}

/** A moment a game in the sitting proved, as a word on that game's row:
 *  the fact the moment names, never a judgement of the game. Null for a
 *  kind with no short word. */
export function markOf(it) {
  const f = it.facts ?? {};
  const n = (v) =>
    typeof v === "number" ? v.toLocaleString("en-US") : String(v);
  switch (it.kind) {
    case "best_trophies_band": {
      const to = f.to ?? f.best ?? f.value;
      return to === undefined || to === null
        ? "New best"
        : `New best: ${n(to)} trophies`;
    }
    case "arena_changed":
      return f.to_name ? `Reached ${f.to_name}` : null;
    case "ranked_promotion":
      return f.to_name ? `Promoted to ${f.to_name}` : null;
    default:
      return null;
  }
}

/** One sitting as its page reads it, for whoever reads: the item as the
 *  card draws it, a page of its games newest first with both sides' decks,
 *  and the moments its games proved. The player page's public timeline,
 *  read in the sitting's window, so the item's id and evidence version are
 *  the ones every card carries. `publicOnly` reads it as nobody (the
 *  public session page): public items only, so a mark is a public
 *  moment's. Null when the record has no such sitting for this player;
 *  `{ error }` when its games' page is refused. */
export async function readSitting(
  db,
  tag,
  {
    id,
    at,
    offset = 0,
    expectedVersion,
    timezone = "UTC",
    publicOnly = false,
  } = {},
  now = Date.now(),
) {
  const { rows } = await db.query(
    "select player_tag, name from player where player_tag = $1",
    [tag],
  );
  if (!rows[0]) return null;
  const window = sessionWindow(at, now);
  // Signed out, the start must be one the page can read: never the
  // fallback of the whole 30 days.
  if (publicOnly && !window) return null;
  const built = await pageTimeline(db, tag, timezone, now, window, {
    publicOnly,
  });
  const timeline = built.timeline ?? [];
  const item = timeline.find((it) => it.id === id && SITTINGS.has(it.kind));
  if (!item) return null;
  const games = await readTimelineEvidence(db, item, {
    offset,
    limit: 25,
    expectedVersion,
    detail: true,
  });
  if (games.error) return { error: games.error, item };
  // The moments this sitting's games proved, each on its game's row. One
  // statement: the proofs that are this player's battles in the sitting.
  const proved = timeline
    .map((it) => [proofOf(it), markOf(it)])
    .filter(([battle, label]) => battle && label);
  let marks = [];
  if (proved.length) {
    const { rows: inside } = await db.query(
      `select battle_id from battle_participant
        where player_tag = $1 and battle_id = any($2::text[])
          and battle_time >= $3::timestamptz and battle_time <= $4::timestamptz`,
      [tag, proved.map(([b]) => b), item.evidence.from, item.evidence.through],
    );
    const ids = new Set(inside.map((r) => r.battle_id));
    marks = proved
      .filter(([b]) => ids.has(b))
      .map(([battle_id, label]) => ({ battle_id, label }));
  }
  return {
    player: { tag: rows[0].player_tag, name: rows[0].name ?? null },
    item: pageItem(item, games.decks?.[0] ?? null),
    games,
    marks,
    // Whether anyone with the link may read it: the public page's gate.
    shareable: itemVisibility(item) === "public",
  };
}

/** One sitting on its own page (2026-11-16), for a signed-in reader:
 *  readSitting, and whether the reader may post about its games. */
export async function readSessionPage(
  db,
  account,
  tag,
  { id, at, offset = 0, expectedVersion } = {},
  now = Date.now(),
) {
  const read = await readSitting(
    db,
    tag,
    {
      id,
      at,
      offset,
      expectedVersion,
      timezone: account.timezone ?? "UTC",
    },
    now,
  );
  if (!read || read.error) return read && { error: read.error };
  const { rows: claims } = await db.query(
    `select status, is_primary, relationship from claim
      where account_id = $1 and player_tag = $2`,
    [account.accountId, tag],
  );
  const claim = claims[0] ?? null;
  return {
    player: read.player,
    you: {
      // As readerSide says it: a primary or an alt is the reader's own.
      own: Boolean(
        claim &&
        (claim.is_primary || ["primary", "alt"].includes(claim.relationship)),
      ),
      // A verified player's games can be posted about from their battle
      // page (battle-posts.mjs battleFor asks the same).
      can_post: claim?.status === "verified",
    },
    item: read.item,
    games: read.games,
    marks: read.marks,
    // Sharing is an explicit capability request, never an enumerable URL.
    shareable: read.shareable,
  };
}

/** The whole page, for one signed-in reader. */
async function readPlayerPage(db, account, tag, now = Date.now()) {
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
  const built = await pageTimeline(db, tag, timezone, now);
  // A moment the record proved names its battle, as Home's feed links it
  // (feed.mjs proofOf): one statement for the page's proofs, and no link
  // where the record does not know the battle.
  const proofs = (built.timeline ?? []).map(proofOf);
  const links = await battleLinks(db, proofs.filter(Boolean));
  // A post about a battle (what was a highlight, 0292) is the page's
  // Posts list's, read as the post it is (GET /api/me/posts?player=), so
  // the record's own line for it is left out here: one item, not two.
  const timeline = (built.timeline ?? [])
    .map((it, i) => {
      if (it.kind === "battle_highlight") return null;
      const item = pageItem(it);
      const link = proofs[i] ? links.get(proofs[i]) : null;
      return link && !item.battle_url
        ? { ...item, battle_url: link.url }
        : item;
    })
    .filter(Boolean);
  // The verified account's badges, follows and followers: the one reader
  // players_follows serves too (@elixir-mcp/tools/social). No verified
  // account, nothing to show: follows are an account's.
  const social = await socialOf(db, tag);
  // The profile images of the page's player and of every player its
  // follows and followers name, in one statement (avatars.mjs). The page's
  // alone: players_follows reads socialOf and never these.
  // A follower named by a claim it never verified draws initials: a
  // profile image belongs to a verified player alone.
  const avatars = await verifiedAvatars(db, [
    tag,
    ...(social.follows?.players ?? []).map((f) => f.tag),
    ...(social.followers?.players ?? [])
      .filter((f) => f.verified !== false)
      .map((f) => f.tag),
  ]);
  // The @handle of the account that verified each listed player
  // (2026-11-15): web only, never players_follows (MCP). A Claimed
  // follower may be claimed by more than one account, so it shows none.
  const handles = await handlesOfVerified(db, [
    ...(social.follows?.players ?? []).map((f) => f.tag),
    ...(social.followers?.players ?? [])
      .filter((f) => f.verified !== false)
      .map((f) => f.tag),
  ]);
  const withHandle = (f) =>
    f.verified !== false && handles.has(f.tag)
      ? { ...f, handle: handles.get(f.tag) }
      : f;
  const faced = (list) =>
    list
      ? {
          ...list,
          players: list.players.map((f) =>
            f.verified === false
              ? f
              : withHandle(withAvatar(f, f.tag, avatars)),
          ),
        }
      : list;
  return {
    player: withAvatar(
      {
        tag: p.player_tag,
        name: p.name ?? null,
        clan_tag: p.clan_tag ?? null,
        clan_name: p.clan_name ?? null,
        trophies: await latestTrophies(db, tag),
        recorded: p.recorded === true,
      },
      tag,
      avatars,
    ),
    you: await readerSide(db, account.accountId, tag, p.clan_tag),
    // Who says they are this player (Jamie, 2026-11-15): the account that
    // verified it, else every account claiming it, each by its page id.
    // Empty: Imported, or not followed at all.
    claimants: await claimantsOf(db, tag),
    ...social,
    follows: faced(social.follows),
    followers: faced(social.followers),
    window_days: PAGE_DAYS,
    timeline,
    timeline_more: built.timeline_more ?? 0,
    moments: timeline.filter((it) => MOMENT_KINDS.has(it.kind)),
    // The verified owner's passport in one row (#1015): the same owner as
    // the badges, a main and an alt alike; null for an unverified claim,
    // nobody's player or an owner with no passport yet. One statement,
    // never a write (packages/stamps store.mjs).
    passport: await readPlayerPassport(db, tag),
  };
}

/** What following each of `tags` would cost the reader's pool, as one plan:
 *  each player priced, and how many are free, how many take a slot, how
 *  many the reader follows already, against the slots left.
 *
 *  "Following" is the reader's own Follow (a friend claim), never the pool's
 *  recording: a player the reader only watches, or one only their agent
 *  tracks, is still theirs to follow, and free, since the pool records them
 *  already (addPlayer, playerCost). A plan that needs no slot always fits,
 *  even with the pool over its limit, as a single free follow does. */
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
  const { rows: friends } = await db.query(
    `select player_tag from claim
      where account_id = $1 and relationship = 'friend' and not is_primary
        and player_tag = any($2::text[])`,
    [accountId, wanted],
  );
  const followed = new Set(friends.map((r) => r.player_tag));
  const used = (await pooledUsage(db, owner.account_id)).players_used;
  const players = costs.map((c) => ({
    player_tag: c.player_tag,
    name: nameOf.get(c.player_tag) ?? null,
    following: followed.has(c.player_tag),
    // Recorded for this pool already, including an agent's follow:
    // following them takes no slot.
    free: c.free || c.following,
    reason: c.reason ?? (c.following ? "recorded_for_you" : null),
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
    fits: limit == null || slots === 0 || used + slots <= limit,
  };
}

/** Your follow slots (Settings, 2026-11-12): every player your pool
 *  follows, as pooledUsage counts them, so `used` and the rows that use a
 *  slot are the same number the Follow dialogs say. Each row says who in
 *  the pool follows the player: you (and how), or an agent of yours by its
 *  name; the reader's own claim decides whether this page can stop it.
 *  Only the reader's own account and agents appear: nothing here names
 *  another account. */
async function followSlots(db, accountId) {
  const owner = await poolOwner(db, accountId);
  const limits = poolLimits(owner);
  const [rows, usage] = [
    await pooledFollows(db, owner.account_id),
    await pooledUsage(db, owner.account_id),
  ];
  const tags = rows.map((r) => r.player_tag);
  const { rows: names } = await db.query(
    `select player_tag, name from player where player_tag = any($1::text[])`,
    [tags],
  );
  const nameOf = new Map(names.map((r) => [r.player_tag, r.name]));
  const agentIds = [
    ...new Set(
      rows.flatMap((r) =>
        r.claims.filter((c) => c.kind === "agent").map((c) => c.account_id),
      ),
    ),
  ];
  const { rows: agents } = agentIds.length
    ? await db.query(
        `select a.account_id,
                (select t.name from service_token t
                  where t.account_id = a.account_id
                  order by (t.revoked_at is null) desc, t.created_at desc
                  limit 1) as name
           from account a where a.account_id = any($1::uuid[])`,
        [agentIds],
      )
    : { rows: [] };
  const agentName = new Map(agents.map((a) => [a.account_id, a.name]));
  const players = rows.map((r) => {
    const mine = r.claims.find((c) => c.account_id === accountId) ?? null;
    return {
      player_tag: r.player_tag,
      name: nameOf.get(r.player_tag) ?? null,
      slot: r.free ? "free" : "used",
      reason: r.reason,
      // The reader's own claim: primary, alt, friend.
      yours: mine?.relationship ?? null,
      agents: r.claims
        .filter((c) => c.kind === "agent")
        .map((c) => ({
          public_id: c.public_id,
          name: agentName.get(c.account_id) ?? null,
          relationship: c.relationship,
        })),
    };
  });
  return {
    used: usage.players_used,
    free: usage.players_free,
    limit: limits.player_slots === Infinity ? null : limits.player_slots,
    players,
  };
}

/**
 * Follow each player of a plan the reader does not follow yet, in order,
 * with a first read for each that Elixir starts recording because of it.
 * The one loop behind every follow-several (a Follow me link, a clan's
 * Follow everyone, Home's starter set); the caller has checked the plan
 * fits. A slot taken meanwhile, or no player of your own, stops it, and
 * the answer says how far it got.
 */
async function followEach(db, account, plan, liveRead) {
  const followed = [];
  for (const p of plan.players) {
    if (p.following) continue;
    const r = await addPlayer(db, account, {
      tag: p.player_tag,
      follow: true,
      via: "web",
    });
    if (!r.ok)
      return {
        ok: false,
        error: r.error,
        message:
          r.error === "no_own_player"
            ? "Add your own player first."
            : (r.message ?? "That did not work. Try again."),
        followed,
      };
    followed.push(p.player_tag);
    // A player Elixir starts recording because of this gets their first
    // read; one already recorded has theirs.
    if (r.recordingStarted)
      await requestFirstRead(db, liveRead, p.player_tag, account.accountId);
    // Linked follows: a Verified player brings its account along. What
    // that cannot take is skipped and said in the bell.
    await linkAfterFollow(db, account, p.player_tag, { via: "web" });
  }
  return { ok: true, followed };
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

    // A sitting's games on the player page (View games, G7): the page's
    // own timeline rebuilt, the item found by its id, and its evidence read
    // as Home reads its own. Public game facts only; one charge, as the
    // page's.
    "GET /api/player/evidence": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const q = event.queryStringParameters ?? {};
      const tag = tagOf(q.tag);
      if (!tag) return json(400, { error: "invalid_tag" });
      if (!q.evidence_item_id) return json(400, { error: "invalid_item" });
      if (!(await rate(db, account)))
        return json(429, { error: "rate_limited" });
      const built = await pageTimeline(
        db,
        tag,
        account.timezone ?? "UTC",
        Date.now(),
      );
      const item = built.timeline.find(
        (it) => it.id === q.evidence_item_id && SITTINGS.has(it.kind),
      );
      const evidence = await readTimelineEvidence(db, item, {
        offset: q.evidence_offset === undefined ? 0 : Number(q.evidence_offset),
        limit: 25,
        expectedVersion: q.expected_evidence_version,
        // The opened session as the website draws it: decks, teammates,
        // a duel's games, newest first.
        detail: true,
      });
      return json(
        evidence.error
          ? evidence.error === "evidence_changed"
            ? 409
            : evidence.error === "evidence_unavailable"
              ? 404
              : 400
          : 200,
        evidence,
      );
    },

    // One sitting's own page (2026-11-16): the item, a page of its games
    // with both sides' decks, the moments they proved. One charge, as the
    // page's; `at` is the sitting's start, which the card links by.
    "GET /api/player/session": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const q = event.queryStringParameters ?? {};
      const tag = tagOf(q.tag);
      if (!tag) return json(400, { error: "invalid_tag" });
      if (!q.id) return json(400, { error: "invalid_item" });
      if (!(await rate(db, account)))
        return json(429, { error: "rate_limited" });
      const page = await readSessionPage(db, account, tag, {
        id: String(q.id),
        at: q.at,
        offset: q.offset === undefined ? 0 : Number(q.offset),
        expectedVersion: q.expected_evidence_version,
      });
      if (!page)
        return json(404, {
          error: "not_found",
          message: "Elixir has no record of that session.",
        });
      if (page.error)
        return json(
          page.error === "evidence_changed"
            ? 409
            : page.error === "evidence_unavailable"
              ? 404
              : 400,
          page,
        );
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

    // Your follow slots, player by player, for Settings' meter.
    "GET /api/me/follow-slots": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      return json(200, await followSlots(db, account.accountId));
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
      const done = await followEach(db, account, plan, liveRead);
      if (!done.ok)
        return json(done.error === "quota_exceeded" ? 429 : 409, {
          error: done.error,
          message: done.message,
          followed: done.followed,
        });
      const { followed } = done;
      return json(200, { ok: true, followed, clan_tag: asked.clan_tag });
    },
  };
}
