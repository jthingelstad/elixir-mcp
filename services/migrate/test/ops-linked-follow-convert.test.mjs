/**
 * {linked_follow_convert} (2026-11-15): follows made before linked
 * follows become them. The dry run writes nothing and only reads; the
 * apply links each pair through the live path; a second apply does
 * nothing; Claimed players link nothing; the answer is counts only.
 * Every tag is invented (docs/invented-tags.json).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  linkedFollowConvert,
  readSpec,
} from "../src/ops-linked-follow-convert.mjs";
import { classifyOp } from "../../../infra/scripts/lib/ops-invoke.mjs";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";

const V = "#0YRL2GQP"; // OWNER's primary, verified
const W = "#0UVC8J9R"; // OWNER's alt, verified
const C = "#0GUQ28PV"; // CLAIMER's, never verified
const MINE = "#0LCVJ8YR"; // READER's own

let scratch, db, OWNER, CLAIMER, READER;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const person = async (hash) =>
  (
    await db.query(
      "insert into account(email_hash,status) values ($1,'approved') returning account_id",
      [hash],
    )
  ).rows[0].account_id;
const claim = (account, tag, relationship, verified = false) =>
  db.query(
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
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;

before(async () => {
  scratch = await scratchDb("linked_convert");
  db = scratch.db;
  for (const tag of [V, W, C, MINE])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      `Name ${tag}`,
    ]);
  OWNER = await person("lc-owner");
  CLAIMER = await person("lc-claimer");
  READER = await person("lc-reader");
  await claim(OWNER, V, "primary", true);
  await claim(OWNER, W, "alt", true);
  await claim(CLAIMER, C, "primary");
  await claim(READER, MINE, "primary", true);
  // Follows made before linked follows: one Verified, one Claimed.
  await claim(READER, V, "friend");
  await claim(READER, C, "friend");
});

after(async () => {
  await scratch?.drop();
});

test("the request is checked; only the dry run is a read", () => {
  assert.deepEqual(readSpec({}), { apply: false });
  assert.deepEqual(readSpec(true), { apply: false });
  assert.deepEqual(readSpec({ apply: true }), { apply: true });
  assert.equal(readSpec({ apply: "yes" }).error, "apply must be true or false");
  assert.deepEqual(readSpec({ dry_run: true }), {
    error: "unknown_keys",
    keys: ["dry_run"],
  });
  assert.ok(readSpec([]).error);
  for (const v of [{}, true, { apply: false }])
    assert.equal(
      classifyOp("migrate", { linked_follow_convert: v }).kind,
      "read",
    );
  assert.equal(
    classifyOp("migrate", { linked_follow_convert: { apply: true } }).kind,
    "write",
  );
});

test("dry run, apply, then a second apply that does nothing", async () => {
  const dry = await linkedFollowConvert(db, { apply: false });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.pairs, 1, "the Claimed player links nothing");
  assert.equal(dry.readers, 1);
  assert.equal(dry.players_to_follow, 1, "W comes along");
  assert.equal(
    await count("select count(*)::int as n from account_follow"),
    0,
    "the dry run writes nothing",
  );
  assert.doesNotMatch(JSON.stringify(dry), UUID_RE);
  assert.doesNotMatch(JSON.stringify(dry), /#0/);

  const done = await linkedFollowConvert(db, { apply: true });
  assert.equal(done.accounts_followed, 1);
  assert.equal(done.players_followed, 1);
  assert.deepEqual(done.skipped, {});
  assert.equal(done.failed, 0);
  assert.doesNotMatch(JSON.stringify(done), UUID_RE);
  const friends = (
    await db.query(
      `select player_tag from claim where account_id = $1
          and relationship = 'friend' order by player_tag`,
      [READER],
    )
  ).rows.map((r) => r.player_tag);
  assert.deepEqual(friends, [C, V, W].sort());
  assert.equal(
    await count(
      `select count(*)::int as n from account_follow
        where account_id = $1 and followed_account_id = $2`,
      [READER, OWNER],
    ),
    1,
  );
  assert.equal(
    await count(
      `select count(*)::int as n from account_follow where followed_account_id = $1`,
      [CLAIMER],
    ),
    0,
  );

  const again = await linkedFollowConvert(db, { apply: true });
  assert.equal(again.pairs, 0);
  assert.equal(again.accounts_followed, 0);
});
