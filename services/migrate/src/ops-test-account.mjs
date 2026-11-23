import pg from "pg";

/**
 * {test_account: {name, clan_tag, token_hash, scope, hourly_rate_limit?,
 *                 mcp_daily_quota?, dry_run?}} and {test_account: {list: true}}
 *
 * A headless test identity that is a person (0316; Jamie, 2026-11-23:
 * "the acceptance and Gym test account may hold a person-bound key"). The
 * acceptance suite and the Gym ran as agents with a door of their own;
 * with agents going, each is a person-kind account at /mcp holding one
 * service token. People still cannot mint a key: this op is the only way
 * one is made for a person, and only for an account it made itself.
 *
 * The key is minted on the operator's machine
 * (`infra/scripts/mint-test-key.mjs`), which writes the raw value to a
 * 0600 file and prints this payload with its sha256: the value never
 * reaches a Lambda, a log or an agent's context, as with {principal}.
 *
 * What the account is, so nothing people see reaches it:
 * - kind person, approved, member; no address (`email` null) and an
 *   email_hash of `test:<name>` that no address hashes to, so it is sent no
 *   mail and nobody signs in as it;
 * - no claim and no handle, so no search, follow list or page names it;
 *   onboarded at creation, so no first-sign-in onboarding acts on it;
 * - `test_name` set, the marker counts of people leave out ({funnel});
 * - one followed clan (`account_clan`, activity scope, notify on), the
 *   clan its reads are about, which must already be recorded: the op never
 *   starts a recording.
 *
 * Run again with a new hash, it re-keys: the account's live key of that
 * name is revoked and the new one inserted, in one transaction. Dry run by
 * default. `list` is the read-back: every test account, its clans and its
 * live keys (names, scopes, ceilings, use; never a hash).
 */

const NAME = /^[a-z0-9][a-z0-9-]{1,40}$/;
const HASH = /^[0-9a-f]{64}$/;
/** A test key reads; the Gym also files feedback. Never every scope (null)
 *  and never a person's address. */
const SCOPES = new Set(["cr:read", "feedback:write"]);

function positiveOrNull(value, label) {
  if (value === undefined || value === null) return { value: null };
  if (Number.isInteger(value) && value > 0) return { value };
  return { error: `${label} must be a positive integer or null` };
}

