/**
 * A place belongs to the claim that wrote it (2026-11-14). A person's
 * place is stored under each of their verified tags; when a tag's
 * verified claim moves to another account (the owner removes the player,
 * and someone else adds and verifies it), the row stays behind. Pinned here on a scratch
 * database, through Clan's own social service over the real ledger and
 * Elixir's readers, with the real claim move (`removePlayer`, then
 * `markVerified`): the new
 * owner's Your place and picker are empty, the clan map shows nothing for
 * the tag, the player map and Near you show nothing; the new owner's own
 * place shows as theirs and never reaches the former owner; a former
 * owner who verifies the tag again gets back only a place they wrote; a
 * row saved before the owner stamp follows the claim's verification time.
 * Invented names and tags throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  readNearYou,
  readOwnedPlaces,
  readPlayerMap,
} from "@elixir-mcp/auth/clan-context";
import { markVerified, removePlayer } from "@elixir-mcp/claims";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { createSocialService } from "@elixir-mcp/clan/manage/social.mjs";
import { diskGeo } from "@elixir-mcp/clan/geo.mjs";

const AUSTIN = 4671654;
const HOUSTON = 4699066;
const TORONTO = 6167865;
const CLAN = "#0QPLGR";

const T = {
  moved: "#0QPLG2", // A's alt, removed by A and verified by B
  kept: "#0QPLG8", // A's primary, never moves
  reader: "#0QPLG9", // someone else in Texas, on the player map
  legacy: "#0QPLGY", // a place saved before the owner stamp
};

let scratch;
const acct = {};
const geo = diskGeo();

async function account(key) {
  const { rows } = await scratch.db.query(
    `insert into account(email_hash, kind, status, role)
     values ($1, 'person', 'approved', 'member') returning account_id`,
    [`place-owner-${key}`],
  );
  acct[key] = rows[0].account_id;
}

async function claim(key, tag, { primary = true, verifiedAt } = {}) {
  await scratch.db.query(
    `insert into claim(account_id, player_tag, status, is_primary, relationship, verified_at)
     values ($1, $2, 'verified', $3, $4, coalesce($5::timestamptz, now()))`,
    [acct[key], tag, primary, primary ? "primary" : "alt", verifiedAt ?? null],
  );
}

/** The real move: `from` removes the player (Settings › Players), then
 *  `to` adds it and verifies it (Verify's poll, in its transaction). */
async function move(from, to, tag) {
  const out = await removePlayer(
    scratch.db,
    { accountId: acct[from] },
    { tag, via: "test" },
  );
  assert.equal(out.removed, true, JSON.stringify(out));
  await verifyAs(to, tag);
}

