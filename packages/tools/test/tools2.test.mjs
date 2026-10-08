import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { emailHash } from "../../auth/src/index.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { ensureSeasonsAround, ensureSeason } from "@elixir-mcp/record/season";
import { dailySql } from "../../record/src/daily-sql.mjs";
import { notBoatDefense } from "../../record/src/boat-defense-sql.mjs";
import { refreshDailyRollups } from "../../ingest/src/rollups.mjs";
import { typesForModeGroup } from "@elixir-mcp/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_tools2_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const OBSERVER = "#JYRQ8U92C"; // colosseum-duel battlelog + profile fixture subject
let db;
let account;
let invoke;

async function fixture(rel) {
  return JSON.parse(
    await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
  );
}

async function call(name, args = {}) {
  const { body, isError } = await invoke(name, args);
  return { body, isError };
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  // What the scheduler does every tick (0104): the running season is a
  // row whatever day this runs on.
  await ensureSeasonsAround(db);

  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status) values ($1, 'approved')
     returning account_id, email_hash, is_owner, timezone`,
    [emailHash("tools2@example.com")],
  );
  account = {
    accountId: acct.account_id,
    emailHash: acct.email_hash,
    isOwner: acct.is_owner,
    timezone: acct.timezone,
  };
  await db.query(`insert into player (player_tag) values ($1)`, [OBSERVER]);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'verified', true)`,
    [account.accountId, OBSERVER],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [OBSERVER, account.accountId],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'tools2-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.accountId],
  );
  const send = async (endpoint, entityKey, payload, fetchedAt) => {
    const result = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(result.outcome, "admitted", JSON.stringify(result));
  };
  await send(
    "player_battlelog",
    OBSERVER,
    await fixture("player_battlelog/with_colosseum_duel.json"),
    "2026-09-03T14:30:34Z",
  );
  await send(
    "player",
    OBSERVER,
    await fixture("player/profile.json"),
    "2026-09-01T14:40:34Z",
  );
  const day2 = structuredClone(await fixture("player/profile.json"));
  day2.trophies += 40;
  day2.battleCount += 12;
  await send("player", OBSERVER, day2, "2026-09-03T14:40:34Z");
  await send(
    "cards",
    "GLOBAL",
    await fixture("cards/catalog.json"),
    "2026-09-03T13:00:00Z",
  );

  const registry = makeRegistry();
  invoke = makeInvoker({ db, account, registry });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("players_timeline: daily series with multiple metrics", async () => {
  const { body, isError } = await call("players_timeline", {
    metrics: ["trophies", "battle_count"],
  });
  assert.equal(isError, false);
  assert.equal(body.series.length, 2, "two snapshot days");
  assert.ok(body.series[1].trophies > body.series[0].trophies);
  assert.equal(body.series[1].battle_count - body.series[0].battle_count, 12);
});

test("battles_performance: window totals reconcile and before_after splits", async () => {
  const { body } = await call("battles_performance", {});
  const w = body.window;
  assert.ok(w.battles > 0);
  assert.equal(w.wins + w.losses + w.draws <= w.battles, true);
  assert.ok(typeof w.win_rate === "number");
  assert.ok(Number.isInteger(w.current_streak));

  const split = await call("battles_performance", {
    before_after: "2026-09-01",
  });
  assert.ok(split.body.before && split.body.after && split.body.split_at);
  assert.equal(
    split.body.before.battles + split.body.after.battles,
    w.battles,
    "the two windows partition the record",
  );
});

test("days/weeks are sugar on EVERY windowed tool, as the instructions promise", async () => {
  // 2026-09-15: a routine sent days: 1 to battles_performance right after
  // clans_standings({days: 1}) had worked, and lost three calls to
  // bad_request. The instructions say "days/weeks are sugar"; now it is
  // true for each tool that takes a window, including the ones that read
  // from/to by hand (elixir_timeline, rankings_timeline, game_events) and
  // the date-only one (players_timeline).
  const dayAgo = Date.now() - 86_400_000;
  const near = (iso) => Math.abs(Date.parse(iso) - dayAgo) < 60_000;

  const perf = await call("battles_performance", { days: 1 });
  assert.equal(perf.isError, false, JSON.stringify(perf.body));
  assert.equal(perf.body.applied.window.source, "argument");
  assert.ok(near(perf.body.applied.window.from), perf.body.applied.window.from);

  const weeks = await call("battles_query", { weeks: 2, limit: 1 });
  assert.equal(weeks.isError, false, JSON.stringify(weeks.body));
  assert.ok(
    Math.abs(
      Date.parse(weeks.body.applied.window.from) -
        (Date.now() - 14 * 86_400_000),
    ) < 60_000,
  );

  // from/to given win over the sugar; both together are not a conflict.
  const both = await call("battles_performance", {
    days: 30,
    from: "2026-09-01",
  });
  assert.equal(both.isError, false);
  assert.match(both.body.applied.window.from, /^2026-09-01T/);

  const events = await call("game_events", { days: 3 });
  assert.equal(events.isError, false, JSON.stringify(events.body));

  const tl = await call("players_timeline", { days: 2 });
  assert.equal(tl.isError, false, JSON.stringify(tl.body));
  // days: N is N GAME days on the 10:00Z grid, today's included, so the
  // expected day is the game day a day ago (the UTC date of that instant
  // less ten hours), not the UTC date: before 10:00Z they differ.
  assert.equal(
    tl.body.applied.window.from,
    new Date(dayAgo - 10 * 3600_000).toISOString().slice(0, 10),
    "two game days of snapshots: yesterday's and today's",
  );
});

test("battles_cards: mine and opponent perspectives, each duel round a game (9.11.0)", async () => {
  const mine = await call("battles_cards", { perspective: "mine" });
  assert.equal(mine.isError, false);
  assert.ok(mine.body.cards.length > 0, "cards attributed");
  for (const c of mine.body.cards) {
    assert.equal(c.battles, c.wins + c.losses);
    assert.ok(c.win_rate >= 0 && c.win_rate <= 1);
  }
  // The duel's rounds are war games: the window's war group holds them
  // beside the war battles with a deck (1v1 and boat attacks), each
  // decided by its own crowns.
  const {
    rows: [war],
  } = await db.query(
    `select (select count(*)::int from battle_participant bp
              where bp.player_tag = $1 and bp.type = any($2)
                and bp.deck_hash is not null and bp.outcome in ('win','loss')
                and ${notBoatDefense()}) as battles,
            (select count(*)::int from battle_participant_round
              where player_tag = $1 and outcome in ('win','loss')) as rounds`,
    [OBSERVER, typesForModeGroup("war")],
  );
  assert.ok(war.rounds > 0, "the fixture's duel has decided rounds");
  assert.equal(
    mine.body.modes_in_window.war?.battles,
    war.battles + war.rounds,
  );
  const opp = await call("battles_cards", { perspective: "opponent" });
  assert.equal(opp.isError, false);
  assert.match(opp.body.notes.join(" "), /OPPONENT/);
});

test("battles_decks: a light list by deck_hash, one page at a time, and one deck in full (9.12.0)", async () => {
  const { body, isError } = await call("battles_decks", {});
  assert.equal(isError, false);
  assert.ok(body.decks.length > 0);
  const d = body.decks[0];
  assert.ok(d.deck_hash);
  assert.equal(d.card_names.split(", ").length, 8, "the cards in one line");
  assert.equal(d.cards, undefined, "no card objects in the list");
  assert.equal(d.archetype, undefined);
  assert.ok(d.battles >= d.wins + d.losses + d.draws);
  assert.ok(d.first_used <= d.last_used);
  assert.equal(body.total_decks >= body.decks.length, true);

  // Pages: every deck once, in the list's order, and the last says so.
  const pages = [];
  for (let offset = 0; offset !== null;) {
    const page = await call("battles_decks", { limit: 2, offset });
    assert.equal(page.body.total_decks, body.total_decks);
    pages.push(...page.body.decks.map((x) => x.deck_hash));
    offset = page.body.next_offset;
    assert.ok(pages.length <= body.total_decks, "paging ends");
  }
  const whole = await call("battles_decks", { limit: 100 });
  assert.deepEqual(
    pages,
    whole.body.decks.map((x) => x.deck_hash),
  );

  // One deck: the same row, its objects in full, the window's totals.
  const one = await call("battles_decks", { deck_hash: d.deck_hash });
  assert.equal(one.body.decks.length, 1);
  const full = one.body.decks[0];
  assert.equal(full.battles, d.battles);
  assert.equal(full.share_of_battles, d.share_of_battles);
  assert.equal(full.cards.length, 8);
  assert.equal(typeof full.archetype.label, "string");
  assert.equal(full.card_names, d.card_names);
  assert.equal(one.body.total_battles_in_window, body.total_battles_in_window);

  // compact keeps the comparison and drops the detail.
  const compact = await call("battles_decks", { verbosity: "compact" });
  assert.equal(compact.body.decks[0].modes, undefined);
  assert.equal(compact.body.decks[0].level_gap_battles, undefined);
  assert.equal(
    compact.body.decks[0].mean_level_gap,
    body.decks[0].mean_level_gap,
  );
});

