/**
 * 0317 on the real pre-0317 schema: it refuses, and changes nothing, while
 * an agent or an integration is left; once the removal ops have run it
 * narrows account.kind, the key audience and the OAuth audiences, and
 * drops the agent and integration schema. A person and a test identity
 * come through untouched, and the call log keeps its history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { loadMigrations, migrate } from "../src/migrate.mjs";

const root = new URL("../../../", import.meta.url);
const migrationsDir = new URL("db/migrations/", root).pathname;
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const HOST = "https://elixir.poapkings.com";

async function tryQuery(db, sql, params = []) {
  await db.query("savepoint s");
  try {
    await db.query(sql, params);
    await db.query("release savepoint s");
    return "ok";
  } catch (err) {
    await db.query("rollback to savepoint s");
    return err.constraint ?? err.message;
  }
}

test("0317 refuses while an agent or an integration is left, then leaves only people", async () => {
  const name = `elixir_mcp_test_people_only_${process.pid}`;
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url });
  const dir = await mkdtemp(path.join(os.tmpdir(), "elixir-pre-0317-"));
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
    const all = await loadMigrations(migrationsDir);
    const copy = async (keep) => {
      for (const m of all)
        if (keep(m.id))
          await cp(path.join(migrationsDir, m.name), path.join(dir, m.name));
    };
    await copy((id) => id < 317);
    await migrate({ databaseUrl: url, migrationsDir: dir });
    await db.connect();

    const insert = async (sql, params) =>
      (await db.query(sql, params)).rows[0].account_id;
    const person = await insert(
      `insert into account (email_hash, status) values ('people-only-person', 'approved')
       returning account_id`,
    );
    const tester = await insert(
      `insert into account (email_hash, status, kind, test_name)
       values ('test:gym', 'approved', 'person', 'gym') returning account_id`,
    );
    await db.query(
      `insert into service_token (account_id, name, token_hash, audience)
       values ($1, 'gym', 'svt-hash-gym', 'mcp')`,
      [tester],
    );
    const integration = await insert(
      `insert into account (status, kind, owned_by_account_id, public_id)
       values ('approved', 'integration', $1, 'leftoverintg') returning account_id`,
      [person],
    );
    await db.query(
      `insert into integration (account_id, name) values ($1, 'elixir-clan')`,
      [integration],
    );
    await db.query(
      `insert into service_token (account_id, name, token_hash, audience, revoked_at)
       values ($1, 'old-site', 'svt-hash-site', 'integration_api', now())`,
      [integration],
    );
    const agent = await insert(
      `insert into account (status, kind, owned_by_account_id, public_id, removed_at)
       values ('disabled', 'agent', $1, 'leftoveragent', now()) returning account_id`,
      [person],
    );
    await db.query(`insert into player (player_tag) values ('#0VQRR8U0')`);
    await db.query(
      `insert into agent_identity (account_id, external_id, player_tag)
       values ($1, 'discord:1', '#0VQRR8U0')`,
      [agent],
    );
    await db.query(
      `insert into mcp_call_audit (account_id, surface, tool, principal_kind, on_behalf_of)
       values (null, 'mcp', 'war_current', 'agent', 'discord:1'),
              (null, 'mcp', 'game_clock', 'integration', null),
              ($1, 'mcp', 'war_current', 'person', null)`,
      [person],
    );
    const people = async () =>
      (
        await db.query(
          `select account_id, kind, status, email_hash, test_name
             from account where kind = 'person' order by account_id`,
        )
      ).rows;
    const peopleBefore = await people();
    assert.deepEqual(peopleBefore.map((a) => a.account_id).sort(), [
      ...[person, tester].sort(),
    ]);

    // With an agent and an integration left, 0317 refuses and changes nothing.
    await copy((id) => id === 317);
    await assert.rejects(
      migrate({ databaseUrl: url, migrationsDir: dir }),
      (err) =>
        /0317 refuses: 2 account\(s\) that are not a person, 1 agent identity row\(s\), 1 integration row\(s\), 1 integration_api key\(s\)/.test(
          err.message,
        ) &&
        /\{agent_accounts_remove\}/.test(err.message) &&
        /\{integration_accounts_remove\}/.test(err.message),
    );
    for (const table of ["agent_identity", "integration"])
      assert.equal(
        (await db.query(`select to_regclass($1) as t`, [table])).rows[0].t,
        table,
      );
    assert.equal(
      (
        await db.query(
          `select count(*)::int as n from schema_migrations where id = 317`,
        )
      ).rows[0].n,
      0,
    );

    // The agent's removal alone is not enough: the integration still blocks.
    await db.query(`delete from account where kind = 'agent'`);
    await assert.rejects(
      migrate({ databaseUrl: url, migrationsDir: dir }),
      /0317 refuses: 1 account\(s\) that are not a person, 0 agent identity row\(s\), 1 integration row\(s\)/,
    );

    // Both ops have run: what is left is people.
    await db.query(`delete from integration`);
    await db.query(`delete from service_token where account_id = $1`, [
      integration,
    ]);
    await db.query(`delete from account where kind = 'integration'`);
    await migrate({ databaseUrl: url, migrationsDir: dir });

    assert.deepEqual(
      await people(),
      peopleBefore,
      "the person and the test identity come through untouched",
    );
    assert.deepEqual(
      (
        await db.query(
          `select name, audience, revoked_at from service_token order by name`,
        )
      ).rows,
      [{ name: "gym", audience: "mcp", revoked_at: null }],
      "the test identity's key still stands",
    );

    await db.query("begin");
    try {
      for (const kind of ["agent", "integration"])
        assert.equal(
          await tryQuery(
            db,
            `insert into account (email_hash, status, kind) values ($1, 'approved', $2)`,
            [`people-only-${kind}`, kind],
          ),
          "account_kind_check",
          kind,
        );
      assert.equal(
        await tryQuery(
          db,
          `insert into service_token (account_id, name, token_hash, audience)
           values ($1, 'site', 'svt-hash-new', 'integration_api')`,
          [person],
        ),
        "service_token_audience_check",
      );
      await db.query(
        `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
         values ('people-only', 'People only', array['https://example.com/cb'],
                 now() + interval '1 day')`,
      );
      for (const [door, want] of [
        ["/mcp", "ok"],
        ["/api/v1", "ok"],
        ["/a/abcd1234/mcp", "oauth_family_resource_shape"],
      ])
        assert.equal(
          await tryQuery(
            db,
            `insert into oauth_family (client_id, account_id, absolute_expires_at, resource)
             values ('people-only', $1, now() + interval '90 days', $2)`,
            [person, `${HOST}${door}`],
          ),
          want,
          door,
        );
    } finally {
      await db.query("rollback");
    }

    for (const table of ["agent_identity", "integration"])
      assert.equal(
        (await db.query(`select to_regclass($1) as t`, [table])).rows[0].t,
        null,
        table,
      );
    assert.deepEqual(
      (
        await db.query(
          `select table_name || '.' || column_name as c from information_schema.columns
            where table_schema = 'public'
              and (table_name, column_name) in (('account', 'removed_at'),
                ('mcp_call_audit', 'on_behalf_of'), ('account', 'public_id'),
                ('account', 'owned_by_account_id'), ('account', 'kind'))
            order by 1`,
        )
      ).rows.map((r) => r.c),
      ["account.kind"],
    );
    // The call log's history keeps its rows, an agent's and an
    // integration's call among them.
    assert.deepEqual(
      (
        await db.query(
          `select principal_kind from mcp_call_audit order by principal_kind`,
        )
      ).rows.map((r) => r.principal_kind),
      ["agent", "integration", "person"],
    );
  } finally {
    await db.end().catch(() => {});
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
