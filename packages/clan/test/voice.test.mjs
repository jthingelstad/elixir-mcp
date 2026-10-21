/**
 * How our messages sound (2026-10-20, call 5), over the real handler: one
 * clan setting, read and set by leaders and co-leaders alone, tidied and
 * held to its bound (refused, never cut), kept in the Clan ledger with who
 * set it. The drafts and the Discord editor reading it are pinned in
 * model.test.mjs and activity.test.mjs. Synthetic names only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { VOICE_MAX } from "@elixir-mcp/clan-engine";
import { createVoiceService } from "@elixir-mcp/clan/manage/voice.mjs";
import {
  cookieHeader,
  createTestAccount,
  fakeMcp,
  player,
  req,
  rosterBody,
  signIn,
} from "./fakes.mjs";

const TAG = "#2PQRJ8LV";
const PATH = "/api/clans/2PQRJ8LV/voice";

function harness(role = "leader", { verified = true } = {}) {
  const clock = { t: Date.parse("2026-10-20T12:00:00Z") };
  const now = () => clock.t;
  const ledger = createMemoryLedger();
  const mcp = fakeMcp({
    players: [
      player({
        clan_role: role,
        ...(verified ? {} : { claim_status: "unverified" }),
      }),
    ],
    roster: rosterBody([
      { player_tag: "#20QQL8CCRU", name: "Ada", role, trophies: 9000 },
    ]),
  });
  const handler = createHandler({
    mcp,
    ...createTestAccount(),
    voice: createVoiceService({ ledger, now }),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: { info() {}, warn() {}, error() {} },
  });
  return { clock, ledger, handler };
}

async function as(h) {
  const cookies = cookieHeader((await signIn(h)).sessionCookie);
  return async (method, body) => {
    const r = await h.handler(
      req(method, PATH, {
        cookies,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
}

test("voice: none at first; a leader sets it, tidied, with who and when; empty clears it", async () => {
  const h = harness();
  const call = await as(h);
  const first = await call("GET");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body, {
    clan_tag: TAG,
    voice: "",
    max: VOICE_MAX,
    set_by_name: null,
    set_at: null,
  });
  const set = await call("PUT", {
    voice: "  Warm and\n\nshort <b>, see https://x.example @here ",
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.voice, "Warm and short b, see here");
  assert.equal(set.body.set_by_name, "Ada");
  assert.equal(set.body.set_at, "2026-10-20T12:00:00.000Z");
  const item = await h.ledger.clanVoice(TAG);
  assert.equal(item.voice, "Warm and short b, see here");
  assert.equal(item.set_by, "#20QQL8CCRU");
  // In the clan's partition, so it goes with the clan's other state.
  assert.equal(h.ledger.items.get(`voice#${TAG}`).gsi1pk, `clan#${TAG}`);
  assert.equal((await call("GET")).body.voice, "Warm and short b, see here");
  const cleared = await call("PUT", { voice: "" });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.voice, "");
  assert.equal((await call("PUT", { voice: null })).body.voice, "");
});

test("voice: at most VOICE_MAX characters once tidied; longer is refused, never cut", async () => {
  const h = harness("coLeader");
  const call = await as(h);
  const exact = "x".repeat(VOICE_MAX);
  const ok = await call("PUT", { voice: exact });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.voice, exact);
  // Spaces and links tidied away do not count against it.
  const tidy = await call("PUT", {
    voice: `${"y".repeat(VOICE_MAX)}   https://x.example`,
  });
  assert.equal(tidy.status, 200, JSON.stringify(tidy.body));
  const long = await call("PUT", { voice: "z".repeat(VOICE_MAX + 1) });
  assert.equal(long.status, 400);
  assert.equal(long.body.error, "voice_too_long");
  assert.equal(long.body.max, VOICE_MAX);
  assert.match(long.body.message, /400 characters/);
  assert.equal((await call("GET")).body.voice, "y".repeat(VOICE_MAX));
  const bad = await call("PUT", { voice: 7 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "bad_request");
});

test("voice: an elder or a member neither reads nor sets it", async () => {
  for (const role of ["elder", "member"]) {
    const h = harness(role);
    const call = await as(h);
    const read = await call("GET");
    assert.equal(read.status, 403, role);
    assert.equal(read.body.error, "leaders_only");
    const write = await call("PUT", { voice: "Loud." });
    assert.equal(write.status, 403, role);
    assert.equal(await h.ledger.clanVoice(TAG), null);
  }
});
