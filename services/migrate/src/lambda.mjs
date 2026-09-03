/** The migrate Lambda — the ONLY thing that applies schema migrations in
 *  the cloud (DESIGN §11.1). Invoked by the deploy script between code
 *  upload and flip. The build packages db/migrations alongside the bundle. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from './migrate.mjs';

/**
 * One-time production seeding, run by explicit invoke payload only
 * ({seed: {owner_email_hash, gateway: {name, static_ip}}}): the owner
 * account (approved, is_owner) and the first gateway row. Idempotent.
 * Everything else (claims, recording opt-in) goes through the real
 * product flow on the site.
 */
async function seed(databaseUrl, spec) {
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
        (await db.query(`select gateway_id from gateway where name = $1`, [spec.gateway.name]))
          .rows[0].gateway_id;
      // Re-seeding transfers ownership: the seeded account owns the gateway.
      await db.query(`update gateway set owner_account_id = $1 where gateway_id = $2`, [
        account.account_id,
        gatewayId,
      ]);
    }
    let clanRecording = null;
    if (spec.record_clan) {
      await db.query(`insert into clan (clan_tag) values ($1) on conflict do nothing`, [spec.record_clan]);
      await db.query(
        `insert into recording (subject_type, subject_tag, requested_by)
         select 'clan', $1, $2
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
        await db.query(`delete from session where account_id = $1`, [v.account_id]);
        await db.query(`delete from mcp_call_audit where account_id = $1`, [v.account_id]);
        await db.query(`delete from recording where requested_by = $1`, [v.account_id]);
        await db.query(`delete from claim where account_id = $1`, [v.account_id]);
        await db.query(`delete from oauth_token t using oauth_family f
                        where t.family_id = f.family_id and f.account_id = $1`, [v.account_id]);
        await db.query(`delete from oauth_code where account_id = $1`, [v.account_id]);
        await db.query(`delete from oauth_family where account_id = $1`, [v.account_id]);
        await db.query(`delete from account where account_id = $1`, [v.account_id]);
        purged += 1;
      }
    }
    return { seeded: true, accountId: account.account_id, gatewayId, clanRecording, purged };
  } finally {
    await db.end();
  }
}

/** Read-only ops stats ({stats: true}) — the admin/ops query path from
 *  DESIGN §7: counts only, no row data, safe to invoke any time. */
async function stats(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const counts = {};
    for (const [key, sql] of Object.entries({
      accounts: `select count(*)::int n from account`,
      recordings: `select count(*)::int n from recording where status = 'active'`,
      players: `select count(*)::int n from player`,
      open_memberships: `select count(*)::int n from clan_membership where left_observed_at is null`,
      battles: `select count(*)::int n from battle`,
      snapshots: `select count(*)::int n from player_snapshot_daily`,
      war_weeks: `select count(*)::int n from war_week`,
      war_participation: `select count(*)::int n from war_participation`,
      war_anchors: `select count(*)::int n from war_period_anchor`,
      receipts_by_endpoint: `select json_object_agg(endpoint, n) n from (
         select endpoint, count(*)::int n from api_receipt group by endpoint) x`,
      audit_calls: `select count(*)::int n from mcp_call_audit`,
    })) {
      counts[key] = (await db.query(sql)).rows[0].n;
    }
    return counts;
  } finally {
    await db.end();
  }
}

export async function handler(event) {
  if (event?.stats) {
    const result = await stats(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.seed) {
    const result = await seed(process.env.DATABASE_URL, event.seed);
    console.log(JSON.stringify(result));
    return result;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const result = await migrate({
    databaseUrl: process.env.DATABASE_URL,
    migrationsDir: path.join(here, 'migrations'),
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify(result));
  return result;
}
