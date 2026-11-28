import {
  HANDLE_MESSAGES,
  checkHandle,
  setHandle,
  suggestHandle,
} from "../handle.mjs";
import {
  addPlayer,
  linkAfterFollow,
  linkedTagsToFollow,
  setClose,
  setRelationship,
  playerCosts,
  playerConnections,
  poolLimits,
  poolOwner,
  pooledUsage,
  unfollowPlayerLinked,
  verifierOf,
} from "@elixir-mcp/claims";
import {
  cardType,
  normalizeTag,
  InvalidTagError,
  roleQuotas,
  tierSql,
  OAUTH_SCOPES,
  OAUTH_SCOPE_DETAILS,
} from "@elixir-mcp/contracts";
import { accountZone, checkRateLimit, normalizeScope } from "@elixir-mcp/auth";
import { discordLinkOf } from "@elixir-mcp/auth/discord";
import { enqueueJob } from "@elixir-mcp/ledger";
import { makeLive, requestFirstRead } from "@elixir-mcp/tools/live";
import { firstAnswer } from "../first-answer.mjs";
import {
  buildTimeline,
  subjectsFor,
  readTimelineEvidence,
  timelineNews,
} from "@elixir-mcp/tools/activity/entries";

import { json, UUID_RE, ID_RE } from "../http.mjs";
import { labelOf as emailChoiceLabel } from "./email.mjs";
import { loadCallRecord } from "../call-record.mjs";
import { mcpCalls } from "../call-log.mjs";
import { annotateFeed } from "../feed.mjs";
import { withCheers } from "../cheers.mjs";
import { playersChangedAfter, settleAfter } from "../passport-hooks.mjs";

/** Profile image changes an account may make in an hour: plenty for
 *  trying cards on, few enough that nothing loops on the write. */
const AVATAR_WRITES_PER_HOUR = 60;
/** Handle changes an hour: plenty for picking one, not for squatting. */
const HANDLE_WRITES_PER_HOUR = 20;

