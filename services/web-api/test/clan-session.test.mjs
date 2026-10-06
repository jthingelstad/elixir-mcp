import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession, revokeSession } from "@elixir-mcp/auth";
import { writeClanFactInClan } from "@elixir-mcp/record/attested-facts";
import { makeHandler } from "../src/handler.mjs";
import { createClanRequest, recordedIdentity } from "../src/clan.mjs";
import { seasonCalendar } from "@elixir-mcp/record/season";
import { seasonFromDate, monthForSeasonId } from "@elixir-mcp/record/war-clock";

import { describeIdentity, principalBlock } from "@elixir-mcp/tools/identity";

const CLAN = "#9GQLV20",
  TAG = "#9GQLV22";
let scratch, handler, accountId, token, sessionId;
const data = (r) => JSON.parse(r.body);
const request = (
  method,
  path,
  {
    cookie = `__Host-elixir_session=${token}`,
    headers = {},
    body,
    base64 = false,
  } = {},
) =>
  handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: { ...(cookie ? { cookie } : {}), ...headers },
    ...(body
      ? {
          body: base64
            ? Buffer.from(JSON.stringify(body)).toString("base64")
            : JSON.stringify(body),
          isBase64Encoded: base64,
        }
      : {}),
  });
before(async () => {
  scratch = await scratchDb("clan_session");
  accountId = (
    await scratch.db.query(
      "insert into account(email_hash,status) values ('clan-session','approved') returning account_id",
    )
  ).rows[0].account_id;
  await scratch.db.query(
    "insert into player(player_tag,name) values ($1,'Player')",
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
    "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values ($1,$2,'leader',now())",
    [CLAN, TAG],
  );
  const session = await createSession(scratch.db, {
    secret: "test",
    accountId,
    emailHash: "clan-session",
  });
  token = session.token;
  sessionId = session.sessionId;
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    clan: createClanRequest({ origin: "https://elixir.poapkings.com" }),
  });
});
after(async () => scratch.drop());

test("the browser session advertises the actual cutover switch for signed-in and signed-out people", async () => {
  for (const enabled of [false, true]) {
    const door = enabled
      ? handler
      : makeHandler({ databaseUrl: scratch.url, secret: "test" });
    for (const signedIn of [false, true]) {
      const result = await door({
        rawPath: "/api/me",
        requestContext: { http: { method: "GET" } },
        headers: signedIn ? { cookie: `__Host-elixir_session=${token}` } : {},
      });
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(data(result).features.clan_internal, enabled);
      assert.equal(data(result).authenticated, signedIn);
    }
  }
});

