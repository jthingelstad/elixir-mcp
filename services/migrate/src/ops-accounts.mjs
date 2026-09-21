import { integrationsRoutes } from "../../web-api/src/routes/integrations.mjs";
import pg from "pg";
import { createPrincipal, addPlayer } from "@elixir-mcp/claims";

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
                (select count(*)::int from claim c
                 where c.account_id = a.account_id) as players_tracked,
                (select count(*)::int from account_clan ac
                 where ac.account_id = a.account_id) as clans_tracked
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
    // The account_event row above is the timeline's record of the change.
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

/** {service_token_limits: {name, hourly_rate_limit?, daily_quota?}}: a
 *  key's own ceilings. A key with its own hourly ceiling spends from its
 *  own bucket (services/mcp/src/handler.mjs), so the acceptance suite's
 *  run does not count against its owner's hour or the Discord agent's.
 *  Null clears an override back to the owner's. By token NAME, the
 *  live (unrevoked) row; never the value or the hash. */
export async function serviceTokenLimitsOp(databaseUrl, spec) {
  const name = String(spec?.name ?? "").trim();
  if (!name) return { error: "name_required" };
  const has = (k) => Object.prototype.hasOwnProperty.call(spec, k);
  const num = (k) =>
    spec[k] === null
      ? null
      : Number.isInteger(spec[k]) && spec[k] > 0
        ? spec[k]
        : undefined;
  if (
    (has("hourly_rate_limit") && num("hourly_rate_limit") === undefined) ||
    (has("daily_quota") && num("daily_quota") === undefined)
  )
    return { error: "limits must be positive integers or null" };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `update service_token set
         hourly_rate_limit = case when $2::boolean then $3::int else hourly_rate_limit end,
         daily_quota = case when $4::boolean then $5::int else daily_quota end
       where name = $1 and revoked_at is null
       returning token_id, name, hourly_rate_limit, daily_quota`,
      [
        name,
        has("hourly_rate_limit"),
        num("hourly_rate_limit") ?? null,
        has("daily_quota"),
        num("daily_quota") ?? null,
      ],
    );
    return rows[0] ? { ok: true, token: rows[0] } : { error: "not_found" };
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

/**
 * Enroll people who never asked: an approved account each, their player
 * claimed as primary, their clan tracked at activity scope.
 *
 * {account_enroll: {dry_run, source?, accounts: [{email, player_tag, clan_tag?}]}}
 *
 * Built for moving elixir-bot's weekly email recipients onto Elixir
 * (2026-09-18): those people have a verified address and a known tag in the
 * bot's database but no account here, and the only door is the access
 * request they never sent. This does what approval does, minus the request
 * and minus the welcome mail (they did not ask; the first thing they hear
 * from Elixir should be the email that moved).
 *
 * Per entry the rules are the approval's own: an address that already has an
 * account is reported and never touched, whatever it holds; the claim goes
 * through addPlayer (primary, recording started if nobody records them);
 * the clan is the one the record places them in unless clan_tag names one,
 * and clan_tag: null defers it - the account stays un-onboarded so the
 * ordinary first-sign-in onboarding resolves it once a fresh profile exists.
 * dry_run returns the same plan without writing.
 *
 * fill_empty: an account that already exists but tracks NOTHING (no claim,
 * no clan) is filled the same way instead of skipped; one that tracks
 * anything is still left alone, whatever it holds. The rule is
 * onboardAccount's own, for the account that was made before the request
 * form carried a tag.
 */