test("players_collection: API-shaped passthrough of the latest payload", async () => {
  const { body, isError } = await call("players_collection", {});
  assert.equal(isError, false);
  assert.ok(Array.isArray(body.cards) && body.cards.length > 50);
  assert.ok(body.cards[0].id && body.cards[0].name, "API shapes pass through");
  assert.ok(body.collection_level !== undefined);
  // Levels are display-scale: none exceeds 16.
  assert.ok(body.cards.every((c) => c.level <= 16));
  // 6.14.0: the catalog's facts are not repeated per card.
  for (const k of [
    "iconUrls",
    "rarity",
    "elixirCost",
    "maxLevel",
    "maxLevelRarityScale",
  ])
    assert.ok(
      body.cards.every((c) => !(k in c)),
      `${k} is cards_catalog's`,
    );
  assert.ok(
    body.cards.every((c) => "forms_unlocked" in c && "forms_available" in c),
  );
  // The profile fixture holds at least one maxed non-common: raw level
  // below 16 that normalizes to exactly 16.
  assert.ok(
    body.cards.some((c) => c.level === 16),
    "maxed cards read 16 like the game shows",
  );
});

test("cards_catalog: served from the recorded GLOBAL payload", async () => {
  const { body, isError } = await call("cards_catalog", {});
  assert.equal(isError, false);
  assert.ok(Array.isArray(body.cards) && body.cards.length > 100);
  assert.ok(Array.isArray(body.tower_troops) && body.tower_troops.length > 0);
});

test("live_fetch: allowlist validation, then honest live_unavailable", async () => {
  const bad = await call("live_fetch", { path: "/locations/global/rankings" });
  assert.equal(bad.body.error.code, "bad_request");
  const badTag = await call("live_fetch", { path: "/players/NOT-A-TAG!" });
  assert.equal(badTag.body.error.code, "invalid_tag");
  assert.equal(
    badTag.body.error.class,
    "input",
    "3.18.0: every error carries its class",
  );
  const crossed = await call("live_fetch", {
    path: "/clans/#J2RGCRVG/battlelog",
  });
  assert.equal(crossed.body.error.code, "bad_request");
  const ok = await call("live_fetch", { path: "/players/#20JJJ2CCRU" });
  assert.equal(ok.body.error.code, "live_unavailable");
});

test("the V1 tools remain declared among the full registry", () => {
  const names = makeRegistry()
    .declarations()
    .map((d) => d.name);
  for (const required of [
    "live_fetch",
    "cards_catalog",
    "battles_cards",
    "players_collection",
    "elixir_coverage",
    "battles_decks",
    "battles_performance",
    "players_profile",
    "players_timeline",
    "battles_query",
    "elixir_my_players",
  ]) {
    assert.ok(names.includes(required), required);
  }
});

test("round-1 tester fixes: inverted windows refuse; compact drops decks; null cursor ends pages", async () => {
  const inverted = await call("battles_query", {
    from: "2026-09-10",
    to: "2026-09-01",
  });
  assert.equal(inverted.body.error.code, "bad_request");
  assert.match(inverted.body.error.message, /inverted/);

  const compactRes = await call("battles_query", {
    limit: 2,
    verbosity: "compact",
  });
  assert.equal(compactRes.isError, false);
  assert.ok(
    compactRes.body.battles[0].me.deck === undefined,
    "compact drops decks",
  );
  assert.ok(compactRes.body.battles[0].me.deck_hash, "hash stays");

  const short = await call("battles_query", {
    limit: 50,
    verbosity: "compact",
  });
  assert.equal(short.body.next_cursor, null, "explicit null on final page");

  const perf = await call("battles_performance", {
    before_after: "2026-09-01",
    compare_from: "2026-08-01",
  });
  assert.match(
    perf.body.notes.join(" "),
    /compare_from\/compare_to were ignored/,
  );
  assert.ok(perf.body.applied, "filters echoed");

  const tl = await call("players_timeline", { from: "2026-05-01" });
  assert.ok(tl.body.snapshots_available_from, "epoch disclosed");
});

test("wishlist batch: weekly trend, headline summary, deck ergonomics, total_count", async () => {
  const trend = await call("battles_performance", { group_by: "week" });
  assert.equal(trend.isError, false);
  assert.ok(Array.isArray(trend.body.weekly) && trend.body.weekly.length > 0);
  assert.ok(trend.body.weekly[0].iso_week.match(/^\d{4}-W\d{2}$/));

  const sum = await call("players_summary", {});
  assert.equal(sum.isError, false);
  assert.ok(sum.body.last_30_days.battles >= 0);
  assert.ok(sum.body.top_deck === null || sum.body.top_deck.deck_hash);

  const decks = await call("battles_decks", {
    sort: "win_rate",
    min_battles: 1,
  });
  assert.equal(decks.isError, false);
  assert.ok(decks.body.total_battles_in_window >= 0);
  if (decks.body.decks.length > 0) {
    assert.ok(decks.body.decks[0].share_of_battles !== undefined);
  }

  const counted = await call("battles_query", {
    limit: 1,
    include_total: true,
  });
  assert.equal(counted.isError, false);
  assert.ok(counted.body.total_count >= counted.body.battles.length);
});

test("round-3 fixes: honest validation and richer shapes", async () => {
  // Empty player_tag is a caller bug, never a silent default.
  const empty = await call("players_profile", { player_tag: "" });
  assert.equal(empty.isError, true);
  assert.equal(empty.body.error.code, "invalid_tag");

  // Forged-but-parseable cursor refused (the id half must be real).
  const forged = await call("battles_query", {
    cursor: `2026-01-01T00:00:00Z|${"0".repeat(64)}`,
  });
  assert.equal(forged.isError, true);
  assert.equal(forged.body.error.code, "bad_request");

  // Weekly rows: week_of is the ISO week's Monday; trophy-eligible count rides along.
  const trend = await call("battles_performance", { group_by: "week" });
  assert.ok(trend.body.weekly.length > 0);
  for (const w of trend.body.weekly) {
    assert.equal(
      new Date(`${w.week_of}T00:00:00Z`).getUTCDay(),
      1,
      `week_of ${w.week_of} is a Monday`,
    );
    assert.ok(typeof w.trophy_battles === "number");
  }
  assert.match(trend.body.notes.join(" "), /draws excluded/);

  // Summary: draws counted, denominator explained, best_deck slot exists.
  const sum = await call("players_summary", {});
  assert.ok(typeof sum.body.last_30_days.draws === "number");
  assert.match(sum.body.notes.join(" "), /draws excluded/);
  assert.ok("best_deck" in sum.body);

  // Full verbosity delivers the promised opponent perspective.
  const full = await call("battles_query", { limit: 10 });
  const withOpp = full.body.battles.find((b) => b.opponents.length > 0);
  assert.ok(withOpp, "an opponent-bearing battle exists");
  assert.ok(
    withOpp.opponents[0].deck,
    "opponent deck present at full verbosity",
  );
  assert.ok(withOpp.opponents[0].name, "opponent name stamped at ingest");
  assert.match(full.body.notes.join(" "), /tower_hp/);

  // A window before recording says so instead of a bare empty page.
  const ancient = await call("battles_query", {
    from: "2020-01-01",
    to: "2020-02-01",
  });
  assert.equal(ancient.isError, false);
  assert.equal(ancient.body.battles.length, 0);
  assert.match(ancient.body.notes.join(" "), /window_precedes_recording/);

  // battles_compare enforces its upper bound server-side.
  const five = await call("battles_compare", {
    player_tags: ["#20JJJ2CCRU", "#2PP", "#2PY", "#2PL", "#2PQ"],
  });
  assert.equal(five.isError, true);
  assert.equal(five.body.error.code, "bad_request");
  assert.equal(five.body.error.class, "input");
});

