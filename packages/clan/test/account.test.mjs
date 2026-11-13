import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountContext } from "../src/account.mjs";
import { createRecord } from "../src/record.mjs";
import { createHandler } from "../src/handler.mjs";

test("Clan reads have no second session and persist only explicit account actions", async () => {
  const rows = new Map(),
    writes = [];
  const account = { accountId: "one", kind: "person" };
  const state = {
    get: async (k) => rows.get(k),
    put: async (v) => {
      rows.set(v.pk, v);
      writes.push(v);
    },
  };
  const { identity, store } = createAccountContext({ account, state });
  const session = await identity.load();
  await store.updateSession(session.id, {
    gate: { secret: "never stored" },
    rosters: { rows: [] },
    selected: { clan_tag: "#0JQ0JQ8" },
  });
  assert.equal(writes.length, 0);
  await store.putPreference(session.id, { clan_tag: "#0JQ0JQ8" });
  await store.updateSession(session.id, { verifyAck: "ack" });
  assert.deepEqual(rows.get("account#one"), {
    pk: "account#one",
    selected: { clan_tag: "#0JQ0JQ8" },
    verifyAck: "ack",
  });
  await assert.rejects(store.putPreference("account#other", {}));
  const other = createAccountContext({
    account: { accountId: "two", kind: "person" },
    state,
  });
  assert.equal((await other.identity.load()).selected, undefined);
  const agent = createAccountContext({
    account: { accountId: "agent", kind: "agent" },
    state,
  });
  assert.equal(await agent.identity.load(), null);
});

test("the record answers only Clan's reads, and a tool's error class as its status", async () => {
  const asked = [];
  let answer = { isError: false, body: { ok: 1 } };
  const record = createRecord({
    read: async (name, args) => {
      asked.push([name, args]);
      return answer;
    },
  });
  for (const [name, args] of [
    ["rankings_players", {}],
    ["battles_meta_cards", {}],
    ["elixir_follow_player", {}],
    ["clans_my_view", {}],
    ["live_fetch", { path: "/locations/global/rankings/players" }],
    ["live_fetch", { path: "/clans/%ZZ" }],
    ["live_fetch", { path: "/clans/%230JQ0JQ8?other=1" }],
  ])
    assert.equal((await record.read(name, args)).status, 403, name);
  assert.equal(asked.length, 0);
  assert.deepEqual(
    await record.read("live_fetch", { path: "/clans/%230JQ0JQ8" }),
    { ok: true, body: { ok: 1 } },
  );
  assert.equal(asked.length, 1);
  for (const [cls, status] of [
    ["input", 400],
    ["subject", 404],
    ["budget", 429],
    ["retry", 503],
    ["server", 502],
  ]) {
    answer = {
      isError: true,
      body: { error: { code: "c", class: cls, message: "m", hint: "h" } },
    };
    const r = await record.read("clans_roster", { clan_tag: "#0JQ0JQ8" });
    assert.equal(r.ok, false);
    assert.equal(r.status, status, cls);
    assert.equal(r.code, "c");
  }
  // No identity on the morning run; no writer where none is wired.
  assert.equal((await record.identity()).status, 401);
  assert.equal((await record.writeFact("#0JQ0JQ8", {})).status, 503);
  assert.equal((await record.sendMail("#0JQ0JQ8", {})).status, 503);
});

test("shared identity uses fresh gate reads and neither legacy cookies nor OAuth", async () => {
  const state = {
    get: async () => null,
    put: async () => assert.fail("a read wrote preferences"),
  };
  const context = createAccountContext({
    account: { accountId: "one", kind: "person" },
    state,
  });
  let calls = 0;
  const record = createRecord({
    read: async () => assert.fail("no tool read for /me"),
    identity: async () => {
      calls++;
      return {
        ok: true,
        principal: { kind: "person" },
        body: {
          players: [
            {
              player_tag: "#0JQ0JQ8",
              relationship: "primary",
              clan_tag: "#08V0UY9",
              clan_role: "leader",
              claim_status: calls === 1 ? "verified" : "unverified",
            },
          ],
        },
      };
    },
  });
  const handler = createHandler({
    record,
    ...context,
    appUrl: "https://elixir.poapkings.com/clan",
    elixirUrl: "https://elixir.poapkings.com",
    log: {},
  });
  const event = {
    path: "/api/clan/me",
    method: "GET",
  };
  const first = await handler(event),
    second = await handler(event);
  assert.equal(JSON.parse(first.body).selected.role, "leader");
  assert.equal(JSON.parse(second.body).selected.role, "member");
  assert.equal(first.cookies, undefined);
  // Clan has no sign-in of its own: the retired OAuth routes are gone.
  for (const path of [
    "/api/clan/auth/callback",
    "/api/clan/auth/login",
    "/api/clan/auth/logout",
  ])
    assert.equal((await handler({ ...event, path })).statusCode, 404);
  const signedOut = createHandler({
    record,
    identity: { load: async () => null },
    store: {},
    appUrl: "https://elixir.poapkings.com/clan",
    elixirUrl: "https://elixir.poapkings.com",
    log: {},
  });
  const refused = await signedOut({
    ...event,
    headers: { cookie: "elixir-clan-session=anything" },
  });
  assert.equal(refused.statusCode, 401);
  assert.equal(refused.cookies, undefined);
});
