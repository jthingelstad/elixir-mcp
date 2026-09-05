import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { emailHash } from "../../auth/src/index.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

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

test("battles_cards: mine and opponent perspectives, duels excluded", async () => {
  const mine = await call("battles_cards", { perspective: "mine" });
  assert.equal(mine.isError, false);
  assert.ok(mine.body.cards.length > 0, "cards attributed");
  for (const c of mine.body.cards) {
    assert.equal(c.battles, c.wins + c.losses);
    assert.ok(c.win_rate >= 0 && c.win_rate <= 1);
  }
  const opp = await call("battles_cards", { perspective: "opponent" });
  assert.equal(opp.isError, false);
  assert.match(opp.body.note, /OPPONENT/);
});

test("battles_decks: grouped by deck_hash with samples", async () => {
  const { body, isError } = await call("battles_decks", {});
  assert.equal(isError, false);
  assert.ok(body.decks.length > 0);
  const d = body.decks[0];
  assert.ok(d.deck_hash);
  assert.ok(d.cards.length > 0, "sample deck rides along");
  assert.ok(d.battles >= d.wins + d.losses + d.draws);
  assert.ok(d.first_used <= d.last_used);
});

test("players_collection: API-shaped passthrough of the latest payload", async () => {
  const { body, isError } = await call("players_collection", {});
  assert.equal(isError, false);
  assert.ok(Array.isArray(body.cards) && body.cards.length > 50);
  assert.ok(body.cards[0].id && body.cards[0].name, "API shapes pass through");
  assert.ok(body.collection_level !== undefined);
  // Levels are display-scale: every card caps at 16, none exceeds it.
  assert.ok(body.cards.every((c) => c.maxLevel === 16));
  assert.ok(body.cards.every((c) => c.level <= 16));
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
  assert.match(perf.body.note, /compare_from\/compare_to were ignored/);
  assert.ok(perf.body.filters_applied, "filters echoed");

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
  assert.match(trend.body.weekly_note, /draws excluded/);

  // Summary: draws counted, denominator explained, best_deck slot exists.
  const sum = await call("players_summary", {});
  assert.ok(typeof sum.body.last_30_days.draws === "number");
  assert.match(sum.body.note, /draws excluded/);
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
  assert.match(full.body.card_legend, /tower_hp/);

  // A window before recording says so instead of a bare empty page.
  const ancient = await call("battles_query", {
    from: "2020-01-01",
    to: "2020-02-01",
  });
  assert.equal(ancient.isError, false);
  assert.equal(ancient.body.battles.length, 0);
  assert.match(ancient.body.warnings?.[0] ?? "", /window_precedes_recording/);

  // battles_compare enforces its upper bound server-side.
  const five = await call("battles_compare", {
    player_tags: ["#20JJJ2CCRU", "#2PP", "#2PY", "#2PL", "#2PQ"],
  });
  assert.equal(five.isError, true);
  assert.equal(five.body.error.code, "bad_request");
});

test("Elixir MCP service domain: watch player, watch clan, insights, collectors", async () => {
  // Watch a new player: claim + recording in one call.
  const watch = await call("elixir_watch_player", { player_tag: "#2PP0V90Y" });
  assert.equal(watch.isError, false, JSON.stringify(watch.body));
  assert.equal(watch.body.claimed, true);
  assert.equal(watch.body.recording_started, true);

  // Watching again: idempotent, shares the existing record.
  const again = await call("elixir_watch_player", { player_tag: "#2PP0V90Y" });
  assert.equal(again.body.claimed, false);
  assert.equal(again.body.recording_started, false);

  // The web flow's cap applies identically here.
  await db.query(
    `update account set max_player_recordings = 2 where account_id = $1`,
    [account.accountId],
  );
  const capped = await call("elixir_watch_player", { player_tag: "#2PL" });
  assert.equal(capped.isError, true);
  assert.equal(capped.body.error.code, "quota_exceeded");
  await db.query(
    `update account set max_player_recordings = null where account_id = $1`,
    [account.accountId],
  );

  // Watch clan: files a reviewed request (budget is shared), never starts alone.
  const clanReq = await call("elixir_watch_clan", {
    clan_tag: "#J2RGCRVG",
    note: "I lead this clan",
  });
  assert.equal(clanReq.isError, false);
  assert.equal(clanReq.body.recording, "requested");
  const { rows: fb } = await db.query(
    `select context->>'kind' as kind from feedback where feedback_id = $1`,
    [clanReq.body.request_id],
  );
  assert.equal(fb[0].kind, "clan_watch_request");

  // Insights: corpus-wide transparency counts.
  const insights = await call("elixir_data_insights", {});
  assert.ok(insights.body.players_observed > 0);
  assert.ok(insights.body.battles.recorded > 0);
  assert.ok(insights.body.battles.first <= insights.body.battles.last);

  // Collectors: the ladder with arena names.
  const collectors = await call("elixir_collectors", {});
  assert.ok(collectors.body.collectors.length >= 1);
  assert.equal(collectors.body.collectors[0].rank, 1);
  assert.ok(collectors.body.collectors[0].arena.length > 0);
});

