/**
 * Account pages and account follows (Jamie, 2026-11-15).
 *
 * An account is a person on Elixir; a player is a Clash Royale player tag
 * in the record. A player is Imported (followed, so Elixir records it),
 * Claimed (an account says it is this player and has not verified it) or
 * Verified (the account proved it; nobody else can claim it then, #556).
 *
 * The page lives at /home/account/<id>, where <id> is the account's page
 * id: its passport id (0269, 0277), random and opaque, never the account
 * UUID or account.public_id. It shows what DECISIONS "What is public about
 * an account" makes public and nothing past it: the players the account
 * claims or verified, its badges (a linked Discord as a boolean), its
 * place (city at most, read through Clan's seam under the ownership rule),
 * its follows and followers, its Stamps, and the combined timeline of its
 * players and its own activity. Never an email, a Discord username, a
 * nickname, an agent or the account's machinery.
 *
 * A claimed player's page names the account claiming it ("This is
 * important so you know what account is making the claim"), so the player
 * page reads claimantsOf too.
 */
import { readOwnedPlaces } from "@elixir-mcp/auth/clan-context";
import {
  followAccountLinked,
  linkedTagsToFollow,
  unfollowAccountLinked,
} from "@elixir-mcp/claims";
import { readAccountPassport } from "@elixir-mcp/stamps";
import { followsOf } from "@elixir-mcp/tools/social";
import {
  buildTimeline,
  itemVisibility,
} from "@elixir-mcp/tools/activity/entries";
import { verifiedAvatars, withAvatar } from "./avatars.mjs";
import { HANDLE, normalizeHandle } from "./handle.mjs";
import { withTimelineSocial } from "./timeline-social.mjs";

/** Page ids are twelve letters and digits with no look-alikes (0269). */
export const PAGE_ID = /^[a-km-np-z2-9]{12}$/;
/** The page's timeline window, as the player page reads it. */
export const ACCOUNT_PAGE_DAYS = 30;
export { ACCOUNT_FOLLOW_MAX } from "@elixir-mcp/claims";

/** The approved person account a page id, or an `@handle`, names, or
 *  null. A handle is another way to the same page (2026-11-15). */
export async function accountByPageId(db, id) {
  if (typeof id !== "string") return null;
  let where;
  let key;
  if (PAGE_ID.test(id)) {
    where = "ap.passport_id = $1::text";
    key = id;
  } else if (id.startsWith("@")) {
    key = normalizeHandle(id);
    if (!HANDLE.test(key)) return null;
    where = "a.handle = $1::text";
  } else return null;
  const { rows } = await db.query(
    `select a.account_id, ap.passport_id as page_id, a.handle,
            exists (select 1 from account_discord d
                     where d.account_id = a.account_id) as discord
       from account_passport ap
       join account a on a.account_id = ap.account_id
      where ${where}
        and a.kind = 'person' and a.status = 'approved'`,
    [key],
  );
  return rows[0] ?? null;
}

/** The players an account says it is, primary first then alts by name:
 *  each with its state (verified or claimed), its game name and clan. */
