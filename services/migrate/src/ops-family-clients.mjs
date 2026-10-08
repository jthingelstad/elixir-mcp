/**
 * The Elixir family's own OAuth clients, for the operator
 * ({family_clients: {...}}; 0185).
 *
 *   {family_clients: {list: true}}  the provisioned clients (app, secret on
 *     file, required, last authenticated) and the AUDIT: every registered
 *     client that sends codes to a family origin, with its live grants.
 *   {family_clients: {set_secret: {app, secret_hash}}}  the sha256 hex of
 *     the secret the app sends as client_secret, minted on the app's host;
 *     the secret itself never comes here. Clears last_authenticated_at.
 *   {family_clients: {require_secret: {app}}}  from now a token request
 *     without the secret is refused. Refused itself until the app has
 *     authenticated with it once (last_authenticated_at), so the switch
 *     cannot lock out an app that is not sending it yet.
 *   {family_clients: {provision: {app, client_name, redirect_uris}}}  a new
 *     family app's client, never expiring; answers its client_id.
 *   {family_clients: {set_redirect_uris: {app, redirect_uris}}}  replace a
 *     provisioned client's redirect URIs, all on family origins: an app
 *     that moves address (Clan to elixir.poapkings.com/clan, 2026-09-28).
 *     Live grants are untouched; the next authorization names a new one.
 *   {family_clients: {revoke_clients: ["<client_id>", ...], reason}}  retire
 *     registered clients: the registration expires now and every live grant
 *     under it is revoked, with a connection_revoked event for its account.
 *     A provisioned client is refused.
 *   {family_clients: {retire_app: {app: "clan", expected_client_id,
 *     snapshot_sha256, apply}}} retires only Clan after its checked import
 *     and shared runtime activation; default preview, audit identity kept.
 *
 * Authority: Jamie (a family app is his to name).
 */

import crypto from "node:crypto";
import pg from "pg";
import {
  FIRST_PARTY_ORIGINS,
  validateRedirectUris,
  validClientId,
} from "@elixir-mcp/auth";

const HASH_RE = /^[0-9a-f]{64}$/;
const APP_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** The URIs as the door stores them, or null unless every one is on a
 *  family origin. */
function familyRedirects(uris) {
  const redirectUris = validateRedirectUris(uris);
  return redirectUris &&
    redirectUris.every((u) => FIRST_PARTY_ORIGINS.includes(new URL(u).origin))
    ? redirectUris
    : null;
}

export async function familyClients(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    return await familyClientsOn(db, spec);
  } finally {
    await db.end();
  }
}

