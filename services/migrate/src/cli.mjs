#!/usr/bin/env node
/**
 * Local CLI for the migration runner.
 *   node src/cli.mjs migrate [--url postgres://...]
 *   node src/cli.mjs fingerprint [--url ...] [--update]
 * Default URL targets local dev; production runs go through the migrate
 * Lambda, never this CLI.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { migrate } from './migrate.mjs';
import { schemaFingerprint } from './fingerprint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const MIGRATIONS_DIR = path.join(repoRoot, 'db/migrations');
const FINGERPRINT_FILE = path.join(repoRoot, 'db/schema.fingerprint');

const args = process.argv.slice(2);
const command = args[0];
const urlFlag = args.indexOf('--url');
const databaseUrl =
  urlFlag !== -1
    ? args[urlFlag + 1]
    : process.env.DATABASE_URL ?? 'postgres://otto@localhost:5432/elixir_mcp_dev';

if (command === 'migrate') {
  const result = await migrate({ databaseUrl, migrationsDir: MIGRATIONS_DIR, log: console.error });
  console.log(`ok: ${result.applied} already applied, ${result.ran} ran`);
} else if (command === 'fingerprint') {
  const fp = await schemaFingerprint(databaseUrl);
  if (args.includes('--update')) {
    await writeFile(FINGERPRINT_FILE, fp + '\n');
    console.log(`wrote ${fp} to db/schema.fingerprint`);
  } else {
    const pinned = (await readFile(FINGERPRINT_FILE, 'utf8')).trim();
    if (pinned !== fp) {
      console.error(`fingerprint mismatch:\n  pinned:  ${pinned}\n  actual:  ${fp}`);
      process.exit(1);
    }
    console.log(`ok: ${fp}`);
  }
} else {
  console.error('usage: cli.mjs <migrate|fingerprint> [--url postgres://...] [--update]');
  process.exit(2);
}
