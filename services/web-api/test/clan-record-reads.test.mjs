/**
 * Clan reads the record in process (2026-11-13): no recorded client, no
 * credential, no audited tool call. Every read Clan makes must answer
 * exactly what it answered through the audited invoker, on the same
 * record: the web path as the signed-in person (who was marked first
 * party then), and the morning run as Elixir itself (which read as the
 * `elixir-clan` integration then). The comparison drops only what the
 * invoker adds to a client's call: its request id and pending hints.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  scratchDb,
  fixture,
  fixtureMeta,
  trackClans,
} from "../../../packages/ingest/test/helpers.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeInvoker, makeRecordReader } from "@elixir-mcp/tools/invoker";
import { SYSTEM_READER } from "@elixir-mcp/clan/record.mjs";

process.env.TZ = "UTC";

const registry = makeRegistry();
const HOUR = 3600_000;
let scratch, db, person, integration, clanTag, profileTag, battleTag, members;

/** The live lane, the same answer for both paths: the profile fixture. */
let profilePayload, rosterPayload;
const live = async (_db, { endpoint }) => ({
  ok: true,
  fetched_at: new Date(Date.now() - 60_000).toISOString(),
  payload: endpoint === "player" ? profilePayload : rosterPayload,
});

before(async () => {
  scratch = await scratchDb("clan_record_reads");
  db = scratch.db;
  await ensureSeasonsAround(db);
  const meta = await fixtureMeta();
  rosterPayload = await fixture("clan/roster.json");
  profilePayload = await fixture("player/profile.json");
  clanTag = rosterPayload.tag;
  profileTag = profilePayload.tag;
  battleTag = meta["player_battlelog/with_boat_and_duel.json"].entity_key;
  members = rosterPayload.memberList.map((m) => m.tag);
  await trackClans(db, [clanTag]);
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner, role) values ('crr-owner', 'approved', true, 'owner') returning account_id`,
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'crr-gw', '127.0.0.1', 'active') returning gateway_id`,
    [owner.account_id],
  );
  const send = async (endpoint, entityKey, payload, fetchedAt) => {
    const r = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(r.outcome, "admitted", JSON.stringify(r));
  };
  const recent = (h) => new Date(Date.now() - h * HOUR).toISOString();
  await send("clan", clanTag, rosterPayload, recent(3));
  await send("player", profileTag, profilePayload, recent(2));
  await send(
    "player_battlelog",
    battleTag,
    await fixture("player_battlelog/with_boat_and_duel.json"),
    recent(1),
  );
  await send(
    "riverracelog",
    clanTag,
    await fixture("riverracelog/log.json"),
    recent(1),
  );
  // Eight weeks of donations and two war weeks for the roster, so the
  // participation read has something in every column.
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, donations, observed_at, clan_tag, roster_observed_at)
     select t, current_date - d, 'daily', d * 7 + i::int, now() - d * interval '1 day', $2, now() - d * interval '1 day'
       from unnest($1::text[]) with ordinality as x(t, i), generate_series(0, 56) d
     on conflict do nothing`,
    [members.slice(0, 20), clanTag],
  );
  for (const [section, started, finished] of [
    [0, "now() - interval '9 days'", "now() - interval '2 days'"],
    [1, "now() - interval '2 days'", "null"],
  ]) {
    await db.query(
      `insert into war_week (clan_tag, season_id, section_index, started_observed_at, finished_observed_at)
       values ($1, 990, $2, ${started}, ${finished})`,
      [clanTag, section],
    );
    await db.query(
      `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
       select $1, 990, $2, t, 300 + i::int * 20, 1 + i::int % 16
         from unnest($3::text[]) with ordinality as x(t, i)`,
      [clanTag, section, members.slice(0, 20)],
    );
  }
  // The signed-in person: a verified leader of the clan, with a nickname
  // of their own on a clanmate (a person's reads show their nicknames).
  const {
    rows: [p],
  } = await db.query(
    `insert into account (email_hash, status, role) values ('crr-person', 'approved', 'member') returning account_id`,
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, relationship, is_primary)
     values ($1, $2, 'verified', 'primary', true)`,
    [p.account_id, profileTag],
  );
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname) values ($1, $2, 'Invented Pal')`,
    [p.account_id, members.find((t) => t !== profileTag)],
  );
  person = {
    accountId: p.account_id,
    kind: "person",
    role: "member",
    timezone: null,
  };
  const {
    rows: [i],
  } = await db.query(
    `insert into account (email_hash, status, role, kind, owned_by_account_id)
     values ('crr-clan-attester', 'approved', 'member', 'integration', $1) returning account_id`,
    [owner.account_id],
  );
  integration = {
    accountId: i.account_id,
    name: "elixir-clan",
    kind: "integration",
    role: "member",
  };
});
after(async () => scratch?.drop());

/** Every read Clan makes, with the arguments it makes it with. */
const reads = () => [
  ["elixir_my_players", {}],
  ["clans_participation", { clan_tag: clanTag, weeks: 8 }],
  ["clans_participation", { clan_tag: clanTag, weeks: 4 }],
  ["war_history", { clan_tag: clanTag, seasons: 12 }],
  ["clans_roster", { clan_tag: clanTag }],
  ["clans_roster", { clan_tag: clanTag, verbosity: "compact" }],
  ["clans_roster", { clan_tag: clanTag, verbosity: "compact", live: true }],
  ["players_names", { player_tags: members.slice(0, 100) }],
  ["players_profile", { player_tag: profileTag, live: true }],
  [
    "battles_query",
    { player_tag: battleTag, live: true, limit: 25, verbosity: "compact" },
  ],
  [
    "battles_query",
    {
      player_tag: battleTag,
      from: "2026-08-01T00:00:00.000Z",
      to: new Date().toISOString(),
      limit: 25,
      verbosity: "compact",
    },
  ],
  ["elixir_coverage", { player_tag: profileTag }],
  ["live_fetch", { path: `/clans/${clanTag}` }],
  ["war_current", { clan_tag: clanTag }],
  // A refusal reads the same way too.
  ["clans_roster", { clan_tag: "#0LUVR2" }],
];

/** What the invoker adds to a client's call, and the clock. */
function comparable(body) {
  const seen = (v) => {
    if (Array.isArray(v)) return v.map(seen);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .filter(
            ([k]) =>
              ![
                "request_id",
                "feedback_responses_pending",
                "timeline_pending",
              ].includes(k),
          )
          .map(([k, x]) => [
            k,
            // A clock read during the call (as_of, freshness, the hours
            // since the latest snapshot) moves between the two runs;
            // anything older is the record's. unmeasured_tail_hours is
            // rounded to 0.01 h, so a slow host crossed a step between
            // them (2.00 then 2.01, verify on 2026-11-13).
            typeof x === "string" &&
            /^\d{4}-\d{2}-\d{2}T/.test(x) &&
            Math.abs(Date.parse(x) - Date.now()) < 120_000
              ? "<now>"
              : (k === "freshness_seconds" || k === "unmeasured_tail_hours") &&
                  typeof x === "number"
                ? "<age>"
                : seen(x),
          ]),
      );
    return v;
  };
  return seen(body);
}

for (const [label, oldAccount, newAccount, opts] of [
  [
    "the web path, as the signed-in person",
    () => ({ ...person, firstParty: true }),
    () => person,
    { clientName: "Clan", queryBudgetMs: 15_000, deadlineMs: 25_000 },
  ],
  [
    "the morning run, as Elixir itself",
    () => ({ ...integration, firstParty: true }),
    () => SYSTEM_READER,
    { clientName: "Clan morning", queryBudgetMs: 15_000, deadlineMs: 75_000 },
  ],
])
  test(`${label}: every Clan read answers what the audited invoker answered`, async () => {
    const before = (
      await db.query("select count(*)::int n from mcp_call_audit")
    ).rows[0].n;
    const invoke = makeInvoker({
      db,
      account: oldAccount(),
      registry,
      live,
      surface: "web",
      ...opts,
    });
    const read = makeRecordReader({
      db,
      account: newAccount(),
      registry,
      live,
      surface: "web",
      queryBudgetMs: opts.queryBudgetMs,
      deadlineMs: opts.deadlineMs,
    });
    let answered = 0;
    for (const [name, args] of reads()) {
      if (name === "elixir_my_players" && newAccount() === SYSTEM_READER)
        continue; // the morning run has no person to read for
      const was = await invoke(name, structuredClone(args));
      const now = await read(name, structuredClone(args));
      assert.equal(now.isError, was.isError, `${name} ${JSON.stringify(args)}`);
      assert.deepEqual(
        comparable(now.body),
        comparable(was.body),
        `${name} ${JSON.stringify(args)}`,
      );
      if (!now.isError) answered += 1;
    }
    // The fixture reaches what it claims: every read but the refusal
    // answers (and the morning run asks no elixir_my_players).
    const asked = reads().length - (newAccount() === SYSTEM_READER ? 1 : 0);
    assert.equal(answered, asked - 1);
    // The old path audited each call; the new one leaves no row.
    const audited = (
      await db.query(
        "select count(*)::int n, count(*) filter (where client_name like 'Clan%')::int clan from mcp_call_audit",
      )
    ).rows[0];
    assert.ok(audited.clan > 0);
    const n = audited.n;
    for (const [name, args] of reads()) await read(name, args);
    assert.equal(
      (await db.query("select count(*)::int n from mcp_call_audit")).rows[0].n,
      n,
    );
    assert.ok(n > before);
    await db.query("delete from mcp_call_audit");
  });

test("the person's own nickname is in their roster read, and never in the morning run's", async () => {
  const mine = await makeRecordReader({ db, account: person, registry })(
    "clans_roster",
    { clan_tag: clanTag },
  );
  const system = await makeRecordReader({
    db,
    account: SYSTEM_READER,
    registry,
  })("clans_roster", { clan_tag: clanTag });
  const nick = (r) => JSON.stringify(r.body).includes("Invented Pal");
  assert.equal(nick(mine), true);
  assert.equal(nick(system), false);
});

test("a read past its budget answers query_timeout, and the session's settings come back", async () => {
  const read = makeRecordReader({
    db,
    account: person,
    registry,
    deadlineMs: 1,
  });
  const r = await read("clans_participation", { clan_tag: clanTag, weeks: 8 });
  assert.equal(r.isError, true);
  assert.equal(r.body.error.code, "query_timeout");
  const { rows } = await db.query(
    "select current_setting('statement_timeout') st, current_setting('lock_timeout') lt",
  );
  assert.deepEqual(rows[0], { st: "0", lt: "0" });
});