test("Elixir MCP service domain: added = recorded, notify is the only toggle", async () => {
  // Add a player: claim + recording in ONE act.
  const add = await call("elixir_track_player", { player_tag: "#2PP0V90Y" });
  assert.equal(add.isError, false, JSON.stringify(add.body));
  assert.equal(add.body.added, true);
  assert.equal(add.body.recording_started, true);
  assert.equal(add.body.notify, true);

  // Adding again: idempotent, shares the existing record.
  const again = await call("elixir_track_player", { player_tag: "#2PP0V90Y" });
  assert.equal(again.body.added, false);
  assert.equal(again.body.recording_started, false);

  // Slots count what you've ADDED (claims); the web door agrees.
  await db.query(
    `update account set max_player_recordings = 2 where account_id = $1`,
    [account.accountId],
  );
  const capped = await call("elixir_track_player", { player_tag: "#2PL" });
  assert.equal(capped.isError, true);
  assert.equal(capped.body.error.code, "quota_exceeded");
  await db.query(
    `update account set max_player_recordings = null where account_id = $1`,
    [account.accountId],
  );

  // Notify is the only per-subject setting; my_players shows it.
  const mute = await call("elixir_track_player", {
    player_tag: "#2PP0V90Y",
    action: "notify_off",
  });
  assert.equal(mute.body.notify, false);
  const mine = await call("elixir_my_players", {});
  const row = mine.body.players.find((x) => x.player_tag === "#2PP0V90Y");
  assert.equal(row.notify, false);
  await call("elixir_track_player", {
    player_tag: "#2PP0V90Y",
    action: "notify_on",
  });

  // Remove releases the claim and stops the recording it justified.
  const removed = await call("elixir_track_player", {
    player_tag: "#2PP0V90Y",
    action: "remove",
  });
  assert.equal(removed.body.removed, true);
  assert.equal(removed.body.recording_stopped, true);

  // Clan add at comprehensive scope: member tier has no slots.
  const tierBlocked = await call("elixir_track_clan", {
    clan_tag: "#J2RGCRVG",
  });
  assert.equal(tierBlocked.isError, true);
  assert.equal(tierBlocked.body.error.code, "quota_exceeded");
  assert.match(tierBlocked.body.error.hint, /upgrade|leader/i);

  // The leader tier has the slot: added = recorded, immediately.
  await db.query(`update account set role = 'leader' where account_id = $1`, [
    account.accountId,
  ]);
  account.role = "leader";
  const clanAdd = await call("elixir_track_clan", { clan_tag: "#J2RGCRVG" });
  assert.equal(clanAdd.isError, false, JSON.stringify(clanAdd.body));
  assert.equal(clanAdd.body.recording, "active");
  assert.equal(clanAdd.body.scope, "comprehensive");
  const { rows: rec } = await db.query(
    `select scope, requested_by from recording
     where subject_type = 'clan' and subject_tag = '#J2RGCRVG' and status = 'active'`,
  );
  assert.equal(rec[0].scope, "comprehensive");
  assert.equal(rec[0].requested_by, account.accountId);

  // Re-adding with a narrower scope settles the recording down too
  // (single adder), and remove stops it entirely.
  const readd = await call("elixir_track_clan", {
    clan_tag: "#J2RGCRVG",
    scope: "activity",
  });
  assert.equal(readd.body.scope, "activity");
  const { rows: settled } = await db.query(
    `select scope from recording
     where subject_type = 'clan' and subject_tag = '#J2RGCRVG' and status = 'active'`,
  );
  assert.equal(settled[0].scope, "activity");
  const gone = await call("elixir_track_clan", {
    clan_tag: "#J2RGCRVG",
    action: "remove",
  });
  assert.equal(gone.body.removed, true);
  assert.equal(gone.body.recording_stopped, true);
  const back = await call("elixir_track_clan", { clan_tag: "#J2RGCRVG" });
  assert.equal(back.body.recording, "active");

  // Insights: corpus-wide transparency counts.
  const insights = await call("elixir_data_insights", {});
  assert.ok(insights.body.players_observed > 0);
  assert.ok(insights.body.battles.recorded > 0);
  assert.ok(insights.body.battles.first <= insights.body.battles.last);

  // Collectors: card-derived identity + quota credits, no arenas, and
  // no machine label - the operator's name for their own box is private
  // and this tool used to hand it to every connected agent (#28).
  const collectors = await call("elixir_collectors", {});
  assert.ok(collectors.body.collectors.length >= 1);
  const c0 = collectors.body.collectors[0];
  assert.ok("quota_credits" in c0);
  assert.ok(!("arena" in c0), "arenas are gone");
  assert.ok(!("machine" in c0), "machine labels are not fleet data");
  assert.ok(
    collectors.body.collectors.every((c) => c.name === (c.card ?? "Collector")),
    "the card is the only name that leaves",
  );
});

test("event modes are discoverable: group_by mode + game_mode filter (the KHAOS gap)", async () => {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_id, game_mode_name)
     values ('khaos-1', now() - interval '2 days', 'trail', 'pvp', 72001001, 'Chaos_1v1_Draft'),
            ('khaos-2', now() - interval '1 day', 'trail', 'pvp', 72001001, 'Chaos_1v1_MegaDraft_All')
     on conflict do nothing`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, type, type_class)
     values ('khaos-1', $1, now() - interval '2 days', 0, 'win', 'PvP', 'pvp'),
            ('khaos-2', $1, now() - interval '1 day', 0, 'loss', 'PvP', 'pvp')
     on conflict do nothing`,
    [OBSERVER],
  );

  const perf = await call("battles_performance", { group_by: "game_mode" });
  assert.equal(perf.isError, false, JSON.stringify(perf.body));
  const chaos = perf.body.by_mode.filter((m) =>
    (m.game_mode ?? "").startsWith("Chaos_"),
  );
  assert.equal(chaos.length, 2, "both Chaos modes surface in discovery");
  assert.match(perf.body.notes.join(" "), /\(game_mode, type\)/);

  const q = await call("battles_query", {
    game_mode: "chaos",
    verbosity: "compact",
    limit: 10,
  });
  assert.equal(q.isError, false);
  assert.equal(
    q.body.battles.length,
    2,
    "substring filter finds KHAOS battles",
  );
  assert.ok(q.body.battles.every((b) => b.game_mode.name.startsWith("Chaos_")));
});

test("3.18.0: elixir_send_feedback keeps every request id a turn names; the first becomes request_id; a malformed one is dropped, never the report", async () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  const filed = await call("elixir_send_feedback", {
    message: "Two calls in one turn disagreed about the floor.",
    category: "data_quality",
    request_ids: [a, "not-an-id", b],
  });
  assert.equal(filed.isError, false, JSON.stringify(filed.body));
  assert.equal(filed.body.applied.request_id, a);
  assert.deepEqual(filed.body.applied.request_ids, [a, b]);
  const { rows } = await db.query(
    `select request_id, context from feedback where feedback_id = $1`,
    [filed.body.feedback_id],
  );
  assert.equal(rows[0].request_id, a);
  assert.deepEqual(rows[0].context.request_ids, [a, b]);
  // An explicit request_id stays the one the console joins on.
  const both = await call("elixir_send_feedback", {
    message: "The named one is the culprit.",
    request_id: b,
    request_ids: [a],
  });
  assert.equal(both.body.applied.request_id, b);
  assert.deepEqual(both.body.applied.request_ids, [a]);
});

test("feedback loop closes: file, maintainer responds, requester sees it", async () => {
  const filed = await call("elixir_send_feedback", {
    message: "The trend view is great but I want draws broken out.",
    category: "feature",
  });
  assert.equal(filed.isError, false);
  const id = filed.body.feedback_id;

  let mine = await call("elixir_my_feedback", {});
  const row = mine.body.feedback.find((f) => f.feedback_id === id);
  assert.equal(row.status, "new");
  assert.equal(row.response, null);

  await db.query(
    `update feedback set status = 'done', response = 'Shipped in 0.6.0 - draws ride every window now.', responded_at = now()
     where feedback_id = $1`,
    [id],
  );
  mine = await call("elixir_my_feedback", {});
  const after2 = mine.body.feedback.find((f) => f.feedback_id === id);
  assert.equal(after2.status, "done");
  assert.match(after2.response, /Shipped in 0.6.0/);
  assert.ok(after2.responded_at);
});

test("feedback pages fit the wire cap and acknowledge only delivered replies", async () => {
  const { rows: inserted } = await db.query(
    `insert into feedback
       (account_id, surface, category, message, status, response, responded_at)
     select $1, 'mcp', 'feature', repeat('m', 4000), 'done', repeat('r', 4000), now()
     from generate_series(1, 12)
     returning feedback_id`,
    [account.accountId],
  );
  const insertedIds = inserted.map((row) => row.feedback_id);

  try {
    const page = await call("elixir_my_feedback", {
      status: "done",
      limit: 50,
    });
    assert.equal(page.isError, false, JSON.stringify(page.body));
    assert.ok(JSON.stringify(page.body).length < 48_000, "page fits MCP cap");
    assert.ok(page.body.feedback.length > 0);
    assert.ok(
      page.body.feedback.length < insertedIds.length,
      "oversized requested page is split",
    );
    assert.ok(page.body.total >= insertedIds.length);
    assert.ok(page.body.next_offset > 0);
    assert.ok(
      page.body.meta.feedback_responses_pending >=
        insertedIds.length - page.body.feedback.length,
      "undelivered replies keep the pending hint raised",
    );

    const delivered = new Set(
      page.body.feedback.map((row) => String(row.feedback_id)),
    );
    const { rows: seen } = await db.query(
      `select feedback_id, response_seen_at from feedback
       where feedback_id = any($1::bigint[]) order by feedback_id desc`,
      [insertedIds],
    );
    for (const row of seen) {
      assert.equal(
        row.response_seen_at !== null,
        delivered.has(String(row.feedback_id)),
        "only a reply present in the delivered page is acknowledged",
      );
    }

    const next = await call("elixir_my_feedback", {
      status: "done",
      limit: 50,
      offset: page.body.next_offset,
    });
    assert.equal(next.isError, false, JSON.stringify(next.body));
    assert.ok(JSON.stringify(next.body).length < 48_000, "next page fits cap");
    assert.ok(
      next.body.feedback.every(
        (row) => !delivered.has(String(row.feedback_id)),
      ),
      "pages do not overlap",
    );
  } finally {
    await db.query(
      `delete from feedback where feedback_id = any($1::bigint[])`,
      [insertedIds],
    );
  }
});

test("feedback round two: changelog since-filter, ship links, pending hint clears on read", async () => {
  const releases = [];
  let offset = 0;
  do {
    const page = await call("elixir_changelog", { since: "0.14.0", offset });
    assert.equal(page.isError, false);
    releases.push(...page.body.entries);
    offset = page.body.next_offset;
  } while (offset !== null);
  const log = { isError: false, body: { entries: releases } };
  assert.equal(log.isError, false);
  assert.ok(
    log.body.entries.every(
      (e) =>
        e.version > "0.14.0" ||
        e.version.startsWith("0.15") ||
        e.version.startsWith("0.16"),
    ),
  );
  assert.ok(
    log.body.entries.some((e) =>
      (e.tools_added ?? []).includes("elixir_changelog"),
    ),
  );
  assert.ok(
    !log.body.entries.some((e) => e.version === "0.14.0"),
    "since is exclusive",
  );

  // Ship links + pending hint: respond to an item, see the hint, read, hint clears.
  const filed = await call("elixir_send_feedback", {
    message: "changelog test item",
  });
  await db.query(
    `update feedback set status='done', response='Shipped.', responded_at=now(),
            shipped_in='0.16.0', related_tools=array['elixir_changelog']
     where feedback_id = $1`,
    [filed.body.feedback_id],
  );
  const anyTool = await call("players_summary", {});
  assert.ok(
    anyTool.body.meta.feedback_responses_pending >= 1,
    "pending hint rides ordinary tool meta",
  );
  const mine = await call("elixir_my_feedback", { status: "done" });
  const row = mine.body.feedback.find(
    (f) => f.feedback_id === filed.body.feedback_id,
  );
  assert.equal(row.shipped_in, "0.16.0");
  assert.deepEqual(row.related_tools, ["elixir_changelog"]);
  const after2 = await call("players_summary", {});
  assert.equal(after2.body.meta.feedback_responses_pending, 0);
});

