import {
  decideAccess,
  pendingRequests,
  issueServiceToken,
  setAccountRole,
} from "@elixir-mcp/auth";
import { isRole, ROLE_ORDER, ADMIN_SETTABLE } from "@elixir-mcp/contracts";

import { UUID_RE, ID_RE, json } from "../http.mjs";
import { onboardAccount } from "../onboard.mjs";
import { loadCallRecord } from "../call-record.mjs";
import {
  SENDS_COLS,
  SENDS_FROM,
  sendRow,
  loadSendRecord,
} from "../send-record.mjs";
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

    "GET /api/admin/email/sends": async (db, event) => {
      // Everything sent, every account, newest first (Jamie, 2026-09-19:
      // "we can audit what we send without user feedback"). Recipients
      // are named by their primary player and public id, never an
      // address; the body is one click away through the record.
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select ${SENDS_COLS},
                a.public_id,
                (select c.player_tag from claim c
                 where c.account_id = s.account_id and c.is_primary) as to_player,
                (select count(*)::int from feedback f where f.send_id = s.send_id) as reports
           ${SENDS_FROM}
           join account a on a.account_id = s.account_id
          order by s.enqueued_at desc limit 200`,
      );
      return json(200, {
        sends: rows.map((r) => ({
          ...sendRow(r),
          account_id: r.account_id,
          public_id: r.public_id,
          to_player: r.to_player,
          reports: r.reports,
        })),
      });
    },
    "GET /api/admin/email/sends/*": async (db, event) => {
      // The same record as /api/me/email/sends/<id>, over every account:
      // the body a report is about, read by the maintainer.
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const sendId = String(event.pathParam ?? "");
      if (!UUID_RE.test(sendId)) return json(404, { error: "not_found" });
      const record = await loadSendRecord(db, { sendId, archive: capture });
      if (!record) return json(404, { error: "not_found" });
      return json(200, record);
    },

    "GET /api/admin/cards": async (db, event) => {
      // The card catalog with its archetype roles, read-only (design
      // 2026-09-20 §12.4): the vocabulary in force and where it came
      // from, and the one operational list - cards with no role that
      // keep turning up as the defining (most expensive troop or
      // building) card of a deck named by cost alone this season. The
      // file is edited in cr-agent-api-docs, never here.
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows: version } = await db.query(
        `select roles_version, source_commit, imported_at, roles, aliases from card_role_version`,
      );
      const { rows: cards } = await db.query(
        `select c.card_id, c.name, c.kind, c.rarity, c.elixir_cost, c.max_evolution_level,
                r.tier, r.family, r.at_cycle_cost, r.needs_partner, r.pairs_with, r.bait_tiers,
                r.bait_unit, r.bridge_partner, r.names_deck, r.source, r.attested_at
           from card c
           left join card_role r on r.card_id = c.card_id
          where c.name is not null
          order by c.card_id`,
      );
      const { rows: season } = await db.query(
        `select season_month from season where starts_at <= now() order by season_month desc limit 1`,
      );
      const seasonMonth = season[0]?.season_month ?? null;
      // Decks with no attested win condition this season, and the most
      // expensive troop or building in each that has no role.
      const { rows: unattested } = await db.query(
        `with fallback as (
           select d.deck_hash, m.battles
             from deck d
             join deck_meta_season m on m.deck_hash = d.deck_hash
              and m.season_month = $1 and m.mode_group = 'all'
            where d.archetype_win_conditions = '{}'),
         defining as (
           select distinct on (f.deck_hash) f.deck_hash, f.battles, dc.card_id
             from fallback f
             join deck_card dc on dc.deck_hash = f.deck_hash
             join card c on c.card_id = dc.card_id
             left join card_role r on r.card_id = dc.card_id
            where r.card_id is null and dc.card_id < 28000000 and c.elixir_cost is not null
            order by f.deck_hash, c.elixir_cost desc, dc.card_id)
         select x.card_id, c.name, count(*)::int as decks, sum(x.battles)::int as battles
           from defining x join card c on c.card_id = x.card_id
          group by x.card_id, c.name
          order by battles desc, decks desc
          limit 30`,
        [seasonMonth],
      );
      const { rows: aliases } = await db.query(
        `select alias, cards, family, source, attested_at from deck_alias order by alias`,
      );
      return json(200, {
        version: version[0] ?? null,
        season: seasonMonth,
        cards: cards.map((c) => ({
          card_id: c.card_id,
          name: c.name,
          kind: c.kind,
          rarity: c.rarity,
          elixir_cost: c.elixir_cost,
          forms_available: c.max_evolution_level,
          role:
            c.tier !== null ||
            c.bait_tiers ||
            c.bait_unit ||
            c.bridge_partner ||
            c.names_deck
              ? {
                  win_condition: c.tier !== null || Boolean(c.bait_tiers),
                  tier: c.tier === null ? null : Number(c.tier),
                  family: c.family,
                  at_cycle_cost: c.at_cycle_cost,
                  needs_partner: c.needs_partner,
                  pairs_with: c.pairs_with,
                  bait_tiers: c.bait_tiers,
                  bait_unit: c.bait_unit,
                  bridge_partner: c.bridge_partner,
                  names_deck: c.names_deck,
                  source: c.source,
                  attested_at: c.attested_at,
                }
              : null,
        })),
        unattested,
        aliases,
      });
    },

    "GET /api/admin/usage": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows: accounts } = await db.query(
        `select a.account_id, a.email_hash, a.kind, a.public_id,
                -- A principal name is an agent's or an integration's; a
                -- person's own legacy key is not their name (console walk
                -- 2: the owner read "Principal name: elixir-bot").
                case when coalesce(a.kind, 'person') <> 'person' then
                  (select st.name from service_token st
                    where st.account_id = a.account_id and st.revoked_at is null
                    order by st.created_at limit 1) end as principal_name,
                a.mcp_daily_quota,
                (select c.player_tag from claim c
                 where c.account_id = a.account_id and c.is_primary) as primary_tag,
                (select p.name from claim c join player p on p.player_tag = c.player_tag
                 where c.account_id = a.account_id and c.is_primary) as primary_name,
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

    // Every account's live connections, and the power to end one on
    // somebody's behalf (2026-09-10, Jamie). Service tokens are a
    // different thing entirely - owner-issued headless credentials - and
    // this is what he was looking for when he opened that page: who is
    // connected, from where, and a way to stop it.
    "GET /api/admin/connections": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select f.family_id, f.account_id, f.scope, f.created_at,
                f.absolute_expires_at, c.client_name,
                a.email, a.kind, a.public_id, a.role,
                (select max(t.created_at) from oauth_token t
                 where t.family_id = f.family_id) as last_token_at,
                (select count(*)::int from mcp_call_audit m
                 where m.oauth_family_id = f.family_id
                   and m.created_at > now() - interval '7 days') as calls_7d,
                (select max(m.created_at) from mcp_call_audit m
                 where m.oauth_family_id = f.family_id) as last_call_at
         from oauth_family f
         join account a on a.account_id = f.account_id
         left join oauth_client c on c.client_id = f.client_id
         where f.revoked_at is null and f.absolute_expires_at > now()
         order by last_call_at desc nulls last, f.created_at desc
         limit 200`,
      );
      return json(200, { connections: rows });
    },

    "POST /api/admin/connections/revoke": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rowCount, rows } = await db.query(
        `update oauth_family set revoked_at = now()
         where family_id::text = $1 and revoked_at is null
         returning account_id`,
        [String(body.family_id ?? "")],
      );
      if (rowCount === 0) return json(404, { error: "not_found" });
      // On the holder's own event log, not the admin's: it is their
      // connection that stopped working, and they should be able to see
      // why without asking.
      await logEvent(db, rows[0].account_id, "connection_revoked", {
        family_id: body.family_id,
        by: "admin",
      });
      return json(200, { ok: true });
    },

    "GET /api/admin/service-tokens": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select t.token_id, t.name, t.created_at, t.last_used_at, t.revoked_at,
                a.email as account_email, a.role as account_role,
                (select count(*)::int from mcp_call_audit m
                 where m.surface = 'svc:' || t.name
                   and m.created_at > now() - interval '7 days') as calls_7d
         from service_token t
         left join account a on a.account_id = t.account_id
         order by t.token_id desc`,
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
        // What they asked for on the form: claim the player they named
        // and follow their clan, so the console has something in it the
        // first time they open it. Never fails the approval.
        await onboardAccount(db, decided.account_id);
      }
      // Say whether they were actually told. An account approved before
      // the address was held has none, and re-approving cannot resend.
      return json(200, { ok: true, status: decided.status, notified });
    },

    "GET /api/admin/accounts": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select a.account_id, a.email_hash, a.email, a.status, a.role, a.is_owner,
                a.kind, a.public_id, a.owned_by_account_id,
                -- Agents and integrations are accounts too (0053), owned by
                -- the person who created them. The list shows people and
                -- says how many principals each one runs; the record page
                -- names them.
                (select count(*)::int from account c
                  where c.owned_by_account_id = a.account_id) as children,
                -- A principal name is an agent's or an integration's; a
                -- person's own legacy key is not their name (console walk
                -- 2: the owner read "Principal name: elixir-bot").
                case when coalesce(a.kind, 'person') <> 'person' then
                  (select st.name from service_token st
                    where st.account_id = a.account_id and st.revoked_at is null
                    order by st.created_at limit 1) end as principal_name,
                a.created_at, a.max_player_recordings, a.mcp_daily_quota,
                a.live_daily_quota,
                -- What the account TRACKS: its claims and its clans. Not
                -- the recordings it originated - a recording is one row
                -- per subject shared by everyone who wants it, so an
                -- account whose player somebody already recorded
                -- originates nothing and used to read "0 players" here
                -- while its claim sat in place.
                (select count(*)::int from claim c
                 where c.account_id = a.account_id) as players_tracked,
                (select count(*)::int from account_clan ac
                 where ac.account_id = a.account_id) as clans_tracked,
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
      // Only a change that actually committed is logged; the account_event
      // row is what the target's timeline shows.
      await logEvent(db, result.account_id, "role_changed", { role });
      return json(200, { ok: true, account_id: result.account_id, role });
    },
  };
}
