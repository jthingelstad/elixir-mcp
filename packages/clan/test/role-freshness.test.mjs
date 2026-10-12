/**
 * A leader mutation needs the clan's roster read within the hour
 * (role-freshness.mjs). Here over the fake door; the ledger's real live
 * lane is services/web-api/test/clan-role-freshness.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { createSocialService } from "@elixir-mcp/clan/manage/social.mjs";
import { diskGeo } from "@elixir-mcp/clan/geo.mjs";
import {
  ROLE_CONFIRM_MAX_AGE_MS,
  isLeaderMutation,
} from "@elixir-mcp/clan/role-freshness.mjs";
import {
  createTestAccount,
  fakeMcp,
  player,
  req,
  signIn,
  cookieHeader,
} from "./fakes.mjs";

const T = Date.parse("2026-10-12T12:00:00Z");
const ago = (ms) => new Date(T - ms).toISOString();

function harness(who = player()) {
  const mcp = fakeMcp({ players: [who] });
  const handler = createHandler({
    mcp,
    ...createTestAccount(),
    social: createSocialService({
      ledger: createMemoryLedger(),
      geo: diskGeo(),
      now: () => T,
    }),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now: () => T,
    log: { warn() {}, error() {}, info() {} },
  });
  return { mcp, handler };
}

async function as(h) {
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  return async (method, path, body) => {
    const r = await h.handler(
      req(method, path, {
        cookies,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: r.statusCode, body: JSON.parse(r.body) };
  };
}

const rosterCalls = (h) =>
  h.mcp.calls.filter(([name]) => name === "clans_roster").map(([, , a]) => a);

test("leader mutations are every non-GET a leader or co-leader sends, except a member's own away and the two read-only POSTs", () => {
  for (const role of ["leader", "coLeader"]) {
    for (const [method, rest] of [
      ["POST", "/policy"],
      ["POST", "/actions/a1/decide"],
      ["POST", "/actions/a1/reopen"],
      ["PUT", "/holds/8QCV"],
      ["DELETE", "/notes/n1"],
      ["PUT", "/discord"],
      ["PUT", "/model"],
      ["POST", "/awards/grants"],
      ["POST", "/actions/a1/comments"],
      ["POST", "/a-route-added-later"],
    ])
      assert.equal(
        isLeaderMutation(method, rest, role),
        true,
        `${method} ${rest}`,
      );
    for (const [method, rest] of [
      ["GET", "/policy"],
      ["GET", "/actions"],
      ["PUT", "/me/away"],
      ["DELETE", "/me/away"],
      ["POST", "/policy/preview"],
      ["POST", "/scout"],
    ])
      assert.equal(
        isLeaderMutation(method, rest, role),
        false,
        `${method} ${rest}`,
      );
  }
  for (const role of ["elder", "member", null])
    assert.equal(isLeaderMutation("POST", "/policy", role), false);
  assert.equal(ROLE_CONFIRM_MAX_AGE_MS, 60 * 60_000);
});

test("a roster read inside the hour lets a leader act, with one compact read and no live ask", async () => {
  const h = harness();
  h.mcp.state.rosterObservedAt = ago(ROLE_CONFIRM_MAX_AGE_MS - 60_000);
  const ada = await as(h);
  const r = await ada("PUT", "/api/clans/2PQRJ8LV/social", { enabled: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(rosterCalls(h), [
    { clan_tag: "#2PQRJ8LV", verbosity: "compact" },
  ]);
});

test("an older roster asks for a live read and refuses role_unconfirmed; a read is not held", async () => {
  const h = harness();
  h.mcp.state.rosterObservedAt = ago(ROLE_CONFIRM_MAX_AGE_MS + 60_000);
  const ada = await as(h);
  const r = await ada("PUT", "/api/clans/2PQRJ8LV/social", { enabled: false });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "role_unconfirmed");
  assert.equal(
    r.body.roster_observed_at,
    ago(ROLE_CONFIRM_MAX_AGE_MS + 60_000),
  );
  assert.equal(r.body.retry_after_s, 15);
  assert.deepEqual(rosterCalls(h), [
    { clan_tag: "#2PQRJ8LV", verbosity: "compact" },
    { clan_tag: "#2PQRJ8LV", verbosity: "compact", live: true },
  ]);
  h.mcp.calls.length = 0;
  const read = await ada("GET", "/api/clans/2PQRJ8LV/social");
  assert.equal(read.status, 200);
  assert.deepEqual(rosterCalls(h), []);
  assert.equal(read.body.enabled, true, "the refused PUT changed nothing");
});

test("a live read already in hand answers at once; a roster with no read at all is unconfirmed", async () => {
  const h = harness();
  h.mcp.state.rosterObservedAt = ago(2 * ROLE_CONFIRM_MAX_AGE_MS);
  const ada = await as(h);
  // The live ask's answer carries the record a fresh read just moved.
  const inner = h.mcp.rawCallTool.bind(h.mcp);
  h.mcp.rawCallTool = async (token, name, args) => {
    const r = await inner(token, name, args);
    if (name === "clans_roster" && args?.live === true) {
      r.body.meta.source_polls.clan.observed_at = ago(30_000);
      r.body.live_status = { state: "fresh", fetched_at: ago(30_000) };
    }
    return r;
  };
  const fresh = await ada("PUT", "/api/clans/2PQRJ8LV/social", {
    enabled: false,
  });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));

  const none = harness();
  const ben = await as(none);
  const inner2 = none.mcp.rawCallTool.bind(none.mcp);
  none.mcp.rawCallTool = async (token, name, args) => {
    const r = await inner2(token, name, args);
    if (name === "clans_roster")
      r.body.meta.source_polls.clan.observed_at = null;
    return r;
  };
  const r = await ben("PUT", "/api/clans/2PQRJ8LV/social", { enabled: false });
  assert.equal(r.status, 409);
  assert.equal(r.body.roster_observed_at, null);
});

test("an elder's and a member's requests are never held for the roster", async () => {
  for (const role of ["elder", "member"]) {
    const h = harness(player({ clan_role: role }));
    h.mcp.state.rosterObservedAt = ago(10 * ROLE_CONFIRM_MAX_AGE_MS);
    const who = await as(h);
    const r = await who("PUT", "/api/clans/2PQRJ8LV/social", {
      enabled: false,
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "leaders_only");
    assert.deepEqual(rosterCalls(h), []);
  }
});

test("a roster read that fails is elixir_unavailable", async () => {
  const h = harness();
  const ada = await as(h);
  h.mcp.state.roster = { error: { code: "internal", message: "down" } };
  const r = await ada("PUT", "/api/clans/2PQRJ8LV/social", { enabled: false });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "elixir_unavailable");
});

test("a role the roster changed between the gate and the freshness read is read again before acting (Codex on #519)", async () => {
  const h = harness();
  const ada = await as(h);
  // The admission lands just as the freshness check reads the roster.
  const inner = h.mcp.rawCallTool.bind(h.mcp);
  h.mcp.rawCallTool = async (token, name, args) => {
    if (name === "clans_roster")
      h.mcp.state.players = [player({ clan_role: "member" })];
    return inner(token, name, args);
  };
  const before = h.mcp.calls.filter(([n]) => n === "initialize").length;
  const r = await ada("PUT", "/api/clans/2PQRJ8LV/social", { enabled: false });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.error, "leaders_only");
  assert.equal(
    h.mcp.calls.filter(([n]) => n === "initialize").length - before,
    2,
    "the gate, then the gate again after the freshness read",
  );

  // Left the clan in that moment: the clan is no longer theirs.
  const g = harness();
  const ben = await as(g);
  const inner2 = g.mcp.rawCallTool.bind(g.mcp);
  g.mcp.rawCallTool = async (token, name, args) => {
    if (name === "clans_roster")
      g.mcp.state.players = [player({ clan_tag: null, clan_role: null })];
    return inner2(token, name, args);
  };
  const gone = await ben("PUT", "/api/clans/2PQRJ8LV/social", {
    enabled: false,
  });
  assert.equal(gone.status, 403, JSON.stringify(gone.body));
  assert.notEqual(gone.body.error, "role_unconfirmed");
});
