import {
  listPrincipals,
  renamePrincipal,
  rotateToken,
  setPrincipalStatus,
  createAgent,
} from "../principals.mjs";
import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";

import { json } from "../http.mjs";

export function principalsRoutes({ resolveAccount, logEvent }) {
  return {
    "GET /api/me/principals": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const owned = await listPrincipals(db, account.accountId);
      return json(200, {
        agents: owned.filter((p) => p.kind === "agent"),
        integrations: owned.filter((p) => p.kind === "integration"),
        // What the console needs to render the create form honestly: an agent
        // may only point at a clan its owner has already added.
        addable_clans: (
          await db.query(
            `select clan_tag, scope from account_clan where account_id = $1 order by clan_tag`,
            [account.accountId],
          )
        ).rows,
        may_create_integration: false,
      });
    },

    "POST /api/me/agents": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      let clanTag;
      try {
        clanTag = normalizeTag(body.clan_tag);
      } catch (err) {
        if (err instanceof InvalidTagError)
          return json(400, { error: "invalid_tag" });
        throw err;
      }
      const result = await createAgent(db, account, {
        name: body.name,
        clanTag,
        scope: typeof body.scope === "string" ? body.scope : null,
      });
      if (!result.ok)
        return json(result.error === "internal" ? 500 : 400, result);
      await logEvent(db, account.accountId, "agent_created", {
        agent: result.principal.public_id,
        clan_tag: clanTag,
      });
      // The raw token is returned exactly once and never stored.
      return json(201, {
        agent: result.principal,
        token: result.token,
        note: "This token is shown once. Store it now.",
      });
    },

    "POST /api/me/integrations": async () =>
      json(403, { error: "admin_integration_api_required" }),

    "POST /api/me/principals/revoke": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      // Scoped by ownership in the WHERE clause, not by a check beforehand:
      // a revoke that names someone else's token must find nothing rather
      // than be refused, so the route cannot be used to probe for token ids.
      const { rowCount } = await db.query(
        `update service_token t
         set revoked_at = now()
         from account a
         where t.token_id = $1
           and a.account_id = t.account_id
           and a.owned_by_account_id = $2
           and a.kind = 'agent'
           and t.revoked_at is null`,
        [body.token_id, account.accountId],
      );
      if (rowCount === 0) return json(404, { error: "not_found" });
      await logEvent(db, account.accountId, "principal_token_revoked", {
        token_id: body.token_id,
      });
      return json(200, { ok: true });
    },

    "POST /api/me/principals/rotate": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const result = await rotateToken(db, account.accountId, body.account_id);
      if (!result.ok) return json(404, result);
      // Handed over once, exactly like creation. There is no second chance
      // and no support path that ends in recovering it.
      return json(200, { ok: true, token: result.token });
    },

    "POST /api/me/principals/rename": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const result = await renamePrincipal(
        db,
        account.accountId,
        body.account_id,
        body.name,
      );
      if (!result.ok)
        return json(result.error === "not_found" ? 404 : 400, result);
      await logEvent(db, account.accountId, "principal_renamed", {
        account_id: body.account_id,
        name: result.name,
      });
      return json(200, result);
    },

    "POST /api/me/principals/status": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const result = await setPrincipalStatus(
        db,
        account.accountId,
        body.account_id,
        body.status,
      );
      return result.ok ? json(200, result) : json(404, result);
    },

    "GET /api/me/principals/events": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const principalId = event.queryStringParameters?.account_id;
      if (!principalId) return json(400, { error: "account_id_required" });
      const { rows: owned } = await db.query(
        `select events_seen_through from account
          where account_id = $1 and owned_by_account_id = $2`,
        [principalId, account.accountId],
      );
      if (owned.length === 0) return json(404, { error: "not_found" });
      const { rows } = await db.query(
        `select event_id, topic, subject_tag, payload, created_at
         from event_feed where account_id = $1
         order by event_id desc limit 100`,
        [principalId],
      );
      return json(200, {
        events: rows,
        seen_through: Number(owned[0].events_seen_through ?? 0),
      });
    },

    "GET /api/me/principals/identities": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const principalId = event.queryStringParameters?.account_id;
      if (!principalId) return json(400, { error: "account_id_required" });
      // Ownership is checked before the read, not folded into it: a stranger
      // must get the same 404 an unknown id gets. Returning an empty list
      // instead would answer "that agent exists and has nobody mapped",
      // which is more than a stranger is owed -- and it disagreed with the
      // feed route next door, which 404s.
      const { rows: owned } = await db.query(
        `select 1 from account
          where account_id = $1 and owned_by_account_id = $2`,
        [principalId, account.accountId],
      );
      if (owned.length === 0) return json(404, { error: "not_found" });
      const { rows } = await db.query(
        `select ai.external_id, ai.player_tag, ai.created_at, p.name
           from agent_identity ai
           left join player p on p.player_tag = ai.player_tag
          where ai.account_id = $1
          order by ai.created_at desc`,
        [principalId],
      );
      return json(200, { identities: rows });
    },

    "POST /api/me/principals/identities/remove": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      // Ownership rides in the WHERE so naming somebody else's agent finds
      // nothing rather than being refused after the fact.
      const { rowCount } = await db.query(
        `delete from agent_identity ai
          using account a
          where ai.account_id = $1 and ai.external_id = $2
            and a.account_id = ai.account_id
            and a.owned_by_account_id = $3`,
        [body.account_id, String(body.external_id ?? ""), account.accountId],
      );
      if (rowCount === 0) return json(404, { error: "not_found" });
      return json(200, { ok: true });
    },
  };
}
