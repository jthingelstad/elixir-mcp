/**
 * The player map's consent (#768, Jamie 2026-11-14): a place reaches the
 * player map and Near you only when its owner chose it. A place saved
 * before the choice existed stays on clan maps only (`player_map: null`)
 * until its owner says yes; a save that does not say never widens it (a
 * yes is never carried over: it may be a former owner's); leaving the player map keeps the place; a person with no verified
 * player still cannot set one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestAccount } from "./fakes.mjs";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { createSocialService } from "@elixir-mcp/clan/manage/social.mjs";
import { diskGeo } from "@elixir-mcp/clan/geo.mjs";
import {
  fakeRecord,
  player,
  req,
  signIn,
  cookieHeader,
  rosterBody,
  memoryPlaces,
} from "./fakes.mjs";

const ADA = player();

function harness() {
  const clock = { t: Date.parse("2026-11-14T12:00:00Z") };
  const now = () => clock.t;
  const record = fakeRecord({
    players: [ADA],
    roster: rosterBody([
      { player_tag: ADA.player_tag, name: ADA.name, role: ADA.clan_role },
    ]),
  });
  const ledger = createMemoryLedger();
  const handler = createHandler({
    record,
    ...createTestAccount(),
    social: createSocialService({
      ledger,
      geo: diskGeo(),
      now,
      ...memoryPlaces(ledger),
    }),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { clock, record, ledger, handler };
}

async function as(h, who) {
  h.record.state.players = [who];
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

const AUSTIN = { country: "US", region: "TX", city: 4671654 };

test("a place saved before the choice stays on clan maps only until its owner says yes", async () => {
  const h = harness();
  // As the ledger holds a place saved before #768: no player_map key.
  await h.ledger.savePlace([ADA.player_tag], {
    country: "US",
    region: "TX",
    city: 4671654,
    set_at: "2026-11-01T00:00:00.000Z",
  });
  const ada = await as(h, ADA);
  const before = (await ada("GET", "/api/me/place")).body.place;
  assert.equal(before.city_name, "Austin");
  assert.equal(before.player_map, null, "never asked: clan maps only");
  // The clan map still shows it as before.
  const map = await ada("GET", "/api/clans/0QC8RCGY/map");
  assert.equal(map.body.on_map, 1);
  // A save from a page that does not ask (an older one) keeps it so.
  const resaved = await ada("PUT", "/api/me/place", {
    country: "CA",
    region: "08",
  });
  assert.equal(resaved.status, 200, JSON.stringify(resaved.body));
  assert.equal(resaved.body.place.player_map, null);
  assert.equal(
    h.ledger.items.get(`place#${ADA.player_tag}`).player_map,
    undefined,
    "nothing widened on disk",
  );
  // Its owner says yes: on the player map, the place unchanged.
  const yes = await ada("PUT", "/api/me/place/player-map", {
    player_map: true,
  });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.place.player_map, true);
  assert.equal(yes.body.place.region_name, "Ontario");
  assert.equal(h.ledger.items.get(`place#${ADA.player_tag}`).player_map, true);
  // Leaving keeps the place.
  const leave = await ada("PUT", "/api/me/place/player-map", {
    player_map: false,
  });
  assert.equal(leave.body.place.player_map, false);
  const after = (await ada("GET", "/api/me/place")).body.place;
  assert.equal(after.region_name, "Ontario");
  assert.equal(after.player_map, false);
});

test("a new place carries the choice its owner made, and a save that does not say never widens", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  const no = await ada("PUT", "/api/me/place", {
    ...AUSTIN,
    player_map: false,
  });
  assert.equal(no.body.place.player_map, false);
  // Moving without saying (an older page) keeps a no.
  const keptNo = await ada("PUT", "/api/me/place", {
    country: "CA",
    region: "08",
  });
  assert.equal(keptNo.body.place.player_map, false);
  const wide = await ada("PUT", "/api/me/place", {
    ...AUSTIN,
    player_map: true,
  });
  assert.equal(wide.body.place.player_map, true);
  // ...but never carries a yes: back to clan maps only.
  const moved = await ada("PUT", "/api/me/place", {
    country: "CA",
    region: "08",
  });
  assert.equal(moved.body.place.player_map, null);
  assert.equal(
    h.ledger.items.get(`place#${ADA.player_tag}`).player_map,
    undefined,
  );
  // Choosing clan maps only on a change.
  const narrow = await ada("PUT", "/api/me/place", {
    ...AUSTIN,
    player_map: false,
  });
  assert.equal(narrow.body.place.player_map, false);
  assert.equal(
    (await ada("GET", "/api/me/place")).body.place.player_map,
    false,
  );
});

test("a new place that does not say is on clan maps only", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  const set = await ada("PUT", "/api/me/place", AUSTIN);
  assert.equal(set.body.place.player_map, null);
  assert.equal(
    h.ledger.items.get(`place#${ADA.player_tag}`).player_map,
    undefined,
  );
});

test("the choice is a yes or no, and joining needs a place", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  const none = await ada("PUT", "/api/me/place/player-map", {
    player_map: true,
  });
  assert.equal(none.status, 404);
  assert.equal(none.body.error, "no_place");
  for (const bad of ["yes", 1, null, undefined]) {
    const r = await ada("PUT", "/api/me/place/player-map", { player_map: bad });
    assert.equal(r.status, 400, String(bad));
  }
  const r = await ada("PUT", "/api/me/place", { ...AUSTIN, player_map: "yes" });
  assert.equal(r.status, 400);
  assert.equal((await ada("GET", "/api/me/place/player-map")).status, 404);
});

test("an unverified player can neither set a place nor join the player map", async () => {
  const h = harness();
  const cy = await as(
    h,
    player({ player_tag: "#09UR", name: "Cy", claim_status: "pending" }),
  );
  for (const [path, body] of [
    ["/api/me/place", { ...AUSTIN, player_map: true }],
    ["/api/me/place/player-map", { player_map: true }],
  ]) {
    const r = await cy("PUT", path, body);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.reason, "unverified");
  }
});

test("each write stamps the time it was written, under every verified tag", async () => {
  const h = harness();
  const alt = player({
    player_tag: "#0JQ0JQ8",
    name: "Ada alt",
    relationship: "alt",
    is_primary: false,
  });
  h.record.state.players = [ADA, alt];
  const { sessionCookie } = await signIn(h);
  const put = (path, body) =>
    h.handler(
      req("PUT", path, {
        cookies: cookieHeader(sessionCookie),
        body: JSON.stringify(body),
      }),
    );
  await put("/api/me/place", { ...AUSTIN, player_map: false });
  h.clock.t += 60_000;
  await put("/api/me/place/player-map", { player_map: true });
  for (const tag of [ADA.player_tag, alt.player_tag]) {
    const row = h.ledger.items.get(`place#${tag}`);
    assert.equal(row.player_map, true, tag);
    assert.equal(row.set_at, "2026-11-14T12:01:00.000Z", tag);
  }
});

test("a tag that moved never carries its former owner's yes (Codex on #1054)", async () => {
  const h = harness();
  // The former owner's place, on the player map, left behind under the tag.
  await h.ledger.savePlace([ADA.player_tag], {
    country: "US",
    region: "TX",
    city: 4671654,
    set_at: "2026-11-01T00:00:00.000Z",
    player_map: true,
  });
  // The new owner saves from a page that does not ask.
  const ada = await as(h, ADA);
  const r = await ada("PUT", "/api/me/place", { country: "CA", region: "08" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.place.player_map, null);
  assert.equal(
    h.ledger.items.get(`place#${ADA.player_tag}`).player_map,
    undefined,
  );
});