test("prepared Clan is disabled by default; its enabled door accepts only Elixir sessions", async () => {
  const disabled = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  assert.equal((await disabled({ rawPath: "/api/clan/me" })).statusCode, 404);
  for (const headers of [
    {},
    { authorization: "Bearer eat_api-grant" },
    { authorization: "Bearer svt_integration-key" },
  ])
    assert.equal(
      (await request("GET", "/api/clan/me", { cookie: null, headers }))
        .statusCode,
      401,
    );
  const r = await request("GET", "/api/clan/me");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(data(r).selected.role, "leader");
  assert.equal(r.cookies, undefined);
  assert.equal(
    (await scratch.db.query("select count(*)::int as n from clan_state"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await request("GET", "/api/clan/auth/callback", { cookie: null }))
      .statusCode,
    410,
  );
});

test("account preferences need the CSRF marker and never use a second session", async () => {
  assert.equal(
    (await request("POST", "/api/clan/select", { body: { clan_tag: CLAN } }))
      .statusCode,
    401,
  );
  const r = await request("POST", "/api/clan/select", {
    body: { clan_tag: CLAN },
    headers: { "x-elixir-client": "web" },
    base64: true,
  });
  assert.equal(r.statusCode, 200, r.body);
  const rows = (await scratch.db.query("select pk,body from clan_state")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pk, `account#${accountId}`);
  assert.equal(rows[0].body.selected.clan_tag, CLAN);
  assert.equal(rows[0].body.accessToken, undefined);
});

test("a friend cannot act in Clan; an unverified own claim stays a member", async () => {
  await scratch.db.query(
    "update claim set relationship='friend',is_primary=false where account_id=$1",
    [accountId],
  );
  assert.equal(
    data(await request("GET", "/api/clan/me")).reason,
    "no_primary_player",
  );
  await scratch.db.query(
    "update claim set relationship='primary',is_primary=true,status='unverified' where account_id=$1",
    [accountId],
  );
  assert.equal(
    data(await request("GET", "/api/clan/me")).selected.role,
    "member",
  );
  const denied = await request(
    "POST",
    `/api/clan/clans/${CLAN.slice(1)}/policy`,
    { headers: { "x-elixir-client": "web" }, body: { values: {} } },
  );
  assert.equal(denied.statusCode, 403);
  await scratch.db.query(
    "update claim set status='verified' where account_id=$1",
    [accountId],
  );
});

test("GET evaluations and mutations serialize across O/0 clan aliases", async () => {
  const key = `clan-state:${CLAN}`;
  const path = `/api/clan/clans/${CLAN.slice(1).replaceAll("0", "O")}/policy`;
  for (const method of ["GET", "POST"]) {
    await scratch.db.query("select pg_advisory_lock(hashtext($1))", [key]);
    const pending = request(method, path, {
      headers: { "x-elixir-client": "web" },
      ...(method === "POST" ? { body: { values: {} } } : {}),
    });
    try {
      // Observe an actual lock waiter rather than assuming a slow response.
      const limit = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < limit) {
        waiting = (
          await scratch.db.query(
            `select exists(select 1 from pg_locks
           where locktype='advisory' and not granted
           and database=(select oid from pg_database where datname=current_database())
           and objid=(hashtext($1)::bigint & 4294967295)) as waiting`,
            [key],
          )
        ).rows[0].waiting;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(
        waiting,
        true,
        `${method} must wait on the canonical clan lock`,
      );
    } finally {
      await scratch.db.query("select pg_advisory_unlock(hashtext($1))", [key]);
    }
    const response = await pending;
    assert.equal(response.statusCode, 200, response.body);
  }
});

test("pure week, season and own-member views do not wait behind the clan's mutation lock", async () => {
  const key = `clan-state:${CLAN}`;
  await scratch.db.query("select pg_advisory_lock(hashtext($1))", [key]);
  try {
    for (const page of ["week", "season", "me"]) {
      let timer;
      try {
        const response = await Promise.race([
          request("GET", `/api/clan/clans/${CLAN.slice(1)}/${page}`),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${page} waited on the mutation lock`)),
              4000,
            );
          }),
        ]);
        // This scratch clan has no recording. Its truthful refusal must also
        // complete while a decision holds the lock; no grants/cards are raised.
        assert.equal(response.statusCode, 502, response.body);
        assert.equal(data(response).error, "clan_not_recorded");
        assert.match(
          response.headers["server-timing"],
          /elixir;dur=\d+;desc="2 calls"/,
        );
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    await scratch.db.query("select pg_advisory_unlock(hashtext($1))", [key]);
  }
});

test("season projects real recorded counters with the canonical calendar and no action or grant writes", async () => {
  const current = seasonFromDate(Date.now()).seasonId;
  const calendar = seasonCalendar(monthForSeasonId(current));
  await scratch.db.query(
    "insert into recording(subject_type,subject_tag,requested_by,scope) values ('clan',$1,$2,'comprehensive')",
    [CLAN, accountId],
  );
  await scratch.db.query(
    "insert into war_week(clan_tag,season_id,section_index,started_observed_at) values ($1,$2,0,$3)",
    [CLAN, current, calendar.starts_at],
  );
  await scratch.db.query(
    "insert into war_participation(clan_tag,season_id,section_index,player_tag,points,decks_used) values ($1,$2,0,$3,750,3)",
    [CLAN, current, TAG],
  );
  const before = (
    await scratch.db.query(
      "select pk,sort_key,body from clan_state order by pk",
    )
  ).rows;
  try {
    const response = await request(
      "GET",
      `/api/clan/clans/${CLAN.slice(1)}/season`,
    );
    assert.equal(response.statusCode, 200, response.body);
    const season = data(response).seasons[0];
    assert.equal(data(response).current_season_id, current);
    assert.equal(season.from, calendar.starts_at.toISOString());
    assert.equal(season.to, calendar.ends_at.toISOString());
    assert.equal(season.races.length, calendar.sections);
    assert.equal(season.decks, 3);
    assert.equal(season.points, 750);
    assert.equal(season.contributors, 1);
    assert.equal(season.coverage.recorded_sections, 1);
    assert.match(
      response.headers["server-timing"],
      /elixir;dur=\d+;desc="2 calls"/,
    );
    const after = (
      await scratch.db.query(
        "select pk,sort_key,body from clan_state order by pk",
      )
    ).rows;
    // The existing member gate may refresh the clan's monotonic metadata.
    // The view must never reconcile business decisions or grants.
    assert.deepEqual(
      after.filter((r) => r.pk !== `clan#${CLAN}`),
      before.filter((r) => r.pk !== `clan#${CLAN}`),
    );
    assert.equal(
      after.some((r) => /action|grant|mail/i.test(r.sort_key)),
      false,
    );
  } finally {
    await scratch.db.query("delete from war_participation where clan_tag=$1", [
      CLAN,
    ]);
    await scratch.db.query("delete from war_week where clan_tag=$1", [CLAN]);
    await scratch.db.query(
      "delete from recording where subject_type='clan' and subject_tag=$1",
      [CLAN],
    );
  }
});

test("compact initialization preserves principal and all player relationships with three reads", async () => {
  const account = { accountId, kind: "person" };
  for (const hasPrimary of [true, false]) {
    await scratch.db.query(
      "update claim set is_primary=$2 where account_id=$1",
      [accountId, hasPrimary],
    );
    const expected = principalBlock(
      "person",
      await describeIdentity(scratch.db, account),
    );
    let queries = 0;
    const actual = await recordedIdentity(
      {
        query: (...args) => {
          queries++;
          return scratch.db.query(...args);
        },
      },
      account,
    );
    assert.deepEqual(actual.principal, expected);
    assert.equal(actual.body.players.length, 1);
    assert.equal(actual.body.players[0].claim_status, "verified");
    assert.equal(queries, 3);
  }
  await scratch.db.query(
    "update claim set is_primary=true where account_id=$1",
    [accountId],
  );
});

test("internal factual writes retain membership and role checks without an OAuth grant", async () => {
  const body = {
    type: "clan_message",
    ref: "internal-message",
    detail: {
      channel: "leader_message",
      title: "Hello",
      body: "The recorded week",
    },
  };
  const person = { accountId, kind: "person" };
  const written = await writeClanFactInClan(scratch.db, person, CLAN, body);
  assert.equal(written.attested_by.app, "Elixir Clan");
  await assert.rejects(
    writeClanFactInClan(scratch.db, { ...person, kind: "agent" }, CLAN, body),
    (e) => e.code === "not_a_person",
  );
  await scratch.db.query(
    "update clan_membership set role='member' where clan_tag=$1 and player_tag=$2",
    [CLAN, TAG],
  );
  await assert.rejects(
    writeClanFactInClan(scratch.db, person, CLAN, body),
    (e) => e.code === "not_permitted",
  );
  await scratch.db.query(
    "update clan_membership set left_observed_at=now() where clan_tag=$1 and player_tag=$2",
    [CLAN, TAG],
  );
  await assert.rejects(
    writeClanFactInClan(scratch.db, person, CLAN, body),
    (e) => e.code === "not_in_clan",
  );
});

test("revoking Elixir's session immediately signs Clan out too", async () => {
  await revokeSession(scratch.db, sessionId);
  assert.equal((await request("GET", "/api/clan/me")).statusCode, 401);
});
