import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountContext } from "../src/account.mjs";
import { createRecordedClient } from "../src/recorded-client.mjs";
import { createHandler } from "../src/handler.mjs";

test("Clan reads have no second session and persist only explicit account actions", async () => {
  const rows = new Map(),
    writes = [];
  const credential = Object.freeze({});
  const account = { accountId: "one", kind: "person" };
  const state = {
    get: async (k) => rows.get(k),
    put: async (v) => {
      rows.set(v.pk, v);
      writes.push(v);
    },
  };
  const { identity, store } = createAccountContext({
    account,
    state,
    credential,
  });
  const session = await identity.load();
  assert.equal(identity.credential(session), credential);
  assert.equal(identity.credential({ ...session }), null);
  await store.updateSession(session.id, {
    gate: { secret: "never stored" },
    rosters: { rows: [] },
    selected: { clan_tag: "#9GQLV20" },
  });
  assert.equal(writes.length, 0);
  await store.putPreference(session.id, { clan_tag: "#9GQLV20" });
  await store.updateSession(session.id, { verifyAck: "ack" });
  assert.deepEqual(rows.get("account#one"), {
    pk: "account#one",
    selected: { clan_tag: "#9GQLV20" },
    verifyAck: "ack",
  });
  await assert.rejects(store.putPreference("account#other", {}));
  const other = createAccountContext({
    account: { accountId: "two", kind: "person" },
    state,
    credential: {},
  });
  assert.equal((await other.identity.load()).selected, undefined);
  const agent = createAccountContext({
    account: { accountId: "agent", kind: "agent" },
    state,
    credential: {},
  });
  assert.equal(await agent.identity.load(), null);
});

test("internal reader refuses browser tokens, keys, other objects and retired domains", async () => {
  const credential = Object.freeze({});
  let calls = 0;
  const client = createRecordedClient({
    credential,
    initialize: async () => ({ ok: true }),
    invoke: async () => {
      calls++;
      return { ok: true };
    },
  });
  for (const token of [
    null,
    "session-token",
    "svt_key",
    {},
    { accountId: "one" },
  ])
    assert.equal(
      (await client.callTool(token, "clans_roster", {})).status,
      401,
    );
  for (const [name, args] of [
    ["rankings_players", {}],
    ["battles_meta_cards", {}],
    ["elixir_track_player", {}],
    ["live_fetch", { path: "/locations/global/rankings/players" }],
    ["live_fetch", { path: "/clans/%ZZ" }],
    ["live_fetch", { path: "/clans/%239GQLV20?other=1" }],
  ])
    assert.equal((await client.callTool(credential, name, args)).status, 403);
  assert.equal(calls, 0);
  assert.equal(
    (
      await client.callTool(credential, "live_fetch", {
        path: "/clans/%239GQLV20",
      })
    ).ok,
    true,
  );
  assert.equal(calls, 1);
});

test("shared identity uses fresh gate reads and neither legacy cookies nor OAuth", async () => {
  const credential = {},
    state = {
      get: async () => null,
      put: async () => assert.fail("a read wrote preferences"),
    };
  const context = createAccountContext({
    account: { accountId: "one", kind: "person" },
    state,
    credential,
    login: async () => ({ statusCode: 303 }),
    logout: async () => ({ statusCode: 303 }),
  });
  let calls = 0;
  const mcp = createRecordedClient({
    credential,
    initialize: async () => {
      calls++;
      return {
        ok: true,
        principal: { kind: "person" },
        body: {
          players: [
            {
              player_tag: "#9GQLV20",
              relationship: "primary",
              clan_tag: "#9GQLV22",
              clan_role: "leader",
              claim_status: calls === 1 ? "verified" : "unverified",
            },
          ],
        },
      };
    },
  });
  const handler = createHandler({
    mcp,
    ...context,
    appUrl: "https://elixir.poapkings.com/clan",
    elixirUrl: "https://elixir.poapkings.com",
    log: {},
  });
  const event = {
    rawPath: "/api/clan/me",
    requestContext: { http: { method: "GET" } },
  };
  const first = await handler(event),
    second = await handler(event);
  assert.equal(JSON.parse(first.body).selected.role, "leader");
  assert.equal(JSON.parse(second.body).selected.role, "member");
  assert.equal(first.cookies, undefined);
  assert.equal(
    (await handler({ ...event, rawPath: "/api/clan/auth/callback" }))
      .statusCode,
    410,
  );
  const signedOut = createHandler({
    mcp,
    identity: { load: async () => null },
    store: {},
    appUrl: "https://elixir.poapkings.com/clan",
    elixirUrl: "https://elixir.poapkings.com",
    log: {},
  });
  const refused = await signedOut({
    ...event,
    cookies: ["elixir-clan-session=anything"],
  });
  assert.equal(refused.statusCode, 401);
  assert.equal(refused.cookies, undefined);
});
