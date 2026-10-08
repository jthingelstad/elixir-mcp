import {
  addClan,
  poolLimits,
  poolOwner,
  pooledUsage,
  removeClan,
  setPrimaryClan,
} from "@elixir-mcp/claims";
import { normalizeTag } from "@elixir-mcp/contracts";

import { json } from "../http.mjs";

export function clansRoutes({ resolveAccount }) {
  return {
    "GET /api/me/clans": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select ac.clan_tag, ac.scope, ac.notify, ac.created_at, c.name,
                ac.is_primary, ac.auto_followed_at,
                r.status as recording_status, r.scope as effective_scope,
                (select count(*)::int from clan_membership cm
                  where cm.clan_tag = ac.clan_tag and cm.left_observed_at is null) as member_count
         from account_clan ac
         left join clan c on c.clan_tag = ac.clan_tag
         left join recording r on r.subject_type = 'clan'
           and r.subject_tag = ac.clan_tag and r.status = 'active'
         where ac.account_id = $1 order by ac.created_at`,
        [account.accountId],
      );
      // The person's clan slots, pooled across them and their agents.
      const owner = await poolOwner(db, account.accountId);
      const limits = poolLimits(owner);
      const used = await pooledUsage(db, owner.account_id);
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
      const lim = (v) => (v === Infinity ? null : v);
      return json(200, {
        clans: rows,
        home_clan: home[0]?.clan_tag
          ? { clan_tag: home[0].clan_tag, name: home[0].name }
          : null,
        slots: {
          activity: {
            used: used.activity_used,
            limit: lim(limits.activity),
          },
          comprehensive: {
            used: used.comprehensive_used,
            limit: lim(limits.comprehensive),
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
        const r = await removeClan(db, account, { tag, via: "web" });
        // An agent keeps the clan it acts for (claims removeClan).
        if (!r.ok) return json(409, { error: r.error });
        return json(200, {
          ok: true,
          removed: r.removed,
          recording_stopped: r.recordingStopped,
        });
      }
      if (action === "primary") {
        // Re-pointing an agent at another of its clans (2026-09-23).
        const r = await setPrimaryClan(db, account, { tag, via: "web" });
        if (!r.ok)
          return json(r.error === "not_entitled" ? 403 : 404, {
            error: r.error,
          });
        return json(200, { ok: true, primary: tag });
      }
      if (action !== "add") return json(400, { error: "bad_request" });
      // Added = recorded, within the pool's clan slots (the person's,
      // shared with their agents); elixir_track_clan runs the same
      // function.
      const r = await addClan(db, account, {
        tag,
        scope: body.scope,
        via: "web",
      });
      if (!r.ok && r.error === "quota_exceeded")
        return json(429, {
          error: "quota_exceeded",
          message:
            r.limit === 0
              ? `The ${r.role} tier has no ${r.scope}-scope clan slots - request an upgrade from Account > Overview.`
              : `Your ${r.scope}-scope clan slots are full (${r.limit} for the ${r.role} tier${account.owner ? ", shared with your agents" : ""}).`,
        });
      if (!r.ok) return json(403, { error: r.error });
      return json(200, { ok: true, clan_tag: tag, scope: r.scope });
    },
  };
}
