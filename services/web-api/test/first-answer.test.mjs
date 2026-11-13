import { test, before, after } from "node:test";
import { refreshDailyRollups } from "../../../packages/ingest/src/rollups.mjs";
import assert from "node:assert/strict";
import pg from "pg";
import { createSession, emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_first_answer_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie, accountId, otherId;
const read = (authenticated = true, tag = null) =>
  handler({
    path: "/api/me/first-answer",
    method: "GET",
    headers: authenticated ? { cookie } : {},
    queryStringParameters: tag == null ? {} : { player_tag: tag },
  });

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const hash = emailHash("first-answer@example.com");
  ({
    rows: [{ account_id: accountId }],
  } = await db.query(
    "insert into account (email_hash, status) values ($1, 'approved') returning account_id",
    [hash],
  ));
  ({
    rows: [{ account_id: otherId }],
  } = await db.query(
    "insert into account (email_hash, status) values ($1, 'approved') returning account_id",
    [emailHash("other@example.com")],
  ));
  const session = await createSession(db, {
    secret: "test",
    accountId,
    emailHash: hash,
  });
  cookie = `__Host-elixir_session=${session.token}`;
  handler = makeHandler({
    databaseUrl,
    secret: "test",
    sendLoginEmail: async () => {},
  });
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

test("first-answer requires a personal session", async () => {
  assert.equal((await read(false)).statusCode, 401);
});

test("first-answer follows actual capture and distinguishes authorization from natural data reads", async () => {
  const res = await read();
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).player, null);
  await db.query(
    "insert into player (player_tag) values ('#09CV8UVL'), ('#J2RGCRVG')",
  );
  await db.query(
    "insert into claim (account_id, player_tag, is_primary) values ($1, '#09CV8UVL', true), ($2, '#J2RGCRVG', true)",
    [accountId, otherId],
  );
  await db.query(
    "insert into recording (subject_type, subject_tag, requested_by) values ('player', '#09CV8UVL', $1)",
    [accountId],
  );
  let data = JSON.parse((await read()).body);
  assert.equal(data.player.player_tag, "#09CV8UVL");
  // When the tag was added: the Console polls fast just after an add.
  assert.ok(Date.now() - Date.parse(data.player.tracked_since) < 60_000);
  assert.equal(data.player.profile_observed_at, null);
  assert.equal(data.player.profile_available, false);
  assert.equal(data.player.battles_30d, 0);
  assert.equal(data.connection.active_connections, 0);

  await db.query(
    "insert into poll_state (subject_tag, endpoint, last_admitted_at) values ('#09CV8UVL', 'player', now()), ('#09CV8UVL', 'player_battlelog', now() - interval '3 hours')",
  );
  // A poll is not proof of a projected profile. Conversely, retained profile
  // observations survive receipt/poll retention and are still useful data.
  data = JSON.parse((await read()).body);
  assert.equal(data.player.profile_observed_at, null);
  await db.query(
    "insert into player_snapshot_daily (player_tag, snapshot_date, trophies, observed_at, profile_observed_at) values ('#09CV8UVL', current_date, 9000, now(), now())",
  );
  // Identities first (0108): a participant's deck_hash references deck.
  await db.query(
    "insert into deck (deck_hash, card_count, first_seen_at, last_seen_at) values ('a', 8, now(), now()), ('b', 8, now(), now()) on conflict do nothing",
  );
  // Two boat defenses (a rival attacking the boat, answered by the
  // defense deck): not battles the member played, so no counter moves.
  for (const [id, days] of [
    ["defense-week", 1],
    ["defense-previous", 9],
  ]) {
    await db.query(
      "insert into battle (battle_id, battle_time, type, type_class, boat_battle_side) values ($1, now() - $2 * interval '1 day', 'boatBattle', 'pvp', 'defender')",
      [id, days],
    );
    await db.query(
      "insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class) values ($1, '#09CV8UVL', 0, now() - $2 * interval '1 day', 'loss', 'boatBattle', 'pvp')",
      [id, days],
    );
  }
  for (const [id, tag, days, deck] of [
    ["recent", "#09CV8UVL", 1, "a"],
    ["second", "#09CV8UVL", 2, "b"],
    ["previous", "#09CV8UVL", 9, "a"],
    ["old", "#09CV8UVL", 31, "a"],
    ["foreign", "#J2RGCRVG", 1, "a"],
  ]) {
    await db.query(
      "insert into battle (battle_id, battle_time, type, type_class) values ($1, now() - $2 * interval '1 day', 'PvP', 'pvp')",
      [id, days],
    );
    await db.query(
      "insert into battle_participant (battle_id, player_tag, side, battle_time, deck_hash, type, type_class) values ($1, $2, 0, now() - $3 * interval '1 day', $4, 'PvP', 'pvp')",
      [id, tag, days, deck],
    );
  }
  // The daily rollup ingest maintains for every written participant;
  // the first answer's counters read it for whole days.
  const { rows: pairs } = await db.query(
    `select distinct player_tag, to_char(battle_time, 'YYYY-MM-DD') as day
     from battle_participant where battle_id in ('recent', 'second', 'previous', 'old', 'foreign', 'defense-week', 'defense-previous')`,
  );
  await refreshDailyRollups(
    db,
    pairs.map((r) => ({ playerTag: r.player_tag, day: r.day })),
  );
  await db.query(
    "insert into oauth_client (client_id, client_name, redirect_uris, expires_at) values ('first-answer', 'Test', '{}', now() + interval '1 day')",
  );
  await db.query(
    "insert into oauth_family (client_id, account_id, absolute_expires_at) values ('first-answer', $1, now() + interval '1 day'), ('first-answer', $1, now() - interval '1 day'), ('first-answer', $2, now() + interval '1 day')",
    [accountId, otherId],
  );
  data = JSON.parse((await read()).body);
  assert.ok(data.player.profile_observed_at);
  assert.equal(data.player.battles_30d, 3);
  assert.equal(data.player.battles_7d, 2);
  assert.equal(data.player.battles_previous_7d, 1);
  assert.equal(data.player.distinct_decks_7d, 2);
  assert.ok(data.player.last_battle_at);
  assert.equal(data.player.profile_available, true);
  assert.ok(
    new Date(data.player.battlelog_observed_at) <
      new Date(data.player.profile_observed_at),
  );
  assert.equal(data.connection.active_connections, 1);
  assert.equal(data.connection.successful_data_calls_7d, 0);

  // Web previews, service principals, failures, oversize responses, setup
  // calls, other accounts and old calls do not count as personal MCP reads.
  for (const [owner, surface, tool, error, truncated, days] of [
    [accountId, "mcp", "players_summary", null, false, 0],
    [accountId, "mcp", "battles_performance", null, false, 2],
    [accountId, "web", "players_summary", null, false, 0],
    [accountId, "svc:bot", "players_summary", null, false, 0],
    [accountId, "mcp", "players_summary", "bad_request", false, 0],
    [accountId, "mcp", "players_summary", null, true, 0],
    [accountId, "mcp", "elixir_status", null, false, 0],
    [otherId, "mcp", "players_summary", null, false, 0],
    [accountId, "mcp", "players_summary", null, false, 8],
  ]) {
    await db.query(
      "insert into mcp_call_audit (account_id, surface, tool, error_code, truncated, created_at) values ($1,$2,$3,$4,$5,now() - $6 * interval '1 day')",
      [owner, surface, tool, error, truncated, days],
    );
  }
  data = JSON.parse((await read()).body);
  assert.equal(data.connection.successful_data_calls_7d, 2);
  assert.equal(data.connection.data_read_days_7d, 2);
  assert.ok(data.connection.last_data_read_at);
  await db.query(
    "update oauth_family set revoked_at = now() where account_id = $1",
    [accountId],
  );
  assert.equal(
    JSON.parse((await read()).body).connection.active_connections,
    0,
  );
  await db.query(
    "delete from player_snapshot_daily where player_tag = '#09CV8UVL'",
  );
  await db.query(
    "delete from battle_participant where player_tag = '#09CV8UVL' and battle_id <> 'old'",
  );
  // Battles are the truth and the rollup is derived: whatever removes
  // rows refreshes their days (here, the test).
  await refreshDailyRollups(
    db,
    pairs.map((r) => ({ playerTag: r.player_tag, day: r.day })),
  );
  data = JSON.parse((await read()).body);
  assert.equal(data.player.profile_available, false);
  assert.equal(data.player.battles_30d, 0);
  assert.ok(
    data.player.last_battle_at,
    "older retained history is still a capture",
  );
});

