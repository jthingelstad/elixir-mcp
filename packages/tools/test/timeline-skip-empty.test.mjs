/**
 * elixir_timeline skip_empty (11.7.0): a poll whose window holds no item
 * answers without building the timeline. The check (timelineNews) must
 * never say "nothing" where the build would serve an item: a missed
 * source is a lost post. This file seeds one moment per item source,
 * then sweeps windows across them and holds the check to the build.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { emitEvent } from "../../ingest/src/events.mjs";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import {
  ITEM_KINDS,
  NEWS_SOURCES,
  buildTimeline,
  subjectsFor,
  timelineNews,
} from "../src/activity/entries.mjs";

const T = Date.parse("2026-09-20T12:00:00Z");
const H = 3_600_000;
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms) => new Date(ms).toISOString();

const CLAN = "#J2RGCRVG";
const OTHER_CLAN = "#GCYQR9VY";
const ME = "#PYL0Q2G8"; // claimed, verified, a member of CLAN
const FRIEND = "#PYL0Q2G9"; // claimed, in no tracked clan; plays, unlocks, joins OTHER_CLAN
const LAPSED = "#PYL0Q2GR"; // claimed; crosses a quiet rung
const STREAK = "#PYL0Q2GJ"; // member: five wins in a row
const BACK = "#PYL0Q2GC"; // member: returns after ten days
const GONE = "#PYL0Q2GU"; // member: crosses a quiet rung
const BADGE = "#PYL0Q2GV"; // member: a badge at a rung

let ctx;
let db;
let owner;
let counted = 0;
let invoke;

let battleSeq = 0;
async function battle(
  player,
  playedMs,
  learnedMs,
  { outcome = "win", clanTag = CLAN } = {},
) {
  battleSeq += 1;
  const id = `skip-empty-${battleSeq}`;
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, at(playedMs), at(learnedMs)],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, outcome, clan_tag)
     values ($1, $2, $3, 0, 'PvP', 'pvp', $4, $5, $6, $7)`,
    [
      id,
      player,
      at(playedMs),
      outcome === "win" ? 3 : 0,
      outcome === "win" ? 30 : -30,
      outcome,
      clanTag,
    ],
  );
}

/** Where each source's moment is OBSERVED, for the sweep and the checks. */
const SEEDED = {
  player_battles: T + H,
  player_moments: T + 2 * H,
  player_clan_moves: T + 3 * H,
  player_quiet: T + 4 * H,
  clan_ledger: T + 5 * H,
  clan_member_moments: T + 6 * H,
  clan_member_battles: T + 7 * H,
  clan_quiet: T + 9 * H,
  account: T + 10 * H,
  attested: T + 11 * H,
};

