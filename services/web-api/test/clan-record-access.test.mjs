/**
 * Who may read what through Clan's in-process reads (2026-11-13). The
 * reader carries no credential and no audit, so the access rule is
 * Clan's own checks alone: the gate (membership), `RUN_READS` and the
 * roles (leaders, elders up), and each service's leader checks. Every
 * route that reads the record is asked by a leader (who is answered),
 * a member (refused what is a leader's or an elder's) and a verified
 * player of another clan (refused everything of this clan's), on a real
 * record, through the web API's own handler.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { seasonFromDate } from "@elixir-mcp/record/war-clock";
import { makeHandler } from "../src/handler.mjs";
import { createClanRequest } from "../src/clan.mjs";

process.env.TZ = "UTC";

// Invented tags: a clan of twelve, and a player of another clan.
const CLAN = "#0GRJCUV";
const OTHER_CLAN = "#0Q2L8";
const TAGS = Array.from(
  { length: 12 },
  (_, i) =>
    "#0" +
    ["L", "V"].join("") +
    "PYLQGRJCUV"[i % 10] +
    "28"[i % 2] +
    "Y".repeat(i >= 10),
);
const LEADER = TAGS[0];
const MEMBER = TAGS[5];
const OUTSIDER = "#0YY9P";
const PATH = `/api/clan/clans/${CLAN.slice(1)}`;

let scratch, handler;
const cookies = {};

before(async () => {
  scratch = await scratchDb("clan_record_access");
  const { db } = scratch;
  await ensureSeasonsAround(db);
  await db.query(
    "insert into clan(clan_tag,name) values ($1,'Access Clan'),($2,'Other Clan')",
    [CLAN, OTHER_CLAN],
  );
  for (const [i, tag] of [...TAGS, OUTSIDER].entries()) {
    const clan = tag === OUTSIDER ? OTHER_CLAN : CLAN;
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      `Invented ${i}`,
    ]);
    await db.query(
      "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values ($1,$2,$3,now() - interval '60 days')",
      [clan, tag, tag === LEADER || tag === OUTSIDER ? "leader" : "member"],
    );
  }
  const {
    rows: [owner],
  } = await db.query(
    "insert into account(email_hash,status) values ('cra-owner','approved') returning account_id",
  );
  for (const clan of [CLAN, OTHER_CLAN])
    await db.query(
      "insert into recording(subject_type,subject_tag,requested_by,scope) values ('clan',$1,$2,'comprehensive')",
      [clan, owner.account_id],
    );
  // Fresh rosters, so a leader's change is not held for a live read.
  await db.query(
    "insert into poll_state(subject_tag,endpoint,last_admitted_at) values ($1,'clan',now() + interval '1 day'),($2,'clan',now() + interval '1 day')",
    [CLAN, OTHER_CLAN],
  );
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, donations, observed_at, clan_tag, roster_observed_at)
     select t, current_date - d, 'daily', d * 3, now() - d * interval '1 day', $2, now() - d * interval '1 day'
       from unnest($1::text[]) t, generate_series(0, 40) d`,
    [TAGS, CLAN],
  );
  const season = seasonFromDate(Date.now()).seasonId;
  for (const [section, started, finished] of [
    [0, "now() - interval '9 days'", "now() - interval '2 days'"],
    [1, "now() - interval '2 days'", "null"],
  ]) {
    await db.query(
      `insert into war_week(clan_tag,season_id,section_index,started_observed_at,finished_observed_at) values ($1,$2,$3,${started},${finished})`,
      [CLAN, season, section],
    );
    await db.query(
      `insert into war_participation(clan_tag,season_id,section_index,player_tag,points,decks_used)
       select $1,$2,$3,t,400 + i::int*10, 4 + (i::int % 13) from unnest($4::text[]) with ordinality as x(t,i)`,
      [CLAN, season, section, TAGS],
    );
  }
  for (const [who, tag] of [
    ["leader", LEADER],
    ["member", MEMBER],
    ["outsider", OUTSIDER],
  ]) {
    const {
      rows: [a],
    } = await db.query(
      "insert into account(email_hash,status) values ($1,'approved') returning account_id",
      [`cra-${who}`],
    );
    await db.query(
      "insert into claim(account_id,player_tag,status,relationship,is_primary) values ($1,$2,'verified','primary',true)",
      [a.account_id, tag],
    );
    const { token } = await createSession(db, {
      secret: "test",
      accountId: a.account_id,
      emailHash: `cra-${who}`,
    });
    cookies[who] = `__Host-elixir_session=${token}`;
  }
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    clan: createClanRequest({ origin: "https://elixir.poapkings.com" }),
  });
  // The leader sets the clan's policy, so every page has something to read.
  const set = await call("leader", "POST", `${PATH}/policy`, { values: {} });
  assert.equal(set.status, 200, JSON.stringify(set.body));
});
after(async () => scratch?.drop());

async function call(who, method, path, body) {
  const r = await handler({
    path,
    method,
    headers: { cookie: cookies[who], "x-elixir-client": "web" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

/** Every Clan route that reads the record, and the read(s) it makes. */
const ROUTES = [
  ["GET", "/me", "clans_participation"],
  ["GET", "/home", "clans_participation"],
  ["GET", "/week", "clans_participation, clans_roster, war_history"],
  ["GET", "/season", "clans_participation, war_history"],
  ["GET", "/standing", "clans_participation"],
  ["GET", "/actions", "clans_participation, players_names"],
  ["GET", "/manage", "clans_participation, clans_roster"],
  ["GET", "/policy", "clans_roster"],
  ["POST", "/policy/preview", "clans_participation", { values: {} }],
  ["GET", "/awards", "clans_participation"],
  ["GET", "/history", "clans_roster"],
  ["GET", "/race", "war_current"],
  [
    "GET",
    `/members/${TAGS[3].slice(1)}/activity`,
    "clans_roster, battles_query, elixir_coverage",
  ],
  ["GET", "/recruit", "live_fetch, clans_roster"],
  ["POST", "/scout", "players_profile, battles_query", { tag: TAGS[4] }],
];

