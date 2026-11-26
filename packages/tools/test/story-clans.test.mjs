/**
 * A clan's stored stories (stage 5 of the stored Timeline, 2026-11-26;
 * docs/notes/2026-11-26-timeline-story-clans.md): the write stores the
 * clan's 8-day telling with what each window selects it by, a window cut
 * from the rows tells what a build of that window tells at either reader
 * scope, the sweep wakes a due clan, and `off` does nothing. On a scratch
 * database (golden rule 9). Invented tags throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  buildTimeline,
  clanWindowItems,
  restoredItem,
  standoutInWindow,
  storedClanTimeline,
} from "../src/activity/entries.mjs";
import {
  STORY_CLAN_SPAN_DAYS,
  readClanRows,
  readSubjectStories,
  storiesToWake,
  storySpan,
  writeSubjectStories,
} from "../src/activity/story-store.mjs";
import {
  compareClanStories,
  refreshClanStories,
  storyClansOf,
} from "../src/activity/story-clans.mjs";
import { TIMELINE_CLANS_SQL } from "../src/recorded-players.mjs";

const CLAN = "#0QRPUY8L";
const QUIET_CLAN = "#0VJ2YRLC"; // followed with notify off: not in the set
const STREAK = "#0LPC2UGQ"; // five wins in a row, then five more
const BACK = "#0RV9JPGY"; // returns after ten days
const GONE = "#0YQ8CJ2L"; // crosses the five-day quiet rung
const ROLE = "#0P2GUVRC"; // promoted: occurred before the week, observed in it
const MIN = 60_000;
const H = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.now();
const WEEK_FROM = NOW - 7 * DAY;
const iso = (ms) => new Date(ms).toISOString();
/** Members with one moment each, more than the moment cap (100). */
const MOMENT_MEMBERS = 104;
const memberTag = (i) =>
  `#0${"0289PYLQGRJCUV"[Math.floor(i / 14)]}${"0289PYLQGRJCUV"[i % 14]}YYGG`;

let ctx;
let db;
let owner;
let seq = 0;

async function battle(player, playedMs, learnedMs, outcome = "win") {
  seq += 1;
  const id = `story-clans-${seq}`;
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, iso(playedMs), iso(learnedMs)],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side,
       type, type_class, crowns, trophy_change, outcome, clan_tag)
     values ($1, $2, $3, 0, 'PvP', 'pvp', $4, $5, $6, $7)`,
    [
      id,
      player,
      iso(playedMs),
      outcome === "win" ? 3 : 0,
      outcome === "win" ? 30 : -30,
      outcome,
      CLAN,
    ],
  );
}

async function member(tag, name) {
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    tag,
    name,
  ]);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
     values ($1, $2, 'member', $3)`,
    [CLAN, tag, iso(NOW - 60 * DAY)],
  );
}

const clanRows = async (tag = CLAN) =>
  (
    await db.query(
      `select story_id, kind, observed_at, sort_at, built_at, item
         from timeline_story where subject_kind = 'clan' and subject_tag = $1
        order by story_id`,
      [tag],
    )
  ).rows;

/** The week as Home builds a clan: observed, items only. */
const builtWeek = (scope, fromMs = WEEK_FROM, toMs = NOW) =>
  buildTimeline(db, [{ kind: "clan", tag: CLAN, scope }], {
    fromMs,
    toMs,
    timezone: "UTC",
    accountId: null,
    basis: "observed",
    accountLines: false,
    lateCounts: false,
    cap: Number.MAX_SAFE_INTEGER,
    filter: (it) => it.section !== "attested",
  });
const cutWeek = async (scope, fromMs = WEEK_FROM, toMs = NOW) =>
  storedClanTimeline(
    db,
    CLAN,
    (await clanRows()).map((r) => restoredItem(structuredClone(r.item))),
    {
      fromMs,
      toMs,
      basis: "observed",
      scope,
      cap: Number.MAX_SAFE_INTEGER,
      filter: (it) => it.section !== "attested",
    },
  );

