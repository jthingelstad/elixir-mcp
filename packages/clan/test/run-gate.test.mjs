/**
 * Clan as one view (slice 8, #766), over the real handler: Run is the
 * leaders' tab, and the server refuses it to everyone else whatever the page
 * draws. `GET /run` is the page's one question; Run's reads answer
 * `leaders_only` to a member, an elder and an unverified leader alike. The
 * Feed answers every member with the clan's timeline as that member reads
 * it. Synthetic names only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import {
  cookieHeader,
  createTestAccount,
  fakeRecord,
  player,
  req,
  rosterBody,
  signIn,
} from "./fakes.mjs";

const TAG = "#0QC8RCGY";
const BASE = "/api/clans/0QC8RCGY";
const RUN_READS = [
  "/run",
  "/history",
  "/model",
  "/voice",
  "/discord",
  "/activity-discord",
  "/sharing",
];

function harness(role, { verified = true } = {}) {
  const feedCalls = [];
  const raceCalls = [];
  const record = fakeRecord({
    players: [
      player({
        clan_role: role,
        ...(verified ? {} : { claim_status: "unverified" }),
      }),
    ],
    roster: rosterBody([
      { player_tag: "#098R2R0PUL", name: "Ada", role, trophies: 9000 },
    ]),
  });
  const handler = createHandler({
    record,
    ...createTestAccount(),
    feed: async (clanTag) => {
      feedCalls.push(clanTag);
      return { clan_tag: clanTag, window_days: 7, items: [], more: 0 };
    },
    race: async (clanTag) => {
      raceCalls.push(clanTag);
      return { race: null };
    },
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now: () => Date.parse("2026-11-12T12:00:00Z"),
    log: { info() {}, warn() {}, error() {} },
  });
  return { handler, feedCalls, raceCalls };
}

async function as(h) {
  const cookies = cookieHeader((await signIn(h)).sessionCookie);
  return async (path) => {
    const r = await h.handler(req("GET", `${BASE}${path}`, { cookies }));
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
}

test("run: a verified leader or co-leader is answered", async () => {
  for (const role of ["leader", "coLeader"]) {
    const call = await as(harness(role));
    const run = await call("/run");
    assert.equal(run.status, 200, `${role} ${JSON.stringify(run.body)}`);
    assert.deepEqual(run.body, { clan_tag: TAG, run: true });
  }
});

test("run: a member and an elder are refused Run and each of its reads", async () => {
  for (const role of ["member", "elder"]) {
    const call = await as(harness(role));
    for (const path of RUN_READS) {
      const r = await call(path);
      assert.equal(r.status, 403, `${role} ${path}`);
      assert.equal(r.body.error, "leaders_only", `${role} ${path}`);
    }
  }
});

test("run: an unverified leader is refused Run and each of its reads", async () => {
  const call = await as(harness("leader", { verified: false }));
  for (const path of RUN_READS) {
    const r = await call(path);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.error, "leaders_only", path);
  }
});

test("race: every member reads the race now, for this clan", async () => {
  for (const role of ["member", "elder", "leader"]) {
    const h = harness(role);
    const call = await as(h);
    const r = await call("/race");
    assert.equal(r.status, 200, `${role} ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body, { race: null });
    assert.deepEqual(h.raceCalls, [TAG]);
  }
});

test("feed: every member reads the clan's Feed, for this clan", async () => {
  for (const role of ["member", "elder", "leader"]) {
    const h = harness(role);
    const call = await as(h);
    const r = await call("/feed");
    assert.equal(r.status, 200, `${role} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.clan_tag, TAG);
    assert.deepEqual(h.feedCalls, [TAG]);
  }
});
