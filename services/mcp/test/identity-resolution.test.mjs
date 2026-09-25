/**
 * Who "me" is, and how few calls it takes to find out (0.31.0).
 *
 * The behaviour these pin is a cost property as much as a correctness one:
 * every session used to spend a round trip — sometimes three — discovering
 * facts the server knew before the first message. An agent serving a whole
 * Discord has the harder version, because "me" is a different person each time.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { resolveSubject, resolveEntitledClan } from "../src/entitlements.mjs";
import { describeIdentity, identitySentences } from "../src/identity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_identity_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = "#J2RGCRVG";
const ME = "#UL2V9QRG0";
const ALT = "#U8RYG9Y2U";
const OTHER = "#20JJJ2CCRU";

let db;
let person;
let agent;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();

  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS')`,
    [CLAN],
  );
  for (const [tag, name] of [
    [ME, "raquaza"],
    [ALT, "King Levy"],
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
  const mk = async (email, kind, owner = null) => {
    const { rows } = await db.query(
      `insert into account (email_hash, status, role, kind, owned_by_account_id, public_id)
       values ($1, 'approved', 'leader', $2, $3, $4) returning account_id`,
      [
        kind === "person" ? email : null,
        kind,
        owner,
        kind === "person" ? null : `pub${Date.now() % 1e8}`,
      ],
    );
    return { accountId: rows[0].account_id, kind };
  };
  person = await mk("identity-person", "person");
  agent = await mk(null, "agent", person.accountId);

  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship)
     values ($1, $2, 'verified', true, 'primary'), ($1, $3, 'unverified', false, 'alt')`,
    [person.accountId, ME, ALT],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, is_primary)
     values ($1, $2, 'comprehensive', true), ($3, $2, 'comprehensive', true)`,
    [person.accountId, CLAN, agent.accountId],
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
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("a person omitting the tag means themselves — no lookup, no argument", async () => {
  const s = await resolveSubject(db, person, undefined);
  assert.equal(s.tag, ME);
});

test("an agent omitting the tag is told what would fix it, not guessed at", async () => {
  // Guessing a clan member here would be confidently wrong every time.
  await assert.rejects(
    () => resolveSubject(db, agent, undefined),
    (e) => e.code === "no_subject" && /elixir_identify/.test(e.hint),
  );
});

test("3.18.0: an unmapped on_behalf_of with a display_name carries the whole-name candidates; a partial name carries none", async () => {
  // Exactly one member's whole name matches, case and spacing ignored:
  // the refusal names them and the hint is the one identify call.
  await assert.rejects(
    () =>
      resolveSubject(db, agent, undefined, "full", {
        onBehalfOf: "discord:77",
        displayName: "king levy",
      }),
    (e) =>
      e.code === "no_subject" &&
      e.data.candidates.length === 1 &&
      e.data.candidates[0].player_tag === ALT &&
      e.data.candidates[0].name === "King Levy" &&
      e.data.candidates[0].clan_tag === CLAN &&
      /elixir_identify\(\{ external_id: "discord:77", player_tag: "#/.test(
        e.hint,
      ),
  );
  // "King" alone is half of two names: nothing is a candidate, and the
  // hint says to ask.
  await assert.rejects(
    () =>
      resolveSubject(db, agent, undefined, "full", {
        onBehalfOf: "discord:77",
        displayName: "King",
      }),
    (e) =>
      e.code === "no_subject" &&
      e.data.candidates.length === 0 &&
      /No clan member's whole name is 'King'/.test(e.hint),
  );
  // No display name: the refusal still says what to pass next time.
  await assert.rejects(
    () =>
      resolveSubject(db, agent, undefined, "full", {
        onBehalfOf: "discord:77",
      }),
    (e) =>
      e.code === "no_subject" &&
      e.data.candidates.length === 0 &&
      /display_name/.test(e.hint),
  );
});

test("on_behalf_of resolves once the agent has been told who someone is", async () => {
  await assert.rejects(
    () =>
      resolveSubject(db, agent, undefined, "full", { onBehalfOf: "discord:1" }),
    (e) => /No player is mapped to discord:1/.test(e.message),
  );

  await db.query(
    `insert into agent_identity (account_id, external_id, player_tag) values ($1, 'discord:1', $2)`,
    [agent.accountId, ME],
  );
  const s = await resolveSubject(db, agent, undefined, "full", {
    onBehalfOf: "discord:1",
  });
  assert.equal(s.tag, ME);
});

test("an explicit tag always wins over who is asking", async () => {
  const s = await resolveSubject(db, agent, OTHER, "full", {
    onBehalfOf: "discord:1",
  });
  assert.equal(
    s.tag,
    OTHER,
    "naming a player means that player, whoever asked",
  );
});

test("one agent's mappings are invisible to another", async () => {
  const { rows } = await db.query(
    `insert into account (email_hash, status, role, kind, owned_by_account_id, public_id)
     values (null, 'approved', 'leader', 'agent', $1, 'pubother123') returning account_id`,
    [person.accountId],
  );
  const other = { accountId: rows[0].account_id, kind: "agent" };
  await assert.rejects(
    () =>
      resolveSubject(db, other, undefined, "full", { onBehalfOf: "discord:1" }),
    (e) => e.code === "no_subject",
  );
});

test("the id is opaque: any surface's namespace works", async () => {
  for (const id of [
    "signal:+15551234",
    "telegram:998877",
    "web-session-abc",
    "🙂",
  ]) {
    await db.query(
      `insert into agent_identity (account_id, external_id, player_tag) values ($1, $2, $3)
       on conflict (account_id, external_id) do update set player_tag = excluded.player_tag`,
      [agent.accountId, id, ALT],
    );
    const s = await resolveSubject(db, agent, undefined, "full", {
      onBehalfOf: id,
    });
    assert.equal(s.tag, ALT, id);
  }
});

test("a person's block names them, their alt, and their clan", async () => {
  const text = identitySentences(await describeIdentity(db, person));
  assert.match(text, /YOU ARE raquaza #UL2V9QRG0/);
  assert.match(text, /Also you, under another tag: King Levy #U8RYG9Y2U/);
  assert.match(text, /POAP KINGS #J2RGCRVG/);
});

test("an agent's block names its clan and its leadership, not its roster", async () => {
  const text = identitySentences(await describeIdentity(db, agent));
  assert.match(text, /YOU ACT FOR POAP KINGS #J2RGCRVG \(3 members\)/);
  assert.match(text, /King Thing \(leader\)/);
  assert.ok(!text.includes(ALT), "members are not enumerated here");
  assert.match(text, /You already know \d+ of them/);
});

/**
 * The clan half of "me".
 *
 * resolveSubject answers WHO; these answer WHICH CLAN, and the two used to
 * disagree with each other and with initialize. Observed in production on
 * 2026-09-08: a connection whose principal block reported
 * `agent acting for clan POAP KINGS #J2RGCRVG, 48 members` got
 * `not_entitled: No recorded clan membership on this account` from
 * `clans_roster {}` seconds later, because clan defaults were derived from
 * claims and an agent has none. Found by elixir-mcp-discord, whose prompts had
 * been passing an explicit tag and so had hidden it since agents shipped.
 */