export async function familyClientsOn(
  db,
  spec = {},
  { clanInternal = process.env.CLAN_INTERNAL === "true" } = {},
) {
  if (spec.retire_app) {
    const {
      app,
      expected_client_id: expected,
      snapshot_sha256: snapshot,
      apply,
    } = spec.retire_app;
    // This retirement is the approved Clan consolidation, never a generic
    // family-client kill switch (Drop remains an active integration).
    if (app !== "clan" || !validClientId(expected))
      throw new Error("Clan retirement needs its exact provisioned client id");
    if (
      apply === true &&
      (!clanInternal || !/^[a-f0-9]{64}$/.test(snapshot ?? ""))
    )
      throw new Error(
        "Clan retirement requires the active shared runtime and import digest",
      );
    await db.query("begin");
    try {
      const current = (
        await db.query(
          `select fc.client_id, c.expires_at from family_oauth_client fc join oauth_client c using(client_id) where fc.app='clan' for update of fc,c`,
        )
      ).rows[0];
      if (!current || current.client_id !== expected)
        throw new Error("Clan client changed; read it again");
      if (
        apply === true &&
        !(
          await db.query(
            "select 1 from clan_state_import where snapshot_sha256=$1",
            [snapshot],
          )
        ).rowCount
      )
        throw new Error("Clan retirement needs the applied snapshot receipt");
      const counts = (
        await db.query(
          `select
        (select count(*)::int from oauth_family where client_id=$1 and revoked_at is null) as grants,
        (select count(*)::int from oauth_code where client_id=$1 and used_at is null) as codes`,
          [expected],
        )
      ).rows[0];
      if (apply !== true) {
        await db.query("rollback");
        return {
          retire_app: { app, client_id: expected, applied: false, ...counts },
        };
      }
      await db.query(
        "update oauth_client set expires_at=least(expires_at,now()) where client_id=$1",
        [expected],
      );
      await db.query(
        "update oauth_code set used_at=now() where client_id=$1 and used_at is null",
        [expected],
      );
      const families = (
        await db.query(
          "update oauth_family set revoked_at=now() where client_id=$1 and revoked_at is null returning family_id,account_id",
          [expected],
        )
      ).rows;
      for (const family of families)
        await db.query(
          `insert into account_event(account_id,kind,detail) values($1,'connection_revoked',$2::jsonb)`,
          [
            family.account_id,
            JSON.stringify({
              family_id: family.family_id,
              by: "operator",
              reason: "Clan consolidated into the Elixir session",
              snapshot_sha256: snapshot,
            }),
          ],
        );
      // Keep the provisioned identity as audit history; getClient refuses
      // expired registrations before considering its family privileges.
      await db.query("commit");
      return {
        retire_app: { app, client_id: expected, applied: true, ...counts },
      };
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    }
  }

  if (spec.set_secret) {
    const { app, secret_hash: hash } = spec.set_secret;
    if (!HASH_RE.test(String(hash ?? "")))
      throw new Error("set_secret needs secret_hash: 64 lowercase hex");
    const { rows } = await db.query(
      `update family_oauth_client
          set secret_hash = $2, secret_required = false, last_authenticated_at = null
        where app = $1
        returning app, client_id`,
      [String(app ?? ""), hash],
    );
    if (!rows[0]) throw new Error(`no family client ${app}`);
    return { secret_set: rows[0] };
  }

  if (spec.require_secret) {
    const app = String(spec.require_secret.app ?? "");
    const { rows } = await db.query(
      `update family_oauth_client set secret_required = true
        where app = $1 and secret_hash is not null
          and last_authenticated_at is not null
        returning app, client_id, last_authenticated_at`,
      [app],
    );
    if (!rows[0])
      throw new Error(
        `family client ${app} has not authenticated with its secret yet; refusing to require it`,
      );
    return { secret_required: rows[0] };
  }

  if (spec.provision) {
    const { app, client_name: name, redirect_uris: uris } = spec.provision;
    if (!APP_RE.test(String(app ?? "")))
      throw new Error("provision needs app: lowercase letters, digits, -");
    const redirectUris = familyRedirects(uris);
    if (!redirectUris)
      throw new Error("provision needs redirect_uris, all on family origins");
    const clientId = crypto.randomBytes(18).toString("base64url");
    await db.query("begin");
    try {
      await db.query(
        `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
         values ($1, $2, $3, 'infinity')`,
        [clientId, String(name ?? app).slice(0, 100), redirectUris],
      );
      await db.query(
        `insert into family_oauth_client (client_id, app) values ($1, $2)`,
        [clientId, app],
      );
      await db.query("commit");
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
    return { provisioned: { app, client_id: clientId } };
  }

  if (spec.set_redirect_uris) {
    const { app, redirect_uris: uris } = spec.set_redirect_uris;
    const redirectUris = familyRedirects(uris);
    if (!redirectUris)
      throw new Error(
        "set_redirect_uris needs redirect_uris, all on family origins",
      );
    const { rows } = await db.query(
      `update oauth_client c set redirect_uris = $2
         from family_oauth_client fc
        where fc.client_id = c.client_id and fc.app = $1
        returning fc.app, c.client_id, c.redirect_uris`,
      [String(app ?? ""), redirectUris],
    );
    if (!rows[0]) throw new Error(`no family client ${app}`);
    return { redirect_uris_set: rows[0] };
  }

  if (Array.isArray(spec.revoke_clients) && spec.revoke_clients.length) {
    const out = [];
    for (const id of spec.revoke_clients.map(String)) {
      const { rows: fam } = await db.query(
        `select 1 from family_oauth_client where client_id = $1`,
        [id],
      );
      if (fam[0]) {
        out.push({ client_id: id, refused: "provisioned" });
        continue;
      }
      const { rowCount } = await db.query(
        `update oauth_client set expires_at = now() where client_id = $1`,
        [id],
      );
      const { rows: families } = await db.query(
        `update oauth_family set revoked_at = now()
          where client_id = $1 and revoked_at is null
          returning family_id, account_id`,
        [id],
      );
      for (const f of families)
        await db.query(
          `insert into account_event (account_id, kind, detail) values ($1, 'connection_revoked', $2)`,
          [
            f.account_id,
            JSON.stringify({
              family_id: f.family_id,
              by: "operator",
              reason: spec.reason ?? null,
            }),
          ],
        );
      out.push({
        client_id: id,
        expired: rowCount === 1,
        grants_revoked: families.length,
      });
    }
    return { revoked: out };
  }

  if (spec.list) {
    const { rows: provisioned } = await db.query(
      `select fc.app, fc.client_id, c.client_name, c.redirect_uris,
              fc.secret_hash is not null as secret_on_file, fc.secret_required,
              fc.last_authenticated_at, fc.provisioned_at, c.last_used_at,
              c.expires_at > now() as client_active,
              (select count(*)::int from oauth_family f
                where f.client_id = fc.client_id and f.revoked_at is null
                  and f.absolute_expires_at > now()) as live_grants
         from family_oauth_client fc
         join oauth_client c on c.client_id = fc.client_id
        order by fc.app`,
    );
    // Every registered client, filtered here by the same origin test the
    // door uses (a host's case, or a bare origin, would slip a LIKE).
    const { rows: all } = await db.query(
      `select c.client_id, c.client_name, c.redirect_uris, c.created_at,
              c.last_used_at, c.expires_at > now() as live,
              (select count(*)::int from oauth_family f
                where f.client_id = c.client_id and f.revoked_at is null
                  and f.absolute_expires_at > now()) as live_grants,
              (select count(distinct f.account_id)::int from oauth_family f
                where f.client_id = c.client_id) as accounts_ever
         from oauth_client c
        where not exists (select 1 from family_oauth_client fc
                           where fc.client_id = c.client_id)
        order by c.created_at`,
    );
    const onFamily = (u) => {
      try {
        return FIRST_PARTY_ORIGINS.includes(new URL(u).origin);
      } catch {
        return false;
      }
    };
    return {
      provisioned,
      registered_to_family_origins: all
        .filter((r) => r.redirect_uris.some(onFamily))
        .map((r) => ({ ...r, all_family: r.redirect_uris.every(onFamily) })),
    };
  }

  throw new Error(
    "family_clients needs list, set_secret, require_secret, provision, set_redirect_uris, revoke_clients or retire_app",
  );
}
