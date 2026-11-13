import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { familyClientsOn } from "../src/ops-family-clients.mjs";
import { getClient } from "@elixir-mcp/auth";
let scratch;
const clanId = "clan-retire-client-000001",
  dropId = "drop-keep-client-000001";
const familyRow = async (client) =>
  (
    await scratch.db.query(
      "select app from family_oauth_client where client_id=$1",
      [client],
    )
  ).rows[0]?.app ?? null;
before(async () => {
  scratch = await scratchDb("clan_oauth_retirement");
  const db = scratch.db;
  await db.query("delete from family_oauth_client");
  const account = (
    await db.query(
      "insert into account(email_hash,status) values ('retire-test','approved') returning account_id",
    )
  ).rows[0].account_id;
  for (const [app, client] of [
    ["clan", clanId],
    ["drop", dropId],
  ]) {
    await db.query(
      "insert into oauth_client(client_id,client_name,redirect_uris,expires_at) values($1,$2,array['https://elixir.poapkings.com/callback'],'infinity')",
      [client, app],
    );
    await db.query(
      "insert into family_oauth_client(app,client_id) values($1,$2)",
      [app, client],
    );
    await db.query(
      "insert into oauth_family(client_id,account_id,scope,absolute_expires_at) values($1,$2,'cr:read',now()+interval '90 days')",
      [client, account],
    );
    await db.query(
      "insert into oauth_code(code_hash,client_id,account_id,code_challenge,redirect_uri,scope,expires_at) values($1,$2,$3,'test','https://elixir.poapkings.com/callback','cr:read',now()+interval '5 minutes')",
      [app, client, account],
    );
  }
});
after(async () => scratch?.drop());
test("Clan's client retirement previews, and refuses another app or a stale client id", async () => {
  const spec = { retire_app: { app: "clan", expected_client_id: clanId } };
  assert.equal(
    (await familyClientsOn(scratch.db, spec)).retire_app.applied,
    false,
  );
  assert.ok(await getClient(scratch.db, clanId));
  for (const body of [
    { ...spec.retire_app, app: "drop", apply: true },
    { ...spec.retire_app, expected_client_id: "stale", apply: true },
    { ...spec.retire_app, expected_client_id: dropId, apply: true },
  ])
    await assert.rejects(familyClientsOn(scratch.db, { retire_app: body }));
  assert.equal(await familyRow(clanId), "clan", "a preview writes nothing");
  assert.equal(await familyRow(dropId), "drop");
});

test("Clan is never provisioned as a family app again", async () => {
  await assert.rejects(
    familyClientsOn(scratch.db, {
      provision: {
        app: "clan",
        client_name: "Clan",
        redirect_uris: ["https://elixir.poapkings.com/clan"],
      },
    }),
    /part of Elixir/,
  );
});
test("retirement expires only Clan's client, revokes its grants and unused codes, and deletes its family row once", async () => {
  const spec = {
    retire_app: { app: "clan", expected_client_id: clanId, apply: true },
  };
  const result = await familyClientsOn(scratch.db, spec);
  assert.equal(result.retire_app.grants, 1);
  assert.equal(result.retire_app.codes, 1);
  assert.equal(await getClient(scratch.db, clanId), null);
  assert.ok(await getClient(scratch.db, dropId));
  assert.equal(
    (
      await scratch.db.query(
        "select count(*)::int as n from oauth_family where client_id=$1 and revoked_at is null",
        [clanId],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await scratch.db.query(
        "select count(*)::int as n from oauth_family where client_id=$1 and revoked_at is null",
        [dropId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await scratch.db.query(
        "select used_at is not null as used from oauth_code where code_hash='clan'",
      )
    ).rows[0].used,
    true,
  );
  assert.equal(
    (
      await scratch.db.query(
        "select used_at is not null as used from oauth_code where code_hash='drop'",
      )
    ).rows[0].used,
    false,
  );
  assert.equal(await familyRow(clanId), null, "Clan is no family app");
  assert.equal(await familyRow(dropId), "drop", "Drop keeps its client");
  assert.ok(
    (
      await scratch.db.query("select 1 from oauth_client where client_id=$1", [
        clanId,
      ])
    ).rowCount,
    "the expired registration stays as its grants' history",
  );
  assert.deepEqual(await familyClientsOn(scratch.db, spec), {
    retire_app: { app: "clan", applied: false, already_removed: true },
  });
  assert.equal(
    (
      await scratch.db.query(
        "select count(*)::int as n from account_event where kind='connection_revoked'",
      )
    ).rows[0].n,
    1,
  );
});

test("an in-flight authorization mint cannot escape the retirement sweep", async () => {
  const pg = (await import("pg")).default;
  const { mintTokens } = await import("@elixir-mcp/auth");
  const db = scratch.db;
  // As it stood before the retirement above.
  await db.query(
    "update oauth_client set expires_at='infinity' where client_id=$1",
    [clanId],
  );
  await db.query(
    "insert into family_oauth_client(app,client_id) values('clan',$1)",
    [clanId],
  );
  const accountId = (
    await db.query(
      "select account_id from account where email_hash='retire-test'",
    )
  ).rows[0].account_id;
  let release, locked;
  const held = new Promise((r) => {
    release = r;
  });
  const ready = new Promise((r) => {
    locked = r;
  });
  const wrapped = {
    async query(sql, values) {
      const result = await db.query(sql, values);
      if (sql.startsWith("select fc.client_id")) {
        locked();
        await held;
      }
      return result;
    },
  };
  const peer = new pg.Client({
    connectionString: scratch.url,
    application_name: "clan_retirement_mint",
  });
  await peer.connect();
  try {
    const retirement = familyClientsOn(wrapped, {
      retire_app: { app: "clan", expected_client_id: clanId, apply: true },
    });
    await ready;
    const mint = mintTokens(peer, {
      clientId: clanId,
      accountId,
      scope: "cr:read",
      resource: "https://elixir.poapkings.com/mcp",
    });
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      waiting =
        (
          await db.query(
            "select 1 from pg_stat_activity where application_name='clan_retirement_mint' and wait_event_type='Lock'",
          )
        ).rowCount === 1;
      if (waiting) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(
      waiting,
      true,
      "final mint serializes on the retiring registration",
    );
    release();
    await retirement;
    assert.equal(await mint, null);
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from oauth_family where client_id=$1 and revoked_at is null",
          [clanId],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    release();
    await peer.end();
  }
});

test("expired registrations cannot use a still-live token; the Drop token still works", async () => {
  const { mintTokens, validateAccessToken } = await import("@elixir-mcp/auth");
  const db = scratch.db;
  const accountId = (
    await db.query(
      "select account_id from account where email_hash='retire-test'",
    )
  ).rows[0].account_id;
  await db.query(
    "update oauth_client set expires_at='infinity' where client_id=$1",
    [clanId],
  );
  const mint = (clientId) =>
    mintTokens(db, {
      clientId,
      accountId,
      scope: "cr:read",
      resource: "https://elixir.poapkings.com/mcp",
    });
  const clan = await mint(clanId),
    drop = await mint(dropId);
  assert.ok(
    await validateAccessToken(db, clan.accessToken, {
      resource: "https://elixir.poapkings.com/mcp",
    }),
  );
  await db.query(
    "update oauth_client set expires_at=now() where client_id=$1",
    [clanId],
  );
  assert.equal(
    await validateAccessToken(db, clan.accessToken, {
      resource: "https://elixir.poapkings.com/mcp",
    }),
    null,
  );
  assert.ok(
    await validateAccessToken(db, drop.accessToken, {
      resource: "https://elixir.poapkings.com/mcp",
    }),
  );
});