before(async () => {
  ctx = await scratchDb("timeline_skip_empty");
  db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS'), ($2, 'Ship It!')`,
    [CLAN, OTHER_CLAN],
  );
  for (const [tag, name] of [
    [ME, "me"],
    [FRIEND, "friend"],
    [LAPSED, "lapsed"],
    [STREAK, "streak"],
    [BACK, "back"],
    [GONE, "gone"],
    [BADGE, "badge"],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
  for (const tag of [ME, STREAK, BACK, GONE, BADGE])
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
       values ($1, $2, 'member', $3)`,
      [CLAN, tag, at(T - 60 * DAY)],
    );
  owner = (
    await db.query(
      `insert into account (email_hash, status, is_owner, timezone)
       values ('skip-empty-owner', 'approved', true, 'UTC') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true),
            ($1, $3, 'unverified', false, 'friend', true),
            ($1, $4, 'unverified', false, 'friend', true)`,
    [owner, ME, FRIEND, LAPSED],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, notify)
     values ($1, $2, 'comprehensive', true)`,
    [owner, CLAN],
  );

  // player_battles: a sitting of two, learned at T+1h, by a player in
  // no tracked clan, so no clan source can find it.
  for (const ago of [6, 2])
    await battle(
      FRIEND,
      SEEDED.player_battles - ago * MIN,
      SEEDED.player_battles,
      { clanTag: null },
    );
  // player_moments: a card unlocked.
  await db.query(
    `insert into card (card_id, name, kind) values (26000000, 'Knight', 'card') on conflict do nothing`,
  );
  await emitEvent(db, "card_unlocked", {
    tag: FRIEND,
    windowStart: at(SEEDED.player_moments - 10 * MIN),
    windowEnd: at(SEEDED.player_moments),
    payload: { card_id: 26000000, name: "Knight" },
  });
  // player_clan_moves: a friend joins another clan.
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
     values ($1, $2, 'member', $3)`,
    [OTHER_CLAN, FRIEND, at(SEEDED.player_clan_moves)],
  );
  // player_quiet: the last battle five days before the crossing. A player
  // with nothing else in a window is listed quiet and serves no item, so
  // the lapsed player also joins a clan in the crossing's window: read
  // under kinds [quiet_crossed], only this source can find it.
  await battle(
    LAPSED,
    SEEDED.player_quiet - 5 * DAY,
    SEEDED.player_quiet - 5 * DAY + MIN,
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
     values ($1, $2, 'member', $3)`,
    [OTHER_CLAN, LAPSED, at(SEEDED.player_quiet - 2 * MIN)],
  );
  // clan_ledger: a role change.
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, player_tag, role_before, role_after)
     values ($1, 'role_changed', 'estimated', $2, $3, $4, 'member', 'elder')`,
    [CLAN, at(SEEDED.clan_ledger - 10 * MIN), at(SEEDED.clan_ledger), BADGE],
  );
  // clan_member_moments: a badge at a rung.
  await emitEvent(db, "badge_earned", {
    tag: BADGE,
    windowStart: at(SEEDED.clan_member_moments - 10 * MIN),
    windowEnd: at(SEEDED.clan_member_moments),
    payload: { name: "MasteryHog", level: 5, prior_level: 4, max_level: 10 },
  });
  // clan_member_battles: five wins in a row (a standout), and a return
  // after ten days, both learned at T+7h.
  for (let i = 5; i >= 1; i -= 1)
    await battle(
      STREAK,
      SEEDED.clan_member_battles - i * 4 * MIN,
      SEEDED.clan_member_battles,
    );
  await battle(
    BACK,
    SEEDED.clan_member_battles - 10 * DAY,
    SEEDED.clan_member_battles - 10 * DAY + MIN,
  );
  await battle(
    BACK,
    SEEDED.clan_member_battles - MIN,
    SEEDED.clan_member_battles,
  );
  // clan_quiet: a member's last battle five days before the crossing.
  await battle(
    GONE,
    SEEDED.clan_quiet - 5 * DAY,
    SEEDED.clan_quiet - 5 * DAY + MIN,
    {
      outcome: "loss",
    },
  );
  // account: an account event.
  await db.query(
    `insert into account_event (account_id, kind, detail, created_at)
     values ($1, 'feedback_responded', '{}', $2)`,
    [owner, at(SEEDED.account)],
  );
  // attested: a clan fact the verified member sees, and a player's own.
  await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, occurred_at, recorded_at)
     values ('clan', $1, $2, 'departure_classified', '{"kind":"leave"}',
             'clan', 'clan.poapkings.com', 'skip-empty-1', $3, $3),
            ('player', null, $4, 'personal_record', '{"game":"drop","score":10}',
             'player', 'drop.poapkings.com', 'skip-empty-2', $5, $5)`,
    [CLAN, GONE, at(SEEDED.attested), ME, at(SEEDED.attested + 20 * MIN)],
  );

  // The invoker on a counting client: a read's query count, as
  // mcp_call_audit.db_queries counts it live.
  const countingDb = {
    query: (...a) => {
      counted += 1;
      return db.query(...a);
    },
  };
  invoke = makeInvoker({
    db: countingDb,
    account: {
      accountId: owner,
      isOwner: true,
      timezone: "UTC",
      credentialType: "oauth",
    },
    registry: makeRegistry(),
  });
});

after(async () => ctx.drop());

const build = (subjects, fromMs, toMs) =>
  buildTimeline(db, subjects, {
    fromMs,
    toMs,
    accountId: owner,
    interactive: true,
  });

test("every item kind belongs to a source the check asks", () => {
  const covered = new Set(Object.values(NEWS_SOURCES).flat());
  for (const kind of ITEM_KINDS)
    assert.ok(covered.has(kind), `${kind} has no news source`);
  assert.ok(covered.has("account_*"), "account kinds are covered");
});