export function parseTestAccountSpec(spec) {
  const name = String(spec?.name ?? "")
    .trim()
    .toLowerCase();
  if (!NAME.test(name)) return { error: "invalid_name" };
  if (!HASH.test(String(spec?.token_hash ?? "")))
    return { error: "invalid_token_hash" };
  const scopes = String(spec?.scope ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (!scopes.includes("cr:read") || scopes.some((s) => !SCOPES.has(s)))
    return {
      error: "invalid_scope",
      allowed: [...SCOPES],
      hint: "cr:read, and feedback:write for the Gym",
    };
  const clan = String(spec?.clan_tag ?? "").trim();
  if (!/^#[0-9A-Z]{3,12}$/.test(clan)) return { error: "invalid_clan_tag" };
  const hourly = positiveOrNull(spec.hourly_rate_limit, "hourly_rate_limit");
  if (hourly.error) return { error: hourly.error };
  const daily = positiveOrNull(spec.mcp_daily_quota, "mcp_daily_quota");
  if (daily.error) return { error: daily.error };
  return {
    name,
    tokenHash: spec.token_hash,
    scope: [...new Set(scopes)].join(" "),
    clanTag: clan,
    hourlyRateLimit: hourly.value,
    mcpDailyQuota: daily.value,
    dryRun: spec.dry_run !== false,
  };
}

async function listTestAccounts(db) {
  const { rows } = await db.query(
    `select a.test_name as name, left(a.account_id::text, 8) as account_ref,
            a.kind, a.status, a.role, a.email is not null as has_address,
            a.handle is not null as has_handle, a.mcp_daily_quota,
            (select count(*)::int from claim c
              where c.account_id = a.account_id) as claims,
            (select coalesce(json_agg(json_build_object(
                      'clan_tag', ac.clan_tag, 'scope', ac.scope,
                      'notify', ac.notify) order by ac.clan_tag), '[]')
               from account_clan ac where ac.account_id = a.account_id) as clans,
            (select coalesce(json_agg(json_build_object(
                      'name', t.name, 'scope', t.scope,
                      'hourly_rate_limit', t.hourly_rate_limit,
                      'daily_quota', t.daily_quota,
                      'created_at', t.created_at,
                      'last_used_at', t.last_used_at) order by t.token_id), '[]')
               from service_token t
              where t.account_id = a.account_id and t.revoked_at is null) as live_keys
       from account a
      where a.test_name is not null
      order by a.test_name`,
  );
  return { test_accounts: JSON.parse(JSON.stringify(rows)) };
}

export async function testAccountOp(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    if (spec?.list) return await listTestAccounts(db);
    const parsed = parseTestAccountSpec(spec);
    if (parsed.error) return parsed;
    const { name, tokenHash, scope, clanTag, dryRun } = parsed;

    const {
      rows: [recorded],
    } = await db.query(
      `select 1 from recording where subject_type = 'clan'
          and subject_tag = $1 and status = 'active' limit 1`,
      [clanTag],
    );
    if (!recorded) return { error: "clan_not_recorded", clan_tag: clanTag };
    const {
      rows: [taken],
    } = await db.query(
      `select 1 from service_token where token_hash = $1 limit 1`,
      [tokenHash],
    );
    if (taken) return { error: "token_hash_in_use" };

    const {
      rows: [existing],
    } = await db.query(`select account_id from account where test_name = $1`, [
      name,
    ]);
    const plan = {
      dry_run: dryRun,
      name,
      action: existing ? "rekey" : "create",
      clan_tag: clanTag,
      scope,
      hourly_rate_limit: parsed.hourlyRateLimit,
      mcp_daily_quota: parsed.mcpDailyQuota,
    };
    if (dryRun) return plan;

    await db.query("begin");
    try {
      let accountId = existing?.account_id;
      if (!accountId) {
        const {
          rows: [created],
        } = await db.query(
          `insert into account (email_hash, email, status, role, kind,
                                test_name, decided_at, onboarded_at,
                                newsletter_opt_in, mcp_daily_quota)
           values ('test:' || $1, null, 'approved', 'member', 'person',
                   $1, now(), now(), false, $2)
           returning account_id`,
          [name, parsed.mcpDailyQuota],
        );
        accountId = created.account_id;
        await db.query(
          `insert into account_event (account_id, kind, detail)
           values ($1, 'test_account_created', $2)`,
          [accountId, JSON.stringify({ via: "ops", name })],
        );
      } else {
        await db.query(
          `update account set mcp_daily_quota = $2 where account_id = $1`,
          [accountId, parsed.mcpDailyQuota],
        );
      }
      await db.query(
        `insert into account_clan (account_id, clan_tag, scope, notify, is_primary)
         values ($1, $2, 'activity', true, false)
         on conflict (account_id, clan_tag) do nothing`,
        [accountId, clanTag],
      );
      const revoked = await db.query(
        `update service_token set revoked_at = now()
          where account_id = $1 and name = $2 and revoked_at is null`,
        [accountId, name],
      );
      await db.query(
        `insert into service_token (account_id, name, token_hash, scope, hourly_rate_limit)
         values ($1, $2, $3, $4, $5)`,
        [accountId, name, tokenHash, scope, parsed.hourlyRateLimit],
      );
      await db.query("commit");
      return { ...plan, ok: true, revoked: revoked.rowCount };
    } catch (err) {
      await db.query("rollback").catch(() => {});
      return { error: "internal", detail: err.message };
    }
  } finally {
    await db.end();
  }
}
