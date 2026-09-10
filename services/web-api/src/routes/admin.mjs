import {
  decideAccess,
  pendingRequests,
  issueServiceToken,
  setAccountRole,
} from "@elixir-mcp/auth";
import { isRole, ROLE_ORDER, ADMIN_SETTABLE } from "@elixir-mcp/contracts";
import { emitAccountTierChanged } from "../../../mcp/src/feed.mjs";

import { UUID_RE, ID_RE, json } from "../http.mjs";
import { loadCallRecord } from "../call-record.mjs";
const SETTABLE_BY_OWNER = ROLE_ORDER.filter((r) => r !== "owner");

export function adminRoutes({
  resolveAccount,
  ping,
  logEvent,
  notifyOwner,
  sendWelcomeEmail,
  capture = null,
}) {
  return {
    "GET /api/admin/calls/*": async (db, event) => {
      // The same record as /api/me/activity/calls/<id>, over every
      // account: the review's "what did elixir-bot send" is one click.
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const requestId = String(event.pathParam ?? "");
      if (!UUID_RE.test(requestId)) return json(404, { error: "not_found" });
      const record = await loadCallRecord(db, { requestId, capture });
      if (!record) return json(404, { error: "not_found" });
      return json(200, record);
    },

    "GET /api/admin/usage": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows: accounts } = await db.query(
        `select a.account_id, a.email_hash, a.kind, a.public_id,
                (select st.name from service_token st
                  where st.account_id = a.account_id and st.revoked_at is null
                  order by st.created_at limit 1) as principal_name,
                a.mcp_daily_quota,
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
      if (body.revoke_token_id !== undefined) {
        // token_id is a bigint column: anything else is a 400, not a 500.
        if (!ID_RE.test(String(body.revoke_token_id)))
          return json(400, { error: "invalid_token_id" });
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
        actorRole: account.role,
      });
      if (!decided) return json(404, { error: "not_found" });
      // The hierarchy refused: an admin cannot deny the owner or
      // another admin out of the service. Never report that as done.
      if (decided.refused) return json(403, { error: decided.refused });
      let notified = false;
      if (decided.status === "approved") {
        // The funnel's middle step. With request and activation already
        // counted, this is what turns two unrelated numbers into a rate:
        // how many asked, how many were let in, how many turned up.
        await ping("signup.approved");
        // The applicant is the one who was promised an email. Sending
        // this to the owner instead is why an approved account heard
        // nothing at all.
        if (decided.email) {
          await sendWelcomeEmail({ email: decided.email });
          notified = true;
        }
        await notifyOwner({
          kind: "approved_welcome",
          emailHash: body.email_hash,
        });
      }
      // Say whether they were actually told. An account approved before
      // the address was held has none, and re-approving cannot resend.
      return json(200, { ok: true, status: decided.status, notified });
    },

    "GET /api/admin/accounts": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select a.account_id, a.email_hash, a.status, a.role, a.is_owner,
                a.kind, a.public_id,
                (select st.name from service_token st
                  where st.account_id = a.account_id and st.revoked_at is null
                  order by st.created_at limit 1) as principal_name,
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
      const accountId = String(body.account_id ?? "");
      if (!UUID_RE.test(accountId)) return json(404, { error: "not_found" });
      // One entitlements system, ONE decision: admins set roles up to
      // partner and never touch admin/owner accounts, the owner grants
      // anything except "owner" itself. The hierarchy rides in the
      // UPDATE's own predicate, so a target promoted between the check
      // and the write cannot be overwritten on stale authority (#29).
      const result = await setAccountRole(db, {
        accountId,
        role,
        actorRole: account.role,
      });
      if (result === null) return json(404, { error: "not_found" });
      if (result.refused)
        return json(result.refused === "bad_role" ? 400 : 403, {
          error: result.refused === "bad_role" ? "bad_request" : "not_entitled",
          message: "That role change is above your grant.",
        });
      // Only a change that actually committed is logged or announced.
      await logEvent(db, result.account_id, "role_changed", { role });
      await emitAccountTierChanged(db, result.account_id, { role });
      return json(200, { ok: true, account_id: result.account_id, role });
    },
  };
}
