import { addPlayer, removePlayer } from "@elixir-mcp/claims";
import {
  normalizeTag,
  InvalidTagError,
  roleQuotas,
  isRole,
  ROLE_ORDER,
} from "@elixir-mcp/contracts";
import { firstAnswer } from "../first-answer.mjs";
import { emitFeedEvent } from "../../../mcp/src/feed.mjs";

import { json } from "../http.mjs";

export function accountRoutes({ resolveAccount, logEvent }) {
  return {
    "GET /api/me": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(200, { authenticated: false });
      const [claims, recordings] = await Promise.all([
        db.query(
          `select c.player_tag, c.status, c.is_primary, c.notify, c.relationship,
                  p.name, p.last_known_clan_tag,
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
                a.newsletter_opt_in,
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
        newsletter_opt_in: e.newsletter_opt_in === true,
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
      /**
       * The writer this column never had.
       *
       * 0055 added claim.relationship (primary | alt | friend | watching) and
       * describeIdentity groups the MCP identity block by it -- but NOTHING
       * could ever set it. No console control, no API action, no MCP tool. So
       * every non-primary player has been announced to every connected agent
       * as "watching" since the day it shipped, and the alt/friend vocabulary
       * in the docs described something unreachable.
       *
       * 'primary' is deliberately NOT settable here: exactly one claim is
       * primary and promoting one must demote the other, which is what
       * make_primary on add already does atomically.
       */
      if (action === "relationship") {
        const REL = ["alt", "friend", "watching"];
        if (!REL.includes(body.relationship))
          return json(400, { error: "bad_relationship", allowed: REL });
        const { rowCount } = await db.query(
          `update claim set relationship = $3
            where account_id = $1 and player_tag = $2 and not is_primary`,
          [account.accountId, tag, body.relationship],
        );
        // No row means either you never added this tag, or it is your primary
        // -- and demoting a primary by renaming it would leave you with none.
        if (rowCount === 0) return json(404, { error: "not_found_or_primary" });
        return json(200, { ok: true, relationship: body.relationship });
      }
      if (action === "remove") {
        const r = await removePlayer(db, account, { tag, via: "web" });
        return json(200, {
          ok: true,
          removed: r.removed,
          recording_stopped: r.recordingStopped,
          primary_player_tag: r.promotedPrimary,
        });
      }
      // 'add': added = recorded (Jamie, 2026-09-05). Slots count what
      // you've ADDED (your claims); the MCP door runs the same function.
      const r = await addPlayer(db, account, {
        tag,
        makePrimary: body.make_primary === true,
        via: "web",
      });
      if (!r.ok && r.error === "quota_exceeded") {
        return json(429, {
          error: "quota_exceeded",
          message: `Added players are capped at ${r.limit} for the ${r.role} tier. Remove one, request an upgrade below, or run a collector for bonus slots.`,
        });
      }
      if (!r.ok) return json(404, { error: "not_found" });
      if (r.recordingStarted) {
        await emitFeedEvent(db, account.accountId, "recording_started", tag);
      }
      return json(200, {
        ok: true,
        player_tag: tag,
        recording: "active",
        recording_started: r.recordingStarted,
      });
    },

    "GET /api/me/first-answer": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      return json(200, await firstAnswer(db, account.accountId));
    },

    "GET /api/me/connections": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select f.family_id, c.client_name, f.scope, f.created_at, f.absolute_expires_at,
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

    "GET /api/me/usage": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      // EVERY account whose calls this budget pays for: yours, and your
      // agents'. An agent charges `mcpday#<owner>` (auth/oauth.mjs, "an agent
      // spends its OWNER's budget") while its audit rows carry its own
      // account_id -- so counting only $1 showed "42 of 500" to somebody the
      // limiter had already counted to 500. The page whose whole job is "am I
      // near my limit" has to count what the limiter counts.
      const { rows: days } = await db.query(
        `select (created_at at time zone 'UTC')::date::text as day, count(*)::int as calls,
                count(*) filter (where error_code is not null)::int as errors,
                count(*) filter (where account_id <> $1)::int as agent_calls
         from mcp_call_audit
         where (account_id = $1 or account_id = any(coalesce(
                 (select array_agg(account_id) from account where owned_by_account_id = $1),
                 '{}'::uuid[])))
           and created_at > now() - interval '7 days'
         group by 1 order by 1 desc`,
        [account.accountId],
      );
      const { rows: tools } = await db.query(
        `select tool, count(*)::int as calls from mcp_call_audit
         where (account_id = $1 or account_id = any(coalesce(
                 (select array_agg(account_id) from account where owned_by_account_id = $1),
                 '{}'::uuid[])))
           and created_at > now() - interval '7 days'
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
        // Broken out so the page can say where the spend went rather than
        // leaving somebody to wonder why their own usage looks bigger than
        // their own usage.
        agent_calls_today: days.find((d) => d.day === today)?.agent_calls ?? 0,
        live_today: live[0]?.count ?? 0,
        live_max: account.isOwner ? null : 50,
        quota_max: account.isOwner ? null : (quota[0]?.mcp_daily_quota ?? 500),
      });
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
        `select a.tool, a.surface, a.args, a.duration_ms, a.result_bytes,
                a.truncated, a.error_code, a.created_at, a.request_id,
                t.name as token_name
         from mcp_call_audit a
         left join service_token t on t.token_id = a.token_id
         where a.account_id = $1
         order by a.created_at desc limit 200`,
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
  };
}
