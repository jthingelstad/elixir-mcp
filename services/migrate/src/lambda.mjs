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
    let demoted = 0;
    if (spec.sole_owner === true) {
      const { rowCount } = await db.query(
        `update account set is_owner = false, status = 'disabled'
         where is_owner and account_id <> $1`,
        [account.account_id],
      );
      demoted = rowCount;
    }
    return { seeded: true, accountId: account.account_id, gatewayId, demoted };
  } finally {
    await db.end();
  }
}

export async function handler(event) {
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
