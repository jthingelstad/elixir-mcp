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
import { resolveSubject } from "../src/entitlements.mjs";
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
  await db
    .query(
      `insert into recording (subject_type, subject_tag, status, scope)
     values ('clan', $1, 'active', 'comprehensive')`,
      [CLAN],
    )
    .catch(() => {});

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
    (e) => e.code === "not_found" && /elixir_identify/.test(e.hint),
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
    (e) => e.code === "not_found",
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