test("trends: a selected player history has weekly mode counts and clipped windows", async () => {
  const trends = await call("battles_trends", {
    segment: { player_tag: OBSERVER },
    weeks: 52,
  });
  assert.equal(trends.isError, false, JSON.stringify(trends.body));
  assert.ok(trends.body.weeks.length > 0, "weekly rows");
  const wk = trends.body.weeks.at(-1);
  assert.ok(wk.players >= 1 && wk.battles >= wk.wins + wk.losses);
  // 3.16.0: every week carries its mode split, and a week the window
  // clips is marked with the span it holds (the fixture's weeks all end
  // before now, so only an explicit `to` inside a week clips one).
  assert.ok(trends.body.weeks.every((w) => typeof w.modes === "object"));
  assert.equal(
    Object.values(wk.modes).reduce((n, m) => n + m.battles, 0),
    wk.battles,
    "the split sums to the week",
  );
  const clipped = await call("battles_trends", {
    segment: { player_tag: OBSERVER },
    from: "2026-08-24",
    to: "2026-09-03T12:00:00Z",
  });
  assert.equal(clipped.isError, false, JSON.stringify(clipped.body));
  const last = clipped.body.weeks.at(-1);
  assert.equal(last.partial, true, "the week `to` cuts is partial");
  assert.equal(last.covers.to, "2026-09-03T12:00:00.000Z");
  assert.ok(clipped.body.notes.some((l) => /partial/.test(l)));
});

test("battles_query links: url, short id, both sides' trophies and clans (9.18.0)", async () => {
  const {
    rows: [pvp],
  } = await db.query(
    `select bp.battle_id from battle_participant bp join battle b using (battle_id)
      where b.type = 'PvP' and bp.side = 0
        and exists (select 1 from battle_participant o
                     where o.battle_id = bp.battle_id and o.side = 1)
      order by bp.battle_id limit 1`,
  );
  const byId = await call("battles_query", { battle_id: pvp.battle_id });
  assert.equal(byId.isError, false, JSON.stringify(byId.body));
  const [battle] = byId.body.battles;
  const short = battle.url.split("/").pop();
  assert.match(
    battle.url,
    /^https:\/\/elixir\.poapkings\.com\/battle\/[0-9a-f]{12,64}$/,
  );
  assert.ok(pvp.battle_id.startsWith(short));
  // The short id, and the link itself, name the same battle.
  for (const ref of [short, battle.url, `${battle.url}.png`]) {
    const again = await call("battles_query", { battle_id: ref });
    assert.equal(again.isError, false, JSON.stringify(again.body));
    assert.equal(again.body.battle_id, pvp.battle_id, ref);
    assert.equal(again.body.battles.length, 1);
  }
  // The other side's own trophies and clan, from the rows the record kept.
  const {
    rows: [them],
  } = await db.query(
    `select o.trophy_change, o.starting_trophies, o.clan_tag, c.name as clan_name
       from battle_participant o left join clan c using (clan_tag)
      where o.battle_id = $1 and o.side = 1`,
    [pvp.battle_id],
  );
  const opp = battle.opponents[0];
  assert.equal(opp.trophy_change, them.trophy_change);
  assert.equal(opp.starting_trophies, them.starting_trophies);
  assert.equal(opp.clan_tag, them.clan_tag);
  assert.equal(opp.clan_name, them.clan_name ?? null);
  assert.ok(Object.hasOwn(battle.me, "clan_tag"));
  assert.ok(Object.hasOwn(battle.me, "clan_name"));
  // A short id nobody holds is an empty page, not an error.
  const none = await call("battles_query", { battle_id: "ffffffffffff" });
  assert.equal(none.isError, false, JSON.stringify(none.body));
  assert.equal(none.body.battles.length, 0);
});

test("battle links grow past a shared prefix", async () => {
  const { battleLinks, resolveBattleRef } =
    await import("../../record/src/battle-links.mjs");
  const {
    rows: [base],
  } = await db.query(
    `select battle_id, battle_time, type, type_class from battle order by battle_id limit 1`,
  );
  // A second battle sharing the first 12 characters (a link issued
  // before it existed now names two).
  const twin =
    base.battle_id.slice(0, 12) +
    (base.battle_id[12] === "0" ? "1" : "0") +
    base.battle_id.slice(13);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ($1, $2, $3, $4)`,
    [twin, base.battle_time, base.type, base.type_class],
  );
  try {
    const links = await battleLinks(db, [base.battle_id, twin]);
    const a = links.get(base.battle_id).short_id;
    const b = links.get(twin).short_id;
    assert.ok(a.length >= 13 && b.length >= 13, `${a} ${b}`);
    assert.notEqual(a, b);
    assert.deepEqual(await resolveBattleRef(db, a), [base.battle_id]);
    assert.deepEqual(
      (await resolveBattleRef(db, base.battle_id.slice(0, 12))).sort(),
      [base.battle_id, twin].sort(),
    );
    assert.deepEqual(await resolveBattleRef(db, "not a battle"), []);
  } finally {
    await db.query(`delete from battle where battle_id = $1`, [twin]);
  }
});

test("battles_query addressing modes: battle_id alone, corpus deck_hash alone", async () => {
  const { rows: one } = await db.query(
    `select bp.battle_id, bp.deck_hash from battle_participant bp
     where bp.deck_hash is not null limit 1`,
  );
  const byId = await call("battles_query", { battle_id: one[0].battle_id });
  assert.equal(byId.isError, false, JSON.stringify(byId.body));
  assert.equal(byId.body.battle_id, one[0].battle_id);
  assert.equal(byId.body.battles.length, 1, "one battle, one perspective row");
  assert.ok(byId.body.battles[0].me.player_tag, "perspective identity present");
  // The perspective row names itself beside its tag (6.3.0): the
  // record's last-observed name, null when it has none.
  const {
    rows: [named],
  } = await db.query(`select name from player where player_tag = $1`, [
    byId.body.battles[0].me.player_tag,
  ]);
  assert.ok(Object.hasOwn(byId.body.battles[0].me, "name"));
  assert.equal(byId.body.battles[0].me.name, named.name);
  assert.ok(
    !Object.hasOwn(byId.body, "name"),
    "no one subject, no top-level name",
  );
  assert.ok(byId.body.battles[0].opponents.length >= 1, "both sides returned");

  const byDeck = await call("battles_query", {
    deck_hash: one[0].deck_hash,
    verbosity: "compact",
  });
  assert.equal(byDeck.isError, false, JSON.stringify(byDeck.body));
  assert.equal(byDeck.body.deck_hash, one[0].deck_hash);
  // deck_stats is the call's match set, not the deck's lifetime (#149):
  // a window that holds none of its battles counts none.
  const emptyWindow = await call("battles_query", {
    deck_hash: one[0].deck_hash,
    verbosity: "compact",
    from: "2001-01-01",
    to: "2001-01-02",
    include_total: true,
  });
  assert.equal(emptyWindow.isError, false, JSON.stringify(emptyWindow.body));
  assert.equal(emptyWindow.body.total_count, 0);
  assert.equal(emptyWindow.body.deck_stats.battles, 0);
  const all = await call("battles_query", {
    deck_hash: one[0].deck_hash,
    verbosity: "compact",
    include_total: true,
  });
  assert.equal(all.body.deck_stats.battles, all.body.total_count);
  assert.ok(byDeck.body.battles.length > 0);
  for (const battle of byDeck.body.battles) {
    assert.ok(
      battle.me.player_tag,
      "exact-deck drill preserves the player's identity (#37)",
    );
    assert.equal(
      battle.me.deck_hash,
      one[0].deck_hash,
      "identity stays attached to exact deck evidence",
    );
  }
  const ds = byDeck.body.deck_stats;
  assert.ok(ds.battles >= 1 && ds.players >= 1);
  assert.ok(!("win_rate" in ds), "no pooled win rate by design");
  assert.match(byDeck.body.notes.join(" "), /who plays it/);
});

test("nicknames: private to the account, matched first in search, shown in summary and roster", async () => {
  const set = await call("elixir_nickname", {
    player_tag: OBSERVER,
    nickname: "Tyler",
  });
  assert.equal(set.isError, false, JSON.stringify(set.body));
  assert.equal(set.body.nickname, "Tyler");

  // Search resolves the nickname, ranked first.
  const hit = await call("players_search", { query: "tyler" });
  assert.equal(hit.isError, false);
  assert.equal(hit.body.matches[0]?.player_tag, OBSERVER);
  assert.equal(hit.body.matches[0]?.source, "nickname");
  assert.equal(hit.body.matches[0]?.nickname, "Tyler");

  // Summary carries it.
  const sum = await call("players_summary", { player_tag: OBSERVER });
  assert.equal(sum.body.nickname, "Tyler");

  // Another account sees NOTHING - nicknames are how YOU know someone.
  const { rows: other } = await db.query(
    `insert into account (email_hash, status) values ('nick-other', 'approved')
     returning account_id`,
  );
  const { rows: leak } = await db.query(
    `select nickname from player_nickname where account_id = $1`,
    [other[0].account_id],
  );
  assert.equal(leak.length, 0);
  const { rows: scoped } = await db.query(
    `select count(*)::int as n from player_nickname where player_tag = $1`,
    [OBSERVER],
  );
  assert.equal(scoped[0].n, 1, "one row, one owner");

  // Clear works.
  const clr = await call("elixir_nickname", {
    player_tag: OBSERVER,
    nickname: null,
  });
  assert.equal(clr.body.cleared, true);
  const gone = await call("players_summary", { player_tag: OBSERVER });
  assert.ok(!("nickname" in gone.body));
});

test("players_profile answers the player as a game entity, not just a name (§7.2)", async () => {
  // The projection itself is covered in the ingest suite against the
  // real fixture; this pins that the tool actually SERVES it, which is
  // the half a consumer sees.
  const tag = "#2YG98VVQ";
  await db.query(
    `insert into clan (clan_tag, name, badge_id) values ('#J2RGCRVG', 'POAP KINGS', 16000107)
     on conflict (clan_tag) do update set badge_id = 16000107`,
  );
  await db.query(
    `insert into player (player_tag, name, last_known_clan_tag, last_known_clan_role,
                        years_played, account_age_days)
     values ($1, 'Alfablack', '#J2RGCRVG', 'coLeader', 4, 1637)
     on conflict (player_tag) do update set
       last_known_clan_tag = '#J2RGCRVG', last_known_clan_role = 'coLeader',
       years_played = 4, account_age_days = 1637`,
    [tag],
  );
  await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, trophies, arena_id, best_trophies,
        favorite_card_id, observed_at, profile_observed_at)
     values ($1, current_date, 'daily', 8000, 54000144, 9001, 26000000, now(), now())
     on conflict (player_tag, snapshot_date, snapshot_kind) do update set
       arena_id = 54000144, best_trophies = 9001, favorite_card_id = 26000000`,
    [tag],
  );
  await db.query(
    `insert into player_badge (player_tag, name, level, max_level, progress, target, observed_at)
     values ($1, 'YearsPlayed', 4, 11, 1637, 1825, now())
     on conflict (player_tag, name) do nothing`,
    [tag],
  );

  const { body, isError } = await call("players_profile", { player_tag: tag });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.clan.badge_id, 16000107, "the badge belongs to the clan");
  assert.equal(body.clan.role, "coLeader", "the player's own standing");
  assert.equal(body.attributes.arena_id, 54000144);
  assert.equal(body.attributes.best_trophies, 9001);
  assert.equal(body.attributes.favorite_card_id, 26000000);
  assert.equal(body.attributes.account_age_days, 1637);
  assert.equal(body.attributes.years_played, 4);

  const years = body.badges.find((b) => b.name === "YearsPlayed");
  assert.equal(years.progress, 1637, "account age in days");
  assert.equal(years.max_level, 11);

  // Ids only: a renamed arena or a new icon must never leave stale
  // copies here, so nothing resolves to an asset URL.
  assert.doesNotMatch(JSON.stringify(body), /api-assets\.clashroyale\.com/);
});

