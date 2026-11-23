/**
 * Who "me" is, and how few calls it takes to find out (0.31.0).
 *
 * The behaviour these pin is a cost property as much as a correctness one:
 * every session used to spend a round trip — sometimes three — discovering
 * facts the server knew before the first message.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { resolveSubject, resolveEntitledClan } from "../src/entitlements.mjs";
import { describeIdentity, identitySentences } from "../src/identity.mjs";
import { createScratch, dropScratch } from "../../ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_identity_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = "#J2RGCRVG";
const ME = "#0G9L8QCVV";
const ALT = "#08Q80C99R";
const OTHER = "#20JJJ2CCRU";

let db;
let person;

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();

  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS')`,
    [CLAN],
  );
  for (const [tag, name] of [
    [ME, "Dove Sunny"],
    [ALT, "Rapid Clear"],
    [OTHER, "King Thing"],
  ]) {
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now(), $3)`,
      [CLAN, tag, tag === OTHER ? "leader" : "member"],
    );
  }
  const { rows } = await db.query(
    `insert into account (email_hash, status, role, kind)
     values ('identity-person', 'approved', 'leader', 'person') returning account_id`,
  );
  person = { accountId: rows[0].account_id, kind: "person" };

  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship)
     values ($1, $2, 'verified', true, 'primary'), ($1, $3, 'unverified', false, 'alt')`,
    [person.accountId, ME, ALT],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, is_primary)
     values ($1, $2, 'comprehensive', true)`,
    [person.accountId, CLAN],
  );
  // recording.requested_by is NOT NULL, so this needs an account and has to
  // come after one exists. It used to sit above, before any account, under a
  // `.catch(() => {})` — so it silently never ran, and the clan in this
  // fixture was never actually recorded. Nothing here depended on that until
  // now, which is exactly how a swallowed fixture write survives: it does not
  // fail, it just quietly changes what the tests are testing.
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, status, scope)
     values ('clan', $1, $2, 'active', 'comprehensive')`,
    [CLAN, person.accountId],
  );
});

after(async () => {
  await db.end();
  await dropScratch(NAME);
});

test("a person omitting the tag means themselves — no lookup, no argument", async () => {
  const s = await resolveSubject(db, person, undefined);
  assert.equal(s.tag, ME);
});

test("an explicit tag always wins over the caller's own player", async () => {
  const s = await resolveSubject(db, person, OTHER);
  assert.equal(
    s.tag,
    OTHER,
    "naming a player means that player, whoever asked",
  );
});

test("a person's block names them, their alt, and their clan", async () => {
  const text = identitySentences(await describeIdentity(db, person));
  assert.match(text, /YOU ARE Dove Sunny #0G9L8QCVV/);
  assert.match(text, /Also you, under another tag: Rapid Clear #08Q80C99R/);
  assert.match(text, /POAP KINGS #J2RGCRVG/);
});

test("#556: a person with players but no primary is told so, not that they have none", () => {
  const text = identitySentences({
    kind: "person",
    grouped: {
      primary: [],
      alt: [],
      friend: [{ player_tag: OTHER, name: "King Thing" }],
    },
  });
  assert.match(
    text,
    /You follow players but have no primary, so nothing here defaults to you/,
  );
  assert.doesNotMatch(text, /You have no player yet/);
  assert.match(
    identitySentences({ kind: "person", grouped: {} }),
    /You have no player yet/,
  );
});

test("a person's clan default comes from their claims", async () => {
  assert.equal(await resolveEntitledClan(db, person, undefined), CLAN);
});

test("an explicit clan tag wins", async () => {
  assert.equal(await resolveEntitledClan(db, person, CLAN), CLAN);
});

/**
 * "Your clan is X" must be the PRIMARY player's clan, and the default must
 * agree with the sentence.
 *
 * describeIdentity ordered account_clan by its own is_primary flag, and
 * resolveEntitlements ordered a person's clans not at all - so on an
 * account whose primary player is in one clan and whose alt is in another,
 * the opening instructions could name a clan that players_summary did not
 * report. Three of five testers flagged it and two changed behaviour: one
 * passed clan_tag on every call, one avoided clan tools entirely because
 * it could not tell what an omitted clan_tag meant (playtest round,
 * 2026-09-09).
 *
 * The alt's clan sorts FIRST alphabetically here, so the old ordering
 * would pick it.
 */