test("clan questions require a recorded war week for a clan this account added", async () => {
  assert.equal(JSON.parse((await read()).body).clan, null);
  await db.query(
    "insert into clan (clan_tag,name) values ('#0GG','Primary clan'),('#00J','Second clan')",
  );
  await db.query(
    "insert into war_week (clan_tag,season_id,section_index) values ('#00J',1,0)",
  );
  assert.equal(
    JSON.parse((await read()).body).clan,
    null,
    "an unrelated clan is not a suggestion",
  );
  await db.query(
    "insert into account_clan (account_id,clan_tag,is_primary) values ($1,'#0GG',true)",
    [accountId],
  );
  assert.equal(
    JSON.parse((await read()).body).clan,
    null,
    "adding a clan alone is not a recorded race",
  );
  await db.query(
    "insert into account_clan (account_id,clan_tag) values ($1,'#00J')",
    [accountId],
  );
  assert.equal(JSON.parse((await read()).body).clan.clan_tag, "#00J");
  await db.query(
    "insert into war_week (clan_tag,season_id,section_index) values ('#0GG',1,0)",
  );
  assert.deepEqual(JSON.parse((await read()).body).clan, {
    clan_tag: "#0GG",
    name: "Primary clan",
    war_weeks: 1,
    latest_week: { season_id: 1, section_index: 0 },
  });
  // The count is the readable half: "tracked" says a clan is on record,
  // "3 war weeks" says what it can answer with. It counts the clan's
  // recorded weeks, not this account's.
  await db.query(
    "insert into war_week (clan_tag,season_id,section_index) values ('#0GG',1,1),('#0GG',2,0)",
  );
  assert.equal(JSON.parse((await read()).body).clan.war_weeks, 3);
});

