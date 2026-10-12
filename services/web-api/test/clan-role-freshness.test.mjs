// A leader mutation needs the clan's roster read within the hour
// (packages/clan/src/role-freshness.mjs), on scratch Postgres with the real
// handler, tools and live lane. Nothing here reaches a collector or the
// Clash Royale API: a live ask only puts a job row in the ledger.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { createClanRequest } from "../src/clan.mjs";
import { ROLE_CONFIRM_MAX_AGE_MS } from "@elixir-mcp/clan/role-freshness.mjs";

const CLAN = "#9GQLV20",
  TAG = "#9GQLV22";
let scratch, handler, accountId, token;
const data = (r) => JSON.parse(r.body);
const request = (method, path, body) =>
  handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: {
      cookie: `__Host-elixir_session=${token}`,
      "x-elixir-client": "web",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const socialPath = `/api/clan/clans/${CLAN.slice(1)}/social`;
const setSocial = (enabled) => request("PUT", socialPath, { enabled });
const rosterReadAgo = (sql) =>
  scratch.db.query(
    `update poll_state set last_admitted_at = ${sql}
      where subject_tag = $1 and endpoint = 'clan'`,
    [CLAN],
  );
const one = async (sql, params = []) =>
  (await scratch.db.query(sql, params)).rows[0];
const liveJobs = async () =>
  (
    await one(
      `select count(*)::int as n from job
        where endpoint = 'clan' and entity_key = $1 and lane = 'live'`,
      [CLAN],
    )
  ).n;
const tokens = async () =>
  Number((await one("select tokens from budget_state")).tokens);

before(async () => {
  scratch = await scratchDb("clan_role_freshness");
  accountId = (
    await scratch.db.query(
      "insert into account(email_hash,status) values ('clan-role','approved') returning account_id",
    )
  ).rows[0].account_id;
  await scratch.db.query(
    "insert into player(player_tag,name) values ($1,'Leader')",
    [TAG],
  );
  await scratch.db.query("insert into clan(clan_tag,name) values ($1,'Clan')", [
    CLAN,
  ]);
  await scratch.db.query(
    "insert into claim(account_id,player_tag,status,relationship,is_primary) values ($1,$2,'verified','primary',true)",
    [accountId, TAG],
  );
  await scratch.db.query(
    "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values ($1,$2,'leader',now() - interval '30 days')",
    [CLAN, TAG],
  );
  await scratch.db.query(
    "insert into poll_state(subject_tag,endpoint,last_admitted_at) values ($1,'clan',now())",
    [CLAN],
  );
  await scratch.db.query(
    "insert into recording(subject_type,subject_tag,requested_by) values ('clan',$1,$2)",
    [CLAN, accountId],
  );
  await scratch.db.query("update budget_state set tokens = 10");
  token = (
    await createSession(scratch.db, {
      secret: "test",
      accountId,
      emailHash: "clan-role",
    })
  ).token;
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    clan: createClanRequest({ origin: "https://elixir.poapkings.com" }),
  });
});
after(async () => scratch.drop());

test("a stale roster refuses a leader mutation once with one live mint; a second ask while it is open mints nothing; a fresh roster proceeds", async () => {
  await rosterReadAgo("now() - interval '2 hours'");
  const before = await tokens();

  const first = await setSocial(false);
  assert.equal(first.statusCode, 409, first.body);
  assert.equal(data(first).error, "role_unconfirmed");
  assert.equal(data(first).max_age_s, ROLE_CONFIRM_MAX_AGE_MS / 1000);
  assert.ok(data(first).retry_after_s >= 15);
  assert.ok(data(first).roster_observed_at);
  assert.equal(await liveJobs(), 1, "one live roster read is asked for");
  assert.equal(await tokens(), before - 1, "charged once, when minted");
  assert.equal(
    (
      await one(
        "select count(*)::int as n from clan_state where pk like 'social#%'",
      )
    ).n,
    0,
    "nothing was changed",
  );

  const second = await setSocial(false);
  assert.equal(second.statusCode, 409, second.body);
  assert.equal(data(second).error, "role_unconfirmed");
  assert.equal(await liveJobs(), 1, "the open job is the same ask");
  assert.equal(await tokens(), before - 1, "and is not charged again");

  // Reads are unaffected, and ask for nothing.
  const read = await request("GET", socialPath);
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(await liveJobs(), 1);

  // The live read lands (the record moves): the same request proceeds.
  await rosterReadAgo("now()");
  const fresh = await setSocial(false);
  assert.equal(fresh.statusCode, 200, fresh.body);
  assert.equal(data(fresh).enabled, false);
  assert.equal(await liveJobs(), 1);
});

test("a membership row the roster poll closed takes the role away on the next request", async () => {
  await rosterReadAgo("now()");
  assert.equal((await setSocial(true)).statusCode, 200);

  // The roster poll saw the leader demoted in the game.
  await scratch.db.query(
    "update clan_membership set role = 'member' where clan_tag = $1 and player_tag = $2",
    [CLAN, TAG],
  );
  assert.equal(
    data(await request("GET", "/api/clan/me")).selected.role,
    "member",
  );
  const demoted = await setSocial(false);
  assert.equal(demoted.statusCode, 403, demoted.body);
  assert.equal(data(demoted).error, "leaders_only");

  // And then saw them leave: the clan is no longer theirs at all.
  await scratch.db.query(
    "update clan_membership set left_observed_at = now() where clan_tag = $1 and player_tag = $2",
    [CLAN, TAG],
  );
  const gone = await setSocial(false);
  assert.equal(gone.statusCode, 403, gone.body);
  assert.notEqual(data(gone).error, "role_unconfirmed");
});

test("a clan nobody records asks the live lane too, rather than failing as unavailable", async () => {
  await scratch.db.query(
    "update clan_membership set role = 'leader', left_observed_at = null where clan_tag = $1 and player_tag = $2",
    [CLAN, TAG],
  );
  await scratch.db.query("delete from job where entity_key = $1", [CLAN]);
  await scratch.db.query(
    "delete from recording where subject_type = 'clan' and subject_tag = $1",
    [CLAN],
  );
  await rosterReadAgo("now() - interval '3 hours'");
  try {
    const r = await request("PUT", socialPath, { enabled: true });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(data(r).error, "role_unconfirmed");
    assert.equal(await liveJobs(), 1);
  } finally {
    await scratch.db.query(
      "insert into recording(subject_type,subject_tag,requested_by) values ('clan',$1,$2)",
      [CLAN, accountId],
    );
  }
});
