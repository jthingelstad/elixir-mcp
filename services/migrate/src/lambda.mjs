/** The migrate Lambda — the ONLY thing that applies schema migrations in
 *  the cloud (DESIGN §11.1). Invoked by the deploy script between code
 *  upload and flip. The build packages db/migrations alongside the bundle. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.mjs';

export async function handler() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const result = await migrate({
    databaseUrl: process.env.DATABASE_URL,
    migrationsDir: path.join(here, 'migrations'),
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify(result));
  return result;
}