test("selected capture state is claim-bound; roster-only data never promises a profile", async () => {
  assert.equal((await read(true, "#J2RGCRVG")).statusCode, 404);
  assert.equal((await read(true, "not-a-tag")).statusCode, 400);
  await db.query(
    "insert into claim (account_id, player_tag, relationship) values ($1, '#J2RGCRVG', 'alt')",
    [accountId],
  );
  await db.query(
    "insert into player_snapshot_daily (player_tag,snapshot_date,trophies,roster_observed_at,observed_at) values ('#J2RGCRVG',current_date,8000,now(),now())",
  );
  let p = JSON.parse((await read(true, "#J2RGCRVG")).body).player;
  assert.equal(p.player_tag, "#J2RGCRVG");
  assert.equal(p.is_primary, false);
  assert.equal(p.verified, false, "an unproved claim reads unverified");
  assert.equal(p.verified_at, null);
  assert.equal(p.profile_available, false);
  assert.equal(p.capture_interval.ratio, null);
  await db.query(
    "update claim set status='verified', verified_at=now() where account_id=$1 and player_tag='#J2RGCRVG'",
    [accountId],
  );
  const proved = JSON.parse((await read(true, "#J2RGCRVG")).body).player;
  assert.equal(proved.verified, true);
  assert.ok(proved.verified_at);
  await db.query(
    "update claim set status='unverified', verified_at=null where account_id=$1 and player_tag='#J2RGCRVG'",
    [accountId],
  );
  // Existing bounded error metadata, never a payload or an identity claim.
  const {
    rows: [g],
  } = await db.query(
    "insert into gateway (owner_account_id,name,static_ip) values ($1,'scratch-first-record','127.0.0.1') returning gateway_id",
    [accountId],
  );
  await db.query(
    "insert into collector_fetch_error (gateway_id,endpoint,entity_key,fetched_at,http_status,error_kind) values ($1,'player','#J2RGCRVG',now() - interval '1 minute',503,'http')",
    [g.gateway_id],
  );
  p = JSON.parse((await read(true, "#J2RGCRVG")).body).player;
  assert.ok(
    p.capture_attempts.find((a) => a.endpoint === "player").last_failed_at,
  );
  assert.equal(
    p.capture_attempts.find((a) => a.endpoint === "player").last_failed_status,
    503,
  );
  assert.equal(p.profile_available, false);
  await db.query(
    "insert into poll_state (subject_tag,endpoint,last_admitted_at) values ('#J2RGCRVG','player',now())",
  );
  p = JSON.parse((await read(true, "#J2RGCRVG")).body).player;
  const attempt = p.capture_attempts.find((a) => a.endpoint === "player");
  assert.ok(
    new Date(attempt.last_admitted_at) > new Date(attempt.last_failed_at),
  );
  assert.equal(
    p.profile_available,
    false,
    "a successful poll is not a projected profile",
  );
  assert.equal(
    JSON.parse((await read()).body).player.player_tag,
    "#09CV8UVL",
    "default selection stays primary",
  );
  await db.query(
    "update player_snapshot_daily set profile_observed_at=now(), battle_count=110 where player_tag='#J2RGCRVG'",
  );
  await db.query(
    "insert into player_snapshot_daily (player_tag,snapshot_date,profile_observed_at,observed_at,battle_count) values ('#J2RGCRVG',current_date-2,now()-interval '2 days',now()-interval '2 days',100)",
  );
  p = JSON.parse((await read(true, "#J2RGCRVG")).body).player;
  assert.equal(p.profile_available, true);
  assert.equal(p.capture_interval.expected_battles, 10);
  assert.equal(p.capture_interval.captured_battles, 1);
  assert.equal(p.capture_interval.ratio, 0.1);
  assert.ok(p.capture_interval.observed_from && p.capture_interval.observed_to);
});