/**
 * What the owner recorded about each player has to come BACK.
 *
 * elixir_add_player writes relationship (primary | alt | friend | watching)
 * and elixir_nickname writes a private name; elixir_my_players returned
 * neither, so both were write-only from an agent's side. Asked "how about my
 * alt?", an agent had six non-primary players, no way to tell which was the
 * alt, and guessed from the handle — while the service held the answer.
 * Reported through elixir_send_feedback, 2026-09-09 (#13).
 */
test("elixir_my_players returns the relationship and nickname the owner set", async () => {
  await call("elixir_track_player", {
    player_tag: "#2PP0V90Y",
    relationship: "alt",
  });
  await call("elixir_nickname", { player_tag: "#2PP0V90Y", nickname: "Spare" });

  const mine = await call("elixir_my_players", {});
  const row = mine.body.players.find((x) => x.player_tag === "#2PP0V90Y");
  assert.equal(row.relationship, "alt", "the distinction the owner recorded");
  assert.equal(row.nickname, "Spare");
  assert.equal(row.is_primary, false, "kept: clients cache tools/list forever");

  // The primary is labelled as such rather than left for the caller to derive
  // from a boolean.
  const primary = mine.body.players.find((x) => x.is_primary);
  if (primary) assert.equal(primary.relationship, "primary");

  await call("elixir_track_player", {
    player_tag: "#2PP0V90Y",
    action: "remove",
  });
});

/**
 * A cheap question should cost a cheap answer. Reading a member count used to
 * pull every member object, each with a correlated last-battle scan, plus
 * twenty clan events. Reported 2026-09-09 (#11).
 */
test("clans_roster summary answers the count without the roster", async () => {
  // Named explicitly, and asserted to have actually answered. Comparing two
  // responses is worthless if both are the same refusal — the first draft of
  // this test passed against a pair of not_entitled errors.
  const CLAN = "#J2RGCRVG";
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, status, scope)
     values ('clan', $1, $2, 'active', 'comprehensive')
     on conflict do nothing`,
    [CLAN, account.accountId],
  );
  // Two members with different roles, or the role breakdown is 0 = 0 and the
  // size comparison is two empty lists.
  for (const [tag, name, role] of [
    ["#2YG98VVQ", "Alfablack", "coLeader"],
    ["#2PP0V90Y", "Bench", "member"],
  ]) {
    await db.query(
      `insert into player (player_tag, name) values ($1, $2)
       on conflict (player_tag) do nothing`,
      [tag, name],
    );
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now(), $3) on conflict do nothing`,
      [CLAN, tag, role],
    );
  }

  const full = await call("clans_roster", { clan_tag: CLAN });
  const brief = await call("clans_roster", {
    clan_tag: CLAN,
    verbosity: "compact",
  });
  assert.ok(!full.isError, JSON.stringify(full.body).slice(0, 200));
  assert.ok(!brief.isError, JSON.stringify(brief.body).slice(0, 200));
  assert.equal(brief.body.member_count, 2, "the fixture's two members");
  assert.equal(brief.body.role_counts.coLeader, 1);
  assert.equal(brief.body.role_counts.member, 1);

  assert.equal(brief.body.member_count, full.body.member_count);
  assert.equal(brief.body.name, full.body.name);
  assert.equal(brief.body.clan_tag, full.body.clan_tag);
  assert.equal(brief.body.members, undefined, "no member list");
  assert.equal(brief.body.recent_events, undefined, "no event list");
  assert.ok(brief.body.role_counts, "role breakdown rides along, it is free");
  assert.equal(
    Object.values(brief.body.role_counts).reduce((a, b) => a + b, 0),
    full.body.member_count,
    "the role counts have to add up to the roster",
  );
  assert.ok(
    JSON.stringify(brief.body).length < JSON.stringify(full.body).length,
    "and it has to actually be smaller",
  );
});

// --- 0.39.0: eleven feedback items from one agent session -----------------

test("battles_opponents groups by opponent: repeats, names, modes", async () => {
  const all = await call("battles_opponents", {});
  assert.equal(all.isError, false, JSON.stringify(all.body));
  assert.ok(all.body.distinct_opponents > 5);
  assert.equal(all.body.opponents.length, all.body.matching_opponents);
  const repeats = await call("battles_opponents", { min_battles: 2 });
  assert.equal(repeats.isError, false);
  assert.ok(repeats.body.opponents.length >= 1, "boat defenders recur");
  for (const o of repeats.body.opponents) {
    assert.ok(o.battles >= 2);
    assert.equal(o.battles, o.wins + o.losses + o.draws);
    assert.equal(typeof o.name_known, "boolean");
    assert.ok(o.first_seen <= o.last_seen);
    assert.ok(Array.isArray(o.modes) && o.modes.length > 0);
  }
  assert.ok(repeats.body.opponents.every((o) => o.name_known));
  assert.equal(repeats.body.matching_opponents, repeats.body.opponents.length);
  // A WINDOWED read (feedback #56): 3.11.1 wrote the predicate on an
  // alias the query did not have, so every days/from/to call failed
  // with a SQL error the door reported as bad_request, and the inverted
  // window below passed for the wrong reason.
  const windowed = await call("battles_opponents", {
    from: "2026-08-01",
    to: "2026-09-10",
    min_battles: 2,
  });
  assert.equal(windowed.isError, false, JSON.stringify(windowed.body));
  assert.equal(windowed.body.opponents.length, repeats.body.opponents.length);
  assert.equal(windowed.body.applied.window.source, "argument");
  const inverted = await call("battles_opponents", {
    from: "2026-09-05",
    to: "2026-09-01",
  });
  assert.equal(inverted.isError, true);
  assert.equal(inverted.body.error.code, "bad_request");
  assert.notEqual(
    inverted.body.error.message,
    "Tool battles_opponents failed unexpectedly.",
  );
});

