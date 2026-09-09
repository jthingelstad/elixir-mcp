import { integrationsRoutes } from "../../web-api/src/routes/integrations.mjs";
import pg from "pg";
import { createPrincipal } from "@elixir-mcp/claims";

/**
 * One-time production seeding, run by explicit invoke payload only
 * ({seed: {owner_email_hash, gateway: {name, static_ip}}}): the owner
 * account (approved, is_owner) and the first gateway row. Idempotent.
 * Everything else (claims, recording opt-in) goes through the real
 * product flow on the site.
 */
export async function seed(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const {
      rows: [account],
    } = await db.query(
      `insert into account (email_hash, status, is_owner, decided_at)
       values ($1, 'approved', true, now())
       on conflict (email_hash) do update set status = 'approved', is_owner = true
       returning account_id`,
      [spec.owner_email_hash],
    );
    let gatewayId = null;
    if (spec.gateway) {
      const { rows } = await db.query(
        `insert into gateway (owner_account_id, name, static_ip, status)
         select $1, $2, $3, 'active'
         where not exists (select 1 from gateway where name = $2)
         returning gateway_id`,
        [account.account_id, spec.gateway.name, spec.gateway.static_ip],
      );
      gatewayId =
        rows[0]?.gateway_id ??
        (
          await db.query(`select gateway_id from gateway where name = $1`, [
            spec.gateway.name,
          ])
        ).rows[0].gateway_id;
      // Re-seeding transfers ownership: the seeded account owns the gateway.
      await db.query(
        `update gateway set owner_account_id = $1 where gateway_id = $2`,
        [account.account_id, gatewayId],
      );
    }
    let clanRecording = null;
    if (spec.record_clan) {
      await db.query(
        `insert into clan (clan_tag) values ($1) on conflict do nothing`,
        [spec.record_clan],
      );
      await db.query(
        `insert into recording (subject_type, subject_tag, requested_by, scope)
         select 'clan', $1, $2, 'comprehensive'
         where not exists (select 1 from recording
                           where subject_type = 'clan' and subject_tag = $1 and status = 'active')`,
        [spec.record_clan, account.account_id],
      );
      clanRecording = spec.record_clan;
    }
    let purged = 0;
    if (spec.purge_email_hash) {
      // Hard delete of a mis-seeded account and everything it touches
      // (explicit, one-off; dependents first, FK order).
      const { rows: victims } = await db.query(
        `select account_id from account where email_hash = $1 and account_id <> $2`,
        [spec.purge_email_hash, account.account_id],
      );
      for (const v of victims) {
        await db.query(`delete from session where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from mcp_call_audit where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from recording where requested_by = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from claim where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(
          `delete from oauth_token t using oauth_family f
                        where t.family_id = f.family_id and f.account_id = $1`,
          [v.account_id],
        );
        await db.query(`delete from oauth_code where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from oauth_family where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from account where account_id = $1`, [
          v.account_id,
        ]);
        purged += 1;
      }
    }
    return {
      seeded: true,
      accountId: account.account_id,
      gatewayId,
      clanRecording,
      purged,
    };
  } finally {
    await db.end();
  }
}

/** Set an account's contact address ({account_email: {email}}).
 *
 *  Accounts created before 0046 have no address, so we cannot write to
 *  them until their holder next signs in. This fills one in by hand for
 *  the case that cannot wait, and it is also how a wrong address gets
 *  corrected. The email_hash is derived from the address itself, so this
 *  can only ever set an account's OWN address: there is no way to point
 *  one account at another person's inbox.
 */
export async function accountEmailOp(databaseUrl, spec) {
  const email = String(spec?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email.includes("@")) return { error: "email required" };
  const { emailHash } = await import("../../auth/src/crypto.mjs");
  const hash = emailHash(email);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `update account set email = $2 where email_hash = $1
       returning account_id, status, left(email_hash, 10) as account_ref`,
      [hash, email],
    );
    if (!rows[0]) return { error: "no account for that address" };
    await db.query(
      `insert into account_event (account_id, kind, detail) values ($1, 'email_recorded', $2)`,
      [rows[0].account_id, JSON.stringify({ via: "ops" })],
    );
    return { ok: true, ...rows[0] };
  } finally {
    await db.end();
  }
}

export async function accountRoleOp(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    if (spec?.list) {
      const { rows: gateways } = await db.query(
        `select name, status, static_ip, enrolled_at,
                (provision_env is not null
                 and provision_expires_at > now()) as provision_staged,
                provision_claimed_at is not null as provision_claimed
         from gateway order by enrolled_at`,
      );
      const { rows } = await db.query(
        `select a.account_id, left(a.email_hash, 10) as email_hash, a.status,
                a.role, a.is_owner,
                (select string_agg(t.name, ',') from service_token t
                 where t.account_id = a.account_id and t.revoked_at is null) as services,
                (select count(*)::int from recording r
                 where r.requested_by = a.account_id and r.subject_type = 'player'
                   and r.status = 'active') as players_recording
         from account a order by a.created_at`,
      );
      return { accounts: rows, gateways };
    }
    const { isRole } = await import("@elixir-mcp/contracts");
    if (!isRole(spec?.role)) throw new Error(`unknown role ${spec?.role}`);
    let accountId = spec.account_id ?? null;
    if (!accountId && spec.service) {
      const { rows } = await db.query(
        `select account_id from service_token
         where name = $1 and revoked_at is null`,
        [String(spec.service)],
      );
      if (!rows[0])
        throw new Error(`no live service token named ${spec.service}`);
      accountId = rows[0].account_id;
    }
    if (!accountId) throw new Error("account_role needs account_id or service");
    const { rows } = await db.query(
      `update account set role = $2 where account_id = $1
       returning account_id, role`,
      [accountId, spec.role],
    );
    if (!rows[0]) throw new Error("no such account");
    await db.query(
      `insert into account_event (account_id, kind, detail) values ($1, 'role_changed', $2)`,
      [rows[0].account_id, JSON.stringify({ role: spec.role, via: "ops" })],
    );
    const { emitAccountTierChanged } = await import("../../mcp/src/feed.mjs");
    await emitAccountTierChanged(db, rows[0].account_id, {
      role: spec.role,
    });
    return { account_id: rows[0].account_id, role: rows[0].role };
  } finally {
    await db.end();
  }
}

/**
 * Register an agent or integration whose key was generated OUTSIDE the cloud.
 *
 * {principal: {kind, name, clan_tag?, token_hash, scope?, owner_service?}}
 *
 * Same shape as collectorTokenOp and for the same reason: the operator mints
 * the raw value locally, writes it straight into the consumer's .env, and sends
 * only its sha256 here. The plaintext never exists in a Lambda, a log, a
 * CloudTrail entry, or an agent's context.
 *
 * The creation itself is @elixir-mcp/claims' createPrincipal, shared with the
 * console route, so the rules that matter -- your clan, your tier, your name --
 * cannot drift between the two ways in.
 */
export async function principalOp(databaseUrl, spec) {
  if (spec?.kind === "integration") return { error: "use_integration_api" };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: owners } = spec?.owner_service
      ? await db.query(
          `select a.account_id, a.role, a.kind from account a
           join service_token t on t.account_id = a.account_id
           where t.name = $1 and t.revoked_at is null`,
          [spec.owner_service],
        )
      : await db.query(
          `select account_id, role, kind from account where role = 'owner'`,
        );
    const owner = owners[0];
    if (!owner) return { error: "owner_not_found" };

    const result = await createPrincipal(
      db,
      { accountId: owner.account_id, role: owner.role, kind: owner.kind },
      {
        kind: spec?.kind,
        name: spec?.name,
        clanTag: spec?.clan_tag ?? null,
        tokenHash: spec?.token_hash,
        scope: spec?.scope ?? null,
      },
    );
    // Deliberately returns the public id and nothing secret: there is nothing
    // secret here to return.
    return result.ok
      ? { ok: true, principal: result.principal }
      : { error: result.error, ...result };
  } finally {
    await db.end();
  }
}

/** IAM-authorized provisioning passes only a locally minted SHA-256 digest.
 * Uses the admin command implementation; no raw credential enters Lambda. */
export async function integrationOp(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const owner = (
      await db.query(
        "select account_id,role,kind from account where role='owner' and kind='person' and status='approved' order by created_at limit 1",
      )
    ).rows[0];
    if (!owner) return { error: "owner_not_found" };
    const action = spec?.action ?? "create";
    if (action === "retire_legacy") {
      if (!/^[a-f0-9]{64}$/.test(spec?.token_hash ?? ""))
        return { error: "token_hash_required" };
      const result = await db.query(
        `update service_token t set revoked_at=coalesce(t.revoked_at,now())
        from integration i join account a on a.account_id=i.account_id
        where a.public_id=$1 and t.token_hash=$2 and t.audience='mcp'
          and t.name=i.name and t.account_id=a.owned_by_account_id
          and exists(select 1 from mcp_call_audit m where m.account_id=i.account_id and m.surface='rest' and m.http_status=200)
        returning t.token_id,t.name,t.revoked_at`,
        [spec.id, spec.token_hash],
      );
      return { retired: result.rowCount, ...result.rows[0] };
    }

    if (
      ["create", "rotate"].includes(action) &&
      !/^[a-f0-9]{64}$/.test(spec?.token_hash ?? "")
    )
      return { error: "token_hash_required" };
    const routes = integrationsRoutes({
      resolveAccount: async () => ({
        accountId: owner.account_id,
        kind: owner.kind,
        isAdmin: true,
      }),
      logEvent: async (db, id, kind, detail) => {
        await db.query(
          "insert into account_event(account_id,kind,detail) values($1,$2,$3)",
          [id, kind, JSON.stringify({ ...detail, via: "ops" })],
        );
      },
      mintToken: () => ({ hash: spec.token_hash }),
    });
    const method = action === "list" ? "GET" : "POST";
    const r = await routes[`${method} /api/admin/integrations`](
      db,
      { requestContext: { http: { method } } },
      spec,
    );
    const result = { status: r.statusCode, ...JSON.parse(r.body) };
    if (action === "list")
      result.available_collections = (
        await db.query(
          "select c.collection_id,c.slug,c.kind,c.scope,(select count(*)::int from collection_member m where m.collection_id=c.collection_id) as members from collection c order by c.slug",
        )
      ).rows;
    return result;
  } finally {
    await db.end();
  }
}