test("first-answer carries Home's welcome state: the players followed and the digest, once chosen (G4)", async () => {
  let w = JSON.parse((await read()).body).welcome;
  assert.deepEqual(w, { following: 0, digest: null, finished_at: null });
  await db.query(
    "insert into player (player_tag) values ('#0Y0PLGJ8'), ('#00GG9Q8R') on conflict do nothing",
  );
  // A friend each, and one the other account follows: only this account's.
  await db.query(
    "insert into claim (account_id, player_tag, relationship) values ($1, '#0Y0PLGJ8', 'friend'), ($1, '#00GG9Q8R', 'friend'), ($2, '#00GG9Q8R', 'friend')",
    [accountId, otherId],
  );
  // An operator's row is not the person's choice.
  await db.query(
    "insert into account_email_pref (account_id, kind, enabled, via) values ($1, 'tracking_report', true, 'ops')",
    [accountId],
  );
  w = JSON.parse((await read()).body).welcome;
  assert.equal(w.following, 2);
  assert.equal(w.digest, null);
  await db.query(
    "update account_email_pref set via = 'profile', cadence = 'daily' where account_id = $1 and kind = 'tracking_report'",
    [accountId],
  );
  w = JSON.parse((await read()).body).welcome;
  assert.equal(w.digest.cadence, "daily");
  assert.equal(w.digest.enabled, true);
  assert.ok(w.digest.chosen_at);
});

test("the welcome checklist finishes for good: stamped once all four are done, never undone (Jamie, 2026-11-12)", async () => {
  await db.query("update account set welcome_finished_at = null");
  await db.query("delete from claim where account_id = $1 and not is_primary", [
    accountId,
  ]);
  await db.query(
    "update claim set status = 'unverified', verified_at = null where account_id = $1 and is_primary",
    [accountId],
  );
  await db.query(
    "insert into account_email_pref (account_id, kind, enabled, via) values ($1, 'tracking_report', false, 'profile') on conflict (account_id, kind) do update set enabled = false, via = 'profile'",
    [accountId],
  );
  await db.query(
    "insert into player (player_tag) values ('#0Y0PLGJ8') on conflict do nothing",
  );
  await db.query(
    "insert into claim (account_id, player_tag, relationship) values ($1, '#0Y0PLGJ8', 'friend')",
    [accountId],
  );
  // Three of four (the primary is not verified): not finished.
  let w = JSON.parse((await read()).body).welcome;
  assert.equal(w.finished_at, null);
  await db.query(
    "update claim set status = 'verified', verified_at = now() where account_id = $1 and is_primary",
    [accountId],
  );
  // One follow and a digest turned off complete it, and the read stamps it.
  w = JSON.parse((await read()).body).welcome;
  assert.ok(w.finished_at, "the read stamps the finish");
  const stamped = w.finished_at;
  const stored = await db.query(
    "select welcome_finished_at from account where account_id = $1",
    [accountId],
  );
  assert.ok(stored.rows[0].welcome_finished_at);
  // Unfollowing everyone keeps it finished, with the first stamp.
  await db.query("delete from claim where account_id = $1 and not is_primary", [
    accountId,
  ]);
  w = JSON.parse((await read()).body).welcome;
  assert.equal(w.following, 0);
  assert.equal(w.finished_at, stamped);
  // Another account's finish is its own.
  const other = await db.query(
    "select welcome_finished_at from account where account_id = $1",
    [otherId],
  );
  assert.equal(other.rows[0].welcome_finished_at, null);
});