test("an agent omitting clan_tag means the clan it acts for", async () => {
  assert.equal(await resolveEntitledClan(db, agent, undefined), CLAN);
});

test("a person's clan default still comes from their claims", async () => {
  assert.equal(await resolveEntitledClan(db, person, undefined), CLAN);
});

test("an explicit tag still wins for an agent", async () => {
  assert.equal(await resolveEntitledClan(db, agent, CLAN), CLAN);
});

test("an agent with no clan is told what would fix it, in terms it can act on", async () => {
  // "be an open member of a recorded clan" is advice an agent can never take:
  // it has no player and cannot join anything.
  const { rows } = await db.query(
    `insert into account (email_hash, status, role, kind, owned_by_account_id, public_id)
     values (null, 'approved', 'leader', 'agent', $1, $2) returning account_id`,
    [person.accountId, `pub${(Date.now() % 1e8) + 1}`],
  );
  const orphan = { accountId: rows[0].account_id, kind: "agent" };
  await assert.rejects(
    () => resolveEntitledClan(db, orphan, undefined),
    (e) => e.code === "no_subject" && /Account -> Agents/.test(e.hint),
  );
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
const PRIMARY_CLAN = "#PYQLVG0"; // sorts after
const ALT_CLAN = "#CGJRU29"; // sorts before
const TWO_CLAN_PRIMARY = "#QQLV02Y";
const TWO_CLAN_ALT = "#GVJ8P0L";

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
  assert.match(sentences, new RegExp(`also track ALT CLAN ${ALT_CLAN}`));

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
  // Elixir Clan pinned the tag on every call); now it says which clan is
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
      e.hint.includes(`elixir_track_clan({ clan_tag: "${PRIMARY_CLAN}" })`) &&
      e.hint.includes(ALT_CLAN),
  );
  assert.equal(await resolveEntitledClan(db, account, ALT_CLAN), ALT_CLAN);
  await db.query(
    `update recording set status = 'active' where subject_type = 'clan' and subject_tag = $1`,
    [PRIMARY_CLAN],
  );
  assert.equal(await resolveEntitledClan(db, account, undefined), PRIMARY_CLAN);
});

test("7.1.0: an agent tracks a rival in its owner's slots, and keeps the clan it acts for", async () => {
  // Jamie, 2026-09-23: "a clan agent may be asked to track a competitive
  // clan". Its owner is a leader: one activity slot, one comprehensive,
  // and the clan they share fills the comprehensive one.
  const { elixir_track_clan } =
    await import("../src/tools/elixir/track-clan.mjs");
  const ctx = { db, account: agent };
  const RIVAL = "#PYLQGRJC";
  const RIVAL2 = "#9VUP08YL";
  const added = await elixir_track_clan.handler(ctx, {
    clan_tag: RIVAL,
    scope: "activity",
  });
  assert.equal(added.added, true);
  await assert.rejects(
    () =>
      elixir_track_clan.handler(ctx, { clan_tag: RIVAL2, scope: "activity" }),
    (err) =>
      err.code === "quota_exceeded" &&
      /shared with its owner/.test(err.message),
  );
  // The clan it acts for stays, and so the default is unchanged.
  await assert.rejects(
    () => elixir_track_clan.handler(ctx, { clan_tag: CLAN, action: "remove" }),
    (err) => err.code === "not_entitled",
  );
  assert.equal(await resolveEntitledClan(db, agent, undefined), CLAN);
  const removed = await elixir_track_clan.handler(ctx, {
    clan_tag: RIVAL,
    action: "remove",
  });
  assert.equal(removed.removed, true);
});
