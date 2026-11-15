/**
 * The player map and Near you (#768, Jamie 2026-11-14): who appears, and
 * how precisely. Pinned here on a scratch database: a place reaches either
 * only when its owner chose the player map (never a clan-only place, nor
 * one saved before the choice existed); only under a tag still verified by
 * an approved person, and only when written after that verification (a tag
 * that moved never carries its old owner's place); one player per person;
 * Near you is the reader's country and region, the reader's city first,
 * never the reader, their own players or anyone they follow or watch; a
 * reader with no place gets none; an agent reads nothing; and no answer
 * carries anything finer than the picked place: the pin is the lists' own
 * point for that city or region. Invented names and tags throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readNearYou, readPlayerMap } from "@elixir-mcp/auth/clan-context";
import { nearPeople, playerMap } from "../src/people.mjs";
import { diskGeo } from "@elixir-mcp/clan/geo.mjs";

const AUSTIN = 4671654;
const DALLAS = 4684888;
const HOUSTON = 4699066;
const TORONTO = 6167865;

// One account each, unless said otherwise.
const P = {
  reader: "#0VJLR2", // Austin, on the player map
  houston: "#0VJLR8", // Houston, on the player map
  dallas: "#0VJLR9", // Dallas, clan maps only (chose)
  old: "#0VJLRP", // Texas, saved before the choice: no key
  austin: "#0VJLRY", // Austin, on the player map
  toronto: "#0VJLRL", // Ontario, on the player map
  followed: "#0VJLRQ", // Texas, on the player map; the reader follows them
  moved: "#0VJLRG", // Texas, on; place written before today's verification
  dualMain: "#0VJLRC", // Texas, on; one person with an alt
  dualAlt: "#0VJLRU", // the same person's alt, also on
  disabled: "#0VJLRJ2", // Texas, on; the account is disabled
  unverified: "#0VJLRJ8", // Texas, on; the claim is not verified
};

let scratch;
const acct = {};

async function account(
  key,
  status = "approved",
  kind = "person",
  owner = null,
) {
  const { rows } = await scratch.db.query(
    `insert into account(email_hash, kind, status, role, owned_by_account_id)
     values ($1, $2, $3, 'member', $4) returning account_id`,
    [`player-map-${key}`, kind, status, owner],
  );
  acct[key] = rows[0].account_id;
  return rows[0].account_id;
}

async function claim(accountId, tag, extra = {}) {
  await scratch.db.query(
    `insert into claim(account_id, player_tag, status, is_primary, relationship, verified_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      accountId,
      tag,
      extra.status ?? "verified",
      extra.is_primary ?? true,
      extra.relationship ?? "primary",
      extra.verified_at ?? "2026-11-01T00:00:00Z",
    ],
  );
}

async function place(
  tag,
  codes,
  playerMapChoice,
  setAt = "2026-11-05T00:00:00.000Z",
) {
  const pk = `place#${tag}`;
  await scratch.db.query(`insert into clan_state(pk, body) values ($1, $2)`, [
    pk,
    {
      pk,
      player_tag: tag,
      country: codes.country,
      region: codes.region ?? null,
      city: codes.city ?? null,
      set_at: setAt,
      ...(playerMapChoice === undefined ? {} : { player_map: playerMapChoice }),
    },
  ]);
}

before(async () => {
  scratch = await scratchDb("player_map");
  const db = scratch.db;
  for (const [key, tag] of Object.entries(P))
    await db.query(`insert into player(player_tag, name) values ($1, $2)`, [
      tag,
      `Invented ${key}`,
    ]);
  const TX = { country: "US", region: "TX" };
  for (const key of [
    "reader",
    "houston",
    "dallas",
    "old",
    "austin",
    "toronto",
    "followed",
    "moved",
  ]) {
    const id = await account(key);
    await claim(
      id,
      P[key],
      key === "moved" ? { verified_at: "2026-11-10T00:00:00Z" } : {},
    );
  }
  await place(P.reader, { ...TX, city: AUSTIN }, true);
  await place(P.houston, { ...TX, city: HOUSTON }, true);
  await place(P.dallas, { ...TX, city: DALLAS }, false);
  await place(P.old, TX, undefined);
  await place(P.austin, { ...TX, city: AUSTIN }, true);
  await place(P.toronto, { country: "CA", region: "08", city: TORONTO }, true);
  await place(P.followed, TX, true);
  await place(P.moved, TX, true);
  // The reader follows one of them.
  await claim(acct.reader, P.followed, {
    status: "unverified",
    is_primary: false,
    relationship: "friend",
    verified_at: null,
  });
  // One person, two players, both on.
  const dual = await account("dual");
  await claim(dual, P.dualMain);
  await claim(dual, P.dualAlt, { is_primary: false, relationship: "alt" });
  await place(P.dualMain, TX, true);
  await place(P.dualAlt, TX, true);
  // A disabled account and an unverified claim, both "on".
  await claim(await account("disabled", "disabled"), P.disabled);
  await place(P.disabled, TX, true);
  await claim(await account("unverified"), P.unverified, {
    status: "unverified",
  });
  await place(P.unverified, TX, true);
  // A reader with no place, and an agent.
  await account("noplace");
  await account("agent", "approved", "agent", acct.reader);
});
after(async () => scratch?.drop());

const tags = (rows) => rows.map((r) => r.player_tag ?? r.tag);

test("the player map is everyone who chose it, one player a person, and nobody else", async () => {
  const got = await readPlayerMap(scratch.db, {
    accountId: acct.reader,
    kind: "person",
  });
  assert.deepEqual(
    tags(got.entries).sort(),
    [P.reader, P.houston, P.austin, P.toronto, P.followed, P.dualMain].sort(),
  );
  assert.equal(got.entries.find((e) => e.you).player_tag, P.reader);
  assert.equal(got.truncated, false);
  // Left out: a clan-only place, one saved before the choice, a place that
  // predates its tag's verification, an alt beside its main, a disabled
  // account and an unverified claim.
  for (const key of [
    "dallas",
    "old",
    "moved",
    "dualAlt",
    "disabled",
    "unverified",
  ])
    assert.ok(!tags(got.entries).includes(P[key]), key);
});

test("a reader with no place still sees the player map; an agent reads nothing", async () => {
  const noplace = await playerMap(scratch.db, acct.noplace);
  assert.equal(noplace.on_map, 6);
  assert.ok(noplace.entries.every((e) => e.you === false));
  assert.deepEqual(
    await readPlayerMap(scratch.db, { accountId: acct.agent, kind: "agent" }),
    { refused: "not_a_person" },
  );
  // An agent account named as a person reads no row either.
  const posing = await readPlayerMap(scratch.db, {
    accountId: acct.agent,
    kind: "person",
  });
  assert.deepEqual(posing.entries, []);
  const near = await readNearYou(scratch.db, {
    accountId: acct.agent,
    kind: "person",
  });
  assert.equal(near.place, null);
});

test("Near you is the reader's region, their city first, never the reader or who they follow", async () => {
  const got = await nearPeople(scratch.db, acct.reader);
  // Austin first (the reader's city), then the rest by name.
  assert.deepEqual(tags(got.people), [P.austin, P.dualMain, P.houston]);
  assert.equal(got.place.name, "Austin");
  assert.equal(got.place.region_name, "Texas");
  assert.equal(got.place.on_map, true);
  const why = Object.fromEntries(got.people.map((p) => [p.tag, p.why]));
  assert.deepEqual(why[P.austin], [{ kind: "near", place_name: "Austin" }]);
  assert.deepEqual(why[P.houston], [{ kind: "near", place_name: "Houston" }]);
  // A region-only place is named by its region, never guessed finer.
  assert.deepEqual(why[P.dualMain], [{ kind: "near", place_name: "Texas" }]);
  // Never ranked by anything but the place and the name; priced to follow.
  for (const p of got.people) {
    assert.equal(typeof p.free, "boolean");
    assert.deepEqual(
      Object.keys(p).sort(),
      ["free", "name", "reason", "tag", "why"].sort(),
    );
  }
  // Ontario is not Texas; the followed player is not suggested.
  assert.ok(!tags(got.people).includes(P.toronto));
  assert.ok(!tags(got.people).includes(P.followed));
});

test("a clan-only reader sees Near you, and is told they are not on the player map", async () => {
  const got = await nearPeople(scratch.db, acct.dallas);
  assert.equal(got.place.on_map, false);
  assert.equal(got.place.name, "Dallas");
  // Nobody in Dallas, so by name; the reader's own row never appears.
  assert.deepEqual(tags(got.people), [
    P.austin,
    P.dualMain,
    P.followed,
    P.houston,
    P.reader,
  ]);
  assert.ok(!tags(got.people).includes(P.dallas));
});

test("a reader with no place gets no Near you", async () => {
  assert.deepEqual(await nearPeople(scratch.db, acct.noplace), {
    place: null,
    people: [],
  });
});

test("a country with no regions is one region", async () => {
  const a = await account("aruba-a");
  const b = await account("aruba-b");
  await scratch.db.query(
    `insert into player(player_tag, name) values ('#0VJLRJ29', 'Invented A'), ('#0VJLRJ2P', 'Invented B')`,
  );
  await claim(a, "#0VJLRJ29");
  await claim(b, "#0VJLRJ2P");
  await place("#0VJLRJ29", { country: "AW" }, true);
  await place("#0VJLRJ2P", { country: "AW", city: 11972427 }, true);
  const got = await nearPeople(scratch.db, a);
  assert.deepEqual(tags(got.people), ["#0VJLRJ2P"]);
  assert.equal(got.place.region_name, "Aruba");
});

test("no answer carries anything finer than the picked place", async () => {
  const geo = diskGeo();
  const map = await playerMap(scratch.db, acct.reader);
  for (const e of map.entries) {
    assert.deepEqual(Object.keys(e).sort(), [
      "name",
      "place",
      "player_tag",
      "you",
    ]);
    // The pin is exactly the lists' point for the picked city or region:
    // what the clan map draws, never a coordinate of its own.
    const expected = await geo.resolve({
      country: e.place.country,
      region: e.place.region,
      city: e.place.city,
    });
    assert.deepEqual(e.place, expected);
  }
  const austin = map.entries.find((e) => e.player_tag === P.austin);
  assert.equal(austin.place.precision, "city");
  assert.deepEqual([austin.place.lat, austin.place.lng], [30.27, -97.74]);
  const texas = map.entries.find((e) => e.player_tag === P.dualMain);
  assert.equal(texas.place.precision, "region");
  assert.equal(texas.place.city, null);
  assert.match(map.attribution, /OpenStreetMap/);
  // Near you carries a place's name, not its point.
  const near = await nearPeople(scratch.db, acct.reader);
  assert.ok(!JSON.stringify(near).includes("lat"));
  assert.deepEqual(Object.keys(near.place).sort(), [
    "name",
    "on_map",
    "region_name",
  ]);
});

test("each read is one statement", async () => {
  const sent = [];
  const counting = {
    query: (text, values) => {
      sent.push(text);
      return scratch.db.query(text, values);
    },
  };
  await readPlayerMap(counting, { accountId: acct.reader, kind: "person" });
  await readNearYou(counting, { accountId: acct.reader, kind: "person" });
  assert.equal(sent.length, 2);
  for (const text of sent) assert.ok(!/player_tag\s*=\s*any\s*\(/i.test(text));
});