before(async () => {
  ctx = await scratchDb("story_clans");
  db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Story Clan'), ($2, 'Quiet Clan')`,
    [CLAN, QUIET_CLAN],
  );
  for (const [tag, name] of [
    [STREAK, "streak"],
    [BACK, "back"],
    [GONE, "gone"],
    [ROLE, "role"],
  ])
    await member(tag, name);
  owner = (
    await db.query(
      `insert into account (email_hash, status, timezone)
       values ('story-clans-owner', 'approved', 'UTC') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, notify)
     values ($1, $2, 'comprehensive', true), ($1, $3, 'comprehensive', false)`,
    [owner, CLAN, QUIET_CLAN],
  );
  // A sitting of ten wins: five learned two days ago (the first rung),
  // five more learned a day ago (the second).
  const sitting = NOW - 2 * DAY - 2 * H;
  for (let i = 0; i < 10; i += 1)
    await battle(
      STREAK,
      sitting + i * 4 * MIN,
      i < 5 ? NOW - 2 * DAY : NOW - DAY,
    );
  // A return after ten days away.
  await battle(BACK, NOW - 13 * DAY, NOW - 13 * DAY + MIN);
  await battle(BACK, NOW - 3 * DAY, NOW - 3 * DAY + MIN);
  // A quiet member: last battle six days ago, the five-day rung a day ago.
  await battle(GONE, NOW - 6 * DAY, NOW - 6 * DAY + MIN, "loss");
  // A promotion that occurred before the week and was observed in it.
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start,
       window_end, occurred_at, player_tag, role_before, role_after)
     values ($1, 'role_changed', 'estimated', $2, $3, $4, $5, 'member', 'elder')`,
    [
      CLAN,
      iso(NOW - 7 * DAY - 14 * H),
      iso(NOW - 6 * DAY),
      iso(NOW - 7 * DAY - 12 * H),
      ROLE,
    ],
  );
  // More member moments than the cap, eight of them at one instant (the
  // tie-break), all in the week.
  for (let i = 0; i < MOMENT_MEMBERS; i += 1) {
    const tag = memberTag(i);
    await member(tag, `moment ${i}`);
    const at = i < 8 ? NOW - 4 * DAY : NOW - 5 * DAY + i * 10 * MIN;
    await db.query(
      `insert into player_event (player_tag, event_type, timing, window_start,
         window_end, league_from, league_to)
       values ($1, 'ranked_promotion', 'estimated', $2, $3, 2, 3)`,
      [tag, iso(at - 10 * MIN), iso(at)],
    );
  }
});

after(async () => {
  await ctx?.drop();
});

test("the clan set is every clan an account's Timeline reads", async () => {
  const { rows } = await db.query(TIMELINE_CLANS_SQL);
  assert.deepEqual(
    rows.map((r) => r.clan_tag),
    [CLAN],
  );
});

test("off writes and compares nothing", async () => {
  assert.equal(storyClansOf(undefined), "off");
  assert.equal(storyClansOf("on"), "off");
  assert.equal(storyClansOf("shadow"), "shadow");
  assert.deepEqual(
    await refreshClanStories(db, CLAN, { mode: "off", now: NOW }),
    { skipped: "off" },
  );
  assert.equal((await clanRows()).length, 0);
  const { rows } = await db.query(
    `select 1 from timeline_story_subject where subject_kind = 'clan'`,
  );
  assert.equal(rows.length, 0);
});

test("a write stores the clan's telling, and the reads stay players only", async () => {
  const out = await refreshClanStories(db, CLAN, { mode: "shadow", now: NOW });
  assert.ok(out.stories > MOMENT_MEMBERS, JSON.stringify(out));
  assert.equal(out.written, out.stories);
  const rows = await clanRows();
  const kinds = new Set(rows.map((r) => r.kind));
  for (const k of [
    "session_standout",
    "returned",
    "quiet_crossed",
    "member_role_changed",
    "ranked_promotion",
  ])
    assert.ok(kinds.has(k), `${k} in ${[...kinds]}`);
  // Every member moment, uncapped.
  assert.equal(
    rows.filter((r) => r.kind === "ranked_promotion").length,
    MOMENT_MEMBERS,
  );
  // The promotion's observed_at column is its row's window_end.
  const role = rows.find((r) => r.kind === "member_role_changed");
  assert.equal(role.observed_at.getTime(), NOW - 6 * DAY);
  assert.equal(role.item._superset.window_end, iso(NOW - 6 * DAY));
  // The standout keeps every crossing (five wins and +150 at the fifth
  // battle, ten and +300 at the tenth), and its column is the latest.
  const standout = rows.find((r) => r.kind === "session_standout");
  assert.equal(standout.item._superset.crossings.length, 4);
  assert.equal(standout.observed_at.getTime(), NOW - DAY);
  // The log line's fields: counts, ids and a hash, never the tag.
  assert.ok(out.shadow, "shadow fields");
  assert.match(out.shadow.clan, /^[0-9a-f]{10}$/);
  assert.ok(!JSON.stringify(out.shadow).includes(CLAN));
  for (const tag of [STREAK, BACK, GONE, ROLE])
    assert.ok(!JSON.stringify(out.shadow).includes(tag));
  await assert.rejects(
    readSubjectStories(db, "clan", CLAN, {
      fromMs: WEEK_FROM,
      toMs: NOW,
      visibilities: ["public"],
    }),
    /players only/,
  );
});

test("a second write stores nothing new", async () => {
  const before = await clanRows();
  const out = await writeSubjectStories(
    db,
    "clan",
    CLAN,
    storySpan(NOW, "clan"),
  );
  assert.equal(out.written, 0, JSON.stringify(out));
  assert.equal(out.deleted, 0);
  const again = await clanRows();
  assert.deepEqual(
    again.map((r) => [r.story_id, r.built_at.getTime()]),
    before.map((r) => [r.story_id, r.built_at.getTime()]),
  );
});

test("the comparison is clean at both scopes", async () => {
  const diff = await compareClanStories(db, CLAN, { now: NOW });
  for (const scope of ["comprehensive", "activity"]) {
    const d = diff[scope];
    assert.equal(d.only_computed, 0, JSON.stringify(d));
    assert.equal(d.only_stored, 0, JSON.stringify(d));
    assert.equal(d.revision, 0, JSON.stringify(d));
    assert.equal(d.content, 0, JSON.stringify(d));
    assert.equal(d.order_same, true);
    assert.ok(d.computed > 0);
  }
  assert.ok(diff.comprehensive.computed > diff.activity.computed);
});

test("activity scope drops presence, and the moment cap matches the build's", async () => {
  for (const scope of ["comprehensive", "activity"]) {
    const built = await builtWeek(scope);
    const cut = await cutWeek(scope);
    assert.equal(cut.timeline_more, built.timeline_more, scope);
    assert.ok(built.timeline_more > 0, "the cap left moments out");
    assert.deepEqual(
      cut.timeline_dropped.map((it) => it.id).sort(),
      built.timeline_dropped.map((it) => it.id).sort(),
      scope,
    );
    const presence = cut.timeline.filter((it) =>
      ["quiet_crossed", "returned"].includes(it.kind),
    );
    if (scope === "activity") assert.equal(presence.length, 0);
    else assert.equal(presence.length, 2);
  }
  const rows = (await clanRows()).map((r) => restoredItem(r.item));
  const window = { fromMs: WEEK_FROM, toMs: NOW, basis: "observed" };
  const activity = clanWindowItems(rows, { ...window, scope: "activity" });
  assert.ok(
    activity.items.every(
      (it) => it.kind !== "quiet_crossed" && it.kind !== "returned",
    ),
  );
});

test("a window selects the ledger by window_end", async () => {
  // A week that ends before the row was observed does not tell it; one
  // that holds its window_end does, though it occurred before the week.
  for (const [toMs, told] of [
    [NOW - 6 * DAY - H, false],
    [NOW - 6 * DAY + H, true],
  ]) {
    const fromMs = toMs - 7 * DAY;
    const cut = clanWindowItems(
      (await clanRows()).map((r) => restoredItem(r.item)),
      { fromMs, toMs, basis: "observed" },
    );
    assert.equal(
      cut.items.some((it) => it.kind === "member_role_changed"),
      told,
      `to ${iso(toMs)}`,
    );
  }
});

test("standoutInWindow: the first rung only, the last only, or none", async () => {
  const row = (await clanRows()).find((r) => r.kind === "session_standout");
  const item = restoredItem(structuredClone(row.item));
  // The fifth battle's crossings were learned two days ago, the tenth's
  // a day ago.
  const crossings = row.item._superset.crossings;
  const learnedAt = (ms) => crossings.filter((c) => c.learned_at === iso(ms));
  const first = learnedAt(NOW - 2 * DAY);
  const last = learnedAt(NOW - DAY);
  assert.equal(first.length, 2);
  assert.equal(last.length, 2);
  const labels = (cs) => cs.map((c) => c.label);
  const firstOnly = standoutInWindow(item, {
    fromMs: NOW - 3 * DAY,
    toMs: NOW - 1.5 * DAY,
    basis: "observed",
  });
  assert.deepEqual(firstOnly.facts.newly, labels(first));
  assert.equal(firstOnly.at, first[0].at);
  assert.equal(firstOnly.observed_at, iso(NOW - 2 * DAY));
  const lastOnly = standoutInWindow(item, {
    fromMs: NOW - 1.5 * DAY,
    toMs: NOW,
    basis: "observed",
  });
  assert.deepEqual(lastOnly.facts.newly, labels(last));
  assert.equal(lastOnly.at, last[0].at);
  assert.equal(lastOnly.observed_at, iso(NOW - DAY));
  assert.equal(
    standoutInWindow(item, {
      fromMs: NOW - 0.5 * DAY,
      toMs: NOW,
      basis: "observed",
    }),
    null,
  );
  // The windows' builds say the same.
  for (const [fromMs, toMs, newly] of [
    [NOW - 3 * DAY, NOW - 1.5 * DAY, labels(first)],
    [NOW - 1.5 * DAY, NOW, labels(last)],
  ]) {
    const built = await builtWeek("comprehensive", fromMs, toMs);
    const told = built.timeline.find((it) => it.kind === "session_standout");
    assert.deepEqual(told?.facts?.newly, newly);
  }
});

test("a tampered row is named by the comparison", async () => {
  const row = (await clanRows()).find((r) => r.kind === "returned");
  const item = { ...row.item, facts: { ...row.item.facts, days_away: 99 } };
  await db.query(
    `update timeline_story set item = $3
      where subject_kind = 'clan' and subject_tag = $1 and story_id = $2`,
    [CLAN, row.story_id, JSON.stringify(item)],
  );
  try {
    const diff = await compareClanStories(db, CLAN, { now: NOW });
    assert.equal(diff.comprehensive.content, 1, JSON.stringify(diff));
    assert.deepEqual(diff.comprehensive.ids.content, [row.story_id]);
    assert.ok(
      diff.comprehensive.groups.some(
        (g) => g.kind === "returned" && g.bucket === "content",
      ),
    );
    // An activity reader never sees a return: nothing to differ.
    assert.equal(diff.activity.content, 0);
  } finally {
    await db.query(
      `update timeline_story set item = $3
        where subject_kind = 'clan' and subject_tag = $1 and story_id = $2`,
      [CLAN, row.story_id, JSON.stringify(row.item)],
    );
  }
});

test("a read older than the span is refused", async () => {
  const written = (await readClanRows(db, CLAN, { fromMs: WEEK_FROM }))
    .written_at;
  assert.ok(written >= NOW);
  assert.deepEqual(
    await readClanRows(db, CLAN, {
      fromMs: written - STORY_CLAN_SPAN_DAYS * DAY - MIN,
    }),
    { ok: false, reason: "span" },
  );
  assert.deepEqual(await readClanRows(db, QUIET_CLAN, { fromMs: WEEK_FROM }), {
    ok: false,
    reason: "unwritten",
  });
});

test("the sweep wakes a due clan and leaves a current one", async () => {
  const current = await storiesToWake(db, { now: Date.now() });
  assert.deepEqual(current.clans.tags, []);
  assert.equal(current.clans.counts.set, 1);
  // The record learns a battle after the write: news.
  await battle(STREAK, Date.now() - MIN, Date.now());
  const news = await storiesToWake(db, { now: Date.now() + 3 * MIN });
  assert.deepEqual(news.clans.tags, [CLAN]);
  assert.equal(news.clans.counts.news, 1);
  // Past the floor, with no news: the floor.
  const floor = await storiesToWake(db, {
    now: Date.now() + 7 * H,
    clanLimit: 1,
  });
  assert.deepEqual(floor.clans.tags, [CLAN]);
  // A limit of none wakes none.
  assert.deepEqual(
    (await storiesToWake(db, { now: Date.now() + 7 * H, clanLimit: 0 })).clans
      .tags,
    [],
  );
  // Unwritten first: the clan's marker gone.
  await db.query(
    `delete from timeline_story_subject where subject_kind = 'clan'`,
  );
  const unwritten = await storiesToWake(db, { now: Date.now() });
  assert.deepEqual(unwritten.clans.tags, [CLAN]);
  assert.equal(unwritten.clans.counts.unwritten, 1);
});