export function accountRoutes({
  resolveAccount,
  logEvent,
  capture = null,
  /** Linking and signing in with Discord are configured (#531). */
  discordLogin = false,
  /** Comments are on (2026-11-16; the stack's CommentsEnabled). */
  comments = false,
  /** Posts (2026-11-17): on only while comments are. */
  posts = false,
  live = null,
}) {
  // The first read of an added tag (live.mjs requestFirstRead), its
  // profile and then its battle log: the live lane Verify uses, charged
  // to nobody's live quota.
  const liveRead = live ?? makeLive({ enqueue: enqueueJob });
  /** Track, untrack, or set notify or relationship on a player. */
  async function followPlayer(db, event, body) {
    const account = await resolveAccount(db, event, {
      requireContractHeader: true,
    });
    if (!account) return json(401, { error: "unauthenticated" });
    let tag;
    try {
      tag = normalizeTag(String(body.player_tag ?? ""));
    } catch (err) {
      if (err instanceof InvalidTagError)
        return json(400, { error: "invalid_tag" });
      throw err;
    }
    const action = body.action ?? "add";
    if (action === "notify_on" || action === "notify_off") {
      const { rowCount } = await db.query(
        `update claim set notify = $3 where account_id = $1 and player_tag = $2`,
        [account.accountId, tag, action === "notify_on"],
      );
      if (rowCount === 0) return json(404, { error: "not_found" });
      return json(200, { ok: true, notify: action === "notify_on" });
    }
    // A close friend (0281): the reader's private mark on a friend follow,
    // kept in step across a linked account's players (close.mjs).
    if (action === "close_on" || action === "close_off") {
      const r = await setClose(db, account, {
        tag,
        close: action === "close_on",
      });
      if (r.error === "not_found") return json(404, { error: r.error });
      if (r.error)
        return json(409, {
          error: r.error,
          message:
            "Only a player you follow as a friend can be a close friend.",
        });
      return json(200, {
        ...r,
        ...(await playerConnections(db, account.accountId, [tag])).get(tag),
      });
    }
    // Primary changes use addPlayer's atomic move. This action only
    // changes an existing non-primary between friend and alt.
    if (action === "relationship") {
      const REL = ["alt", "friend"];
      if (!REL.includes(body.relationship))
        return json(400, { error: "bad_relationship", allowed: REL });
      const r = await setRelationship(db, account, {
        tag,
        relationship: body.relationship,
      });
      // An alt on a tag another account has verified (#556).
      if (r.error === "verified_elsewhere")
        return json(409, { error: r.error, message: r.message });
      // No row means either you never added this tag, or it is your primary
      // -- and demoting a primary by renaming it would leave you with none.
      if (!r.ok) return json(404, { error: "not_found_or_primary" });
      // Full Roster, or a follow (#1015), once the change committed.
      await playersChangedAfter(db, account.accountId, "relationship");
      return json(200, {
        ok: true,
        relationship: body.relationship,
        ...(await playerConnections(db, account.accountId, [tag])).get(tag),
      });
    }
    if (action === "remove") {
      // Linked follows: unfollowing a Verified player you follow through
      // its account ends the account follow and its other players too.
      const r = await unfollowPlayerLinked(db, account, { tag, via: "web" });
      if (r.refused === "primary_in_use")
        return json(409, {
          error: "primary_in_use",
          message:
            "This is your primary player. Make another player your primary first, then remove this one.",
        });
      return json(200, {
        ok: true,
        removed: r.removed,
        recording_stopped: r.recordingStopped,
        primary_player_tag: r.promotedPrimary,
        ...(await playerConnections(db, account.accountId, [tag])).get(tag),
        ...(r.unlinked ? { unfollowed: r.unlinked.unfollowed } : {}),
      });
    }
    // 'add': added = recorded (Jamie, 2026-09-05). Slots count the players
    // Elixir records because of you (#760): one already recorded for
    // another reason is free. The MCP door runs the same function.
    // relationship "friend" is Home's Follow: never the primary, and never
    // with make_primary. "alt" and "friend" are the add form's Add as.
    const asked = body.relationship ?? null;
    if (asked && !["friend", "alt"].includes(asked))
      return json(400, { error: "bad_relationship" });
    if (asked && body.make_primary === true)
      return json(400, { error: "bad_relationship" });
    const follow = asked === "friend";
    const r = await addPlayer(db, account, {
      tag,
      makePrimary: !asked && body.make_primary === true,
      follow,
      relationship: follow ? null : asked,
      via: "web",
    });
    if (!r.ok && r.error === "no_own_player")
      return json(409, {
        error: r.error,
        message: "Add your own player first.",
      });
    // Refused, never queued, saying why (#760): how many of how many, and
    // that following a player Elixir already records stays free.
    if (!r.ok && r.error === "quota_exceeded") {
      return json(429, {
        error: "quota_exceeded",
        message: r.message,
        used: r.used,
        limit: r.limit,
      });
    }
    if (!r.ok && r.error === "not_entitled")
      return json(403, { error: "not_entitled" });
    // A tag another account has verified (#556): the one answer.
    if (!r.ok && r.error === "verified_elsewhere")
      return json(409, { error: r.error, message: r.message });
    if (!r.ok) return json(404, { error: "not_found" });
    // The passport (#1015), once the add committed: the add-player step,
    // Full Roster, the follow step, Inner Circle and Mutual. A follow can
    // also make the followed player's verified owner a Mutual.
    // Linked follows (Jamie, 2026-11-15): a Verified player's follow is
    // its account's follow, with the account's other Verified players.
    const linked = follow
      ? await linkAfterFollow(db, account, tag, { via: "web" })
      : null;
    await playersChangedAfter(db, account.accountId, "player_added");
    if (follow) await settleFollowedOwner(db, account.accountId, tag);
    // claims logs recording_started; logging it here too wrote it twice.
    // A person's add asks for the battle log live too (2026-11-09), so
    // the last 30 battles land with the profile, in seconds.
    const first = r.added
      ? await requestFirstRead(db, liveRead, tag, account.accountId, {
          battles: true,
        })
      : { requested: false };
    return json(200, {
      ok: true,
      player_tag: tag,
      recording: "active",
      recording_started: r.recordingStarted,
      first_read: first.requested,
      not_found: first.not_found === true,
      clan_followed: r.clanFollowed ?? null,
      ...(await playerConnections(db, account.accountId, [tag])).get(tag),
      slot: slotWire(r.slot),
      ...(follow ? { added: r.added, relationship: r.relationship } : {}),
      ...(linked
        ? {
            linked: {
              followed: linked.followed,
              skipped: linked.skipped.map((x) => ({
                player_tag: x.tag,
                reason: x.reason,
              })),
            },
          }
        : {}),
    });
  }

  /** The verified owner of a player just followed, settled too: a
   *  follow back completes their Mutual as well as yours. */
  async function settleFollowedOwner(db, accountId, tag) {
    try {
      const { rows } = await db.query(
        `select c.account_id from claim c
           join account a on a.account_id = c.account_id
          where c.player_tag = $1::text and c.status = 'verified'
            and (c.is_primary or c.relationship in ('primary', 'alt'))
            and c.account_id <> $2::uuid and a.kind = 'person'
          limit 1`,
        [tag, accountId],
      );
      if (rows[0]) await settleAfter(db, rows[0].account_id, "mutual");
    } catch {
      console.error(
        JSON.stringify({ at: "passport_hook_failed", hook: "mutual" }),
      );
    }
  }

  /** What a follow costs, on the wire: Infinity is null (unlimited). */
  function slotWire(slot) {
    return {
      took: slot.took,
      free: slot.free,
      reason: slot.reason,
      used: slot.used,
      limit: slot.limit === Infinity ? null : slot.limit,
    };
  }

  return {
    "GET /api/me": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account)
        return json(200, {
          authenticated: false,
          features: { discord_login: discordLogin, comments, posts },
        });
      // One client is one connection: pg queues concurrent queries on it
      // anyway, so Promise.all bought no parallelism and only tripped the
      // deprecation (docs/ENGINEERING.md: one client, one query at a time).
      const claims = await db.query(
        `select c.player_tag, c.status, c.verified_at, c.is_primary, c.notify, c.relationship, c.close,
                  p.name, p.last_known_clan_tag,
                  nn.nickname
           from claim c
           -- Each claim's player by its key: joined plainly, the planner
           -- merge-joins the claims against player_pkey and walks the
           -- index from the first claimed tag to the last (1,778 buffers
           -- for 56 claims on a year's record, 2026-11-13).
           cross join lateral (
             select p.name, p.last_known_clan_tag from player p
              where p.player_tag = c.player_tag limit 1) p
           left join player_nickname nn on nn.account_id = c.account_id
             and nn.player_tag = c.player_tag
         where c.account_id = $1 order by c.is_primary desc, c.player_tag`,
        [account.accountId],
      );
      const recordings = await db.query(
        `select r.subject_tag, r.status, r.created_at,
                  (select max(last_admitted_at) from poll_state ps where ps.subject_tag = r.subject_tag) as freshest_poll,
                  -- Every endpoint a recorded subject is fetched on, so
                  -- the count probes api_receipt_entity_fetched (0256:
                  -- endpoint, entity_key, fetched_at) once per endpoint.
                  (select count(*)::int from api_receipt ar
                   where ar.endpoint = any(array['player', 'player_battlelog',
                                                 'clan', 'currentriverrace',
                                                 'riverracelog'])
                     and ar.entity_key = r.subject_tag
                     and ar.fetched_at > now() - interval '24 hours') as fetches_24h
         from recording r
         -- Recording is per SUBJECT, not per account: the second account
         -- to claim a player joins the recording that already exists and
         -- never gets a row of its own. Scoping by requested_by therefore
         -- showed the newcomer "never polled" for a player with years of
         -- history — the same defect the clan half below was already
         -- fixed for. The question is "is this subject recorded", never
         -- "did I ask first".
         where (r.subject_type = 'player'
                and (r.requested_by = $1
                     or (r.status = 'active'
                         and r.subject_tag in (select player_tag from claim
                                                where account_id = $1))))
            -- The clans this account tracks, whoever first asked for them:
            -- Tracking shows one freshness column over both kinds, and a
            -- clan row with no recording read as "off" however live it was.
            or (r.subject_type = 'clan' and r.status = 'active'
                and r.subject_tag in (select clan_tag from account_clan
                                       where account_id = $1))`,
        [account.accountId],
      );
      const { rows: ent } = await db.query(
        `select ${tierSql("a")} as role, a.mcp_daily_quota, a.live_daily_quota,
                a.newsletter_opt_in, a.email, a.avatar_card_id, a.handle,
                (select passport_id from account_passport p
                  where p.account_id = a.account_id) as page_id
         from account a where a.account_id = $1`,
        [account.accountId],
      );
      const e = ent[0];
      // Recording slots are the pool's (@elixir-mcp/claims pool.mjs).
      const owner = await poolOwner(db, account.accountId);
      const limits = poolLimits(owner);
      const used = await pooledUsage(db, owner.account_id);
      const q = roleQuotas(owner.role);
      // Each player's standing in the pool's slots (#760): free when Elixir
      // records them for another reason, else the slot it takes.
      const costs = new Map(
        (
          await playerCosts(
            db,
            owner.account_id,
            claims.rows.map((c) => c.player_tag),
          )
        ).map((c) => [c.player_tag, c]),
      );
      for (const c of claims.rows) {
        const cost = costs.get(c.player_tag);
        c.slot = cost?.free ? "free" : "used";
        c.slot_reason = cost?.reason ?? null;
      }
      const lim = (v) => (v === Infinity ? null : v); // null = unlimited on the wire
      // The rail's signals (design 2026-09-09): a count of the reader's
      // own things on Connections and Feedback, an unread dot on
      // Timeline, and an alert dot on Connections when a credential of
      // theirs that no longer works is still being presented. Counted
      // here rather than by the pages, so the rail can show them on
      // every screen without every screen fetching four lists.
      // timeline_pending counts SUBJECTS polled since the page's own place
      // (a hint, not a count of items: Home's tab asks
      // GET /api/me/timeline?news=1 instead). Its place is
      // console_timeline_seen_at (0228), never an MCP read pointer:
      // "timeline should be independent of what agents have seen via
      // MCP" (Jamie, 2026-10-20). meta.timeline_pending (packages/tools
      // shared.mjs) is MCP's count and never reads the app's place.
      const { rows: sig } = await db.query(
        `select
           (select count(*)::int from oauth_family f
            where f.account_id = $1
              and f.revoked_at is null and f.absolute_expires_at > now())
             as connections,
           (select count(*)::int from feedback where account_id = $1) as feedback,
           (select count(*)::int from (
              select c.player_tag as tag from claim c
               where c.account_id = $1 and c.notify
              union
              select ac.clan_tag from account_clan ac
               where ac.account_id = $1 and ac.notify) s
             where exists (
               select 1 from poll_state ps
                where ps.subject_tag = s.tag
                  and ps.last_admitted_at > coalesce(
                    (select console_timeline_seen_at from account
                      where account_id = $1),
                    'epoch'::timestamptz))) as timeline_pending,
           -- Undismissed only, as the list counts them (console audit M4:
           -- the dot stayed lit for a week after "Dismiss all").
           (select count(*)::int from credential_refusal
             where account_id = $1 and day > current_date - 7
               and dismissed_at is null) as refusals_7d,
           -- What THIS account tracks, for the rail's Tracking count.
           (select count(*)::int from claim where account_id = $1)
           + (select count(*)::int from account_clan where account_id = $1)
             as tracking`,
        [account.accountId],
      );
      const entitlements = {
        player_slots: {
          used: used.players_used,
          limit: lim(limits.player_slots),
          // Followed players that take no slot (#760).
          free: used.players_free,
        },
        activity_clans: {
          used: used.activity_used,
          limit: lim(limits.activity),
        },
        comprehensive_clans: {
          used: used.comprehensive_used,
          limit: lim(limits.comprehensive),
        },
        mcp_calls_per_day: lim(e.mcp_daily_quota ?? q.mcp_calls_per_day),
        live_fetches_per_day: lim(e.live_daily_quota ?? q.live_fetches_per_day),
      };
      // A self claim that ended because another account verified its tag,
      // or a signup tag refused for it (#556): said where the primary is
      // shown for as long as the account has no primary (a friend
      // added since does not answer it). The latest such
      // event; never names the other account. A primary is only ever left
      // unset by that event or by removing the last player (removePlayer
      // refuses it otherwise), so an account that still tracks players has
      // not chosen one since; one that tracks none and added a player
      // after the event chose one and removed it, and the notice is over.
      const noPrimary = !claims.rows.some((c) => c.is_primary);
      const { rows: notice } = noPrimary
        ? await db.query(
            `select e.kind, e.detail->>'player_tag' as player_tag, e.created_at as at
               from account_event e
              where e.account_id = $1
                and ((e.kind = 'claim_ended' and (e.detail->>'was_primary')::boolean)
                     or e.kind = 'claim_refused')
                and ($2 or not exists (select 1 from account_event later
                                        where later.account_id = e.account_id
                                          and later.kind = 'claim_added'
                                          and later.event_id > e.event_id))
              order by e.event_id desc limit 1`,
            [account.accountId, claims.rows.length > 0],
          )
        : { rows: [] };
      const connections = await playerConnections(
        db,
        account.accountId,
        claims.rows.map((row) => row.player_tag),
      );
      return json(200, {
        authenticated: true,
        features: { discord_login: discordLogin, comments, posts },
        claim_notice: notice[0]
          ? {
              kind:
                notice[0].kind === "claim_ended"
                  ? "primary_ended"
                  : "signup_tag_refused",
              player_tag: notice[0].player_tag,
              at: notice[0].at,
            }
          : null,
        signals: sig[0],
        is_owner: account.isOwner,
        is_admin: account.isAdmin,
        timezone: account.timezone,
        // The profile image, a card id (2026-11-14): the account's own, so
        // the top bar, the account menu and Settings draw it whether or not
        // any of its players is verified. Null: initials.
        avatar_card_id: e.avatar_card_id ?? null,
        // Your account page's id (/home/account/<id>, 2026-11-15): your
        // passport id, which other members see in your page's address.
        page_id: e.page_id ?? null,
        // Your @handle (2026-11-15), public on your account page; null
        // until you choose one.
        handle: e.handle ?? null,
        // The holder's own address, shown back to them on their profile
        // and in the console rail. Never on a public surface (0046).
        email: e.email ?? null,
        newsletter_opt_in: e.newsletter_opt_in === true,
        // The Discord user linked to this account (#531): who it is to
        // Discord, for the profile to show and disconnect. Never the id.
        discord: await discordLinkOf(db, account.accountId).then((d) =>
          d ? { username: d.username, linked_at: d.linked_at } : null,
        ),
        role: e.role,
        entitlements,
        claims: claims.rows.map((row) => ({
          ...row,
          ...connections.get(row.player_tag),
        })),
        recordings: recordings.rows,
      });
    },

    "POST /api/me/timezone": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      // Empty (the console's "UTC (default)") or "UTC" resets to the
      // default; before, "" failed validation and a set zone could never
      // be cleared (console audit B1, 2026-09-24). Signup runs the same
      // check on a new account's browser zone (auth accountZone).
      const tz = accountZone(body.timezone);
      if (tz === null) {
        await db.query(
          `update account set timezone = null where account_id = $1`,
          [account.accountId],
        );
        return json(200, { ok: true, timezone: null });
      }
      if (tz === undefined)
        return json(400, {
          error: "bad_request",
          message: "Not an IANA timezone.",
        });
      await db.query(`update account set timezone = $2 where account_id = $1`, [
        account.accountId,
        tz,
      ]);
      return json(200, { ok: true, timezone: tz });
    },

    // The profile image (2026-11-14, Jamie: "I want to wholesale move that
    // into Elixir"): one card from the catalog, never a tower troop, or
    // null to go back to initials.
    "POST /api/me/avatar": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const raw = body?.card_id;
      let card = null;
      if (raw !== null && raw !== undefined) {
        card = typeof raw === "number" ? raw : Number.NaN;
        if (
          !Number.isSafeInteger(card) ||
          card <= 0 ||
          cardType(card) === "tower_troop"
        )
          return json(400, {
            error: "unknown_card",
            message: "That card can't be a profile image.",
          });
      }
      if (
        !(await checkRateLimit(db, {
          bucket: `avatar#${account.accountId}`,
          max: AVATAR_WRITES_PER_HOUR,
        }))
      )
        return json(429, { error: "rate_limited" });
      // A card in the current catalog with base art (kind 'card': a tower
      // troop is 'support'); the art the avatar draws is that file.
      const { rows } = await db.query(
        `update account a set avatar_card_id = $2, avatar_set_at = now()
          where a.account_id = $1
            and ($2::integer is null or exists (
                  select 1 from card c
                   where c.card_id = $2 and c.kind = 'card' and c.in_catalog
                     and c.icon_medium is not null))
          returning a.avatar_card_id`,
        [account.accountId, card],
      );
      if (!rows[0])
        return json(400, {
          error: "unknown_card",
          message: "That card can't be a profile image.",
        });
      // Looking Good (#1015): a card chosen, never going back to initials.
      if (rows[0].avatar_card_id !== null)
        await settleAfter(db, account.accountId, "looking_good");
      return json(200, { ok: true, avatar_card_id: rows[0].avatar_card_id });
    },

    // Your @handle (Jamie, 2026-11-15): set, change or remove it.
    "POST /api/me/handle": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const raw = body?.handle;
      if (raw !== null && typeof raw !== "string")
        return json(400, {
          error: "invalid",
          message: HANDLE_MESSAGES.invalid,
        });
      if (
        !(await checkRateLimit(db, {
          bucket: `handle#${account.accountId}`,
          max: HANDLE_WRITES_PER_HOUR,
        }))
      )
        return json(429, { error: "rate_limited" });
      const out = await setHandle(db, account.accountId, raw);
      if (out.error)
        return json(out.error === "taken" ? 409 : 400, {
          error: out.error,
          message: HANDLE_MESSAGES[out.error],
        });
      return json(200, out);
    },

    // Whether a handle is free, said while you type; with none asked, the
    // one Elixir suggests from your main player's name.
    "GET /api/me/handle-check": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const raw = event.queryStringParameters?.handle;
      if (raw == null || raw === "")
        return json(200, {
          suggestion: await suggestHandle(db, account.accountId),
        });
      const out = await checkHandle(db, account.accountId, raw);
      return json(200, {
        ...out,
        message: out.error ? HANDLE_MESSAGES[out.error] : null,
      });
    },

    // What a Follow would cost, said before the tap (#760): free when
    // Elixir already records the player, else one of the pool's slots.
    "GET /api/me/follow-cost": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      // No tag asks only for the count: how many slots are in use.
      const raw = event.queryStringParameters?.player_tag;
      let tag = null;
      if (raw != null && raw !== "") {
        try {
          tag = normalizeTag(String(raw));
        } catch (err) {
          if (err instanceof InvalidTagError)
            return json(400, { error: "invalid_tag" });
          throw err;
        }
      }
      const owner = await poolOwner(db, account.accountId);
      const limits = poolLimits(owner);
      const [cost] = tag ? await playerCosts(db, owner.account_id, [tag]) : [];
      const used = await pooledUsage(db, owner.account_id);
      // Linked follows: following a Verified player follows its account's
      // other Verified players too, so the price counts them.
      const verifier = tag ? await verifierOf(db, tag) : null;
      const extra =
        verifier && verifier !== account.accountId
          ? await linkedTagsToFollow(db, account.accountId, verifier, tag)
          : [];
      const extraCosts = extra.length
        ? await playerCosts(db, owner.account_id, extra)
        : [];
      return json(200, {
        player_tag: tag,
        following: cost?.following ?? null,
        free: cost?.free ?? null,
        reason: cost?.reason ?? null,
        used: used.players_used,
        limit: limits.player_slots === Infinity ? null : limits.player_slots,
        linked: extra.length
          ? {
              players: extra.length,
              slots: extraCosts.filter((c) => !c.free && !c.following).length,
            }
          : null,
      });
    },
    "POST /api/claims": followPlayer,
    // The same writer at a /api/me address (docs: recording).
    "POST /api/me/players": followPlayer,

    "GET /api/me/first-answer": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      let playerTag = null;
      const requested = event.queryStringParameters?.player_tag;
      if (requested != null) {
        try {
          playerTag = normalizeTag(String(requested));
        } catch (err) {
          if (err instanceof InvalidTagError)
            return json(400, { error: "invalid_tag" });
          throw err;
        }
      }
      const data = await firstAnswer(db, account.accountId, playerTag);
      if (playerTag && !data.player) return json(404, { error: "not_yours" });
      return json(200, data);
    },

    "GET /api/me/connections": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select f.family_id, c.client_name, f.scope, f.created_at, f.absolute_expires_at,
                (select max(t.created_at) from oauth_token t
                 where t.family_id = f.family_id) as last_token_at,
                -- WHAT this connection has actually done, and from where. A
                -- list of client names answers "what did I connect"; an
                -- account holding several answers nothing about which one is
                -- still working, or which one is calling from somewhere you
                -- do not recognise.
                (select json_build_object(
                          'at', max(m.created_at),
                          'calls_7d', count(*) filter (
                            where m.created_at > now() - interval '7 days'),
                          'ip', (array_agg(m.viewer_ip order by m.created_at desc)
                                 filter (where m.viewer_ip is not null))[1],
                          'country', (array_agg(m.viewer_country order by m.created_at desc)
                                      filter (where m.viewer_country is not null))[1])
                 from mcp_call_audit m
                 where m.oauth_family_id = f.family_id) as usage
         from oauth_family f
         join oauth_client c on c.client_id = f.client_id
         where f.account_id = $1
           and f.revoked_at is null
           and f.absolute_expires_at > now()
         order by f.created_at desc`,
        [account.accountId],
      );
      // Credentials of yours that no longer work and are still being
      // presented. On the personal door that is a client you revoked or a
      // grant that expired, still running somewhere.
      const { rows: refusals } = await db.query(
        `select refusal_id, reason, kind, attempts, viewer_ip as ip,
                viewer_country as country, last_seen
         from credential_refusal
         where account_id = $1 and day > current_date - 7
           and dismissed_at is null
         order by last_seen desc limit 10`,
        [account.accountId],
      );
      return json(200, {
        connections: rows.map((row) => ({
          ...row,
          scope: normalizeScope(row.scope),
        })),
        refusals,
      });
    },

    // Acknowledging a refusal warning. Per row, because a row is one
    // credential from one source on one day: this says "I have seen
    // today's", not "never tell me again". If whatever holds the dead
    // credential is still running tomorrow, that is a new row and news.
    "POST /api/me/connections/refusals/dismiss": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "not_authenticated" });
      if (body.all === true) {
        await db.query(
          `update credential_refusal set dismissed_at = now()
           where account_id = $1 and dismissed_at is null`,
          [account.accountId],
        );
        return json(200, { ok: true });
      }
      if (!ID_RE.test(String(body.refusal_id ?? "")))
        return json(400, { error: "bad_request" });
      // Scoped by account as well as id: an id is a guessable integer.
      await db.query(
        `update credential_refusal set dismissed_at = now()
         where refusal_id = $1 and account_id = $2`,
        [body.refusal_id, account.accountId],
      );
      return json(200, { ok: true });
    },

    "POST /api/me/connections/revoke": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const { rowCount } = await db.query(
        `update oauth_family set revoked_at = now()
         where family_id::text = $1 and revoked_at is null
           and account_id = $2`,
        [String(body.family_id ?? ""), account.accountId],
      );
      if (rowCount === 0) return json(404, { error: "not_found" });
      await logEvent(db, account.accountId, "connection_revoked", {
        family_id: body.family_id,
      });
      return json(200, { ok: true });
    },

    // Capabilities are editable AFTER the fact, on your own connections.
    //
    // The grant is the person's, not the client's: scope arrives in the
    // client's ?scope= parameter, so an app that never asks for a capability
    // could otherwise never be allowed one, and an app that was granted more
    // than it needs could never be narrowed without disconnecting it.
    //
    // Takes effect immediately and without a reconnect: validateAccessToken
    // joins oauth_family and reads f.scope on every request, so live tokens
    // in this family gain or lose the capability on their next call.
    "POST /api/me/connections/scope": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      // normalizeScope is the same gate the authorize endpoint uses: it
      // refuses anything outside OAUTH_SCOPES, requires cr:read, dedupes and
      // returns the canonical order. "" means the request was not valid.
      const scope = normalizeScope(
        Array.isArray(body.scope) ? body.scope.join(" ") : body.scope,
      );
      if (!scope)
        return json(400, {
          error: "invalid_scope",
          hint: `Space-separated, must include cr:read, and each must be one of: ${OAUTH_SCOPES.join(", ")}.`,
        });
      // A non-standard capability (account:email) can be
      // taken back here but never handed to a client that did not ask for
      // it at consent: the update keeps one only where the family already
      // holds it.
      const nonStandard = OAUTH_SCOPE_DETAILS.filter(
        (d) => !d.standard && scope.split(" ").includes(d.scope),
      ).map((d) => d.scope);
      const { rows } = await db.query(
        `update oauth_family f set scope = $3
         where f.family_id::text = $1 and f.revoked_at is null
           and f.account_id = $2
           and $4::text[] <@ string_to_array(f.scope, ' ')
         returning f.family_id, f.scope`,
        [String(body.family_id ?? ""), account.accountId, scope, nonStandard],
      );
      if (rows.length === 0) return json(404, { error: "not_found" });
      await logEvent(db, account.accountId, "connection_scope_changed", {
        family_id: rows[0].family_id,
        scope,
      });
      return json(200, { ok: true, scope });
    },

    "GET /api/me/activity": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select kind, detail, created_at from account_event
         where account_id = $1 order by event_id desc limit 20`,
        [account.accountId],
      );
      // An event's detail names its subject by tag alone (the writers
      // are many; the reader is one): resolve the last-observed name here
      // so the console never shows a tag with nothing beside it.
      const playerTags = [
        ...new Set(rows.map((r) => r.detail?.player_tag).filter(Boolean)),
      ];
      const clanTags = [
        ...new Set(rows.map((r) => r.detail?.clan_tag).filter(Boolean)),
      ];
      const names = new Map();
      if (playerTags.length > 0) {
        const { rows: named } = await db.query(
          `select player_tag as tag, name from player where player_tag = any($1)`,
          [playerTags],
        );
        for (const n of named) if (n.name) names.set(n.tag, n.name);
      }
      if (clanTags.length > 0) {
        const { rows: named } = await db.query(
          `select clan_tag as tag, name from clan where clan_tag = any($1)`,
          [clanTags],
        );
        for (const n of named) if (n.name) names.set(n.tag, n.name);
      }
      return json(200, {
        events: rows.map((r) => {
          if (r.kind === "email_pref")
            return {
              ...r,
              detail: { ...r.detail, label: emailChoiceLabel(r.detail?.kind) },
            };
          const tag = r.detail?.player_tag ?? r.detail?.clan_tag ?? null;
          return tag && names.has(tag)
            ? { ...r, detail: { ...r.detail, subject_name: names.get(tag) } }
            : r;
        }),
      });
    },

    "GET /api/me/usage": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      // Fourteen days, because the page draws them as a bar per day and
      // a week is too short a run to see a shape in.
      // MCP calls only (call-log.mjs): what the daily limiter charges.
      const { rows: days } = await db.query(
        `select (created_at at time zone 'UTC')::date::text as day,
                count(*)::int as calls,
                count(*) filter (where error_code is not null)::int as errors
         from mcp_call_audit
         where account_id = $1
           and created_at > now() - interval '14 days'
           and ${mcpCalls()}
         group by 1 order by 1 desc`,
        [account.accountId],
      );
      // WHO spent it: a client signed in as you (its registered name) or a
      // service token on your own account. Seven days, like the tools.
      const { rows: callers } = await db.query(
        `select coalesce(
                  case when m.token_id is not null then
                    'svc:' || (select st.name from service_token st
                               where st.token_id = m.token_id) end,
                  m.client_name,
                  'unnamed client') as name,
                case when m.token_id is not null then 'service token'
                     else 'client' end as kind,
                count(*)::int as calls
         from mcp_call_audit m
         where m.account_id = $1
           and m.created_at > now() - interval '7 days'
           and ${mcpCalls("m")}
         group by 1, 2 order by calls desc limit 8`,
        [account.accountId],
      );
      const { rows: tools } = await db.query(
        `select tool, count(*)::int as calls from mcp_call_audit
         where account_id = $1
           and created_at > now() - interval '7 days'
           and ${mcpCalls()}
         group by 1 order by 2 desc limit 5`,
        [account.accountId],
      );
      const today = new Date().toISOString().slice(0, 10);
      const { rows: live } = await db.query(
        `select count from rate_limit where bucket = $1 and window_start = $2::date`,
        [`liveday#${account.accountId}`, today],
      );
      // The tier's real ceilings (contracts roles.ts), beaten by the
      // per-account overrides; null = unlimited on the wire. This used to
      // hardcode member's numbers for every tier.
      const q = roleQuotas(account.role);
      const unlimited = account.isOwner || account.role === "admin";
      const lim = (v) => (unlimited || v === Infinity ? null : v);
      return json(200, {
        days,
        by_caller: callers,
        top_tools: tools,
        today_calls: days.find((d) => d.day === today)?.calls ?? 0,
        live_today: live[0]?.count ?? 0,
        live_max: lim(account.liveDailyQuota ?? q.live_fetches_per_day),
        quota_max: lim(account.mcpDailyQuota ?? q.mcp_calls_per_day),
      });
    },

    "GET /api/me/requests": async (db, event) => {
      // The MCP requests this account's connections made: the
      // person's own audit slice, newest first.
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select a.tool, a.surface, a.args, a.duration_ms, a.result_bytes,
                a.truncated, a.error_code, a.created_at, a.request_id,
                t.name as token_name
         from mcp_call_audit a
         left join service_token t on t.token_id = a.token_id
         where a.account_id = $1 and ${mcpCalls("a")}
         order by a.created_at desc limit 200`,
        [account.accountId],
      );
      return json(200, { requests: rows });
    },

    "GET /api/me/activity/calls/*": async (db, event) => {
      // One call, opened from the Activity log (review 2026-09-10 Part
      // 5): the row with its timings, and the captured request and
      // response when they landed. Own rows only; the id is the request_id the caller was handed in meta.
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const requestId = String(event.pathParam ?? "");
      if (!UUID_RE.test(requestId)) return json(404, { error: "not_found" });
      const record = await loadCallRecord(db, {
        requestId,
        ownerAccountId: account.accountId,
        capture,
      });
      if (!record) return json(404, { error: "not_found" });
      return json(200, record);
    },

    "GET /api/me/timeline": async (db, event) => {
      // The Timeline page: the last seven days for this account's subjects,
      // synthesized exactly as elixir_timeline would. Reading here moves
      // nothing. seen_to is the app's own place (0228) as it stood
      // before this read, for the page's "New since your last visit"
      // divider; the page moves it with POST /api/me/timeline/seen. MCP's
      // read pointers (activity_seen_at, timeline_reader) are its own:
      // this route neither reads nor moves them (Jamie, 2026-10-20).
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select console_timeline_seen_at, timezone from account
          where account_id = $1`,
        [account.accountId],
      );
      const q = event.queryStringParameters ?? {};
      // Home's tab mark: has anything been learned since the page's place?
      // One statement, and false proves the page would mark nothing new.
      // Its count stays the page's own: only the page builds the items.
      if (q.news === "1") {
        const now = Date.now();
        const seen = rows[0]?.console_timeline_seen_at?.getTime() ?? 0;
        const { any } = await timelineNews(
          db,
          await subjectsFor(db, account.accountId),
          {
            fromMs: Math.max(seen, now - 7 * 86_400_000),
            toMs: now,
            accountId: account.accountId,
          },
        );
        return json(200, { unread: any });
      }
      const evidenceRead = Boolean(q.evidence_item_id);
      const toMs = evidenceRead ? Date.parse(q.to ?? "") : Date.now();
      const fromMs = evidenceRead
        ? Date.parse(q.from ?? "")
        : toMs - 7 * 86_400_000;
      if (
        !Number.isFinite(fromMs) ||
        !Number.isFinite(toMs) ||
        fromMs >= toMs ||
        toMs - fromMs > 7 * 86_400_000 ||
        toMs > Date.now() + 1000
      )
        return json(400, { error: "invalid_window" });
      const subjects = await subjectsFor(db, account.accountId);
      const built = await buildTimeline(db, subjects, {
        fromMs,
        toMs,
        timezone: account.timezone ?? rows[0]?.timezone ?? "UTC",
        accountId: account.accountId,
        // The console is a browser session: the person, interactively.
        interactive: true,
      });
      if (evidenceRead) {
        const evidence = await readTimelineEvidence(
          db,
          built.timeline.find((it) => it.id === q.evidence_item_id),
          {
            offset:
              q.evidence_offset === undefined ? 0 : Number(q.evidence_offset),
            limit:
              q.evidence_limit === undefined ? 25 : Number(q.evidence_limit),
            expectedVersion: q.expected_evidence_version,
          },
        );
        return json(
          evidence.error
            ? evidence.error === "evidence_changed"
              ? 409
              : 404
            : 200,
          evidence,
        );
      }
      return json(200, {
        ...built,
        // Home's chips, sparklines and battle links, and each item's
        // cheers: counts and the reader's own, never who (slice 7, #765).
        timeline: await withCheers(
          db,
          await annotateFeed(db, built.timeline, subjects),
          account.accountId,
        ),
        seen_to: rows[0]?.console_timeline_seen_at?.toISOString() ?? null,
      });
    },

    "POST /api/me/timeline/seen": async (db, event, body) => {
      // The app showed this account's Timeline through `to` (the
      // window end GET /api/me/timeline served): its own place moves
      // there, forward only, and the rail's dot counts from it. Never an
      // MCP read pointer or meta.timeline_pending (Jamie, 2026-10-20:
      // "timeline should be independent of what agents have seen via
      // MCP").
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const toMs = typeof body?.to === "string" ? Date.parse(body.to) : NaN;
      if (!Number.isFinite(toMs) || toMs > Date.now() + 1000)
        return json(400, { error: "invalid_to" });
      const { rows } = await db.query(
        `update account
            set console_timeline_seen_at = greatest(
                  console_timeline_seen_at, least($2::timestamptz, now()))
          where account_id = $1
          returning console_timeline_seen_at`,
        [account.accountId, new Date(toMs).toISOString()],
      );
      return json(200, {
        seen_to: rows[0]?.console_timeline_seen_at?.toISOString() ?? null,
      });
    },
  };
}