export async function accountPlayers(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag as tag, p.name,
            case when c.is_primary then 'primary' else 'alt' end
              as relationship,
            case when c.status = 'verified' then 'verified' else 'claimed' end
              as state,
            cm.clan_tag, cl.name as clan_name
       from claim c
       left join player p on p.player_tag = c.player_tag
       left join lateral (
         select m.clan_tag from clan_membership m
          where m.player_tag = c.player_tag and m.left_observed_at is null
          limit 1) cm on true
       left join clan cl on cl.clan_tag = cm.clan_tag
      where c.account_id = $1
        and (c.is_primary or c.relationship in ('primary', 'alt'))
      order by c.is_primary desc, c.status = 'verified' desc,
               lower(coalesce(p.name, c.player_tag)), c.player_tag`,
    [accountId],
  );
  return rows.map((r) => ({
    tag: r.tag,
    name: r.name ?? null,
    relationship: r.relationship,
    state: r.state,
    clan_tag: r.clan_tag ?? null,
    clan_name: r.clan_name ?? null,
  }));
}

/**
 * The accounts that say they are this player, for its page: the one that
 * verified it, or every account claiming it while nobody has. Each by its
 * page id and the player it is (its primary), with how it holds this tag.
 * Approved person accounts with a page only.
 */
export async function claimantsOf(db, tag) {
  const { rows } = await db.query(
    `select ap.passport_id as id,
            c.status = 'verified' as verified,
            case when c.is_primary then 'primary' else 'alt' end
              as relationship,
            pc.player_tag as primary_tag, pp.name as primary_name,
            pc.status = 'verified' as primary_verified
       from claim c
       join account a on a.account_id = c.account_id
                     and a.kind = 'person' and a.status = 'approved'
       join account_passport ap on ap.account_id = c.account_id
       left join claim pc on pc.account_id = c.account_id and pc.is_primary
       left join player pp on pp.player_tag = pc.player_tag
      where c.player_tag = $1
        and (c.is_primary or c.relationship in ('primary', 'alt'))
        and (c.status = 'verified' or not exists (
              select 1 from claim v
               where v.player_tag = c.player_tag and v.status = 'verified'
                 and (v.is_primary or v.relationship in ('primary', 'alt'))))
      order by c.status = 'verified' desc, c.created_at, ap.passport_id`,
    [tag],
  );
  return rows.map((r) => ({
    id: r.id,
    verified: r.verified === true,
    relationship: r.relationship,
    player:
      r.primary_tag && r.primary_tag !== tag
        ? {
            tag: r.primary_tag,
            name: r.primary_name ?? null,
            verified: r.primary_verified === true,
          }
        : null,
  }));
}

async function followCounts(db, accountId, readerId) {
  const { rows } = await db.query(
    `select
       (select count(*)::int from account_follow f
          join account a on a.account_id = f.account_id
                        and a.kind = 'person' and a.status = 'approved'
         where f.followed_account_id = $1) as followers,
       (select count(*)::int from account_follow f
          join account a on a.account_id = f.followed_account_id
                        and a.kind = 'person' and a.status = 'approved'
         where f.account_id = $1) as following,
       exists (select 1 from account_follow
                where account_id = $2 and followed_account_id = $1)
         as you_follow`,
    [accountId, readerId],
  );
  return rows[0];
}

/** The account's place as the player map shows it (country, region, city:
 *  never a point), the newest its verified players' claims wrote. */
async function placeOf(db, players) {
  const tags = players.filter((p) => p.state === "verified").map((p) => p.tag);
  if (!tags.length) return null;
  const places = await readOwnedPlaces(db, tags);
  const newest = places
    .filter((p) => p && (p.city || p.region || p.country))
    .sort((a, b) => String(b.set_at ?? "").localeCompare(a.set_at ?? ""))[0];
  return newest
    ? {
        city: newest.city ?? null,
        region: newest.region ?? null,
        country: newest.country ?? null,
      }
    : null;
}

/** The account's timeline: its players' public game record and its own
 *  people items, newest first, in the page's window. */
async function accountTimeline(
  db,
  accountId,
  players,
  timezone,
  now,
  pageGameReader,
) {
  return buildTimeline(
    db,
    players.map((p) => ({
      kind: "player",
      tag: p.tag,
      relationship: null,
      nickname: null,
    })),
    {
      fromMs: now - ACCOUNT_PAGE_DAYS * 86_400_000,
      toMs: now,
      timezone,
      // Account-level news belongs to the page's owner. Only Drop games use
      // the reader's follow relationship on this page.
      accountId: null,
      pageGameReader,
      accountLines: false,
      basis: "occurred",
      people: { accounts: [accountId], players: false },
      filter: (it) =>
        it.kind === "drop_game" ||
        ["public", "member"].includes(itemVisibility(it)),
    },
  );
}

async function youBlocked(db, readerId, accountId) {
  if (readerId === accountId) return false;
  const { rows } = await db.query(
    `select 1 from account_block where account_id = $1 and blocked_account_id = $2`,
    [readerId, accountId],
  );
  return rows.length > 0;
}

/** The whole account page for one signed-in reader, or null. */
export async function readAccountPage(
  db,
  reader,
  id,
  now = Date.now(),
  { blocks = false, comments = false } = {},
) {
  const account = await accountByPageId(db, id);
  if (!account) return null;
  const players = await accountPlayers(db, account.account_id);
  const avatars = await verifiedAvatars(
    db,
    players.filter((p) => p.state === "verified").map((p) => p.tag),
  );
  const primary = players.find((p) => p.relationship === "primary") ?? null;
  const counts = await followCounts(db, account.account_id, reader.accountId);
  const built = await accountTimeline(
    db,
    account.account_id,
    players,
    reader.timezone ?? "UTC",
    now,
    reader.accountId,
  );
  return {
    account: {
      id: account.page_id,
      // The account's own @handle (2026-11-15), null when it set none.
      handle: account.handle ?? null,
      name: primary?.name ?? null,
      player: primary ? withAvatar({ ...primary }, primary.tag, avatars) : null,
      state: primary?.state ?? null,
      players: players.map((p) => withAvatar(p, p.tag, avatars)),
      badges: {
        verified_player: players.some((p) => p.state === "verified"),
        discord: account.discord === true,
      },
      place: await placeOf(db, players),
      follows: await followsOf(db, account.account_id),
      followers: counts.followers,
      following_accounts: counts.following,
    },
    you: {
      self: reader.accountId === account.account_id,
      following: counts.you_follow === true,
      // Whether the reader blocked this account (2026-11-16): their own
      // block only, for Block or Unblock. A block the other way is never
      // said.
      blocked: blocks
        ? await youBlocked(db, reader.accountId, account.account_id)
        : false,
      // The Verified players a Follow would add (linked follows).
      to_follow:
        reader.accountId === account.account_id
          ? []
          : await linkedTagsToFollow(db, reader.accountId, account.account_id),
    },
    passport: await readAccountPassport(db, account.account_id),
    window_days: ACCOUNT_PAGE_DAYS,
    timeline: await withTimelineSocial(
      db,
      built.timeline ?? [],
      reader.kind === "agent" ? null : reader.accountId,
      { comments },
    ),
    timeline_more: built.timeline_more ?? 0,
  };
}

/** Follow an account, linked (Jamie, 2026-11-15): the account and each
 *  of its Verified players. Idempotent; refused for yourself and past the
 *  cap. `{ ok, following, followed, skipped }` or `{ error }`. */
export async function followAccount(db, reader, id) {
  const target = await accountByPageId(db, id);
  if (!target) return { error: "not_found" };
  if (target.account_id === reader.accountId) return { error: "self" };
  const r = await followAccountLinked(db, reader, target.account_id, {
    via: "web",
  });
  if (r.error) return r;
  return {
    ok: true,
    following: true,
    followed: r.followed,
    skipped: r.skipped.map((s) => ({ player_tag: s.tag, reason: s.reason })),
  };
}

/** Stop following an account, and each of its Verified players.
 *  Idempotent. `{ ok, following: false, unfollowed }`. */
export async function unfollowAccount(db, reader, id) {
  const target = await accountByPageId(db, id);
  if (!target) return { error: "not_found" };
  const r = await unfollowAccountLinked(db, reader, target.account_id, {
    via: "web",
  });
  return { ok: true, following: false, unfollowed: r.unfollowed };
}
