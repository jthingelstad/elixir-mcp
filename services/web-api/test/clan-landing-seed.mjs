/**
 * A realistic clan for measuring Clan's landing reads (2026-11-13): the
 * fixture roster (49 members, invented but for King Thing #20JJJ2CCRU,
 * its leader, and POAP KINGS #J2RGCRVG), twelve weeks of battle logs for
 * every member through the ingest pipeline, ninety days of donation
 * snapshots, the race log and the race now, a saved policy, and other
 * clans' battles beside them so the clan's rows are a small part of
 * each table, as in production. Every other tag is made up here, at
 * random over the game's alphabet, and never written to a file.
 *
 * `seedClanLanding()` answers the scratch database, the leader's
 * session cookie and the clan's tag; the caller drops the database.
 */
import { gzipSync } from "node:zlib";
import {
  scratchDb,
  fixture,
  trackClans,
} from "../../../packages/ingest/test/helpers.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { createSession } from "@elixir-mcp/auth";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { EXAMPLE_POLICY } from "../../../packages/clan-engine/test/fixture.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ALPHABET = "0289PYLQGRJCUV";

/** A small seeded generator, so a run's data is the same every time. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The CR API's battle time, `20260902T061714.000Z`. */
const crTime = (ms) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.(\d{3})Z$/, ".$1Z");