test("each source's moment answers its own check", async () => {
  const subjects = await subjectsFor(db, owner);
  for (const [source, observed] of Object.entries(SEEDED)) {
    const news = await timelineNews(db, subjects, {
      fromMs: observed - 5 * MIN,
      toMs: observed,
      accountId: owner,
    });
    assert.equal(news.sources[source], true, `${source} at ${at(observed)}`);
  }
});

test("sweep: a window the build serves an item in is never news-free, for every kind it serves", async () => {
  const subjects = await subjectsFor(db, owner);
  const windows = [];
  // 5-minute polls and hour-long backed-off polls across the seeded span.
  for (let from = T - H; from < T + 12 * H; from += 5 * MIN)
    windows.push([from, from + 5 * MIN]);
  for (let from = T - H; from < T + 12 * H; from += 30 * MIN)
    windows.push([from, from + H]);
  const served = new Set();
  const firedSources = new Set();
  let skippable = 0;
  for (const [fromMs, toMs] of windows) {
    const built = await build(subjects, fromMs, toMs);
    const news = await timelineNews(db, subjects, {
      fromMs,
      toMs,
      accountId: owner,
    });
    for (const [k, v] of Object.entries(news.sources))
      if (v) firedSources.add(k);
    if (built.timeline.length === 0 && !news.any) skippable += 1;
    if (built.timeline.length === 0) continue;
    assert.ok(
      news.any,
      `(${at(fromMs)}, ${at(toMs)}] serves ${built.timeline.map((i) => i.kind).join(", ")} but the check said nothing`,
    );
    // The same window read under each served kind alone.
    for (const kind of new Set(built.timeline.map((i) => i.kind))) {
      served.add(kind.startsWith("account_") ? "account_*" : kind);
      const narrowed = await timelineNews(db, subjects, {
        fromMs,
        toMs,
        accountId: owner,
        kinds: [kind],
      });
      assert.ok(
        narrowed.any,
        `(${at(fromMs)}, ${at(toMs)}] serves ${kind}; the check under kinds [${kind}] said nothing`,
      );
    }
  }
  // The sweep reached every source and the kinds the seeds make.
  assert.deepEqual([...firedSources].sort(), Object.keys(NEWS_SOURCES).sort());
  for (const kind of [
    "battle_session",
    "session_standout",
    "card_unlocked",
    "badge_earned",
    "clan_joined",
    "member_role_changed",
    "quiet_crossed",
    "returned",
    "departure_classified",
    "personal_record",
    "account_*",
  ])
    assert.ok(served.has(kind), `the sweep served ${kind}`);
  assert.ok(skippable > windows.length / 2, `${skippable} empty windows`);
});

test("a kinds filter asks only the sources that can serve those kinds", async () => {
  const subjects = await subjectsFor(db, owner);
  const window = { fromMs: SEEDED.account - 5 * MIN, toMs: SEEDED.account };
  const all = await timelineNews(db, subjects, { ...window, accountId: owner });
  assert.equal(all.any, true);
  const roster = await timelineNews(db, subjects, {
    ...window,
    accountId: owner,
    kinds: ["member_joined", "member_left"],
  });
  assert.equal(roster.any, false, "an account event is not a roster move");
  const acct = await timelineNews(db, subjects, {
    ...window,
    accountId: owner,
    kinds: ["account_feedback_responded"],
  });
  assert.equal(acct.any, true);
});

const EMPTY = { from: at(T + 8 * H + 30 * MIN), to: at(T + 8 * H + 35 * MIN) };