const PRIMARY_CLAN = "#0Q9C0YQ"; // sorts after
const ALT_CLAN = "#09URLL9"; // sorts before
const TWO_CLAN_PRIMARY = "#08QQP0J";
const TWO_CLAN_ALT = "#02QQVG8";

test("the clan named at initialize is the primary player's, and it is what an omitted clan_tag means", async () => {
  assert.ok(ALT_CLAN < PRIMARY_CLAN, "the fixture must reproduce the ordering");

  const { rows } = await db.query(
    `insert into account (email_hash, status, role, kind)
     values ('two-clan', 'approved', 'leader', 'person') returning account_id`,
  );
  const account = { accountId: rows[0].account_id, kind: "person" };

  // account_clan.is_primary is deliberately set on the ALT's clan: it is a
  // different fact from "which player is primary", and the old ordering
  // trusted it. Only one row per account may carry it.
  for (const [clan, name, acPrimary] of [
    [PRIMARY_CLAN, "PRIMARY CLAN", false],
    [ALT_CLAN, "ALT CLAN", true],
  ]) {
    await db.query(`insert into clan (clan_tag, name) values ($1, $2)`, [
      clan,
      name,
    ]);
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, status, scope)
       values ('clan', $1, $2, 'active', 'comprehensive')`,
      [clan, account.accountId],
    );
    await db.query(
      `insert into account_clan (account_id, clan_tag, scope, is_primary)
       values ($1, $2, 'comprehensive', $3)`,
      [account.accountId, clan, acPrimary],
    );
  }
  for (const [tag, clan, name] of [
    [TWO_CLAN_PRIMARY, PRIMARY_CLAN, "Me"],
    [TWO_CLAN_ALT, ALT_CLAN, "My Alt"],
  ]) {
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now(), 'member')`,
      [clan, tag],
    );
  }
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship)
     values ($1, $2, 'verified', true, 'primary'), ($1, $3, 'verified', false, 'alt')`,
    [account.accountId, TWO_CLAN_PRIMARY, TWO_CLAN_ALT],
  );

  // The sentence.
  const sentences = identitySentences(await describeIdentity(db, account));
  assert.match(
    sentences,
    new RegExp(`Your clan is PRIMARY CLAN ${PRIMARY_CLAN}`),
    `named the wrong clan: ${sentences}`,
  );
  // The other clan is real and must not be hidden - silence about it is
  // what made the mismatch unresolvable. It is a clan you TRACK, which is
  // not the same as being in it (2026-09-25).
  assert.match(sentences, new RegExp(`also follow ALT CLAN ${ALT_CLAN}`));

  // The default, which must not disagree with the sentence.
  assert.equal(
    await resolveEntitledClan(db, account, undefined),
    PRIMARY_CLAN,
    "an omitted clan_tag must mean the clan the instructions named",
  );
  // Naming the other one explicitly still works.
  assert.equal(await resolveEntitledClan(db, account, ALT_CLAN), ALT_CLAN);
});

test("3.18.0: when the primary player's clan is not recorded, an omitted clan_tag is refused as not_recorded, never an alt's clan", async () => {
  // The two-clan account above, with the primary's clan no longer
  // recorded: the old default slid to the alt's recorded clan (the reason
  // Clan pinned the tag on every call); now it says which clan is
  // missing and how to record it, and the alt's clan stays reachable by
  // name.
  const {
    rows: [acct],
  } = await db.query(
    `select account_id from account where email_hash = 'two-clan'`,
  );
  const account = { accountId: acct.account_id, kind: "person" };
  await db.query(
    `update recording set status = 'stopped' where subject_type = 'clan' and subject_tag = $1`,
    [PRIMARY_CLAN],
  );
  await assert.rejects(
    () => resolveEntitledClan(db, account, undefined),
    (e) =>
      e.code === "not_recorded" &&
      e.message.includes(PRIMARY_CLAN) &&
      e.hint.includes(`elixir_follow_clan({ clan_tag: "${PRIMARY_CLAN}" })`) &&
      e.hint.includes(ALT_CLAN),
  );
  assert.equal(await resolveEntitledClan(db, account, ALT_CLAN), ALT_CLAN);
  await db.query(
    `update recording set status = 'active' where subject_type = 'clan' and subject_tag = $1`,
    [PRIMARY_CLAN],
  );
  assert.equal(await resolveEntitledClan(db, account, undefined), PRIMARY_CLAN);
});