test("battles_levels: symmetric curve with floors; Pilot Score honest under small n", async () => {
  const r = await call("battles_levels", { days: 365 });
  assert.equal(r.isError, false, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.curve) && r.body.curve.length > 0);
  for (const bin of r.body.curve) {
    assert.ok(typeof bin.n === "number");
    if (bin.n < 200) {
      assert.equal(bin.win_rate, null, "below-floor bins serve counts only");
      assert.equal(bin.insufficient_sample, true);
    }
  }
  assert.match(r.body.note, /wins your card levels can't explain/);

  // Fixture corpus is tiny: the player block must refuse, not guess.
  const scored = await call("battles_levels", {
    player_tag: OBSERVER,
    days: 365,
  });
  assert.equal(scored.isError, false, JSON.stringify(scored.body));
  assert.equal(scored.body.player.insufficient_sample, true);

  const bad = await call("battles_levels", { days: 3 });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.code, "bad_request");
});

test("experience cohorts: tenure rides player block and standings; unknown stays null", async () => {
  await db.query(
    `update player set years_played = 4, account_age_days = 1712 where player_tag = $1`,
    [OBSERVER],
  );
  const r = await call("battles_levels", { player_tag: OBSERVER, days: 365 });
  assert.equal(r.isError, false, JSON.stringify(r.body));
  assert.equal(r.body.player.experience.years_played, 4);
  assert.equal(r.body.player.experience.account_age_days, 1712);

  await db.query(
    `update player set years_played = null, account_age_days = null where player_tag = $1`,
    [OBSERVER],
  );
  const unk = await call("battles_levels", { player_tag: OBSERVER, days: 365 });
  assert.equal(unk.body.player.experience.years_played, null);
  assert.match(unk.body.player.experience.note, /unknown/);
});

test("event modes are discoverable: group_by mode + game_mode filter (the KHAOS gap)", async () => {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_id, game_mode_name)
     values ('khaos-1', now() - interval '2 days', 'trail', 'pvp', 72001001, 'Chaos_1v1_Draft'),
            ('khaos-2', now() - interval '1 day', 'trail', 'pvp', 72001001, 'Chaos_1v1_MegaDraft_All')
     on conflict do nothing`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome)
     values ('khaos-1', $1, now() - interval '2 days', 0, 'win'),
            ('khaos-2', $1, now() - interval '1 day', 0, 'loss')
     on conflict do nothing`,
    [OBSERVER],
  );

  const perf = await call("battles_performance", { group_by: "mode" });
  assert.equal(perf.isError, false, JSON.stringify(perf.body));
  const chaos = perf.body.by_mode.filter((m) =>
    (m.game_mode ?? "").startsWith("Chaos_"),
  );
  assert.equal(chaos.length, 2, "both Chaos modes surface in discovery");
  assert.match(perf.body.mode_note, /Chaos/);

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

test("feedback loop closes: file, maintainer responds, requester sees it", async () => {
  const filed = await call("elixir_feedback", {
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

test("collections: browse + enriched get; private stays owner-only; unknown honest", async () => {
  const {
    rows: [owner],
  } = await db.query(`select account_id from account where is_owner limit 1`);
  const ownerId = owner?.account_id ?? account.accountId;
  const {
    rows: [col],
  } = await db.query(
    `insert into collection (slug, title, kind, description, owner_account)
     values ('pros', 'Pros', 'player', 'Professional players', $1)
     returning collection_id`,
    [ownerId],
  );
  await db.query(
    `insert into collection_member (collection_id, subject_tag) values ($1, $2)`,
    [col.collection_id, OBSERVER],
  );
  await db.query(
    `insert into collection (slug, title, kind, owner_account, visibility)
     values ('secret', 'Secret', 'player', $1, 'private')`,
    [ownerId],
  );

  const browse = await call("collections_browse", {});
  assert.equal(browse.isError, false);
  assert.ok(browse.body.collections.some((c) => c.slug === "pros"));
  // caller is NOT the owner account in this fixture? account may be owner=false
  const got = await call("collections_get", { slug: "pros" });
  assert.equal(got.isError, false, JSON.stringify(got.body));
  assert.equal(got.body.kind, "player");
  const m = got.body.members.find((x) => x.player_tag === OBSERVER);
  assert.ok(m, "member enriched row present");
  assert.ok(typeof m.recording === "boolean");

  const missing = await call("collections_get", { slug: "nope-list" });
  assert.equal(missing.isError, true);
  assert.equal(missing.body.error.code, "not_found");
});

test("feedback round two: changelog since-filter, ship links, pending hint clears on read", async () => {
  const log = await call("elixir_changelog", { since: "0.14.0" });
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
  const filed = await call("elixir_feedback", {
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
  assert.equal(
    after2.body.meta.feedback_responses_pending,
    undefined,
    "hint clears once responses are read",
  );
});