/** What a member may not read: Run's reads, a leader's tools, and
 *  Recruit and Scout (elders up). */
const NOT_FOR_MEMBERS = new Set([
  "/history",
  "/manage",
  "/policy/preview",
  "/recruit",
  "/scout",
]);

test("a player of another clan reads nothing of this clan's, through every read", async () => {
  for (const [method, rest, reads, body] of ROUTES) {
    const r = await call("outsider", method, `${PATH}${rest}`, body);
    assert.equal(r.status, 403, `${method} ${rest} (${reads})`);
    assert.equal(r.body.error, "not_your_clan", `${method} ${rest}`);
    // Nothing of the clan's in the refusal: no member, no number.
    for (const tag of TAGS)
      assert.ok(!JSON.stringify(r.body).includes(tag), `${rest} ${tag}`);
  }
});

test("a member is refused the leaders' and elders' reads, and answered their own", async () => {
  for (const [method, rest, reads, body] of ROUTES) {
    const r = await call("member", method, `${PATH}${rest}`, body);
    if (NOT_FOR_MEMBERS.has(rest)) {
      assert.equal(r.status, 403, `${method} ${rest} (${reads})`);
      assert.match(
        r.body.error,
        /^(leaders_only|elders_only)$/,
        `${method} ${rest}`,
      );
      for (const tag of TAGS.filter((t) => t !== MEMBER))
        assert.ok(!JSON.stringify(r.body).includes(tag), `${rest} ${tag}`);
    } else
      assert.ok(
        r.status === 200,
        `${method} ${rest}: ${r.status} ${JSON.stringify(r.body)}`,
      );
  }
});

test("the leader is answered every one of these reads", async () => {
  for (const [method, rest, reads, body] of ROUTES) {
    const r = await call("leader", method, `${PATH}${rest}`, body);
    assert.equal(
      r.status,
      200,
      `${method} ${rest} (${reads}): ${JSON.stringify(r.body)}`,
    );
  }
});
