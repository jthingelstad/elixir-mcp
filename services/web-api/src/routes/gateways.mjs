import crypto from "node:crypto";
import { ensureGatewayCards } from "../../../mcp/src/gateway-cards.mjs";

import { UUID_RE, json } from "../http.mjs";

export function gatewaysRoutes({ resolveAccount, logEvent, notifyOwner }) {
  return {
    "GET /api/gateways/ladder": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      await ensureGatewayCards(db);
      const { rows } = await db.query(
        `select gateway_id, status, fetch_points, card_name, card_icon,
                (owner_account_id = $1) as mine
         from gateway where status <> 'revoked'
         order by fetch_points desc, enrolled_at`,
        [account.accountId],
      );
      // Card-derived identity (Jamie, 2026-09-06): the CARD is the
      // collector's public name; the operator-chosen name is a MACHINE
      // LABEL and stays private (#28). Machine labels routinely carry
      // hostnames, usernames or locations, and this response used to
      // hand every approved account the whole fleet's. The card is the
      // only name that leaves here, and an unnamed collector is
      // "Collector" rather than a fallback to the private label.
      // `mine` replaces it for the one legitimate client use: telling
      // an operator which rows are theirs.
      return json(200, {
        ladder: rows.map((g) => ({
          name: g.card_name ?? "Collector",
          status: g.status,
          points: Number(g.fetch_points),
          credits: Math.floor(Number(g.fetch_points) / 10),
          card: g.card_name,
          card_icon: g.card_icon,
          mine: g.mine === true,
        })),
      });
    },

    "POST /api/me/gateway-env": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const id = String(body.id ?? "");
      if (!UUID_RE.test(id)) return json(404, { error: "not_found" });
      // RETURNING sees post-update values, so the pre-update secret
      // comes from a locked self-join (prev) instead. Expiry rides the
      // same predicate: an expired stage is not claimable, and NULL
      // fails the comparison, so it fails closed.
      const { rows } = await db.query(
        `update gateway g
         set provision_env = null, provision_expires_at = null,
             provision_claimed_at = now()
         from (select gateway_id, name, provision_env from gateway
               where gateway_id = $1 and owner_account_id = $2
                 and provision_env is not null
                 and provision_expires_at > now()
               for update) prev
         where g.gateway_id = prev.gateway_id
         returning prev.name, prev.provision_env as env`,
        [id, account.accountId],
      );
      if (!rows[0]) return json(404, { error: "not_found" });
      await logEvent(db, account.accountId, "gateway_config_claimed", {
        gateway: rows[0].name,
      });
      // Never let a one-time secret sit in a shared cache.
      return json(
        200,
        { name: rows[0].name, env: rows[0].env },
        { "cache-control": "no-store" },
      );
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

    "GET /api/admin/gateways": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: "not_entitled" });
      // provision_ready + owner_is_me let Admin say what a provision click
      // did: the token is staged for the OPERATOR's one-time reveal on
      // their Collector page, and when the admin owns the collector the
      // UI links straight there (Jamie 2026-09-06: the silent refresh
      // read as "it does nothing").
      const { rows } = await db.query(
        `select g.gateway_id, g.name, g.card_name, g.card_icon, g.status, g.channel,
                g.owner_account_id, g.static_ip, g.key_source,
                g.enrolled_at, g.last_heartbeat_at, g.last_success_at,
                g.fetch_points, g.last_seen_sha,
                (g.provision_env is not null
                 and g.provision_expires_at > now()) as provision_ready,
                (g.owner_account_id = $1) as owner_is_me,
                -- Who runs this machine. The account table holds only a hash
                -- of the email, by design, so the readable half is the
                -- operator's primary claimed player; the hash prefix is the
                -- stable identifier Admin already uses elsewhere.
                a.email_hash as owner_email_hash,
                op.name as owner_player_name,
                op.player_tag as owner_player_tag,
                (select count(*)::int from api_receipt r where r.gateway_id = g.gateway_id
                 and r.fetched_at > now() - interval '1 hour') as fetches_last_hour
         from gateway g
         left join account a on a.account_id = g.owner_account_id
         left join lateral (
           select p.name, p.player_tag
           from claim c join player p on p.player_tag = c.player_tag
           where c.account_id = g.owner_account_id
           order by c.is_primary desc, (c.status = 'verified') desc, c.created_at
           limit 1
         ) op on true
         order by g.enrolled_at`,
        [account.accountId],
      );
      return json(200, { gateways: rows });
    },

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
                (g.provision_env is not null
                 and g.provision_expires_at > now()) as provision_ready,
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
               provision_claimed_at = null,
               provision_expires_at = now() + interval '72 hours'
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
}