test("players_names resolves tags in bulk and lists the misses", async () => {
  await db.query(
    `insert into player (player_tag) values ('#2LLLL') on conflict do nothing`,
  );
  const { body, isError } = await call("players_names", {
    player_tags: [OBSERVER, "#2LLLL", "#2QQQQ"],
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.names.length, 1);
  assert.equal(body.names[0].player_tag, OBSERVER);
  assert.equal(body.names[0].source, "profile");
  assert.deepEqual(
    body.unknown.map((u) => [u.player_tag, u.in_corpus]),
    [
      ["#2LLLL", true],
      ["#2QQQQ", false],
    ],
  );
  const bad = await call("players_names", { player_tags: ["nope!"] });
  assert.equal(bad.body.error.code, "invalid_tag");
});

test("battles_query: name_known, duel rounds_played, padded princess towers, legend", async () => {
  const { body, isError } = await call("battles_query", { limit: 25 });
  assert.equal(isError, false);
  for (const b of body.battles) {
    for (const o of b.opponents) assert.equal(typeof o.name_known, "boolean");
    if (b.type.startsWith("riverRaceDuel")) {
      assert.equal(
        b.me.rounds_played,
        3,
        "a duel row says how many games it holds",
      );
      assert.equal(b.opponents[0].rounds_played, 3);
    } else {
      assert.equal(b.me.rounds_played, undefined);
    }
    const p = b.me.tower_hp?.princess;
    if (Array.isArray(p))
      assert.equal(p.length, 2, "fixed length once reported");
  }
  assert.ok(
    body.battles.some((b) => b.me.tower_hp?.princess?.[1] === 0),
    "a one-tower array was padded with 0",
  );
  assert.match(body.notes.join(" "), /final round/);
  assert.match(body.notes.join(" "), /sum across rounds/);
});

test("battles_performance: decided vs boat denominators, mode key documented", async () => {
  const { body } = await call("battles_performance", {});
  const w = body.window;
  // The fixture's boat rows: ten, of which three are defenses, which are
  // not the member's battle (0171, 2026-09-25) and are left out.
  assert.equal(w.boat_battles, 7, "the fixture's seven boat attacks");
  assert.ok(w.decided_battles <= w.wins + w.losses);
  assert.ok(w.decided_battles < w.battles);
  assert.match(body.notes.join(" "), /decided_wins/);
  const modes = await call("battles_performance", { group_by: "game_mode" });
  assert.match(modes.body.notes.join(" "), /\(game_mode, type\)/);
  assert.ok(modes.body.by_mode.every((r) => "type" in r));
});

test("badges are a dimension: rarity census and holders, exact names only", async () => {
  const rarity = await call("badges_rarity", {
    segment: { player_tag: OBSERVER },
  });
  assert.equal(rarity.isError, false, JSON.stringify(rarity.body));
  const n = rarity.body.players_considered;
  assert.ok(n >= 1);
  assert.ok(rarity.body.badges.length > 100, "every badge the fixture holds");
  const years = rarity.body.badges.find((b) => b.name === "YearsPlayed");
  assert.equal(years.kind, "tiered");
  assert.ok(years.by_level[4] >= 1, "the fixture's level-4 holder is counted");
  assert.equal(years.holder_share, Number((years.holders / n).toFixed(3)));
  assert.ok(rarity.body.badges.every((b) => b.holders <= n));
  const oneOff = await call("badges_rarity", {
    segment: { player_tag: OBSERVER },
    kind: "one_off",
  });
  assert.ok(oneOff.body.badges.every((b) => b.kind === "one_off"));
  assert.ok(oneOff.body.badges.length < rarity.body.badges.length);
  // A limited page says it was cut, and drops "does not appear" (#193).
  assert.ok(rarity.body.notes.some((l) => /does not appear at all/.test(l)));
  const page = await call("badges_rarity", {
    segment: { player_tag: OBSERVER },
    limit: 5,
  });
  assert.equal(page.body.badges.length, 5);
  assert.ok(
    page.body.notes.some((l) =>
      new RegExp(`5 of ${rarity.body.badges.length} badges`).test(l),
    ),
    page.body.notes.join(" | "),
  );
  assert.ok(!page.body.notes.some((l) => /does not appear at all/.test(l)));

  const holders = await call("badges_holders", {
    segment: { player_tag: OBSERVER },
    badge: "yearsplayed",
  });
  assert.equal(holders.isError, false, JSON.stringify(holders.body));
  assert.equal(holders.body.badge, "YearsPlayed");
  assert.ok(holders.body.holders_total >= 1);
  const me = holders.body.holders.find((h) => h.player_tag === OBSERVER);
  assert.equal(me.level, 4);
  assert.equal(me.name_known, true);
  const near = await call("badges_holders", {
    segment: { player_tag: OBSERVER },
    badge: "Years",
  });
  assert.equal(near.isError, true);
  assert.equal(near.body.error.code, "not_found");
  assert.match(
    near.body.error.message,
    /YearsPlayed/,
    "candidates, not a guess",
  );
  const none = await call("badges_holders", {
    segment: { player_tag: OBSERVER },
    badge: "NoSuchBadgeAtAll",
  });
  assert.equal(none.body.error.code, "not_found");
  // The refusal is about the argument, not a claim about the world (#93).
  assert.doesNotMatch(none.body.error.message, /No recorded player holds/);

  // A label resolves to its identifier and says so (#93).
  const byLabel = await call("badges_holders", {
    segment: { player_tag: OBSERVER },
    badge: "Years Played",
  });
  assert.equal(byLabel.isError, false, JSON.stringify(byLabel.body));
  assert.equal(byLabel.body.badge, "YearsPlayed");
  assert.ok(
    byLabel.body.notes.some((n) => /is the label of YearsPlayed/.test(n)),
  );

  // A typo gets candidates by edit distance (#146), and the census says
  // what it counts (#145) and quotes a versioned pair as distinct players
  // (#144) when the fixture holds one.
  const typo = await call("badges_holders", {
    segment: { player_tag: OBSERVER },
    badge: "Years Plaeyd",
  });
  assert.equal(typo.body.error.code, "not_found");
  assert.match(typo.body.error.message, /Did you mean: YearsPlayed/);
  assert.match(none.body.error.message, /exactly 'NoSuchBadgeAtAll'/);
  const said = rarity.body.notes.join(" ");
  assert.match(said, /players_considered/);
});

test("dailySql sums equal the raw rows over any instant window, edge days included", async () => {
  // Earlier tests seeded participants by hand, some with a type that
  // disagrees with their battle's; ingest copies the battle's (0 drift
  // rows live) and keeps the rollup for every day, so the test restores
  // both invariants once for the whole table before comparing.
  await db.query(
    `update battle_participant bp set type = b.type, type_class = b.type_class
     from battle b where b.battle_id = bp.battle_id
       and (bp.type, bp.type_class) is distinct from (b.type, b.type_class)`,
  );
  const { rows: pairs } = await db.query(
    `select distinct player_tag, to_char(battle_time, 'YYYY-MM-DD') as day from battle_participant`,
  );
  await refreshDailyRollups(
    db,
    pairs.map((r) => ({ playerTag: r.player_tag, day: r.day })),
  );
  const { rows: tags } = await db.query(
    `select distinct player_tag from battle_participant order by 1 limit 12`,
  );
  const players = tags.map((r) => r.player_tag);
  // A battle BEFORE a mid-day window start, on the start day (the
  // acceptance suite, 2026-09-21: players_summary counted 93 battles
  // where battles_performance counted 90 over the same 30 days - three
  // battles on the window's first day before its instant). The
  // parameter's first use in dailySql was `($2)::date`, which typed the
  // whole parameter DATE, so the timestamptz comparison saw midnight.
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ('edge-early', '2026-08-20T10:00:00Z', 'PvP', 'pvp')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, type, type_class)
     values ('edge-early', $1, '2026-08-20T10:00:00Z', 0, 'win', 'PvP', 'pvp')`,
    [players[0]],
  );
  await refreshDailyRollups(db, [{ playerTag: players[0], day: "2026-08-20" }]);
  const windows = [
    ["2026-08-20T00:00:00Z", null],
    ["2026-08-20T14:30:00Z", "2026-09-03T09:15:00Z"],
    ["2026-08-20T14:30:00Z", null], // the edge-early battle is before this
    ["2026-09-02T06:00:00Z", "2026-09-02T18:00:00Z"], // one day, both edges
    ["2026-08-31T23:00:00Z", "2026-09-01T01:00:00Z"], // a midnight
    ["2026-07-01T00:00:00Z", "2026-09-05T00:00:00Z"],
  ];
  for (const [from, to] of windows) {
    const { rows: daily } = await db.query(
      `select player_tag, sum(battles)::int as battles, sum(wins)::int as wins,
              sum(losses)::int as losses, sum(draws)::int as draws,
              sum(trophy_delta)::int as trophy_delta
       from ${dailySql({ players: "$1", from: "$2", to: "$3" })} d
       group by player_tag order by player_tag`,
      [players, from, to],
    );
    const { rows: raw } = await db.query(
      `select player_tag, count(*)::int as battles,
              count(*) filter (where outcome = 'win')::int as wins,
              count(*) filter (where outcome = 'loss')::int as losses,
              count(*) filter (where outcome = 'draw')::int as draws,
              coalesce(sum(trophy_change), 0)::int as trophy_delta
       from battle_participant
       where player_tag = any($1) and battle_time >= $2
         and ($3::timestamptz is null or battle_time < $3)
       group by player_tag order by player_tag`,
      [players, from, to],
    );
    assert.deepEqual(daily, raw, `${from} .. ${to}`);
  }
  // A mode filter: one group rule on both halves (#157).
  const { rows: dailyLadder } = await db.query(
    `select coalesce(sum(battles), 0)::int as battles
     from ${dailySql({ players: "$1", from: "$2", to: "null", modeGroup: "$3" })} d`,
    [players, "2026-08-20T14:30:00Z", "ladder"],
  );
  const { rows: rawLadder } = await db.query(
    `select count(*)::int as battles from battle_participant
     where player_tag = any($1) and battle_time >= $2 and type = any($3)`,
    [players, "2026-08-20T14:30:00Z", typesForModeGroup("ladder")],
  );
  assert.deepEqual(dailyLadder, rawLadder);
});

test("players_profile renders a snapshot with every typed column null and passes its output schema", async () => {
  // A pre-3.0.0 row: trophies and donations only, nothing the API's
  // objects carried. The three objects render as null / {null, null}
  // and the registry's response validation (which throws under the
  // test runner on a mismatch) accepts them.
  const tag = "#2YYYY";
  await db.query(`insert into player (player_tag, name) values ($1, 'Bare')`, [
    tag,
  ]);
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, trophies, observed_at, profile_observed_at)
     values ($1, current_date, 'daily', 4200, now(), now())`,
    [tag],
  );
  const { body, isError } = await call("players_profile", { player_tag: tag });
  assert.equal(isError, false, JSON.stringify(body));
  assert.deepEqual(body.snapshot.path_of_legend, {
    current: null,
    best: null,
    seasons: [],
  });
  assert.equal(body.snapshot.league_statistics, null);
  assert.equal(body.snapshot.lifetime, null);
  assert.equal(body.snapshot.trophies, 4200);
  // And a partial one: a current result with no rank, one lifetime key.
  await db.query(
    `update player_snapshot_daily set pol_league = 3, pol_trophies = 120, battle_count = 9
     where player_tag = $1`,
    [tag],
  );
  const partial = await call("players_profile", { player_tag: tag });
  assert.equal(partial.isError, false, JSON.stringify(partial.body));
  assert.deepEqual(partial.body.snapshot.path_of_legend, {
    current: { leagueNumber: 3, trophies: 120, rank: null },
    best: null,
    seasons: [],
  });
  // One lifetime shape across the tools (defect 7, 2026-09-19; the
  // camelCase twins retired at 4.0.0).
  assert.equal(partial.body.snapshot.lifetime.battle_count, 9);
  assert.equal(partial.body.snapshot.lifetime.star_points, null);
  assert.equal(partial.body.snapshot.lifetime.collection_level, null);
  for (const camel of [
    "battleCount",
    "threeCrownWins",
    "starPoints",
    "expPoints",
    "collectionLevel",
  ])
    assert.ok(!(camel in partial.body.snapshot.lifetime), `${camel} is gone`);
});

