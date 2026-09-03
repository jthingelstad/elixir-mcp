#!/usr/bin/env node
/**
 * Dev seed — local development only, never production (prod's first account
 * arrives through the real request-access flow).
 *
 * Creates the owner account (approved, is_owner), the owner's player row,
 * a verified primary claim, and an active recording. Idempotent.
 *
 * The owner email is NEVER committed (public repo): it comes from
 * ELIXIR_MCP_OWNER_EMAIL in the environment or the repo-root .env, and only
 * its sha256 (lowercased) is stored — same as production.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Jamie's player tag and POAP KINGS — public CR data, fine to commit.
const OWNER_PLAYER_TAG = "#20JJJ2CCRU";
const OWNER_CLAN_TAG = "#J2RGCRVG";
// No clan_membership seed on purpose: tenure is OBSERVED, never asserted
// (DESIGN §4.1) — the recorder writes membership when it sees the roster.
// In the running system the clan is auto-followed from the player's own
// profile (§4.2); seeding the clan row here just gives dev a familiar clan.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

async function ownerEmail() {
  if (process.env.ELIXIR_MCP_OWNER_EMAIL)
    return process.env.ELIXIR_MCP_OWNER_EMAIL;
  try {
    const env = await readFile(path.join(repoRoot, ".env"), "utf8");
    const line = env
      .split("\n")
      .find((l) => l.startsWith("ELIXIR_MCP_OWNER_EMAIL="));
    if (line) return line.slice("ELIXIR_MCP_OWNER_EMAIL=".length).trim();
  } catch {
    /* no .env */
  }
  throw new Error(
    "set ELIXIR_MCP_OWNER_EMAIL in the environment or repo-root .env",
  );
}

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://otto@localhost:5432/elixir_mcp_dev";
const emailHash = createHash("sha256")
  .update((await ownerEmail()).toLowerCase())
  .digest("hex");

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
try {
  await db.query("begin");
  const {
    rows: [account],
  } = await db.query(
    `insert into account (email_hash, status, is_owner, decided_at)
     values ($1, 'approved', true, now())
     on conflict (email_hash) do update set status = 'approved', is_owner = true
     returning account_id`,
    [emailHash],
  );
  await db.query(
    `insert into player (player_tag) values ($1) on conflict do nothing`,
    [OWNER_PLAYER_TAG],
  );
  await db.query(
    `insert into clan (clan_tag) values ($1) on conflict do nothing`,
    [OWNER_CLAN_TAG],
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, verified_method, is_primary)
     values ($1, $2, 'verified', 'owner_seed', true)
     on conflict (account_id, player_tag) do nothing`,
    [account.account_id, OWNER_PLAYER_TAG],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by)
     select 'player', $1, $2
     where not exists (
       select 1 from recording
       where subject_type = 'player' and subject_tag = $1 and status = 'active'
     )`,
    [OWNER_PLAYER_TAG, account.account_id],
  );
  await db.query("commit");
  const { rows: summary } = await db.query(
    `select (select count(*)::int from account) as accounts,
            (select count(*)::int from claim) as claims,
            (select count(*)::int from recording where status = 'active') as active_recordings`,
  );
  console.log("seeded:", JSON.stringify(summary[0]));
} catch (err) {
  await db.query("rollback").catch(() => {});
  throw err;
} finally {
  await db.end();
}
