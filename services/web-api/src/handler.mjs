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
  gatewayArena,
} from "@elixir-mcp/contracts";
import { makeRegistry } from "../../mcp/src/tools.mjs";
import { ensureGatewayCards } from "../../mcp/src/gateway-cards.mjs";
import { makeInvoker } from "../../mcp/src/invoker.mjs";

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
}) {
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
      { "set-cookie": sessionCookie(minted.token, 9 * 24 * 3600) },
    );
  }

  const routes = {
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
      if (result.created)
        await notifyOwner({ kind: "access_request", playerTag });
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
      return mintSessionResponse(db, hash);
    },

    "GET /api/me": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(200, { authenticated: false });
      const [claims, recordings] = await Promise.all([
        db.query(
          `select c.player_tag, c.status, c.is_primary, p.name, p.last_known_clan_tag
           from claim c join player p on p.player_tag = c.player_tag
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
      return json(200, {
        authenticated: true,
        is_owner: account.isOwner,
        timezone: account.timezone,
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
      return json(200, { ok: true, player_tag: tag });
    },

    "POST /api/recordings": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      let tag;
      try {
        tag = normalizeTag(String(body.player_tag ?? ""));
      } catch {
        return json(400, { error: "invalid_tag" });
      }
      const { rows: claim } = await db.query(
        `select 1 from claim where account_id = $1 and player_tag = $2`,
        [account.accountId, tag],
      );
      if (!claim[0]) return json(403, { error: "not_entitled" });
      if (body.action === "start") {
        // Recordings spend the one global rate budget: cap active player
        // recordings per account (default 5, column override, owner exempt).
        if (!account.isOwner) {
          const { rows: cap } = await db.query(
            `select coalesce(a.max_player_recordings, 5) as cap,
                    (select count(*)::int from recording r
                     where r.requested_by = $1 and r.subject_type = 'player'
                       and r.status = 'active') as active
             from account a where a.account_id = $1`,
            [account.accountId],
          );
          if (cap[0].active >= cap[0].cap) {
            return json(429, {
              error: "quota_exceeded",
              message: `Active player recordings are capped at ${cap[0].cap} per account.`,
            });
          }
        }
        const { rowCount: started } = await db.query(
          `insert into recording (subject_type, subject_tag, requested_by)
           select 'player', $1, $2
           where not exists (select 1 from recording where subject_type = 'player' and subject_tag = $1 and status = 'active')`,
          [tag, account.accountId],
        );
        if (started > 0)
          await logEvent(db, account.accountId, "recording_started", {
            player_tag: tag,
          });
      } else if (body.action === "stop") {
        const { rowCount: stopped } = await db.query(
          `update recording set status = 'stopped'
           where subject_type = 'player' and subject_tag = $1 and status = 'active'`,
          [tag],
        );
        if (stopped > 0)
          await logEvent(db, account.accountId, "recording_stopped", {
            player_tag: tag,
          });
      } else {
        return json(400, { error: "bad_request" });
      }
      return json(200, { ok: true });
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

    "GET /api/gateways/ladder": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      await ensureGatewayCards(db);
      const { rows } = await db.query(
        `select name, status, fetch_points, card_name, card_icon from gateway
         where status <> 'revoked'
         order by fetch_points desc, enrolled_at`,
      );
      return json(200, {
        ladder: rows.map((g, i) => ({
          rank: i + 1,
          name: g.name,
          status: g.status,
          points: Number(g.fetch_points),
          arena: gatewayArena(Number(g.fetch_points)).name,
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
      });
      const args = body.args && typeof body.args === "object" ? body.args : {};
      const result = await invoke(tool, args);
      return json(200, {
        tool,
        is_error: result.isError === true,
        body: result.body,
      });
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
      return json(200, { ok: true });
    },

    "GET /api/admin/feedback": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select f.feedback_id, f.surface, f.category, f.message, f.context,
                f.status, f.created_at,
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
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      const status = ["seen", "planned", "done", "declined"].includes(
        body.status,
      )
        ? body.status
        : null;
      if (!status || !body.feedback_id)
        return json(400, { error: "bad_request" });
      await db.query(`update feedback set status = $2 where feedback_id = $1`, [
        body.feedback_id,
        status,
      ]);
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
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
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
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      return json(200, { requests: await pendingRequests(db) });
    },

    "POST /api/admin/decide": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
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

    "GET /api/admin/clans": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select r.subject_tag as clan_tag, r.status, r.clan_scope, r.created_at, cl.name,
                (select count(*)::int from clan_membership cm
                 where cm.clan_tag = r.subject_tag and cm.left_observed_at is null) as open_members,
                (select max(ps.last_admitted_at) from poll_state ps
                 where ps.subject_tag = r.subject_tag and ps.endpoint = 'clan') as last_roster_poll
         from recording r
         left join clan cl on cl.clan_tag = r.subject_tag
         where r.subject_type = 'clan'
         order by r.created_at`,
      );
      return json(200, { clans: rows });
    },

    "POST /api/admin/clans": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      let tag;
      try {
        tag = normalizeTag(String(body.clan_tag ?? ""));
      } catch {
        return json(400, { error: "invalid_tag" });
      }
      const scope = body.scope === "activity" ? "activity" : "comprehensive";
      if (body.action === "start") {
        await db.query(
          `insert into clan (clan_tag) values ($1) on conflict do nothing`,
          [tag],
        );
        await db.query(
          `insert into recording (subject_type, subject_tag, requested_by, clan_scope)
           select 'clan', $1, $2, $3
           where not exists (select 1 from recording
                             where subject_type = 'clan' and subject_tag = $1 and status = 'active')`,
          [tag, account.accountId, scope],
        );
      } else if (body.action === "scope") {
        // Live scope change: downgrading to 'activity' lets member rows
        // go dormant on the next tick; upgrading re-seeds them.
        await db.query(
          `update recording set clan_scope = $2
           where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
          [tag, scope],
        );
      } else if (body.action === "stop") {
        await db.query(
          `update recording set status = 'stopped'
           where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
          [tag],
        );
      } else {
        return json(400, { error: "bad_request" });
      }
      return json(200, { ok: true, clan_tag: tag });
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
      const ip = String(body.static_ip ?? "").trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
        return json(400, { error: "invalid_ip" });
      const dupe = await db.query(
        `select 1 from gateway where name = $1 and status <> 'revoked'`,
        [name],
      );
      if (dupe.rows.length > 0) return json(409, { error: "name_taken" });
      const { rows } = await db.query(
        `insert into gateway (owner_account_id, name, static_ip)
         values ($1, $2, $3) returning gateway_id`,
        [account.accountId, name, ip],
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
        `select g.gateway_id, g.name, g.status, g.static_ip, g.enrolled_at, g.last_heartbeat_at, g.last_success_at,
                g.fetch_points, g.card_name, g.card_icon,
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
          arena: gatewayArena(Number(g.fetch_points)),
        })),
      });
    },

    "POST /api/admin/gateways": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
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
