/**
 * Site API — DESIGN §6.1. One credential core, this is the web shell.
 *
 * Auth resolution: Bearer wins (dev/tools), else the __Host- cookie —
 * and cookie-authed state changes require the X-Elixir-Client header
 * (CSRF: SameSite=Lax + custom-header contract, librarian's pattern; the
 * CloudFront distribution for the site is the only origin that forwards
 * it). The access-gate answers identically for unknown/pending/denied
 * emails everywhere — never an oracle.
 */

import crypto from "node:crypto";
import pg from "pg";
import {
  emailHash,
  requestAccess,
  decideAccess,
  approvedAccount,
  pendingRequests,
  startMagicLogin,
  redeemMagicToken,
  verifyMagicCode,
  createSession,
  resolveSession,
  revokeSession,
  checkRateLimit,
  issueServiceToken,
} from "@elixir-mcp/auth";
import {
  normalizeTag,
  InvalidTagError,
  roleQuotas,
  isRole,
  ROLE_ORDER,
  ADMIN_SETTABLE,
  canSetRole,
} from "@elixir-mcp/contracts";

// Every role but "owner" — the owner grants anything except ownership.
const SETTABLE_BY_OWNER = ROLE_ORDER.filter((r) => r !== "owner");
import { makeRegistry } from "../../mcp/src/tools.mjs";
import { ensureGatewayCards } from "../../mcp/src/gateway-cards.mjs";
import { makeInvoker } from "../../mcp/src/invoker.mjs";
import { ledgerStats } from "../../scheduler/src/ledger.mjs";
import { emitFeedEvent } from "../../mcp/src/feed.mjs";
import {
  ensureClanRecording,
  settleClanRecording,
} from "../../mcp/src/tools.mjs";

const COOKIE_NAME = "__Host-elixir_session";
const CONTRACT_HEADER = "x-elixir-client";

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers,
  },
  body: JSON.stringify(body),
});

function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function readCookie(event) {
  const cookies =
    event.cookies ?? String(event.headers?.cookie ?? "").split("; ");
  for (const c of cookies) {
    if (c.startsWith(`${COOKIE_NAME}=`)) return c.slice(COOKIE_NAME.length + 1);
  }
  return "";
}