async function verifyAs(key, tag) {
  const db = scratch.db;
  await db.query("begin");
  try {
    await db.query(
      `insert into claim(account_id, player_tag, status, is_primary, relationship)
       values ($1, $2, 'unverified', false, 'alt')
       on conflict do nothing`,
      [acct[key], tag],
    );
    const r = await markVerified(db, {
      accountId: acct[key],
      tag,
      method: "test",
      via: "test",
    });
    assert.equal(r.verified, true);
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

/** A person's verified own tags, as Clan's gate passes them. */
async function tagsOf(key) {
  const { rows } = await scratch.db.query(
    `select player_tag from claim
      where account_id = $1 and status = 'verified'
        and (is_primary or relationship in ('primary', 'alt'))
      order by player_tag`,
    [acct[key]],
  );
  return rows.map((r) => r.player_tag);
}

/** Clan's social service as the web API wires it for `key`. */
function socialFor(key) {
  return createSocialService({
    ledger: createPostgresLedger(scratch.db),
    geo,
    ownedPlaces: (tags) => readOwnedPlaces(scratch.db, tags),
    accountId: acct[key],
  });
}

const person = async (key) => ({ tags: await tagsOf(key) });
const roster = Object.values(T).map((tag, i) => ({
  player_tag: tag,
  name: `Invented ${i}`,
  role: "member",
}));
const mapTags = async (key) =>
  (await socialFor(key).map(CLAN, roster, await person(key))).entries.map(
    (e) => e.player_tag,
  );
const playerMapTags = async (key) =>
  (
    await readPlayerMap(scratch.db, { accountId: acct[key], kind: "person" })
  ).entries.map((e) => e.player_tag);
const near = (key) =>
  readNearYou(scratch.db, { accountId: acct[key], kind: "person" });

before(async () => {
  scratch = await scratchDb("place_owner");
  for (const [i, tag] of Object.values(T).entries())
    await scratch.db.query(
      `insert into player(player_tag, name) values ($1, $2)`,
      [tag, `Invented ${i}`],
    );
  for (const key of ["a", "b", "reader", "c", "d"]) await account(key);
  await claim("a", T.kept, { verifiedAt: "2026-11-01T00:00:00Z" });
  await claim("a", T.moved, {
    primary: false,
    verifiedAt: "2026-11-01T00:00:00Z",
  });
  await claim("reader", T.reader, { verifiedAt: "2026-11-01T00:00:00Z" });
  await claim("c", T.legacy, { verifiedAt: "2026-11-01T00:00:00Z" });
  // A saves Austin, on the player map: written under both of A's tags.
  await socialFor("a").setMyPlace(await person("a"), {
    country: "US",
    region: "TX",
    city: AUSTIN,
    player_map: true,
  });
  await socialFor("reader").setMyPlace(await person("reader"), {
    country: "US",
    region: "TX",
    city: HOUSTON,
    player_map: true,
  });
  // C's place was saved before the owner stamp existed: no account_id.
  const pk = `place#${T.legacy}`;
  await scratch.db.query(`insert into clan_state(pk, body) values ($1, $2)`, [
    pk,
    {
      pk,
      player_tag: T.legacy,
      country: "US",
      region: "TX",
      city: AUSTIN,
      set_at: "2026-11-05T00:00:00.000Z",
      player_map: true,
    },
  ]);
});
after(async () => scratch?.drop());

test("before any move, every reader shows each place under its owner", async () => {
  assert.equal((await socialFor("a").myPlace(await person("a"))).city, AUSTIN);
  assert.deepEqual(
    (await mapTags("reader")).sort(),
    [T.moved, T.kept, T.reader, T.legacy].sort(),
  );
  // One player a person: A by their primary; C's older place too.
  assert.deepEqual(
    (await playerMapTags("reader")).sort(),
    [T.kept, T.reader, T.legacy].sort(),
  );
  // The stamp never leaves the seam.
  const [row] = await readOwnedPlaces(scratch.db, [T.moved]);
  assert.equal(row.account_id, undefined);
  assert.equal(row.pk, undefined);
});

test("a tag that moves to B carries none of A's place, anywhere", async () => {
  await move("a", "b", T.moved);
  await move("c", "d", T.legacy);
  assert.deepEqual(await tagsOf("b"), [T.moved]);
  // B's Your place and the picker's starting point: empty.
  assert.equal(await socialFor("b").myPlace(await person("b")), null);
  assert.deepEqual(await readOwnedPlaces(scratch.db, [T.moved]), []);
  // B's Near you: no place of B's, so nobody near "B's" place.
  assert.deepEqual(await near("b"), {
    place: null,
    people: [],
    truncated: false,
  });
  // The clan map, read by anyone: nothing under either moved tag, and A's
  // place still under the primary A keeps.
  for (const reader of ["reader", "b", "a"]) {
    const tags = await mapTags(reader);
    assert.ok(!tags.includes(T.moved), reader);
    assert.ok(!tags.includes(T.legacy), reader);
    assert.ok(tags.includes(T.kept), reader);
  }
  // The player map: A by their primary, never B by the moved tag; the
  // legacy row (saved before D verified) is nobody's.
  assert.deepEqual(
    (await playerMapTags("reader")).sort(),
    [T.kept, T.reader].sort(),
  );
  // Near you for someone in Texas: A, never the moved tags.
  const people = (await near("reader")).people.map((p) => p.player_tag);
  assert.deepEqual(people, [T.kept]);
  // A still sees their own place, through the tag they kept.
  const mine = await socialFor("a").myPlace(await person("a"));
  assert.equal(mine.city, AUSTIN);
});

test("B's own place shows as B's, and never reaches A", async () => {
  // The picker's save with no choice: clan maps only, never A's yes.
  const saved = await socialFor("b").setMyPlace(await person("b"), {
    country: "CA",
    region: "08",
    city: TORONTO,
  });
  assert.equal(saved.player_map, null);
  const mine = await socialFor("b").myPlace(await person("b"));
  assert.equal(mine.city, TORONTO);
  assert.equal(mine.player_map, null);
  const entry = (
    await socialFor("reader").map(CLAN, roster, await person("reader"))
  ).entries.find((e) => e.player_tag === T.moved);
  assert.equal(entry.place.city, TORONTO);
  // Clan maps only: not on the player map until B says yes.
  assert.ok(!(await playerMapTags("reader")).includes(T.moved));
  await socialFor("b").setPlayerMap(await person("b"), { player_map: true });
  assert.ok((await playerMapTags("reader")).includes(T.moved));
  // A never sees B's place as their own.
  const a = await socialFor("a").myPlace(await person("a"));
  assert.equal(a.city, AUSTIN);
  assert.equal((await near("a")).place.city, AUSTIN);
});

test("A verifying the tag again gets back only a place A wrote", async () => {
  // The row under the tag is B's now: A gets nothing from it.
  await move("b", "a", T.moved);
  assert.deepEqual(await tagsOf("b"), []);
  assert.deepEqual(await readOwnedPlaces(scratch.db, [T.moved]), []);
  assert.equal(
    (await socialFor("a").myPlace({ tags: [T.moved] })) ?? null,
    null,
  );
  // A's own place (under the primary) is still A's.
  assert.equal((await socialFor("a").myPlace(await person("a"))).city, AUSTIN);
  // A tag whose row A wrote, verified by someone else meanwhile who saved
  // nothing, comes back with it: it was A's own.
  await scratch.db.query(`delete from clan_state where pk = $1`, [
    `place#${T.moved}`,
  ]);
  await socialFor("a").setMyPlace(await person("a"), {
    country: "US",
    region: "TX",
    city: AUSTIN,
    player_map: true,
  });
  await move("a", "b", T.moved);
  assert.deepEqual(await readOwnedPlaces(scratch.db, [T.moved]), []);
  await move("b", "a", T.moved);
  const [back] = await readOwnedPlaces(scratch.db, [T.moved]);
  assert.equal(back.city, AUSTIN);
});

test("a row saved before the stamp counts only for a claim verified before it", async () => {
  // D verified the legacy tag after its row was saved: not D's.
  assert.deepEqual(await readOwnedPlaces(scratch.db, [T.legacy]), []);
  // Saved again after D's verification, unstamped (an older page's row):
  // D's.
  await scratch.db.query(
    `update clan_state
        set body = jsonb_set(body, '{set_at}', to_jsonb(now()::text))
      where pk = $1`,
    [`place#${T.legacy}`],
  );
  const [row] = await readOwnedPlaces(scratch.db, [T.legacy]);
  assert.equal(row.city, AUSTIN);
});

test("the owned-places read is one statement, by key", async () => {
  const sent = [];
  const counting = {
    query: (text, values) => {
      sent.push(text);
      return scratch.db.query(text, values);
    },
  };
  const got = await readOwnedPlaces(counting, [
    T.kept,
    T.reader,
    "#0QPLG2",
    T.kept,
  ]);
  assert.equal(sent.length, 1);
  assert.ok(!/player_tag\s*=\s*any\s*\(/i.test(sent[0]));
  // In the tags' order, as the ledger's getMany answered.
  assert.deepEqual(
    got.map((r) => r.player_tag),
    [T.kept, T.reader, T.moved, T.kept],
  );
  assert.deepEqual(await readOwnedPlaces(counting, []), []);
  assert.equal(sent.length, 1);
});