test("a window on bp.battle_time answers what a window on b.battle_time answered", async () => {
  // The participant's copy of battle_time is what every covering index
  // is on; the window predicates moved onto it. Equal by construction
  // because the two copies never differ, and pinned here both ways.
  // Earlier tests seeded participants by hand with their own now();
  // ingest copies the battle's instant (0 drift rows live), so the test
  // restores the invariant once before pinning against it.
  await db.query(
    `update battle_participant bp set battle_time = b.battle_time
     from battle b where b.battle_id = bp.battle_id
       and bp.battle_time is distinct from b.battle_time`,
  );
  const {
    rows: [drift],
  } = await db.query(
    `select count(*)::int as n from battle_participant bp join battle b on b.battle_id = bp.battle_id
     where bp.battle_time is distinct from b.battle_time`,
  );
  assert.equal(drift.n, 0, "the copies agree on every row");
  const from = "2026-08-25T00:00:00Z";
  const to = "2026-09-02T12:00:00Z";
  const q = await call("battles_query", {
    from,
    to,
    include_total: true,
    verbosity: "compact",
    limit: 5,
  });
  assert.equal(q.isError, false, JSON.stringify(q.body));
  const {
    rows: [old],
  } = await db.query(
    `select count(*)::int as n from battle_participant bp join battle b on b.battle_id = bp.battle_id
     where bp.player_tag = $1 and b.battle_time >= $2 and b.battle_time < $3`,
    [OBSERVER, from, to],
  );
  assert.ok(old.n > 0, "the window holds fixture battles");
  assert.equal(q.body.total_count, old.n, "the old predicate's count");
  const perf = await call("battles_performance", { from, to });
  assert.equal(perf.isError, false, JSON.stringify(perf.body));
  // battles_performance counts the member's own battles: a boat defense
  // is not theirs (0171, 2026-09-25), so it leaves the same count out.
  const {
    rows: [own],
  } = await db.query(
    `select count(*)::int as n from battle_participant bp join battle b on b.battle_id = bp.battle_id
     where bp.player_tag = $1 and b.battle_time >= $2 and b.battle_time < $3
       and not (b.boat_battle_side is not null
                and (b.boat_battle_side = 'defender') = (bp.side = 0))`,
    [OBSERVER, from, to],
  );
  assert.equal(perf.body.window.battles, own.n);
});

test("forms are decoded, never ordinal: collection, catalog, in-game max level", async () => {
  const col = await call("players_collection", {});
  const hero = col.body.cards.find((c) => c.evolutionLevel === 2);
  assert.ok(hero, "the fixture holds a hero-unlocked card");
  assert.deepEqual(hero.forms_unlocked, ["hero"]);
  assert.ok(hero.forms_available.includes("hero"));
  const base = col.body.cards.find((c) => c.maxEvolutionLevel === undefined);
  assert.deepEqual(base.forms_available, []);
  assert.match(col.body.notes.join(" "), /bit fields/);

  const cat = await call("cards_catalog", {});
  assert.ok(cat.body.cards.every((c) => c.maxLevel === 16));
  const champion = cat.body.cards.find((c) => c.rarity === "champion");
  assert.equal(champion.maxLevelRarityScale, 6);
  const both = cat.body.cards.find((c) => c.maxEvolutionLevel === 3);
  assert.deepEqual(both.forms_available, ["evolution", "hero"]);
});

test("elixir_data_insights sizes the corpus along the profile axis", async () => {
  const { body, isError } = await call("elixir_data_insights", {});
  assert.equal(isError, false, JSON.stringify(body));
  // Earlier tests add recordings of their own; pin the arithmetic, not
  // the counts: total is the union, via_clans excludes direct adds.
  const rp = body.recorded_players;
  assert.ok(rp.direct >= 1);
  assert.ok(rp.total >= rp.direct && rp.total <= rp.direct + rp.via_clans);
  assert.equal(body.active_recordings.players, rp.direct);
  const scopes = body.active_recordings.clans_by_scope;
  assert.equal(
    scopes.activity + scopes.comprehensive,
    body.active_recordings.clans,
  );
  assert.equal(body.recorded_clans.length, body.active_recordings.clans);
  for (const c of body.recorded_clans) {
    assert.match(c.clan_tag, /^#/);
    assert.ok(["activity", "comprehensive"].includes(c.scope));
    assert.equal(typeof c.members, "number");
  }
  assert.ok(body.profiles.players_with_snapshot >= 1);
  assert.ok(body.profiles.players_with_badges >= 1);
  assert.ok(body.profiles.players_with_snapshot <= body.players_observed);
});

test("players_search matches user text literally: %, _ and \\ are not wildcards", async () => {
  for (const [tag, name] of [
    ["#2LQ0PC", "100% legit"],
    ["#2LQ0PL", "100 legit"],
    ["#2LQ0UG", "a_b"],
    ["#2LQ0UY", "axb"],
  ]) {
    await db.query(
      `insert into player (player_tag, name) values ($1, $2)
       on conflict (player_tag) do update set name = excluded.name`,
      [tag, name],
    );
  }
  const pct = await call("players_search", { query: "100%" });
  assert.deepEqual(
    pct.body.matches.map((m) => m.player_tag),
    ["#2LQ0PC"],
    "% is a literal percent sign",
  );
  const und = await call("players_search", { query: "a_b" });
  assert.deepEqual(
    und.body.matches.map((m) => m.player_tag),
    ["#2LQ0UG"],
    "_ is a literal underscore",
  );
  const bs = await call("players_search", { query: "\\" });
  assert.equal(
    bs.body.matches.length,
    0,
    "a backslash matches only a backslash",
  );
});

test("elixir_send_feedback notifies the owner through the door's notify hook; owner-owned callers do not", async () => {
  const notes = [];
  const registry = makeRegistry();
  const member = makeInvoker({
    db,
    account: { ...account, publicId: "abc123def456", role: "member" },
    registry,
    notifyOwner: async (spec) => notes.push(spec),
  });
  const filed = await member("elixir_send_feedback", {
    message: "battles_opponents is exactly what I needed",
    category: "praise",
  });
  assert.equal(filed.isError, false, JSON.stringify(filed.body));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "feedback");
  assert.equal(notes[0].surface, "mcp");
  assert.equal(notes[0].from, "agent abc123def456");
  assert.equal(notes[0].feedbackId, filed.body.feedback_id);

  const ownerAgent = makeInvoker({
    db,
    account: {
      ...account,
      role: "leader",
      kind: "agent",
      budget: { accountId: account.accountId, role: "owner" },
    },
    registry,
    notifyOwner: async (spec) => notes.push(spec),
  });
  const own = await ownerAgent("elixir_send_feedback", {
    message: "owner's own agent",
  });
  assert.equal(own.isError, false);
  assert.equal(notes.length, 1, "the owner's agents do not mail the owner");

  // A notify hook that throws never fails the filing.
  const flaky = makeInvoker({
    db,
    account: { ...account, role: "member" },
    registry,
    notifyOwner: async () => {
      throw new Error("queue down");
    },
  });
  const still = await flaky("elixir_send_feedback", { message: "still filed" });
  assert.equal(still.isError, false);
  assert.ok(still.body.feedback_id);
});