function bearer(event) {
  const auth = String(event.headers?.authorization ?? "");
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

export function makeHandler({
  databaseUrl,
  secret,
  sendLoginEmail,
  notifyOwner = async () => {},
  queueStats = async () => null,
  track = null,
  collectorDoor = null,
}) {
  // Tinylytics ping (best-effort by contract; never blocks a response).
  const ping = async (eventName, value) => {
    if (!track) return;
    try {
      await track(eventName, value);
    } catch {
      // Analytics must never break serving (house rule).
    }
  };
  async function resolveAccount(
    db,
    event,
    { requireContractHeader = false } = {},
  ) {
    const fromBearer = bearer(event);
    const token = fromBearer || readCookie(event);
    if (!token) return null;
    if (
      !fromBearer &&
      requireContractHeader &&
      !event.headers?.[CONTRACT_HEADER]
    )
      return null;
    return resolveSession(db, { secret, token });
  }

  let exploreRegistryCache = null;
  function exploreRegistry() {
    exploreRegistryCache ??= makeRegistry();
    return exploreRegistryCache;
  }

  // The activity log must never break the action it records.
  async function logEvent(db, accountId, kind, detail = null) {
    await db
      .query(
        `insert into account_event (account_id, kind, detail) values ($1, $2, $3)`,
        [accountId, kind, detail ? JSON.stringify(detail) : null],
      )
      .catch(() => {});
  }

  async function mintSessionResponse(db, hash) {
    const account = await approvedAccount(db, hash);
    if (!account) return json(400, { error: "invalid_or_expired" });
    const minted = await createSession(db, {
      secret,
      accountId: account.account_id,
      emailHash: hash,
    });
    await logEvent(db, account.account_id, "signed_in");
    return json(
      200,
      { authenticated: true },
      { "set-cookie": sessionCookie(minted.token, 90 * 24 * 3600) },
    );
  }

  const routes = {
    // Zero-trust collector door (COLLECTOR-ZERO-TRUST.md): Bearer
    // gateway tokens, no cookies, no contract header - pure API
    // clients. Handlers live in collector-door.mjs.
    "GET /api/collector/config": async (db, event) => {
      if (!collectorDoor) return json(503, { error: "unavailable" });
      const r = await collectorDoor.config(db, event);
      return json(r.status, r.body);
    },
    "POST /api/collector/lease": async (db, event, body) => {
      if (!collectorDoor) return json(503, { error: "unavailable" });
      const r = await collectorDoor.lease(db, event, body);
      return json(r.status, r.body);
    },
    "POST /api/collector/submit": async (db, event, body) => {
      if (!collectorDoor) return json(503, { error: "unavailable" });
      const r = await collectorDoor.submit(db, event, body);
      return json(r.status, r.body);
    },

    "POST /api/request-access": async (db, event, body) => {
      const ip = event.requestContext?.http?.sourceIp ?? "unknown";
      if (!(await checkRateLimit(db, { bucket: `reqaccess#${ip}`, max: 5 }))) {
        return json(429, { error: "rate_limited" });
      }
      const email = String(body.email ?? "").trim();
      if (!email.includes("@")) return json(400, { error: "bad_request" });
      let playerTag = null;
      try {
        playerTag = body.player_tag
          ? normalizeTag(String(body.player_tag))
          : null;
      } catch {
        return json(400, { error: "invalid_tag" });
      }
      const result = await requestAccess(db, {
        emailHash: emailHash(email),
        playerTag,
        note: String(body.note ?? "").slice(0, 500) || null,
      });
      if (result.created) {
        await notifyOwner({ kind: "access_request", playerTag });
        await ping("site.access_request");
      }
      // Identical response for new, repeat, denied, and already-approved.
      return json(200, {
        ok: true,
        message: "If your request is approved, you will hear from us by email.",
      });
    },

    "POST /api/auth": async (db, event, body) => {
      const ip = event.requestContext?.http?.sourceIp ?? "unknown";
      const email = String(body.email ?? "").trim();
      const okIp = await checkRateLimit(db, { bucket: `auth#${ip}`, max: 10 });
      const okEmail = await checkRateLimit(db, {
        bucket: `auth#${emailHash(email)}`,
        max: 5,
      });
      if (okIp && okEmail && email.includes("@")) {
        const account = await approvedAccount(db, emailHash(email));
        if (account) {
          const { token, code } = await startMagicLogin(db, {
            emailHash: emailHash(email),
            purpose: "web",
          });
          await sendLoginEmail({ email, code, token, purpose: "web" });
        }
      }
      return json(200, {
        ok: true,
        message: "If your account is approved, a sign-in email is on its way.",
      });
    },

    "POST /api/auth/redeem": async (db, _event, body) => {
      const row = await redeemMagicToken(db, body.token);
      if (!row || row.purpose !== "web")
        return json(400, { error: "invalid_or_expired" });
      await ping("site.signin", "magic_link");
      return mintSessionResponse(db, row.email_hash);
    },

    "POST /api/auth/code": async (db, _event, body) => {
      const hash = emailHash(String(body.email ?? ""));
      const row = await verifyMagicCode(db, {
        emailHash: hash,
        code: body.code,
      });
      if (!row || row.purpose !== "web")
        return json(400, { error: "invalid_or_expired" });
      await ping("site.signin", "code");
      return mintSessionResponse(db, hash);
    },

    "GET /api/me": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(200, { authenticated: false });
      const [claims, recordings] = await Promise.all([
        db.query(
          `select c.player_tag, c.status, c.is_primary, c.notify, p.name, p.last_known_clan_tag,
                  nn.nickname
           from claim c join player p on p.player_tag = c.player_tag
           left join player_nickname nn on nn.account_id = c.account_id
             and nn.player_tag = c.player_tag
           where c.account_id = $1 order by c.is_primary desc, c.player_tag`,
          [account.accountId],
        ),
        db.query(
          `select r.subject_tag, r.status, r.created_at,
                  (select max(last_admitted_at) from poll_state ps where ps.subject_tag = r.subject_tag) as freshest_poll,
                  (select count(*)::int from api_receipt ar
                   where ar.entity_key = r.subject_tag
                     and ar.fetched_at > now() - interval '24 hours') as fetches_24h
           from recording r where r.requested_by = $1 and r.subject_type = 'player'`,
          [account.accountId],
        ),
      ]);
      const { rows: ent } = await db.query(
        `select a.role, a.max_player_recordings, a.mcp_daily_quota, a.live_daily_quota,
                exists (select 1 from gateway g
                        where g.owner_account_id = $1 and g.status = 'active') as operator,
                (select count(*)::int from claim c
                 where c.account_id = $1) as players_used,
                (select count(*)::int from account_clan ac
                 where ac.account_id = $1 and ac.scope = 'activity') as activity_used,
                (select count(*)::int from account_clan ac
                 where ac.account_id = $1 and ac.scope = 'comprehensive') as comprehensive_used,
                (select count(*)::int from collection c
                 where c.owner_account = $1) as collections_used
         from account a where a.account_id = $1`,
        [account.accountId],
      );
      const e = ent[0];
      const q = roleQuotas(e.role, { operator: e.operator });
      const lim = (v) => (v === Infinity ? null : v); // null = unlimited on the wire
      return json(200, {
        authenticated: true,
        is_owner: account.isOwner,
        is_admin: account.isAdmin,
        timezone: account.timezone,
        role: e.role,
        entitlements: {
          operator_bonus_applied:
            e.operator && !["partner", "admin"].includes(e.role),
          player_slots: {
            used: e.players_used,
            limit: lim(e.max_player_recordings ?? q.player_slots),
          },
          activity_clans: {
            used: e.activity_used,
            limit: lim(q.activity_clans),
          },
          comprehensive_clans: {
            used: e.comprehensive_used,
            limit: lim(q.comprehensive_clans),
          },
          mcp_calls_per_day: lim(e.mcp_daily_quota ?? q.mcp_calls_per_day),
          live_fetches_per_day: lim(
            e.live_daily_quota ?? q.live_fetches_per_day,
          ),
          collections: {
            used: e.collections_used,
            limit: lim(q.collections_max),
          },
        },
        claims: claims.rows,
        recordings: recordings.rows,
      });
    },

    "POST /api/session/signout": async (db, event) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (account) await revokeSession(db, account.sessionId);
      return json(200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    },

    "POST /api/me/timezone": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const tz = String(body.timezone ?? "");
      try {
        Intl.DateTimeFormat("en-US", { timeZone: tz });
      } catch {
        return json(400, {
          error: "bad_request",
          message: "Not an IANA timezone.",
        });
      }
      await db.query(`update account set timezone = $2 where account_id = $1`, [
        account.accountId,
        tz,
      ]);
      return json(200, { ok: true, timezone: tz });
    },

    "POST /api/claims": async (db, event, body) => {
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
      if (action === "remove") {
        const { rowCount } = await db.query(
          `delete from claim where account_id = $1 and player_tag = $2`,
          [account.accountId, tag],
        );
        let recordingStopped = false;
        if (rowCount > 0) {
          const { rowCount: stopped } = await db.query(
            `update recording set status = 'stopped'
             where subject_type = 'player' and subject_tag = $1
               and status = 'active' and requested_by = $2
               and not exists (select 1 from claim where player_tag = $1)`,
            [tag, account.accountId],
          );
          recordingStopped = stopped > 0;
          if (recordingStopped)
            await logEvent(db, account.accountId, "recording_stopped", {
              player_tag: tag,
            });
        }
        return json(200, {
          ok: true,
          removed: rowCount > 0,
          recording_stopped: recordingStopped,
        });
      }
      // 'add': added = recorded (Jamie, 2026-09-05). Slots count what
      // you've ADDED (your claims); the MCP door applies the same rule.
      if (!account.isOwner && account.role !== "admin") {
        const { rows: cap } = await db.query(
          `select a.max_player_recordings as override,
                  exists (select 1 from gateway g
                          where g.owner_account_id = $1 and g.status = 'active') as operator,
                  (select count(*)::int from claim c
                   where c.account_id = $1 and c.player_tag <> $2) as added
           from account a where a.account_id = $1`,
          [account.accountId, tag],
        );
        const limit =
          cap[0].override ??
          roleQuotas(account.role, { operator: cap[0].operator }).player_slots;
        if (cap[0].added >= limit) {
          return json(429, {
            error: "quota_exceeded",
            message: `Added players are capped at ${limit} for the ${account.role ?? "member"} tier. Remove one, request an upgrade below, or run a collector for bonus slots.`,
          });
        }
      }
      await db.query(
        `insert into player (player_tag) values ($1) on conflict do nothing`,
        [tag],
      );
      const { rows: existing } = await db.query(
        `select count(*)::int as n from claim where account_id = $1`,
        [account.accountId],
      );
      const { rowCount: claimed } = await db.query(
        `insert into claim (account_id, player_tag, status, is_primary)
         values ($1, $2, 'unverified', $3) on conflict (account_id, player_tag) do nothing`,
        [
          account.accountId,
          tag,
          existing[0].n === 0 || body.make_primary === true,
        ],
      );
      if (claimed > 0)
        await logEvent(db, account.accountId, "claim_added", {
          player_tag: tag,
        });
      if (body.make_primary === true) {
        await db.query(
          `update claim set is_primary = (player_tag = $2) where account_id = $1`,
          [account.accountId, tag],
        );
      }
      const { rowCount: started } = await db.query(
        `insert into recording (subject_type, subject_tag, requested_by)
         select 'player', $1, $2
         where not exists (select 1 from recording where subject_type = 'player' and subject_tag = $1 and status = 'active')`,
        [tag, account.accountId],
      );
      if (started > 0) {
        await logEvent(db, account.accountId, "recording_started", {
          player_tag: tag,
        });
        await emitFeedEvent(db, account.accountId, "recording_started", tag);
      }
      return json(200, {
        ok: true,
        player_tag: tag,
        recording: "active",
        recording_started: started > 0,
      });
    },

    "GET /api/clan": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      // The account's clan: open membership of a claimed tag in a recorded
      // clan; the owner falls back to the first recorded clan.
      const { rows: mine } = await db.query(
        `select distinct cm.clan_tag from claim c
         join clan_membership cm on cm.player_tag = c.player_tag and cm.left_observed_at is null
         join recording r on r.subject_type = 'clan' and r.subject_tag = cm.clan_tag and r.status = 'active'
         where c.account_id = $1`,
        [account.accountId],
      );
      let clanTag = mine[0]?.clan_tag ?? null;
      if (!clanTag && account.isOwner) {
        const { rows } = await db.query(
          `select subject_tag from recording where subject_type = 'clan' and status = 'active' limit 1`,
        );
        clanTag = rows[0]?.subject_tag ?? null;
      }
      if (!clanTag) return json(403, { error: "not_entitled" });

      // One pg.Client per invocation: queries run sequentially by design.
      const clanRow = await db.query(
        `select name from clan where clan_tag = $1`,
        [clanTag],
      );
      const week = await db.query(
        `select w.season_id, w.section_index, w.is_colosseum,
                  (select json_agg(json_build_object('clan', s.participant_name, 'tag', s.participant_clan_tag,
                                                     'fame', s.fame, 'rank', s.rank) order by s.rank nulls last, s.fame desc)
                   from war_week_clan s where s.clan_tag = w.clan_tag
                     and s.season_id = w.season_id and s.section_index = w.section_index) as standings
           from war_week w where w.clan_tag = $1
           order by w.season_id desc, w.section_index desc limit 1`,
        [clanTag],
      );
      const roster = await db.query(
        `select cm.player_tag, cm.role, p.name, s.trophies, s.donations,
                  (select max(b.battle_time) from battle_participant bp
                   join battle b on b.battle_id = bp.battle_id where bp.player_tag = cm.player_tag) as last_battle
           from clan_membership cm join player p on p.player_tag = cm.player_tag
           left join lateral (select trophies, donations from player_snapshot_daily
                              where player_tag = cm.player_tag
                              order by snapshot_date desc, snapshot_kind desc limit 1) s on true
           where cm.clan_tag = $1 and cm.left_observed_at is null
           order by s.trophies desc nulls last`,
        [clanTag],
      );
      return json(200, {
        clan_tag: clanTag,
        name: clanRow.rows[0]?.name ?? null,
        war: week.rows[0] ?? null,
        members: roster.rows,
      });
    },

    "GET /api/me/connections": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select f.family_id, c.client_name, f.created_at, f.absolute_expires_at,
                (select max(t.created_at) from oauth_token t
                 where t.family_id = f.family_id) as last_token_at
         from oauth_family f join oauth_client c on c.client_id = f.client_id
         where f.account_id = $1 and f.revoked_at is null
           and f.absolute_expires_at > now()
         order by f.created_at desc`,
        [account.accountId],
      );
      return json(200, { connections: rows });
    },

    "POST /api/me/connections/revoke": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const { rowCount } = await db.query(
        `update oauth_family set revoked_at = now()
         where family_id::text = $1 and account_id = $2 and revoked_at is null`,
        [String(body.family_id ?? ""), account.accountId],
      );
      if (rowCount === 0) return json(404, { error: "not_found" });
      await logEvent(db, account.accountId, "connection_revoked", {
        family_id: body.family_id,
      });
      return json(200, { ok: true });
    },

    "GET /api/me/activity": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select kind, detail, created_at from account_event
         where account_id = $1 order by event_id desc limit 20`,
        [account.accountId],
      );
      return json(200, { events: rows });
    },

    "GET /api/public/status": async (db) => {
      // The operational dashboard (Jamie, 2026-09-06): current system
      // health, PUBLIC by design - queues, collectors, an hour of
      // capture. Nothing confidential: no IPs, no machine labels, no
      // account data; collectors go by their card names.
      // One pg.Client per invocation: queries run sequentially by design.
      const q = async (sql, params = []) => (await db.query(sql, params)).rows;
      const collectors = await q(
        `select coalesce(card_name, 'unnamed') as name, card_icon, status,
                last_success_at, last_heartbeat_at,
                (select count(*)::int from api_receipt ar
                 where ar.gateway_id = g.gateway_id
                   and ar.fetched_at > now() - interval '1 hour') as fetches_1h
         from gateway g
         where status in ('active', 'probation', 'pending')
           and name <> 'backfill-elixir-bot'
         order by fetch_points desc`,
      );
      const hour = await q(
        `select to_char(date_trunc('minute', fetched_at)
                  - make_interval(mins => extract(minute from fetched_at)::int % 5),
                'HH24:MI') as bucket,
                count(*)::int as fetches,
                count(*) filter (where admission = 'admitted')::int as admitted,
                count(*) filter (where admission = 'rejected')::int as rejected
         from api_receipt r
         join gateway g on g.gateway_id = r.gateway_id
         where r.fetched_at > now() - interval '75 minutes'
           and g.name <> 'backfill-elixir-bot'
         group by 1 order by 1`,
      );
      const latest = await q(
        `select extract(epoch from now() - max(fetched_at))::int as last_fetch_s,
                extract(epoch from now() - max(fetched_at)
                  filter (where admission = 'admitted'))::int as last_admit_s
         from api_receipt`,
      );
      const hourTotals = await q(
        `select count(*)::int as battles_1h from battle
         where created_at > now() - interval '1 hour'`,
      );
      const audit = await q(
        `select count(*)::int as polls,
                count(*) filter (where gap)::int as gaps
         from capture_audit where fetched_at > now() - interval '24 hours'`,
      );
      const queues = await queueStats();
      const jobs = await ledgerStats(db).catch(() => null);
      // Health verdict derived from data, never vibes: pipeline is OK
      // when something was admitted recently, no DLQ holds messages,
      // and no ledger job has died (0040).
      const dlqDepth = ["live_dlq", "bulk_dlq", "results_dlq", "email_dlq"]
        .map((k) => queues?.[k]?.depth ?? 0)
        .reduce((a, b) => a + b, 0);
      const lastAdmit = latest[0]?.last_admit_s;
      const healthy =
        dlqDepth === 0 &&
        (jobs?.dead ?? 0) === 0 &&
        lastAdmit !== null &&
        lastAdmit < 1800;
      return json(
        200,
        {
          as_of: new Date().toISOString(),
          health: {
            ok: healthy,
            last_fetch_seconds: latest[0]?.last_fetch_s ?? null,
            last_admission_seconds: lastAdmit ?? null,
            dlq_messages: dlqDepth,
            battles_last_hour: hourTotals[0]?.battles_1h ?? 0,
            capture_audit_24h: {
              polls: audit[0]?.polls ?? 0,
              gaps: audit[0]?.gaps ?? 0,
            },
          },
          queues,
          jobs,
          collectors: collectors.map((c) => ({
            name: c.name,
            card_icon: c.card_icon,
            status: c.status,
            last_success_at: c.last_success_at?.toISOString() ?? null,
            last_heartbeat_at: c.last_heartbeat_at?.toISOString() ?? null,
            fetches_1h: c.fetches_1h,
          })),
          capture_5m: hour,
          note: "Live operational snapshot, ~60s cache. Collectors go by their card names; the backfill lane is excluded.",
        },
        { "cache-control": "public, max-age=60" },
      );
    },

    "GET /api/public/stats": async (db) => {
      // The public data story (SITE-IA 2026-09-05): corpus scale and
      // full-history daily series. No auth, no account data - the
      // universal-reads boundary applied to aggregates. CloudFront
      // caches it for an hour.
      const q = async (sql) => (await db.query(sql)).rows;
      const [totals] = await q(
        `select (select count(*)::int from battle) as battles,
                (select count(*)::int from player) as players,
                (select count(*)::int from clan) as clans,
                (select count(*)::int from war_week) as war_weeks,
                (select count(*)::int from player_snapshot_daily) as snapshots,
                (select min(battle_time) from battle) as oldest_battle,
                (select max(battle_time) from battle) as newest_battle,
                (select count(*)::int from gateway where status = 'active') as collectors_active,
                (select count(*) filter (where subject_type = 'player')::int
                 from recording where status = 'active') as players_recording,
                (select count(*) filter (where subject_type = 'clan')::int
                 from recording where status = 'active') as clans_recording`,
      );
      const battlesDaily = await q(
        `select (battle_time at time zone 'UTC')::date::text as day,
                count(*)::int as battles
         from battle group by 1 order by 1`,
      );
      const observedDaily = await q(
        `select (first_seen_at at time zone 'UTC')::date::text as day,
                count(*)::int as players
         from player group by 1 order by 1`,
      );
      const fetchesDaily = await q(
        `select (r.fetched_at at time zone 'UTC')::date::text as day,
                count(*)::int as fetches,
                count(distinct r.gateway_id)::int as collectors
         from api_receipt r join gateway g on g.gateway_id = r.gateway_id
         where g.name <> 'backfill-elixir-bot'
         group by 1 order by 1`,
      );
      return json(
        200,
        {
          totals: {
            ...totals,
            oldest_battle: totals.oldest_battle?.toISOString() ?? null,
            newest_battle: totals.newest_battle?.toISOString() ?? null,
          },
          series: {
            battles_daily: battlesDaily,
            players_observed_daily: observedDaily,
            fetches_daily: fetchesDaily,
          },
          note: "Recorded history only - the corpus began 2026-09-03 plus imported archives; battle days predate observation days where archives were replayed.",
        },
        { "cache-control": "public, max-age=3600" },
      );
    },

    "GET /api/gateways/ladder": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      await ensureGatewayCards(db);
      const { rows } = await db.query(
        `select name, status, fetch_points, card_name, card_icon from gateway
         where status <> 'revoked'
         order by fetch_points desc, enrolled_at`,
      );
      // Card-derived identity (Jamie, 2026-09-06): the CARD is the
      // collector's public name; the operator-chosen name stays as the
      // machine label. Arenas are gone - the real benefit is quota
      // credits (10 fetches = +1 daily call).
      return json(200, {
        ladder: rows.map((g) => ({
          name: g.card_name ?? g.name,
          machine: g.name,
          status: g.status,
          points: Number(g.fetch_points),
          credits: Math.floor(Number(g.fetch_points) / 10),
          card: g.card_name,
          card_icon: g.card_icon,
        })),
      });
    },

    // The explorer bridge: the SAME tool registry the MCP serves,
    // session-authed, audited as surface='web'. Users explore exactly
    // what their agents see; every future tool is explorable for free.
    "POST /api/explore": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const tool = String(body.tool ?? "");
      const registry = exploreRegistry();
      if (!registry.has(tool) || tool === "live_fetch") {
        return json(400, {
          error: "bad_request",
          message: `Unknown or non-explorable tool: ${tool}`,
        });
      }
      const invoke = makeInvoker({
        db,
        account,
        registry,
        surface: "web",
        track,
      });
      const args = body.args && typeof body.args === "object" ? body.args : {};
      const result = await invoke(tool, args);
      return json(200, {
        tool,
        is_error: result.isError === true,
        body: result.body,
      });
    },

    "GET /api/me/feedback": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select feedback_id, surface, category, message, status,
                response, responded_at, created_at
         from feedback where account_id = $1
         order by feedback_id desc limit 50`,
        [account.accountId],
      );
      return json(200, { feedback: rows });
    },

    "POST /api/feedback": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const message = String(body.message ?? "").trim();
      if (!message || message.length > 4000)
        return json(400, { error: "bad_request", message: "1-4000 chars." });
      const category = [
        "general",
        "bug",
        "data_quality",
        "feature",
        "praise",
      ].includes(body.category)
        ? body.category
        : "general";
      await db.query(
        `insert into feedback (account_id, surface, category, message, context)
         values ($1, 'web', $2, $3, $4)`,
        [
          account.accountId,
          category,
          message,
          body.context
            ? JSON.stringify({ context: String(body.context) })
            : null,
        ],
      );
      await ping("site.feedback", category);
      return json(200, { ok: true });
    },

    "GET /api/admin/feedback": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select f.feedback_id, f.surface, f.category, f.message, f.context,
                f.status, f.response, f.responded_at, f.created_at,
                (select c.player_tag from claim c
                 where c.account_id = f.account_id and c.is_primary) as from_player
         from feedback f order by f.feedback_id desc limit 100`,
      );
      return json(200, { feedback: rows });
    },

    "POST /api/admin/feedback": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const status = ["seen", "planned", "done", "declined"].includes(
        body.status,
      )
        ? body.status
        : null;
      if (!status || !body.feedback_id)
        return json(400, { error: "bad_request" });
      const response = body.response
        ? String(body.response).slice(0, 4000)
        : null;
      const { rows: updated } = await db.query(
        `update feedback set status = $2,
                response = coalesce($3, response),
                responded_at = case when $3 is not null then now() else responded_at end
         where feedback_id = $1
         returning account_id`,
        [body.feedback_id, status, response],
      );
      if (updated[0] && response) {
        await emitFeedEvent(
          db,
          updated[0].account_id,
          "feedback_responded",
          null,
          {
            feedback_id: Number(body.feedback_id),
            status,
          },
        );
      }
      return json(200, { ok: true });
    },

    "GET /api/me/usage": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows: days } = await db.query(
        `select (created_at at time zone 'UTC')::date::text as day, count(*)::int as calls,
                count(*) filter (where error_code is not null)::int as errors
         from mcp_call_audit
         where account_id = $1 and created_at > now() - interval '7 days'
         group by 1 order by 1 desc`,
        [account.accountId],
      );
      const { rows: tools } = await db.query(
        `select tool, count(*)::int as calls from mcp_call_audit
         where account_id = $1 and created_at > now() - interval '7 days'
         group by 1 order by 2 desc limit 5`,
        [account.accountId],
      );
      const today = new Date().toISOString().slice(0, 10);
      const { rows: live } = await db.query(
        `select count from rate_limit where bucket = $1 and window_start = $2::date`,
        [`liveday#${account.accountId}`, today],
      );
      const { rows: quota } = await db.query(
        `select mcp_daily_quota from account where account_id = $1`,
        [account.accountId],
      );
      return json(200, {
        days,
        top_tools: tools,
        today_calls: days.find((d) => d.day === today)?.calls ?? 0,
        live_today: live[0]?.count ?? 0,
        live_max: account.isOwner ? null : 50,
        quota_max: account.isOwner ? null : (quota[0]?.mcp_daily_quota ?? 500),
      });
    },

    "GET /api/admin/usage": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows: accounts } = await db.query(
        `select a.email_hash, a.mcp_daily_quota,
                (select c.player_tag from claim c
                 where c.account_id = a.account_id and c.is_primary) as primary_tag,
                count(m.audit_id)::int as calls_7d,
                count(m.audit_id) filter (where (m.created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date)::int as calls_today,
                count(m.audit_id) filter (where m.error_code is not null)::int as errors_7d,
                max(m.created_at) as last_call
         from account a
         left join mcp_call_audit m
           on m.account_id = a.account_id and m.created_at > now() - interval '7 days'
         where a.status = 'approved'
         group by a.account_id order by calls_7d desc`,
      );
      const { rows: tools } = await db.query(
        `select tool, count(*)::int as calls,
                count(*) filter (where error_code is not null)::int as errors,
                round(avg(duration_ms))::int as avg_ms,
                count(*) filter (where truncated)::int as truncated
         from mcp_call_audit where created_at > now() - interval '7 days'
         group by 1 order by 2 desc`,
      );
      // Budget reality: the global 1 rps budget supports ~86,400
      // fetches/day; show consumption and the heaviest subjects.
      const { rows: budget } = await db.query(
        `select count(*)::int as fetches_24h,
                count(distinct entity_key)::int as subjects_24h
         from api_receipt where fetched_at > now() - interval '24 hours'`,
      );
      const { rows: topSubjects } = await db.query(
        `select entity_key, count(*)::int as fetches
         from api_receipt where fetched_at > now() - interval '24 hours'
         group by 1 order by 2 desc limit 10`,
      );
      return json(200, {
        accounts,
        tools,
        budget: {
          ...budget[0],
          capacity_24h: 86400,
          top_subjects: topSubjects,
        },
      });
    },

    "GET /api/admin/service-tokens": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select t.token_id, t.name, t.created_at, t.last_used_at, t.revoked_at,
                (select count(*)::int from mcp_call_audit m
                 where m.surface = 'svc:' || t.name
                   and m.created_at > now() - interval '7 days') as calls_7d
         from service_token t order by t.token_id desc`,
      );
      return json(200, { tokens: rows });
    },

    "POST /api/admin/service-tokens": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      if (body.revoke_token_id) {
        await db.query(
          `update service_token set revoked_at = now() where token_id = $1`,
          [body.revoke_token_id],
        );
        return json(200, { ok: true });
      }
      const name = String(body.name ?? "")
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name))
        return json(400, { error: "invalid_name" });
      // Bound to the OWNER's account by default (elixir-bot acts with
      // Jamie's entitlements); a different binding can come later.
      const token = await issueServiceToken(db, {
        accountId: account.accountId,
        name,
      });
      return json(200, {
        ok: true,
        name,
        token,
        note: "Shown once — store it in the consuming service's env now.",
      });
    },

    "GET /api/admin/requests": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      return json(200, { requests: await pendingRequests(db) });
    },

    "POST /api/admin/decide": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const decided = await decideAccess(db, {
        emailHash: String(body.email_hash ?? ""),
        decision: String(body.decision ?? ""),
      });
      if (!decided) return json(404, { error: "not_found" });
      if (decided.status === "approved")
        await notifyOwner({
          kind: "approved_welcome",
          emailHash: body.email_hash,
        });
      return json(200, { ok: true, status: decided.status });
    },

    "GET /api/me/clans": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select ac.clan_tag, ac.scope, ac.notify, ac.created_at, c.name,
                r.status as recording_status, r.clan_scope as effective_scope
         from account_clan ac
         left join clan c on c.clan_tag = ac.clan_tag
         left join recording r on r.subject_type = 'clan'
           and r.subject_tag = ac.clan_tag and r.status = 'active'
         where ac.account_id = $1 order by ac.created_at`,
        [account.accountId],
      );
      const { rows: slots } = await db.query(
        `select exists (select 1 from gateway g
                        where g.owner_account_id = $1 and g.status = 'active') as operator,
                count(*) filter (where ac.scope = 'activity')::int as activity_used,
                count(*) filter (where ac.scope = 'comprehensive')::int as comprehensive_used
         from account_clan ac where ac.account_id = $1`,
        [account.accountId],
      );
      // The starred suggestion (Jamie, 2026-09-05): your primary
      // player's current clan - "we know your clan from your account".
      const { rows: home } = await db.query(
        `select coalesce(cm.clan_tag, p.last_known_clan_tag) as clan_tag,
                cl.name
         from claim c
         join player p on p.player_tag = c.player_tag
         left join clan_membership cm on cm.player_tag = c.player_tag
           and cm.left_observed_at is null
         left join clan cl on cl.clan_tag = coalesce(cm.clan_tag, p.last_known_clan_tag)
         where c.account_id = $1 and c.is_primary
         limit 1`,
        [account.accountId],
      );
      const q = roleQuotas(account.role, { operator: slots[0]?.operator });
      const lim = (v) => (v === Infinity ? null : v);
      return json(200, {
        clans: rows,
        home_clan: home[0]?.clan_tag
          ? { clan_tag: home[0].clan_tag, name: home[0].name }
          : null,
        slots: {
          activity: {
            used: slots[0]?.activity_used ?? 0,
            limit: lim(q.activity_clans),
          },
          comprehensive: {
            used: slots[0]?.comprehensive_used ?? 0,
            limit: lim(q.comprehensive_clans),
          },
        },
      });
    },

    "POST /api/me/clans": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      let tag;
      try {
        tag = normalizeTag(String(body.clan_tag ?? ""));
      } catch {
        return json(400, { error: "invalid_tag" });
      }
      const action = body.action ?? "add";
      if (action === "notify_on" || action === "notify_off") {
        const { rowCount } = await db.query(
          `update account_clan set notify = $3 where account_id = $1 and clan_tag = $2`,
          [account.accountId, tag, action === "notify_on"],
        );
        if (rowCount === 0) return json(404, { error: "not_found" });
        return json(200, { ok: true, notify: action === "notify_on" });
      }
      if (action === "remove") {
        const { rowCount } = await db.query(
          `delete from account_clan where account_id = $1 and clan_tag = $2`,
          [account.accountId, tag],
        );
        let recordingStopped = false;
        if (rowCount > 0) {
          recordingStopped = await settleClanRecording(db, tag);
          if (recordingStopped)
            await logEvent(db, account.accountId, "recording_stopped", {
              clan_tag: tag,
            });
        }
        return json(200, {
          ok: true,
          removed: rowCount > 0,
          recording_stopped: recordingStopped,
        });
      }
      if (action !== "add") return json(400, { error: "bad_request" });
      // Added = recorded: slots count clans you've ADDED, per scope -
      // the MCP door (elixir_add_clan) applies the same rule.
      const scope = body.scope === "activity" ? "activity" : "comprehensive";
      if (!account.isOwner && account.role !== "admin") {
        const { rows: slots } = await db.query(
          `select exists (select 1 from gateway g
                          where g.owner_account_id = $1 and g.status = 'active') as operator,
                  (select count(*)::int from account_clan ac
                   where ac.account_id = $1 and ac.scope = $2
                     and ac.clan_tag <> $3) as used`,
          [account.accountId, scope, tag],
        );
        const q = roleQuotas(account.role, { operator: slots[0].operator });
        const limit =
          scope === "activity" ? q.activity_clans : q.comprehensive_clans;
        if (slots[0].used >= limit)
          return json(429, {
            error: "quota_exceeded",
            message:
              limit === 0
                ? `The ${account.role ?? "member"} tier has no ${scope}-scope clan slots - request an upgrade from Account > Overview.`
                : `Your ${scope}-scope clan slots are full (${limit} for the ${account.role ?? "member"} tier).`,
          });
      }
      await db.query(
        `insert into clan (clan_tag) values ($1) on conflict do nothing`,
        [tag],
      );
      await db.query(
        `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, $3)
         on conflict (account_id, clan_tag) do update set scope = excluded.scope`,
        [account.accountId, tag, scope],
      );
      const started = await ensureClanRecording(db, tag, account.accountId);
      if (started) {
        await logEvent(db, account.accountId, "recording_started", {
          clan_tag: tag,
          scope,
        });
        await emitFeedEvent(db, account.accountId, "recording_started", tag, {
          scope,
        });
      }
      return json(200, { ok: true, clan_tag: tag, scope });
    },

    "GET /api/admin/collections": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select c.collection_id, c.slug, c.title, c.kind, c.description,
                c.visibility, c.created_at,
                (select count(*)::int from collection_member m
                 where m.collection_id = c.collection_id) as member_count,
                (select array_agg(m.subject_tag order by m.added_at)
                 from collection_member m
                 where m.collection_id = c.collection_id) as members
         from collection c order by c.created_at`,
      );
      return json(200, { collections: rows });
    },

    "POST /api/admin/collections": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const slug = String(body.slug ?? "")
        .toLowerCase()
        .trim();
      if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(slug))
        return json(400, { error: "bad_request", message: "invalid slug" });
      if (body.action === "upsert") {
        if (!body.title || !["player", "clan"].includes(body.kind))
          return json(400, { error: "bad_request" });
        await db.query(
          `insert into collection (slug, title, kind, description, visibility, owner_account)
           values ($1, $2, $3, $4, coalesce($5, 'public'), $6)
           on conflict (slug) do update set
             title = excluded.title,
             description = coalesce(excluded.description, collection.description),
             visibility = coalesce($5, collection.visibility)`,
          [
            slug,
            String(body.title).slice(0, 80),
            body.kind,
            body.description ? String(body.description).slice(0, 500) : null,
            ["public", "private"].includes(body.visibility)
              ? body.visibility
              : null,
            account.accountId,
          ],
        );
        return json(200, { ok: true, slug });
      }
      if (body.action === "add" || body.action === "remove") {
        const { rows: col } = await db.query(
          `select collection_id from collection where slug = $1`,
          [slug],
        );
        if (!col[0]) return json(404, { error: "not_found" });
        let n = 0;
        for (const raw of body.tags ?? []) {
          let tag;
          try {
            tag = normalizeTag(String(raw));
          } catch {
            continue;
          }
          if (body.action === "add") {
            const r = await db.query(
              `insert into collection_member (collection_id, subject_tag)
               values ($1, $2) on conflict do nothing`,
              [col[0].collection_id, tag],
            );
            n += r.rowCount;
          } else {
            const r = await db.query(
              `delete from collection_member
               where collection_id = $1 and subject_tag = $2`,
              [col[0].collection_id, tag],
            );
            n += r.rowCount;
          }
        }
        return json(200, { ok: true, changed: n });
      }
      if (body.action === "delete") {
        await db.query(`delete from collection where slug = $1`, [slug]);
        return json(200, { ok: true });
      }
      return json(400, { error: "bad_request" });
    },

    "GET /api/admin/accounts": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select a.account_id, a.email_hash, a.status, a.role, a.is_owner,
                a.created_at, a.max_player_recordings, a.mcp_daily_quota,
                a.live_daily_quota,
                (select count(*)::int from recording r
                 where r.requested_by = a.account_id and r.subject_type = 'player'
                   and r.status = 'active') as players_recording,
                (select count(*)::int from recording r
                 where r.requested_by = a.account_id and r.subject_type = 'clan'
                   and r.status = 'active') as clans_recording,
                exists (select 1 from gateway g
                        where g.owner_account_id = a.account_id
                          and g.status = 'active') as operator,
                (select f.feedback_id from feedback f
                 where f.account_id = a.account_id and f.status = 'new'
                   and f.context->>'kind' = 'role_upgrade_request'
                 order by f.created_at desc limit 1) as pending_role_request
         from account a order by a.created_at`,
      );
      return json(200, {
        accounts: rows,
        roles: ROLE_ORDER,
        settable_roles:
          account.role === "owner" ? SETTABLE_BY_OWNER : ADMIN_SETTABLE,
      });
    },

    "POST /api/admin/accounts": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const role = String(body.role ?? "");
      if (!isRole(role))
        return json(400, { error: "bad_request", message: "unknown role" });
      const { rows: target } = await db.query(
        `select role from account where account_id = $1`,
        [String(body.account_id ?? "")],
      );
      if (!target[0]) return json(404, { error: "not_found" });
      // One entitlements system: admins set roles up to partner and
      // never touch admin/owner accounts; the owner grants anything
      // except "owner" itself (exactly one, never assigned by API).
      if (!canSetRole(account.role, target[0].role, role))
        return json(403, {
          error: "not_entitled",
          message: "That role change is above your grant.",
        });
      const { rows } = await db.query(
        `update account set role = $2 where account_id = $1
         returning account_id, role`,
        [String(body.account_id ?? ""), role],
      );
      if (!rows[0]) return json(404, { error: "not_found" });
      await logEvent(db, rows[0].account_id, "role_changed", { role });
      await emitFeedEvent(db, rows[0].account_id, "role_changed", null, {
        role,
      });
      return json(200, { ok: true, account_id: rows[0].account_id, role });
    },

    "POST /api/me/role-request": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const role = String(body.role ?? "");
      if (!isRole(role) || role === "admin")
        return json(400, { error: "bad_request", message: "unknown tier" });
      if (
        ROLE_ORDER.indexOf(role) <= ROLE_ORDER.indexOf(account.role ?? "member")
      )
        return json(400, {
          error: "bad_request",
          message: "That tier is not above your current one.",
        });
      const { rows: pending } = await db.query(
        `select feedback_id from feedback
         where account_id = $1 and status = 'new'
           and context->>'kind' = 'role_upgrade_request'`,
        [account.accountId],
      );
      if (pending[0])
        return json(409, {
          error: "conflict",
          message: "You already have an upgrade request pending review.",
        });
      const note = body.note ? String(body.note).slice(0, 500) : null;
      const { rows: fb } = await db.query(
        `insert into feedback (account_id, surface, category, message, context)
         values ($1, 'web', 'feature', $2, $3) returning feedback_id`,
        [
          account.accountId,
          `Tier upgrade request: ${account.role ?? "member"} -> ${role}${note ? ` — ${note}` : ""}`,
          JSON.stringify({
            kind: "role_upgrade_request",
            requested_role: role,
          }),
        ],
      );
      await logEvent(db, account.accountId, "role_upgrade_requested", { role });
      return json(200, { ok: true, request_id: fb[0].feedback_id });
    },

    "GET /api/me/requests": async (db, event) => {
      // Activity tab 1 (SITE-IA): the MCP requests this account's
      // agents made - the user's own audit slice, newest first.
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select tool, surface, args, duration_ms, result_bytes, truncated,
                error_code, created_at
         from mcp_call_audit
         where account_id = $1
         order by created_at desc limit 200`,
        [account.accountId],
      );
      return json(200, { requests: rows });
    },

    "GET /api/me/events": async (db, event) => {
      // Activity tab 3: the notification pipe, read-only. The web view
      // NEVER advances events_seen_through - that cursor belongs to
      // the account's agents (elixir_events mark_seen).
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select event_id, topic, subject_tag, payload, created_at
         from event_feed where account_id = $1
         order by event_id desc limit 100`,
        [account.accountId],
      );
      const { rows: seen } = await db.query(
        `select events_seen_through from account where account_id = $1`,
        [account.accountId],
      );
      return json(200, {
        events: rows,
        seen_through: Number(seen[0]?.events_seen_through ?? 0),
      });
    },

    "GET /api/me/gateway-env": async (db, event) => {
      // ONE-TIME config download (0034): the rendered .env the owner
      // provisioned for this collector. Reading it CLAIMS it - the
      // stored copy is nulled in the same statement, so the secret
      // exists in the database only between provisioning and first
      // download. The CR token is deliberately absent (operator
      // pastes their own - the one exception, per Jamie).
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const id = String(event.queryStringParameters?.id ?? "");
      // RETURNING sees post-update values, so the pre-update secret
      // comes from a locked self-join (prev) instead.
      const { rows } = await db.query(
        `update gateway g set provision_env = null, provision_claimed_at = now()
         from (select gateway_id, name, provision_env from gateway
               where gateway_id::text = $1 and owner_account_id = $2
                 and provision_env is not null
               for update) prev
         where g.gateway_id = prev.gateway_id
         returning prev.name, prev.provision_env as env`,
        [id, account.accountId],
      );
      if (!rows[0]) return json(404, { error: "not_found" });
      await logEvent(db, account.accountId, "gateway_config_claimed", {
        gateway: rows[0].name,
      });
      return json(200, { name: rows[0].name, env: rows[0].env });
    },

    "GET /api/me/gateway-detail": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const id = String(event.queryStringParameters?.id ?? "");
      const { rows: gw } = await db.query(
        `select gateway_id, name, status, fetch_points, last_success_at,
                last_seen_sha, enrolled_at
         from gateway
         where gateway_id::text = $1 and owner_account_id = $2`,
        [id, account.accountId],
      );
      if (!gw[0]) return json(404, { error: "not_found" });
      const { rows: daily } = await db.query(
        `select (fetched_at at time zone 'UTC')::date::text as day,
                count(*)::int as fetches,
                count(*) filter (where admission = 'admitted')::int as admitted,
                count(*) filter (where admission = 'rejected')::int as rejected
         from api_receipt
         where gateway_id = $1
           and fetched_at > now() - interval '30 days'
         group by 1 order by 1`,
        [gw[0].gateway_id],
      );
      const { rows: endpoints } = await db.query(
        `select endpoint, count(*)::int as fetches
         from api_receipt
         where gateway_id = $1
           and fetched_at > now() - interval '7 days'
         group by 1 order by 2 desc`,
        [gw[0].gateway_id],
      );
      return json(200, { gateway: gw[0], daily, endpoints_7d: endpoints });
    },

    "GET /api/me/collections": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select c.collection_id, c.slug, c.title, c.kind, c.description,
                c.visibility, c.created_at,
                (select count(*)::int from collection_member m
                 where m.collection_id = c.collection_id) as member_count,
                (select array_agg(m.subject_tag order by m.added_at)
                 from collection_member m
                 where m.collection_id = c.collection_id) as members
         from collection c where c.owner_account = $1 order by c.created_at`,
        [account.accountId],
      );
      const limit = roleQuotas(account.role).collections_max;
      return json(200, {
        collections: rows,
        limit: limit === Infinity ? null : limit,
      });
    },

    "POST /api/me/collections": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const limit = roleQuotas(account.role).collections_max;
      if (limit === 0 && !account.isOwner)
        return json(403, {
          error: "not_entitled",
          message:
            "Creating collections needs the family tier or above — request an upgrade from Account > Overview.",
        });
      const slug = String(body.slug ?? "")
        .toLowerCase()
        .trim();
      if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(slug))
        return json(400, { error: "bad_request", message: "invalid slug" });
      // Ownership is the governance model: you touch only your own.
      const { rows: owned } = await db.query(
        `select collection_id, owner_account from collection where slug = $1`,
        [slug],
      );
      if (owned[0] && owned[0].owner_account !== account.accountId)
        return json(403, {
          error: "not_entitled",
          message: "Not your collection.",
        });
      if (body.action === "upsert") {
        if (!body.title || !["player", "clan"].includes(body.kind))
          return json(400, { error: "bad_request" });
        if (!owned[0]) {
          const { rows: mine } = await db.query(
            `select count(*)::int as n from collection where owner_account = $1`,
            [account.accountId],
          );
          if (mine[0].n >= limit)
            return json(429, {
              error: "quota_exceeded",
              message: `The ${account.role ?? "member"} tier can curate up to ${limit} collections.`,
            });
        }
        await db.query(
          `insert into collection (slug, title, kind, description, visibility, owner_account)
           values ($1, $2, $3, $4, coalesce($5, 'public'), $6)
           on conflict (slug) do update set
             title = excluded.title,
             description = coalesce(excluded.description, collection.description),
             visibility = coalesce($5, collection.visibility)`,
          [
            slug,
            String(body.title).slice(0, 80),
            body.kind,
            body.description ? String(body.description).slice(0, 500) : null,
            ["public", "private"].includes(body.visibility)
              ? body.visibility
              : null,
            account.accountId,
          ],
        );
        return json(200, { ok: true, slug });
      }
      if (!owned[0]) return json(404, { error: "not_found" });
      if (body.action === "add" || body.action === "remove") {
        let n = 0;
        for (const raw of body.tags ?? []) {
          let tag;
          try {
            tag = normalizeTag(String(raw));
          } catch {
            continue;
          }
          if (body.action === "add") {
            const r = await db.query(
              `insert into collection_member (collection_id, subject_tag)
               values ($1, $2) on conflict do nothing`,
              [owned[0].collection_id, tag],
            );
            n += r.rowCount;
          } else {
            const r = await db.query(
              `delete from collection_member
               where collection_id = $1 and subject_tag = $2`,
              [owned[0].collection_id, tag],
            );
            n += r.rowCount;
          }
        }
        return json(200, { ok: true, changed: n });
      }
      if (body.action === "delete") {
        await db.query(`delete from collection where collection_id = $1`, [
          owned[0].collection_id,
        ]);
        return json(200, { ok: true });
      }
      return json(400, { error: "bad_request" });
    },

    "GET /api/admin/gateways": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select gateway_id, name, status, static_ip, key_source, enrolled_at, last_heartbeat_at, last_success_at,
                fetch_points, last_seen_sha,
                (select count(*)::int from api_receipt r where r.gateway_id = g.gateway_id
                 and r.fetched_at > now() - interval '1 hour') as fetches_last_hour
         from gateway g order by enrolled_at`,
      );
      return json(200, { gateways: rows });
    },

    // Raise your hand to run a gateway (§4.6 lifecycle: pending until Jamie
    // issues an IP-bound key from his Supercell account + a per-gateway IAM
    // user — both Jamie-manual). The key itself never touches this system.
    "POST /api/gateways": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const name = String(body.name ?? "")
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name))
        return json(400, { error: "invalid_name" });
      // Zero-trust: no IP collected - the CR key's IP binding is
      // operator<->Supercell business (COLLECTOR-ZERO-TRUST.md).
      const dupe = await db.query(
        `select 1 from gateway where name = $1 and status <> 'revoked'`,
        [name],
      );
      if (dupe.rows.length > 0) return json(409, { error: "name_taken" });
      const { rows } = await db.query(
        `insert into gateway (owner_account_id, name)
         values ($1, $2) returning gateway_id`,
        [account.accountId, name],
      );
      await notifyOwner({ kind: "gateway_request", playerTag: name });
      await logEvent(db, account.accountId, "gateway_raised", { name });
      return json(200, {
        ok: true,
        gateway_id: rows[0].gateway_id,
        status: "pending",
        next: "The owner issues an IP-bound CR key and credentials, then follow docs/OPERATORS.md.",
      });
    },

    "GET /api/me/gateways": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      await ensureGatewayCards(db);
      const { rows } = await db.query(
        `select g.gateway_id, g.name, g.status, g.channel, g.enrolled_at, g.last_heartbeat_at, g.last_success_at,
                g.fetch_points, g.card_name, g.card_icon,
                (g.provision_env is not null) as provision_ready,
                (select count(*)::int from api_receipt ar
                 where ar.gateway_id = g.gateway_id
                   and ar.fetched_at > now() - interval '24 hours') as fetches_24h
         from gateway g where g.owner_account_id = $1 order by g.enrolled_at`,
        [account.accountId],
      );
      return json(200, {
        gateways: rows.map((g) => ({
          ...g,
          fetch_points: Number(g.fetch_points),
          credits: Math.floor(Number(g.fetch_points) / 10),
        })),
      });
    },

    "POST /api/admin/gateways": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      // Zero-trust provisioning is one click: mint the bearer token
      // server-side, store its hash, stage the raw for the OPERATOR's
      // one-time reveal (Jamie 2026-09-06: just a token to copy - the
      // file-download flow was IAM-era baggage). The raw token exists
      // in the database only between this click and the reveal.
      if (body.action === "provision_token") {
        const raw = "emcg_" + crypto.randomBytes(32).toString("base64url");
        const { rows: minted } = await db.query(
          `update gateway
           set token_hash = $2, provision_env = $3,
               provision_claimed_at = null
           where gateway_id::text = $1 and status <> 'revoked'
           returning gateway_id, name, channel, status`,
          [
            String(body.gateway_id ?? ""),
            crypto.createHash("sha256").update(raw).digest("hex"),
            raw,
          ],
        );
        if (!minted[0]) return json(404, { error: "not_found" });
        return json(200, { ok: true, staged: true, gateway: minted[0] });
      }
      // Forward-only lifecycle; probation is the only entry to active.
      const TRANSITIONS = {
        probation: ["pending", "draining"],
        activate: ["probation"],
        drain: ["probation", "active"],
        revoke: ["pending", "probation", "active", "draining"],
      };
      const to = {
        probation: "probation",
        activate: "active",
        drain: "draining",
        revoke: "revoked",
      }[body.action];
      const from = TRANSITIONS[body.action];
      if (!to) return json(400, { error: "bad_request" });
      const { rows } = await db.query(
        `update gateway set status = $2,
                cr_key_ref = coalesce($3, cr_key_ref)
         where gateway_id::text = $1 and status = any($4)
         returning gateway_id, name, status`,
        [String(body.gateway_id ?? ""), to, body.cr_key_ref ?? null, from],
      );
      if (rows.length === 0) return json(409, { error: "bad_transition" });
      return json(200, rows[0]);
    },
  };

  return async function handler(event) {
    const method =
      event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
    const path = event.rawPath ?? event.path ?? "/";
    const route = routes[`${method} ${path}`];
    if (!route) return json(404, { error: "not_found" });
    let body = {};
    if (event.body) {
      try {
        // API Gateway v2 may deliver bodies base64-encoded.
        body = JSON.parse(
          event.isBase64Encoded
            ? Buffer.from(event.body, "base64").toString("utf8")
            : event.body,
        );
      } catch {
        return json(400, { error: "invalid_json" });
      }
    }
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      return await route(db, event, body);
    } finally {
      await db.end();
    }
  };
}