export async function seedClanLanding(
  name = "clan_landing",
  { weeks = 12, others = 8, now = Date.now() } = {},
) {
  const scratch = await scratchDb(name);
  const t0 = Date.now();
  const step = (what) =>
    process.env.SEED_LOG && console.log(`seed ${what} ${Date.now() - t0} ms`);
  const db = scratch.db;
  const rand = random(20261113);
  const tag = () =>
    `#0${Array.from({ length: 8 }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("")}`;
  await ensureSeasonsAround(db);
  const roster = await fixture("clan/roster.json");
  const template = await fixture("player_battlelog/with_boat_and_duel.json");
  const clanTag = roster.tag;
  const members = roster.memberList.map((m) => ({ tag: m.tag, name: m.name }));
  const leader = roster.memberList.find((m) => m.role === "leader");
  await trackClans(db, [clanTag]);
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner, role)
     values ('landing-owner', 'approved', true, 'owner') returning account_id`,
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'landing-gw', '127.0.0.1', 'active') returning gateway_id`,
    [owner.account_id],
  );
  const send = async (endpoint, entityKey, payload, fetchedMs) => {
    const r = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: new Date(fetchedMs).toISOString(),
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    if (r.outcome !== "admitted")
      throw new Error(`seed ${endpoint} ${JSON.stringify(r)}`);
  };

  // A battle log per member per week, the newest an hour ago: the
  // template's 34 battles (ladder, war, boat, a duel) as this member,
  // against opponents made up per battle, spread over the week.
  // Members' older battles were played in another clan, as a member who
  // joined some weeks ago brings, so a read for battles "in this clan"
  // walks past them.
  const before = { tag: tag(), name: "Earlier Clan" };
  const battlelog = (member, endMs, elsewhere) =>
    template.map((b, j) => {
      const copy = structuredClone(b);
      copy.battleTime = crTime(
        endMs - j * 4.5 * HOUR - Math.floor(rand() * HOUR),
      );
      const me = copy.team[0];
      me.tag = member.tag;
      me.name = member.name;
      if (me.clan)
        me.clan = elsewhere
          ? { ...me.clan, ...before }
          : { ...me.clan, tag: clanTag, name: roster.name };
      for (const side of [copy.team.slice(1), copy.opponent])
        for (const p of side) {
          p.tag = tag();
          p.name = "Invented Rival";
          if (p.clan) p.clan = { ...p.clan, tag: tag(), name: "Rival Clan" };
        }
      return copy;
    });
  await send("clan", clanTag, roster, now - 3 * HOUR);
  step("roster");
  for (let w = weeks - 1; w >= 0; w--)
    for (const m of members)
      await send(
        "player_battlelog",
        m.tag,
        battlelog(m, now - w * 7 * DAY - HOUR, w >= 6),
        now - w * 7 * DAY - HOUR / 2,
      );
  step("battlelogs");
  await send(
    "riverracelog",
    clanTag,
    await fixture("riverracelog/log.json"),
    now - 2 * HOUR,
  );
  await send(
    "currentriverrace",
    clanTag,
    await fixture("currentriverrace/war_day.json"),
    now - HOUR,
  );
  // Ninety days of donation snapshots for every member.
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, donations, observed_at, clan_tag, roster_observed_at)
     select t, current_date - d, 'daily', d * 7 + i::int, now() - d * interval '1 day', $2, now() - d * interval '1 day'
       from unnest($1::text[]) with ordinality as x(t, i), generate_series(0, 90) d
     on conflict do nothing`,
    [members.map((m) => m.tag), clanTag],
  );
  // Other clans' players beside ours: each table holds far more than one
  // clan, so a read that scans one is visible in its plan. Copies of the
  // clan's own battles under other tags, `others` times over, each row
  // copied whole whatever its columns.
  // A bulk copy: foreign keys are not checked while it runs, since every
  // copied row points at a copied player and battle.
  step("snapshots");
  await db.query("set session_replication_role = replica");
  const code = (sql) => `translate(${sql}, '0123456789', '0289PYLQGR')`;
  const other = (col, k) =>
    `'#Q' || ${code(`lpad(${k}::text, 2, '0')`)} || substr(${col}, 3)`;
  await db.query(
    `insert into player (player_tag, name)
     select distinct ${other("player_tag", "k")}, 'Invented Other'
       from battle_participant, generate_series(1, $1) k
     on conflict do nothing`,
    [others],
  );
  // Each copy is the row whole, its columns listed from the catalog, with
  // the named ones replaced; generated columns are left to the table.
  const copy = async (table, alias, replace, tail = "") => {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
        where table_schema = current_schema() and table_name = $1
          and is_generated = 'NEVER'
        order by ordinal_position`,
      [table],
    );
    const cols = rows.map((r) => r.column_name);
    const list = cols.map((c) => replace[c] ?? `${alias}.${c}`).join(", ");
    await db.query(
      `insert into ${table} (${cols.join(", ")})${table === "battle" ? " overriding system value" : ""}
       select ${list} from ${table} ${alias}, generate_series(1, $1) k${tail}`,
      [others],
    );
  };
  await copy("battle", "b", {
    battle_id: "b.battle_id || '-' || k",
    cursor: "b.cursor + k * 10000000",
    battle_time: "b.battle_time - k * interval '7 minutes'",
  });
  await copy("battle_participant", "bp", {
    battle_id: "bp.battle_id || '-' || k",
    player_tag: other("bp.player_tag", "k"),
    clan_tag: `case when bp.clan_tag is null then null else ${other("bp.clan_tag", "k")} end`,
    battle_time: "bp.battle_time - k * interval '7 minutes'",
  });
  await copy(
    "player_snapshot_daily",
    "s",
    {
      player_tag: other("s.player_tag", "k"),
      clan_tag: other("s.clan_tag", "k"),
    },
    " on conflict do nothing",
  );
  // When the record learned each battle: within the hour for the clan's
  // own, as a polled clan's are, and for half the others a backfill
  // learned this week whatever its play time, the late captures a
  // newly followed player brings.
  await db.query(
    `update battle set created_at = case
       when battle_id like '%-%' and right(battle_id, 1) in ('1', '3', '5', '7')
         then least(now(), greatest(battle_time, now() - (abs(hashtext(battle_id)) % 604800) * interval '1 second'))
       else least(now(), battle_time + interval '40 minutes') end`,
  );
  await db.query("set session_replication_role = default");
  step("filler");

  // The signed-in person: King Thing, the clan's leader, verified.
  const {
    rows: [p],
  } = await db.query(
    `insert into account (email_hash, status, role) values ('landing-leader', 'approved', 'member') returning account_id`,
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, relationship, is_primary)
     values ($1, $2, 'verified', 'primary', true)`,
    [p.account_id, leader.tag],
  );
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ($1, 'clan', now() + interval '1 day')
     on conflict (subject_tag, endpoint) do update set last_admitted_at = excluded.last_admitted_at`,
    [clanTag],
  );
  await createPostgresLedger(db).savePolicy(clanTag, {
    values: EXAMPLE_POLICY,
    by: leader.tag,
    by_name: leader.name,
    note: null,
  });
  const session = await createSession(db, {
    secret: "test",
    accountId: p.account_id,
    emailHash: "landing-leader",
  });
  await db.query("vacuum analyze");
  step("done");
  return {
    scratch,
    db,
    clanTag,
    leaderTag: leader.tag,
    accountId: p.account_id,
    cookie: `__Host-elixir_session=${session.token}`,
  };
}
