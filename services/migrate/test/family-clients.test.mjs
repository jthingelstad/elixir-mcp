import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { familyClientsOn } from "../src/ops-family-clients.mjs";

/**
 * The family clients op's guards: Clan is never provisioned as a family
 * app (it is part of Elixir, 2026-11-12), and an expired registration's
 * still-live token stops working while Drop's provisioned client keeps
 * signing people in.
 */
let scratch;
const oldId = "expired-test-client-000001",
  dropId = "drop-keep-client-000001";
let accountId;
before(async () => {
  scratch = await scratchDb("family_clients");
  const db = scratch.db;
  await db.query("delete from family_oauth_client");
  accountId = (
    await db.query(
      "insert into account(email_hash,status) values ('family-test','approved') returning account_id",
    )
  ).rows[0].account_id;
  for (const client of [oldId, dropId])
    await db.query(
      "insert into oauth_client(client_id,client_name,redirect_uris,expires_at) values($1,$1,array['https://elixir.poapkings.com/callback'],'infinity')",
      [client],
    );
  await db.query(
    "insert into family_oauth_client(app,client_id) values('drop',$1)",
    [dropId],
  );
});
after(async () => scratch?.drop());

test("Clan is never provisioned as a family app", async () => {
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

test("an expired registration cannot use a still-live token; the Drop token still works", async () => {
  const { mintTokens, validateAccessToken } = await import("@elixir-mcp/auth");
  const db = scratch.db;
  const resource = "https://elixir.poapkings.com/mcp";
  const mint = (clientId) =>
    mintTokens(db, { clientId, accountId, scope: "cr:read", resource });
  const old = await mint(oldId),
    drop = await mint(dropId);
  assert.ok(await validateAccessToken(db, old.accessToken, { resource }));
  await db.query(
    "update oauth_client set expires_at=now() where client_id=$1",
    [oldId],
  );
  assert.equal(
    await validateAccessToken(db, old.accessToken, { resource }),
    null,
  );
  assert.ok(await validateAccessToken(db, drop.accessToken, { resource }));
});
