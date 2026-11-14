/**
 * A verified player's page carries its owner's passport in one row
 * (#1015), against a real PostgreSQL database. Pinned here: only the
 * canonical verified owner's passport, so a verified main and a verified
 * alt give the same one; an unverified claim, a player nobody claimed and
 * an owner with no passport yet give none; reading it writes nothing; and
 * the row carries only { id, count, marks: [{ stamp_id, level }] }, none
 * of what the public passport may never carry. Invented names and tags.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { summarize } from "@elixir-mcp/stamps/summary";
import { makeHandler } from "../src/handler.mjs";
import { PASSPORT_LEAKS } from "./passport-privacy.mjs";

// Made-up tags: this repository is public.
const MAIN = "#0JR2U89V"; // the owner's verified main
const ALT = "#0PYP8RQ2"; // the owner's verified alt
const CLAIMED = "#0YLPUQU8"; // claimed, never verified
const BARE = "#0UCCGLUQ"; // verified by an owner with no passport yet
const NOBODY = "#0RPYVQ9R"; // nobody's
const PASSPORT = "abcdefghjkmn";
const CLAIMED_PASSPORT = "pqrstuvwxyz2";
const NICK = "Pet Name Nobody Else Sees";
const DISCORD = "secret_discord_handle";

let scratch, handler, OWNER, CLAIMANT, BAREOWNER, READER;
const sessions = new Map();
const data = (r) => JSON.parse(r.body);

async function person(hash, timezone = null) {
  const id = (
    await scratch.db.query(
      "insert into account(email_hash,status,timezone) values ($1,'approved',$2) returning account_id",
      [hash, timezone],
    )
  ).rows[0].account_id;
  const { token } = await createSession(scratch.db, {
    secret: "test",
    accountId: id,
    emailHash: hash,
  });
  sessions.set(id, token);
  return id;
}
const read = (id, tag) =>
  handler({
    path: "/api/player",
    method: "GET",
    queryStringParameters: { tag },
    headers: {
      cookie: `__Host-elixir_session=${sessions.get(id)}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
  });
const claim = (account, tag, relationship, verified) =>
  scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      account,
      tag,
      verified ? "verified" : "unverified",
      relationship === "primary",
      relationship,
      verified ? new Date() : null,
    ],
  );
const earn = (account, stamp, level, day) =>
  scratch.db.query(
    `insert into account_stamp_earned
       (account_id,stamp_id,level,earned_at,earned_on,definition_version)
     values ($1,$2,$3,$4::date,$4::date,1)`,
    [account, stamp, level, day],
  );
const passportRows = async () =>
  (await scratch.db.query("select count(*)::int as n from account_passport"))
    .rows[0].n;

before(async () => {
  scratch = await scratchDb("player_passport");
  const { db } = scratch;
  for (const [tag, name] of [
    [MAIN, "Alder"],
    [ALT, "Birch"],
    [CLAIMED, "Dogwood"],
    [BARE, "Elm"],
    [NOBODY, "Umber"],
  ])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  OWNER = await person("passport-owner", "America/Chicago");
  CLAIMANT = await person("passport-claimant", "America/Chicago");
  BAREOWNER = await person("passport-bare");
  READER = await person("passport-reader");
  await claim(OWNER, MAIN, "primary", true);
  await claim(OWNER, ALT, "alt", true);
  await claim(CLAIMANT, CLAIMED, "primary", false);
  await claim(BAREOWNER, BARE, "primary", true);
  await db.query(
    "insert into account_discord(account_id,discord_user_id,username) values ($1,'123456789012345678',$2)",
    [OWNER, DISCORD],
  );
  await db.query(
    "insert into player_nickname(account_id,player_tag,nickname) values ($1,$2,$3)",
    [OWNER, MAIN, NICK],
  );
  await db.query(
    "insert into account_passport(account_id,passport_id) values ($1,$2), ($3,$4)",
    [OWNER, PASSPORT, CLAIMANT, CLAIMED_PASSPORT],
  );
  await earn(OWNER, "player_verified", 1, "2026-11-01");
  await earn(OWNER, "cheerleader", 1, "2026-11-05");
  await earn(OWNER, "cheerleader", 2, "2026-11-10");
  // A legacy grant: known only to precede a day.
  await db.query(
    `insert into account_stamp_earned
       (account_id,stamp_id,level,earned_at,definition_version,legacy_before,legacy_source_to)
     values ($1,'looking_good',1,'2026-10-01',1,'2026-10-01','2026-10-01')`,
    [OWNER],
  );
  await earn(CLAIMANT, "storyteller", 1, "2026-11-02");
});

after(async () => scratch?.drop());

const OWNERS_ROW = {
  id: PASSPORT,
  count: 3,
  marks: [
    { stamp_id: "cheerleader", level: 2 },
    { stamp_id: "player_verified", level: 1 },
  ],
};

test("a verified main's page carries its owner's passport in one row", async () => {
  const r = await read(READER, MAIN);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(data(r).passport, OWNERS_ROW);
});

test("a verified alt opens the same passport as the main", async () => {
  const r = await read(READER, ALT);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(data(r).passport, OWNERS_ROW);
  const own = await read(OWNER, ALT);
  assert.deepEqual(data(own).passport, OWNERS_ROW, "the same for its owner");
});

test("an unverified claim, a player nobody claimed and an owner with no passport show none, and nothing is written", async () => {
  const before = await passportRows();
  for (const tag of [CLAIMED, NOBODY, BARE]) {
    const r = await read(READER, tag);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(data(r).passport, null, tag);
  }
  // The bare owner reading their own page does not make one either.
  assert.equal(data(await read(BAREOWNER, BARE)).passport, null);
  assert.equal(await passportRows(), before);
});

test("the row carries its three fields and none of the passport's private parts", async () => {
  const row = data(await read(READER, MAIN)).passport;
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        keys.add(k);
        walk(x);
      }
  };
  walk(row);
  assert.deepEqual([...keys].sort(), [
    "count",
    "id",
    "level",
    "marks",
    "stamp_id",
  ]);
  const text = JSON.stringify(row);
  for (const leak of [...PASSPORT_LEAKS, OWNER, DISCORD, NICK, "earned_on"])
    assert.ok(!text.includes(leak), `leaked ${leak}`);
});

test("summarize: the count, and the two most recent marks, a legacy grant by its day", () => {
  assert.deepEqual(
    summarize({
      id: PASSPORT,
      earned: [
        {
          stamp_id: "looking_good",
          level: 1,
          earned_on: null,
          earned_before: "2026-11-20",
        },
        {
          stamp_id: "linked",
          level: 1,
          earned_on: "2026-11-01",
          earned_before: null,
        },
        {
          stamp_id: "mutual",
          level: 1,
          earned_on: "2026-11-12",
          earned_before: null,
        },
      ],
    }),
    {
      id: PASSPORT,
      count: 3,
      marks: [
        { stamp_id: "looking_good", level: 1 },
        { stamp_id: "mutual", level: 1 },
      ],
    },
  );
  assert.deepEqual(summarize({ id: PASSPORT, earned: [] }), {
    id: PASSPORT,
    count: 0,
    marks: [],
  });
});