test("3.17.0: every instant-windowed tool says its season, crossings fire only when crossed, and season bounds the player battle tools", async (t) => {
  // Relative windows need a stable clock: a real season rollover made the
  // supposedly clean three-day window cross a boundary in CI.
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-09-10T12:00:00Z"),
  });
  await ensureSeason(db, "2026-09");
  // The record's seasons back to July, so a 60-day window crosses two
  // rolls (Aug 3 and Sep 7 at 10:00Z) and a 3-day one crosses none.
  await ensureSeason(db, "2026-07");
  await ensureSeason(db, "2026-08");
  const sixty = await call("battles_decks", { days: 60 });
  assert.equal(sixty.isError, false, JSON.stringify(sixty.body));
  const w = sixty.body.applied.window;
  assert.ok(w.season, "the window starts in a named season");
  assert.ok(Array.isArray(w.crosses));
  assert.ok(w.crosses.length >= 1, JSON.stringify(w));
  assert.ok(w.crosses.every((c) => c.kind === "season" && c.from_season));
  assert.ok(sixty.body.notes.some((n) => /^Window spans S/.test(n)));
  assert.equal(typeof w.season_age_days, "number");

  const clean = await call("battles_decks", { days: 3 });
  assert.deepEqual(clean.body.applied.window.crosses, []);
  assert.ok(!clean.body.notes.some((n) => /^Window spans/.test(n)));

  const beforeRoll = await call("battles_decks", {
    from: "2026-09-07T09:59:00Z",
    to: "2026-09-07T09:59:59Z",
  });
  assert.equal(beforeRoll.isError, false);
  assert.deepEqual(beforeRoll.body.applied.window.crosses, []);
  const acrossRoll = await call("battles_decks", {
    from: "2026-09-07T09:59:00Z",
    to: "2026-09-07T10:00:01Z",
  });
  assert.equal(acrossRoll.isError, false);
  assert.equal(acrossRoll.body.applied.window.crosses.length, 1);
  assert.equal(
    acrossRoll.body.applied.window.crosses[0].at,
    "2026-09-07T10:00:00.000Z",
  );

  // Unbounded: no season to start in, every roll on record crossed.
  const all = await call("battles_query", {});
  assert.equal(all.body.applied.window.source, "unbounded");
  assert.equal(all.body.applied.window.season, null);
  assert.ok(
    all.body.applied.window.crosses.length >= 2,
    JSON.stringify(all.body.applied.window),
  );

  // Every instant-windowed tool carries the keys, whatever the window.
  for (const [name, args] of [
    ["battles_query", { days: 5 }],
    ["battles_performance", { days: 5 }],
    ["battles_cards", { days: 5 }],
    ["battles_decks", { days: 5 }],
    ["battles_opponents", { days: 5 }],
    ["battles_compare", { player_tags: [OBSERVER, "#2PP0V90Y"], days: 5 }],
    ["game_events", { days: 5 }],
    ["elixir_timeline", { mark_read: false }],
  ]) {
    const { body, isError } = await call(name, args);
    assert.equal(isError, false, `${name}: ${JSON.stringify(body)}`);
    assert.ok("season" in body.applied.window, `${name} carries season`);
    assert.ok(Array.isArray(body.applied.window.crosses), `${name} crosses`);
  }

  // season: one argument everywhere (item 2): the previous season's bounds.
  const prev = await call("battles_performance", { season: "previous" });
  assert.equal(prev.isError, false, JSON.stringify(prev.body));
  assert.equal(prev.body.applied.window.source, "season");
  assert.equal(prev.body.applied.window.season.month, "2026-08");
  assert.deepEqual(prev.body.applied.window.crosses, []);
  const byMonth = await call("battles_query", { season: "2026-08", limit: 5 });
  assert.equal(byMonth.body.applied.window.from, prev.body.applied.window.from);
  // Explicit bounds still win over season.
  const both = await call("battles_query", { season: "previous", days: 2 });
  assert.equal(both.body.applied.window.source, "argument");
});

// ------------------------------------------------------------ 6.12.0 (#77-#79)
// A corpus read whose window sits inside the running season but is not
// the whole season used to scan the participant heap with a per-row
// lateral for the level gap: every 7-day corpus read timed out at the 18 s
// budget (feedback #77, #78, #79). The population table (0140) holds the
// same rows with the gap on them; the read answers what the heap answered.

// ---------------------------------------------------------------- 6.12.0 (#80)

test("a card name shared with a tower-troop entry is the deck card; Evo and Hero prefixes name the card (Gym #324, #325)", async () => {
  const {
    rows: [top],
  } = await db.query(
    `select card_id, name from card where kind = 'card' order by card_id limit 1`,
  );
  // A tower-troop catalog entry that shares the top card's name, as the
  // live catalog's "Archer Queen" tower entry shares the champion's.
  await db.query(
    `insert into card (card_id, name, kind) values (29000099, $1, 'support')
     on conflict do nothing`,
    [top.name],
  );
  try {
    const byName = await call("cards_card", {
      card: top.name,
      segment: { player_tag: OBSERVER },
      from: "2020-01-01",
      verbosity: "compact",
    });
    assert.equal(byName.isError, false, JSON.stringify(byName.body));
    assert.equal(
      byName.body.card.id,
      top.card_id,
      "the deck card, not the tower entry",
    );
    const evo = await call("cards_card", {
      card: `Evo ${top.name}`,
      segment: { player_tag: OBSERVER },
      from: "2020-01-01",
      verbosity: "compact",
    });
    assert.equal(evo.isError, false, JSON.stringify(evo.body));
    assert.equal(evo.body.card.id, top.card_id);
  } finally {
    await db.query(`delete from card where card_id = 29000099`);
  }
});

test("Gym #329: a bucket the newest profile read no longer carried is ended, even when it is the only one", async () => {
  // The reader keeps buckets from the last 35 days by the database's
  // clock, so this subject's profile is read relative to now: on the
  // fixed 2026-09-03 fixture read the bucket aged out of that window on
  // 2026-09-28 and the test failed on every run after.
  const tag = "#Q2RUPYC8";
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.tag = tag;
  const {
    rows: [gw],
  } = await db.query(`select gateway_id from gateway where name = 'tools2-gw'`);
  const read = await processResult(db, {
    v: 1,
    job: { endpoint: "player", entity_key: tag, lane: "bulk" },
    gateway_id: gw.gateway_id,
    fetched_at: new Date(Date.now() - 86400_000).toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(profile))).toString(
      "base64",
    ),
  });
  assert.equal(read.outcome, "admitted", JSON.stringify(read));
  const {
    rows: [snap],
  } = await db.query(
    `select max(snapshot_date) as d from player_snapshot_daily where player_tag = $1`,
    [tag],
  );
  const ended = new Date(snap.d.getTime() - 10 * 86400_000);
  await db.query(
    `insert into mode_season (progress_key, mode, season_month, first_seen_at, last_seen_at)
     values ('AutoChess_2026_Season_T', 'AutoChess', null, now(), now())
     on conflict do nothing`,
  );
  await db.query(
    `insert into player_progress_daily (player_tag, progress_key, day, observed_at, trophies, best_trophies)
     values ($1, 'AutoChess_2026_Season_T', $2::date, $2::timestamptz, 15, 15)
     on conflict do nothing`,
    [tag, ended],
  );
  const { body, isError } = await call("players_profile", {
    player_tag: tag,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const row = body.snapshot.progress.find(
    (p) => p.key === "AutoChess_2026_Season_T",
  );
  assert.equal(row.current, false, "ended: the newest profile read lacked it");
  assert.match(body.notes.join(" "), /have ended \(current false\)/);
});

test("player trends preserve distinct battles at the same player timestamp and reapply mode filters", async () => {
  await db.query("begin");
  try {
    for (const [id, type, outcome, trophies] of [
      ["trend-collision-ladder", "PvP", "win", 11],
      ["trend-collision-casual", "clanMate", "loss", null],
      ["trend-collision-unresolved", "PvP", null, null],
    ]) {
      await db.query(
        `insert into battle (battle_id, battle_time, type, type_class)
         values ($1, '2026-07-01T05:00:00Z', $2, 'pvp')`,
        [id, type],
      );
      await db.query(
        `insert into battle_participant (battle_id, player_tag, side, battle_time, type, type_class, outcome, trophy_change)
         values ($1, $2, 0, '2026-07-01T05:00:00Z', $3, 'pvp', $4, $5)`,
        [id, OBSERVER, type, outcome, trophies],
      );
    }
    for (const [mode, expected] of [
      [null, 2],
      ["ladder", 1],
      ["casual", 1],
    ]) {
      const { body, isError } = await call("battles_trends", {
        segment: { player_tag: OBSERVER },
        from: "2026-07-01T04:59:59Z",
        to: "2026-07-01T05:00:01Z",
        ...(mode ? { mode } : {}),
      });
      assert.equal(isError, false, JSON.stringify(body));
      assert.equal(body.weeks.length, 1);
      assert.equal(body.weeks[0].battles, expected);
      assert.equal(body.weeks[0].players, 1);
      assert.equal(body.weeks[0].net_trophies, mode === "casual" ? 0 : 11);
    }
  } finally {
    await db.query("rollback");
  }
});