export async function accountEnrollOp(databaseUrl, spec) {
  const entries = Array.isArray(spec?.accounts) ? spec.accounts : [];
  if (entries.length === 0) return { error: "accounts required" };
  const dryRun = spec.dry_run !== false;
  const fillEmpty = spec.fill_empty === true;
  const source = String(spec.source ?? "ops");
  const { emailHash, normalizeEmail } =
    await import("../../auth/src/crypto.mjs");
  const { normalizeTag } = await import("@elixir-mcp/contracts");
  const { clanOf } = await import("../../web-api/src/onboard.mjs");
  const { ensureClanRecording } = await import("../../mcp/src/tools.mjs");

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const plan = [];
    for (const entry of entries) {
      const email = normalizeEmail(entry?.email);
      if (!email.includes("@")) {
        plan.push({ email: entry?.email ?? null, error: "email required" });
        continue;
      }
      const hash = emailHash(email);
      const ref = hash.slice(0, 10);
      let tag;
      try {
        tag = normalizeTag(String(entry.player_tag ?? ""));
      } catch {
        plan.push({ account_ref: ref, error: "bad player_tag" });
        continue;
      }
      const { rows: existing } = await db.query(
        `select account_id, status, role, kind from account where email_hash = $1`,
        [hash],
      );
      let fill = null;
      if (existing[0]) {
        const { rows: tracks } = await db.query(
          `select (select count(*)::int from claim where account_id = $1) as players,
                  (select count(*)::int from account_clan where account_id = $1) as clans`,
          [existing[0].account_id],
        );
        const empty = tracks[0].players === 0 && tracks[0].clans === 0;
        if (
          !fillEmpty ||
          !empty ||
          existing[0].status !== "approved" ||
          existing[0].kind !== "person"
        ) {
          plan.push({
            account_ref: ref,
            player_tag: tag,
            action: "skip",
            reason: empty ? "exists" : "exists_tracking",
            status: existing[0].status,
            role: existing[0].role,
          });
          continue;
        }
        fill = existing[0];
      }
      // Explicit clan_tag wins; null defers; absent asks the record.
      const explicit = entry.clan_tag;
      const resolved =
        explicit === undefined
          ? (await clanOf(db, tag)).clanTag
          : explicit === null
            ? null
            : normalizeTag(String(explicit));
      const { rows: rec } = await db.query(
        `select 1 from recording where subject_type = 'player'
           and subject_tag = $1 and status = 'active' limit 1`,
        [tag],
      );
      const step = {
        account_ref: ref,
        player_tag: tag,
        action: fill ? "fill" : "create",
        clan_tag: resolved,
        clan: resolved
          ? explicit === undefined
            ? "from_record"
            : "explicit"
          : "deferred",
        recording_starts: rec.length === 0,
      };
      if (dryRun) {
        plan.push(step);
        continue;
      }
      let accountId;
      if (fill) {
        accountId = fill.account_id;
      } else {
        const {
          rows: [created],
        } = await db.query(
          `insert into account (email_hash, email, status, role, kind,
                                requested_player_tag, decided_at)
           values ($1, $2, 'approved', 'member', 'person', $3, now())
           returning account_id`,
          [hash, email, tag],
        );
        accountId = created.account_id;
      }
      await db.query(
        `insert into account_event (account_id, kind, detail) values ($1, $2, $3)`,
        [
          accountId,
          fill ? "filled" : "enrolled",
          JSON.stringify({ via: "ops", source }),
        ],
      );
      const added = await addPlayer(
        db,
        { accountId },
        { tag, makePrimary: true, via: "ops" },
      );
      step.claimed = added.ok === true;
      step.recording_started = added.recordingStarted === true;
      if (resolved) {
        await db.query(
          `insert into clan (clan_tag) values ($1) on conflict do nothing`,
          [resolved],
        );
        await db.query(
          `insert into account_clan (account_id, clan_tag, scope)
           values ($1, $2, 'activity')
           on conflict (account_id, clan_tag) do nothing`,
          [accountId, resolved],
        );
        await ensureClanRecording(db, resolved, accountId);
        await db.query(
          `update account set onboarded_at = now() where account_id = $1`,
          [accountId],
        );
      }
      step.account_id = accountId;
      plan.push(step);
    }
    const created = plan.filter((p) => p.action === "create").length;
    const filled = plan.filter((p) => p.action === "fill").length;
    const skipped = plan.filter((p) => p.action === "skip").length;
    return { dry_run: dryRun, created, filled, skipped, plan };
  } finally {
    await db.end();
  }
}

/**
 * Track a player on somebody else's account, at their owner's word.
 *
 * {account_track: {primary_tag, player_tag, relationship?, dry_run?}}
 *
 * The account is named by the tag it holds as primary, never by address,
 * so nothing personal enters the invoke payload or its log line. The add
 * is @elixir-mcp/claims' addPlayer, the same act the holder's own "track"
 * click performs (quota, recording start, claim_added event), plus an
 * account_event that says it was ops that did it. Built 2026-09-20 for
 * Jamie adding Tyler's alt; the claim lands unverified exactly as a
 * self-added one would, and the holder can remove it the same way.
 */
export async function accountTrackOp(databaseUrl, spec) {
  const { normalizeTag } = await import("@elixir-mcp/contracts");
  const primaryTag = normalizeTag(String(spec?.primary_tag ?? ""));
  const playerTag = normalizeTag(String(spec?.player_tag ?? ""));
  const relationship = spec?.relationship ?? "alt";
  if (!["alt", "friend", "watching"].includes(relationship))
    return { error: "relationship must be alt, friend or watching" };
  if (primaryTag === playerTag)
    return { error: "player_tag is already the account's primary" };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: holders } = await db.query(
      `select a.account_id, a.role, a.status, a.kind,
              (select count(*)::int from claim where account_id = a.account_id) as players,
              exists (select 1 from claim
                      where account_id = a.account_id and player_tag = $2) as already
       from claim c join account a on a.account_id = c.account_id
       where c.player_tag = $1 and c.relationship = 'primary'`,
      [primaryTag, playerTag],
    );
    if (holders.length !== 1)
      return {
        error: holders.length === 0 ? "no_account_for_primary" : "ambiguous",
        primary_tag: primaryTag,
        accounts: holders.length,
      };
    const holder = holders[0];
    const plan = {
      dry_run: spec?.dry_run === true,
      primary_tag: primaryTag,
      player_tag: playerTag,
      relationship,
      account: {
        role: holder.role,
        status: holder.status,
        kind: holder.kind,
        players: holder.players,
        already_tracked: holder.already,
      },
    };
    if (holder.status !== "approved" || holder.kind !== "person")
      return { ...plan, error: "account_not_a_person_or_not_approved" };
    if (plan.dry_run || holder.already) return plan;
    const added = await addPlayer(
      db,
      { accountId: holder.account_id },
      { tag: playerTag, makePrimary: false, via: "ops", relationship },
    );
    if (added.ok !== true) return { ...plan, error: added.error, added };
    await db.query(
      `insert into account_event (account_id, kind, detail) values ($1, 'tracked_by_ops', $2)`,
      [
        holder.account_id,
        JSON.stringify({ player_tag: playerTag, relationship, via: "ops" }),
      ],
    );
    return {
      ...plan,
      added: added.added,
      recording_started: added.recordingStarted,
    };
  } finally {
    await db.end();
  }
}
