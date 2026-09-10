import {
  setCollectionMembers,
  reconcileCollection,
  deleteCollection,
} from "@elixir-mcp/claims";
import { normalizeTag, roleQuotas } from "@elixir-mcp/contracts";
import { emitFeedEvent } from "../../../mcp/src/feed.mjs";
import {
  ensureClanRecording,
  settleClanRecording,
} from "../../../mcp/src/tools.mjs";

import { json } from "../http.mjs";

export function collectionsRoutes({ resolveAccount, logEvent }) {
  return {
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

    "GET /api/me/clans": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select ac.clan_tag, ac.scope, ac.notify, ac.created_at, c.name,
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
      // the MCP door (elixir_track_clan) applies the same rule.
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
                c.visibility, c.scope, c.created_at,
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
        const scope = ["activity", "comprehensive"].includes(body.scope)
          ? body.scope
          : null;
        // Admins may edit any collection by design, so this upsert
        // has no ownership predicate; the self-service route does.
        const { rows: written } = await db.query(
          `insert into collection (slug, title, kind, description, visibility, owner_account, scope)
           values ($1, $2, $3, $4, coalesce($5, 'public'), $6, coalesce($7, 'comprehensive'))
           on conflict (slug) do update set
             title = excluded.title,
             description = coalesce(excluded.description, collection.description),
             visibility = coalesce($5, collection.visibility),
             scope = coalesce($7, collection.scope)
           returning collection_id, kind`,
          [
            slug,
            String(body.title).slice(0, 80),
            body.kind,
            body.description ? String(body.description).slice(0, 2000) : null,
            ["public", "private"].includes(body.visibility)
              ? body.visibility
              : null,
            account.accountId,
            scope,
          ],
        );
        // Deepening applies to what is already in the collection, not
        // only to what is added next.
        if (scope && written[0])
          await reconcileCollection(db, written[0].collection_id);
        return json(200, { ok: true, slug });
      }
      if (["set", "add", "remove"].includes(body.action)) {
        const { rows: col } = await db.query(
          `select collection_id, kind, owner_account from collection where slug = $1`,
          [slug],
        );
        if (!col[0]) return json(404, { error: "not_found" });
        const parsed = [];
        for (const raw of body.tags ?? []) {
          const text = String(raw).trim();
          if (!text) continue;
          try {
            parsed.push(normalizeTag(text));
          } catch {
            /* admin edits skip junk rather than refusing the batch */
          }
        }
        // Same function as the owner route: membership and recording
        // are decided in one place, never twice — including the delta,
        // which the helper resolves under its own lock.
        const r = await setCollectionMembers(
          db,
          {
            collectionId: col[0].collection_id,
            kind: col[0].kind,
            ownerAccount: col[0].owner_account,
          },
          parsed,
          { mode: body.action },
        );
        return json(200, { ok: true, changed: r.added + r.removed, ...r });
      }
      if (body.action === "delete") {
        const { rows: col } = await db.query(
          `select collection_id from collection where slug = $1`,
          [slug],
        );
        if (!col[0]) return json(404, { error: "not_found" });
        const r = await deleteCollection(db, col[0].collection_id);
        return json(200, { ok: true, recordingsStopped: r.recordingsStopped });
      }
      return json(400, { error: "bad_request" });
    },

    "GET /api/me/collections": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select c.collection_id, c.slug, c.title, c.kind, c.description,
                c.visibility, c.scope, c.created_at,
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
        `select collection_id, owner_account, kind from collection where slug = $1`,
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
        const scope = ["activity", "comprehensive"].includes(body.scope)
          ? body.scope
          : null;
        // The ownership precheck above is advisory only: between it
        // and this statement another account can commit the same slug,
        // and an unguarded ON CONFLICT would then rewrite THEIR
        // collection — including flipping it public and exposing its
        // curated members. The ownership test therefore lives in the
        // conflict update's own predicate, atomic with the write.
        const { rows: written } = await db.query(
          `insert into collection (slug, title, kind, description, visibility, owner_account, scope)
           values ($1, $2, $3, $4, coalesce($5, 'public'), $6, coalesce($7, 'comprehensive'))
           on conflict (slug) do update set
             title = excluded.title,
             description = coalesce(excluded.description, collection.description),
             visibility = coalesce($5, collection.visibility),
             scope = coalesce($7, collection.scope)
           where collection.owner_account = $6
           returning collection_id, kind`,
          [
            slug,
            String(body.title).slice(0, 80),
            body.kind,
            body.description ? String(body.description).slice(0, 2000) : null,
            ["public", "private"].includes(body.visibility)
              ? body.visibility
              : null,
            account.accountId,
            scope,
          ],
        );
        // Nothing written means the conflicting row belongs to someone
        // else. Same answer the precheck gives, from the same rule.
        if (!written[0])
          return json(403, {
            error: "not_entitled",
            message: "Not your collection.",
          });
        // Deepening applies to what is already in the collection, not
        // only to what is added next.
        if (scope) await reconcileCollection(db, written[0].collection_id);
        return json(200, { ok: true, slug });
      }
      if (!owned[0]) return json(404, { error: "not_found" });
      // Every membership change goes through one wholesale set, so a
      // tag named in a collection is always recorded and a tag that
      // leaves stops being recorded unless something else still wants
      // it. add/remove are expressed as a set against what is there.
      if (["set", "add", "remove"].includes(body.action)) {
        const kind = owned[0].kind;
        const parsed = [];
        const rejected = [];
        for (const raw of body.tags ?? []) {
          const text = String(raw).trim();
          if (!text) continue;
          try {
            parsed.push(normalizeTag(text));
          } catch {
            rejected.push(text.slice(0, 24));
          }
        }
        // A typo must not silently delete somebody's curation.
        if (body.action === "set" && rejected.length > 0) {
          return json(400, {
            error: "bad_request",
            message: `Not a valid Clash Royale tag: ${rejected.slice(0, 5).join(", ")}${rejected.length > 5 ? ` and ${rejected.length - 5} more` : ""}.`,
            rejected,
          });
        }
        // add/remove are deltas, resolved against the membership the
        // helper reads under its own lock. Computing a whole desired
        // set out here and sending it as a replacement loses a
        // concurrent add.
        const r = await setCollectionMembers(
          db,
          {
            collectionId: owned[0].collection_id,
            kind,
            ownerAccount: account.accountId,
          },
          parsed,
          { mode: body.action },
        );
        return json(200, {
          ok: true,
          changed: r.added + r.removed,
          ...r,
          rejected,
        });
      }
      if (body.action === "delete") {
        // Membership rows cascade, but a cascade reconciles nothing —
        // deleting the collection has to stop what only it was keeping
        // recorded, exactly as removing those members would have.
        const r = await deleteCollection(db, owned[0].collection_id);
        return json(200, { ok: true, recordingsStopped: r.recordingsStopped });
      }
      return json(400, { error: "bad_request" });
    },
  };
}