test("skip_empty on an empty window: no build, entries_skipped, the same cursor and window as a full read", async () => {
  counted = 0;
  const full = await invoke("elixir_timeline", { ...EMPTY, mark_read: false });
  const fullQueries = counted;
  counted = 0;
  const t0 = performance.now();
  const fast = await invoke("elixir_timeline", {
    ...EMPTY,
    mark_read: false,
    skip_empty: true,
  });
  const fastMs = performance.now() - t0;
  const fastQueries = counted;
  assert.equal(full.isError, false, JSON.stringify(full.body));
  assert.equal(fast.isError, false, JSON.stringify(fast.body));
  assert.deepEqual(full.body.timeline, [], "the window is empty");
  assert.ok(full.body.entries.length > 0, "a full read still serves entries");
  assert.equal(full.body.entries_skipped, false);

  assert.equal(fast.body.entries_skipped, true);
  assert.deepEqual(fast.body.timeline, []);
  assert.deepEqual(fast.body.entries, []);
  assert.deepEqual(fast.body.quiet, []);
  assert.equal(fast.body.applied.skip_empty, true);
  for (const k of [
    "window",
    "next_cursor",
    "read_to",
    "has_more",
    "timeline_more",
    "timeline_more_to",
    "subjects",
  ])
    assert.deepEqual(fast.body[k], full.body[k], k);
  assert.deepEqual(
    { ...fast.body.applied, skip_empty: undefined },
    { ...full.body.applied, skip_empty: undefined },
  );
  assert.ok(fast.body.meta.contract_version);
  assert.ok(
    fast.body.notes.some((n) => /entries_skipped/.test(n)),
    "a note says why the entries are empty",
  );
  assert.ok(
    fastQueries * 3 <= fullQueries,
    `fast ${fastQueries} queries vs full ${fullQueries}`,
  );
  console.log(
    `skip_empty: ${fastQueries} queries (${fastMs.toFixed(1)} ms) against a full read's ${fullQueries}`,
  );
});

test("skip_empty on a window with an item reads exactly as a full read", async () => {
  const window = {
    from: at(SEEDED.clan_member_battles - 5 * MIN),
    to: at(SEEDED.clan_member_battles),
    mark_read: false,
  };
  const full = await invoke("elixir_timeline", window);
  const fast = await invoke("elixir_timeline", { ...window, skip_empty: true });
  assert.ok(full.body.timeline.length > 0);
  assert.equal(fast.body.entries_skipped, false);
  assert.deepEqual(fast.body.timeline, full.body.timeline);
  assert.deepEqual(fast.body.entries, full.body.entries);
  assert.deepEqual(fast.body.quiet, full.body.quiet);
  assert.equal(fast.body.next_cursor, full.body.next_cursor);
});

test("skip_empty moves a named reader's pointer as a full read does, and kinds decide what is empty", async () => {
  const reader = "skip-empty-editor";
  const first = await invoke("elixir_timeline", {
    from: EMPTY.from,
    to: EMPTY.to,
    reader,
    skip_empty: true,
  });
  assert.equal(first.body.entries_skipped, true);
  assert.equal(first.body.read_to, EMPTY.to, "the pointer moved to the end");
  const {
    rows: [row],
  } = await db.query(
    `select read_to from timeline_reader where account_id = $1 and reader = $2`,
    [owner, reader],
  );
  assert.equal(row.read_to.toISOString(), EMPTY.to);

  // The account event's window, read by a roster-only consumer: empty to
  // it, so skipped; read for account kinds, it builds.
  const acctWindow = {
    from: at(SEEDED.account - 5 * MIN),
    to: at(SEEDED.account),
    mark_read: false,
    skip_empty: true,
  };
  const roster = await invoke("elixir_timeline", {
    ...acctWindow,
    kinds: ["member_joined", "member_left"],
  });
  assert.equal(roster.body.entries_skipped, true);
  const acct = await invoke("elixir_timeline", {
    ...acctWindow,
    kinds: ["account_feedback_responded"],
  });
  assert.equal(acct.body.entries_skipped, false);
  assert.deepEqual(
    acct.body.timeline.map((i) => i.kind),
    ["account_feedback_responded"],
  );
});

test("an evidence read always builds", async () => {
  const window = {
    from: at(SEEDED.player_battles - 5 * MIN),
    to: at(SEEDED.player_battles),
    mark_read: false,
  };
  const full = await invoke("elixir_timeline", window);
  const session = full.body.timeline.find((i) => i.kind === "battle_session");
  assert.ok(session, JSON.stringify(full.body.timeline));
  const ev = await invoke("elixir_timeline", {
    ...window,
    skip_empty: true,
    evidence_item_id: session.id,
  });
  assert.equal(ev.isError, false, JSON.stringify(ev.body));
  assert.equal(ev.body.entries_skipped, false);
  assert.equal(ev.body.timeline[0].id, session.id);
});
