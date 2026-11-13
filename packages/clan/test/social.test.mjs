/**
 * Social, the clan map (Jamie, 2026-09-26): a person's place from the
 * lists, one per person under each verified tag; the clan's members see
 * each other's, names beside pins; someone off the roster is off the map;
 * a leader turns the clan's social features off; nothing leaves for Elixir.
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
} from "./fakes.mjs";

const ADA = player();
const BEN = player({
  player_tag: "#0RJL",
  name: "Ben",
  clan_role: "member",
});
const rosterOf = (...members) =>
  rosterBody(
    members.map((m) => ({
      player_tag: m.player_tag,
      name: m.name,
      role: m.clan_role,
    })),
  );

function harness() {
  const clock = { t: Date.parse("2026-09-26T12:00:00Z") };
  const now = () => clock.t;
  const record = fakeRecord({ players: [ADA], roster: rosterOf(ADA, BEN) });
  const ledger = createMemoryLedger();
  const handler = createHandler({
    record,
    ...createTestAccount(),
    social: createSocialService({ ledger, geo: diskGeo(), now }),
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

test("a member picks a place from the lists; the clan's members see it, with its time zone", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  assert.deepEqual((await ada("GET", "/api/me/place")).body, { place: null });
  const set = await ada("PUT", "/api/me/place", {
    country: "US",
    region: "TX",
    city: 4671654,
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.place.city_name, "Austin");
  assert.equal(set.body.place.region_name, "Texas");
  assert.equal(set.body.place.tz, "America/Chicago");
  assert.equal(set.body.place.precision, "city");

  const ben = await as(h, BEN);
  const region = await ben("PUT", "/api/me/place", {
    country: "CA",
    region: "08",
  });
  assert.equal(region.status, 200, JSON.stringify(region.body));
  assert.equal(region.body.place.precision, "region");
  assert.equal(region.body.place.city, null, "no city picked, none pinned");

  const map = await ben("GET", "/api/clans/0QC8RCGY/map");
  assert.equal(map.status, 200, JSON.stringify(map.body));
  assert.equal(map.body.members, 2);
  assert.equal(map.body.on_map, 2);
  const a = map.body.entries.find((e) => e.player_tag === ADA.player_tag);
  assert.equal(a.name, "Ada");
  assert.equal(a.you, false);
  assert.equal(a.place.city_name, "Austin");
  assert.equal(map.body.entries.find((e) => e.you).name, "Ben");
  assert.equal(map.body.yours.region_name, region.body.place.region_name);
  assert.match(map.body.attribution, /OpenStreetMap/);
  // Nothing of it goes to Elixir.
  assert.equal(h.record.calls.filter((c) => c[0] === "writeFact").length, 0);
});

test("a place is checked against the lists, in words a person can act on", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  for (const [body, field] of [
    [{ country: "ZZ" }, "country"],
    [{ country: "US" }, "region"],
    [{ country: "US", region: "TX", city: 5128581 }, "city"],
  ]) {
    const r = await ada("PUT", "/api/me/place", body);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "bad_place");
    assert.equal(r.body.field, field);
    assert.ok(r.body.message.length > 10);
  }
});

test("off the roster is off the map; a cleared place is gone", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  const ben = await as(h, BEN);
  await ben("PUT", "/api/me/place", { country: "CA", region: "08" });
  assert.equal((await ada("GET", "/api/clans/0QC8RCGY/map")).body.on_map, 1);
  // Ben leaves the clan: the next roster read no longer has him.
  h.record.state.roster = rosterOf(ADA);
  h.clock.t += 4 * 60_000;
  assert.equal((await ada("GET", "/api/clans/0QC8RCGY/map")).body.on_map, 0);
  // Back, then he removes his place himself.
  h.record.state.roster = rosterOf(ADA, BEN);
  h.clock.t += 4 * 60_000;
  assert.equal((await ada("GET", "/api/clans/0QC8RCGY/map")).body.on_map, 1);
  assert.equal((await ben("DELETE", "/api/me/place")).status, 200);
  h.clock.t += 4 * 60_000;
  assert.equal((await ada("GET", "/api/clans/0QC8RCGY/map")).body.on_map, 0);
});

test("one place per person: written under each verified tag, shown in each of their clans", async () => {
  const h = harness();
  const alt = player({
    player_tag: "#0JQ0JQ8",
    name: "Ada alt",
    relationship: "alt",
    is_primary: false,
    clan_tag: "#0QG0P8G",
    clan_role: "member",
  });
  h.record.state.players = [ADA, alt];
  const { sessionCookie } = await signIn(h);
  const r = await h.handler(
    req("PUT", "/api/me/place", {
      cookies: cookieHeader(sessionCookie),
      body: JSON.stringify({ country: "US", region: "TX" }),
    }),
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(h.ledger.items.has(`place#${ADA.player_tag}`));
  assert.ok(h.ledger.items.has(`place#${alt.player_tag}`));
});

test("a leader turns the clan's social features off; a member cannot; the rail hears it", async () => {
  const h = harness();
  const ben = await as(h, BEN);
  assert.equal(
    (await ben("PUT", "/api/clans/0QC8RCGY/social", { enabled: false })).status,
    403,
  );
  const ada = await as(h, ADA);
  assert.equal((await ada("GET", "/api/me")).body.social.enabled, true);
  const off = await ada("PUT", "/api/clans/0QC8RCGY/social", {
    enabled: false,
  });
  assert.equal(off.status, 200);
  assert.equal(off.body.enabled, false);
  assert.equal(off.body.set_by_name, "Ada");
  const map = await ben("GET", "/api/clans/0QC8RCGY/map");
  assert.equal(map.status, 409);
  assert.equal(map.body.error, "social_off");
  assert.equal((await ada("GET", "/api/me")).body.social.enabled, false);
  // A person's own place is theirs whatever one clan decides.
  assert.equal(
    (await ben("PUT", "/api/me/place", { country: "CA", region: "08" })).status,
    200,
  );
});

test("a person in two clans sees each clan's own members on its map, never the other's", async () => {
  const h = harness();
  const OTHER = "#0QG0P8G";
  const alt = player({
    player_tag: "#0JQ0JQ8",
    name: "Ada alt",
    relationship: "alt",
    is_primary: false,
    clan_tag: OTHER,
    clan_role: "member",
  });
  const CY = player({
    player_tag: "#09UR",
    name: "Cy",
    clan_tag: OTHER,
    clan_role: "member",
  });
  // The default roster (what the tool answers when no clan is named) is
  // Ada's home clan; the other clan answers only when asked for by tag.
  h.record.state.rosters = {
    [OTHER]: {
      ...rosterOf(alt, CY),
      clan_tag: OTHER,
      name: "Other Clan",
    },
  };
  const ben = await as(h, BEN);
  await ben("PUT", "/api/me/place", { country: "CA", region: "08" });
  const cy = await as(h, CY);
  await cy("PUT", "/api/me/place", { country: "US", region: "TX" });

  h.record.state.players = [ADA, alt];
  const { sessionCookie } = await signIn(h);
  const ada = async (method, path, body) => {
    const r = await h.handler(
      req(method, path, {
        cookies: cookieHeader(sessionCookie),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: r.statusCode, body: JSON.parse(r.body) };
  };
  // Ada's home clan has its map switched off; the other clan's stays on.
  assert.equal(
    (await ada("PUT", "/api/clans/0QC8RCGY/social", { enabled: false })).status,
    200,
  );

  const map = await ada("GET", "/api/clans/0QG0P8G/map");
  assert.equal(map.status, 200, JSON.stringify(map.body));
  assert.equal(map.body.clan_tag, OTHER);
  assert.equal(map.body.members, 2);
  assert.deepEqual(
    map.body.entries.map((e) => e.player_tag),
    [CY.player_tag],
    "only the requested clan's members, with their places",
  );
  assert.equal(map.body.entries[0].place.region_name, "Texas");
  const asked = h.record.calls.filter((c) => c[0] === "clans_roster").at(-1);
  assert.equal(asked[1].clan_tag, OTHER, "the roster read names the clan");
  // The home clan's map stays off for everyone.
  assert.equal((await ada("GET", "/api/clans/0QC8RCGY/map")).status, 409);
});
