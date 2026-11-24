/**
 * Every read tells a battle at its played time however late Elixir learned
 * it (2026-11-23, docs/notes/2026-11-23-late-battles-everywhere.md; Jamie:
 * "I don't know that we should ever delete a battle just because it was
 * late", "as long as the timestamps are honored"). Check for new battles
 * on a player nobody follows lands a log whose battles are all a day or
 * more old: every one a late capture. The sitting is told at its played
 * time by an occurred read and an observed one (marked late when it was
 * played before the window), on the player's timeline and the clan's, under
 * one id; its games agree with it. A return is never judged from a late
 * batch, and a sitting learned only late is never sent as news
 * (learnedLate).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  buildTimeline,
  learnedLate,
  readTimelineEvidence,
  restoredItem,
  storedItem,
} from "../src/activity/entries.mjs";

// Invented tags (docs/invented-tags.json): this repository is public.
const TAG = "#0LCU2RY8";
const FOE = "#0LCU2RY9";
const MIX = "#0LCU2RYU"; // a sitting begun on time and finished late
const CLAN = "#0LCU2RYC";
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const FROM = NOW - 7 * DAY;
// The battle log read 46 hours after the sitting began.
const SITTING = NOW - 2 * DAY;
const LEARNED = SITTING + 46 * H;
// MIX's sitting: its first battle learned a minute after play, the next
// two two days on.
const MIXED = NOW - 4 * DAY;
const iso = (ms) => new Date(ms).toISOString();
const id = (n) => `late-battle-${String(n).padStart(2, "0")}`;

let scratch, db;
async function battle(
  n,
  playedMs,
  learnedMs,
  { outcome, boat = null, player = TAG, clan = CLAN } = {},
) {
  await db.query(
    `insert into battle(battle_id,battle_time,type,type_class,boat_battle_side,created_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      id(n),
      iso(playedMs),
      boat ? "boatBattle" : "PvP",
      boat ? "boat" : "pvp",
      boat,
      iso(learnedMs),
    ],
  );
  await db.query(
    `insert into battle_participant(battle_id,player_tag,clan_tag,battle_time,side,type,type_class,crowns,trophy_change,outcome)
     values ($1,$2,$3,$4,0,$5,$6,$7,$8,$9)`,
    [
      id(n),
      player,
      clan,
      iso(playedMs),
      boat ? "boatBattle" : "PvP",
      boat ? "boat" : "pvp",
      outcome === "win" ? 3 : 0,
      outcome === "win" ? 30 : -30,
      outcome,
    ],
  );
  await db.query(
    `insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,crowns,outcome)
     values ($1,$2,$3,1,'PvP','pvp',$4,$5)`,
    [
      id(n),
      FOE,
      iso(playedMs),
      outcome === "win" ? 0 : 3,
      outcome === "win" ? "loss" : "win",
    ],
  );
}

before(async () => {
  scratch = await scratchDb("timeline_late_battles");
  db = scratch.db;
  await db.query(
    "insert into player(player_tag,name) values ($1,'Late Larch'),($2,'Foe Fir'),($3,'Mixed Maple')",
    [TAG, FOE, MIX],
  );
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Late Lodge')`,
    [CLAN],
  );
  for (const tag of [TAG, MIX])
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
       values ($1, $2, 'member', $3)`,
      [CLAN, tag, iso(NOW - 60 * DAY)],
    );
  // A battle the record learned on time, twelve days before the sitting:
  // the gap before the late batch is not a return Elixir can vouch for.
  await battle(0, SITTING - 12 * DAY, SITTING - 12 * DAY + MIN, {
    outcome: "win",
  });
  // Four battles, five minutes apart, all learned 46 hours after the first.
  for (const [n, outcome] of ["win", "win", "loss", "win"].entries())
    await battle(n + 1, SITTING + n * 5 * MIN, LEARNED, { outcome });
  // An enemy attacking the player's boat is never their battle, late or not.
  await battle(9, SITTING + 7 * MIN, LEARNED, {
    outcome: "win",
    boat: "defender",
  });
  // MIX: one battle on time, then two the record learned two days later.
  await battle(11, MIXED, MIXED + MIN, { outcome: "win", player: MIX });
  await battle(12, MIXED + 5 * MIN, MIXED + 2 * DAY, {
    outcome: "loss",
    player: MIX,
  });
  await battle(13, MIXED + 10 * MIN, MIXED + 2 * DAY, {
    outcome: "win",
    player: MIX,
  });
});
after(async () => scratch?.drop());

const player = (tag) => ({
  kind: "player",
  tag,
  relationship: null,
  nickname: null,
});
const read = (opts = {}, subjects = [player(TAG)]) =>
  buildTimeline(db, subjects, {
    fromMs: FROM,
    toMs: NOW,
    timezone: "UTC",
    accountId: null,
    basis: "occurred",
    ...opts,
  });
const sittingOf = (built, tag = TAG) =>
  built.timeline.find(
    (it) => it.kind === "battle_session" && it.subject_tag === tag,
  );

test("a late-captured sitting is told at its played time, whole", async () => {
  const built = await read();
  const sittings = built.timeline.filter((it) => it.kind === "battle_session");
  assert.equal(sittings.length, 1, JSON.stringify(built.timeline));
  const [s] = sittings;
  assert.equal(s.at, iso(SITTING));
  assert.equal(s.facts.started_at, iso(SITTING));
  assert.equal(s.facts.ended_at, iso(SITTING + 15 * MIN));
  assert.equal(s.facts.battles, 4);
  assert.equal(s.facts.won, 3);
  assert.equal(s.facts.lost, 1);
  assert.equal(s.revision, 4);
  assert.equal(s.observed_at, iso(LEARNED));
  assert.equal(s.late, false);
  assert.equal(s.evidence.count, 4);
  assert.equal(s.evidence.from, iso(SITTING));
  assert.equal(s.evidence.completeness, "recorded_sitting");
  // Learned only late: told, never sent as news.
  assert.equal(learnedLate(s), true);
  assert.equal(JSON.stringify(s).includes("learned"), false, "server-only");

  const [entry] = built.entries;
  assert.equal(entry.battles.played, 4);
  assert.equal(entry.battles.sessions, 1);
  assert.equal(entry.battles.late_captures, 4, "told, and counted late");
  // No return from a late batch: the twelve days before it may be battles
  // Elixir never read.
  assert.equal(entry.presence.returned_after_days, null);
  assert.ok(!built.timeline.some((it) => it.kind === "returned"));
  assert.ok(!entry.notables.some((n) => n.kind === "returned"));

  // Its games agree with it: the same four, in played order, at the same
  // version, and the boat defense is not one of them.
  const games = await readTimelineEvidence(db, s, {
    expectedVersion: s.evidence.version,
  });
  assert.ok(!games.error, JSON.stringify(games));
  assert.deepEqual(
    games.battles.map((b) => b.battle_id),
    [id(1), id(2), id(3), id(4)],
  );
  assert.equal(games.count, 4);

  // The stored form (the story store, Home's week) keeps its games and
  // that it was learned late.
  const back = restoredItem(JSON.parse(JSON.stringify(storedItem(s))));
  assert.equal(learnedLate(back), true);
  const again = await readTimelineEvidence(db, back, {
    expectedVersion: s.evidence.version,
  });
  assert.equal(again.battles.length, 4);

  // The same sitting read again through a narrower window is one story.
  const narrow = sittingOf(await read({ fromMs: SITTING + 10 * MIN }));
  assert.equal(narrow.id, s.id);
  assert.equal(narrow.revision, s.revision);
  assert.equal(narrow.evidence.version, s.evidence.version);
});

test("an observed read tells it at its played time, late when played before the window", async () => {
  const occurred = sittingOf(await read());
  // A poller's window that opened an hour before the log was read: the
  // sitting was played two days before it, found by when it was learned.
  const built = await read({ basis: "observed", fromMs: LEARNED - H });
  const s = sittingOf(built);
  assert.ok(s, JSON.stringify(built.timeline));
  assert.equal(s.at, iso(SITTING));
  assert.equal(s.late, true, "happened before from, learned in the window");
  assert.equal(s.id, occurred.id);
  assert.equal(s.revision, occurred.revision);
  assert.equal(s.evidence.version, occurred.evidence.version);
  assert.equal(learnedLate(s), true);
  assert.equal(built.entries[0].battles.late_captures, 4);
  assert.equal(built.entries[0].presence.returned_after_days, null);
  // A window that holds its play is not late, and is the same story.
  const wide = sittingOf(await read({ basis: "observed" }));
  assert.equal(wide.late, false);
  assert.equal(wide.id, occurred.id);
  // A window that learned none of it tells none of it.
  const before = await read({ basis: "observed", toMs: LEARNED - H });
  assert.equal(sittingOf(before), undefined);
});

test("a sitting begun on time and finished late is one story, all of it", async () => {
  const subjects = [player(MIX)];
  const reads = {
    occurred: await read({}, subjects),
    observed: await read({ basis: "observed" }, subjects),
  };
  const ids = new Set();
  for (const [basis, built] of Object.entries(reads)) {
    const s = sittingOf(built, MIX);
    assert.ok(s, `${basis}: ${JSON.stringify(built.timeline)}`);
    ids.add(s.id);
    assert.equal(s.at, iso(MIXED), basis);
    assert.equal(s.facts.battles, 3, basis);
    assert.equal(s.revision, 3, basis);
    assert.equal(s.evidence.count, 3, basis);
    assert.equal(s.evidence.from, iso(MIXED), basis);
    // One battle came on time: it is news like any sitting.
    assert.equal(learnedLate(s), false, basis);
    assert.equal(built.entries[0].battles.late_captures, 2, basis);
    const games = await readTimelineEvidence(db, s, {
      expectedVersion: s.evidence.version,
    });
    assert.deepEqual(
      games.battles?.map((b) => b.battle_id),
      [id(11), id(12), id(13)],
      basis,
    );
  }
  // Read before the late two were learned, it is the same story, smaller.
  const early = sittingOf(
    await read({ basis: "observed", toMs: MIXED + H }, subjects),
    MIX,
  );
  ids.add(early.id);
  assert.equal(early.revision, 1);
  assert.equal(ids.size, 1, "one id");
});

test("an observed read at the late capture tells the sitting begun on time whole", async () => {
  // Codex on #1223: the window holds only the two battles learned two
  // days late; the first, learned on time, is the sitting's all the same.
  const subjects = [player(MIX)];
  const whole = sittingOf(await read({}, subjects), MIX);
  const at = { basis: "observed", fromMs: MIXED + 2 * DAY - H };
  for (const batchPlayers of [true, false]) {
    const built = await read({ ...at, batchPlayers }, subjects);
    const s = sittingOf(built, MIX);
    assert.ok(s, JSON.stringify(built.timeline));
    for (const key of ["id", "at", "revision"])
      assert.equal(s[key], whole[key], `${key} (batched: ${batchPlayers})`);
    assert.equal(s.facts.started_at, iso(MIXED));
    assert.equal(s.facts.battles, 3);
    assert.deepEqual(
      { ...s.facts, open: null },
      { ...whole.facts, open: null },
      `batched: ${batchPlayers}`,
    );
    assert.deepEqual(s.evidence, whole.evidence);
    assert.equal(s.late, true, "played before the window");
    assert.equal(learnedLate(s), false);
    const games = await readTimelineEvidence(db, s, {
      expectedVersion: s.evidence.version,
    });
    assert.equal(games.battles.length, s.facts.battles);
    // The window's own counts are what it learned: the late two.
    assert.equal(built.entries[0].battles.played, 2);
    assert.equal(built.entries[0].battles.late_captures, 2);
  }
  // A clan's read about the member tells the same sitting, whole.
  const clan = await read({ ...at, memberTag: MIX }, [
    { kind: "clan", tag: CLAN, scope: "comprehensive" },
  ]);
  const c = clan.timeline.find(
    (it) => it.kind === "battle_session" && it.facts.player_tag === MIX,
  );
  assert.ok(c, JSON.stringify(clan.timeline));
  assert.equal(c.id, whole.id);
  assert.equal(c.facts.started_at, iso(MIXED));
  assert.equal(c.facts.battles, 3);
  assert.equal(c.evidence.version, whole.evidence.version);
  // The window's own counts: MIX's late two and TAG's four.
  assert.equal(clan.entries[0].activity.battles, 6);
});

test("a clan's timeline tells a member's late sitting at its played time", async () => {
  const clan = [{ kind: "clan", tag: CLAN, scope: "comprehensive" }];
  const mine = sittingOf(await read());
  // A read about one member serves their sittings as items (Gym #258).
  const about = { memberTag: TAG };
  for (const opts of [about, { ...about, basis: "observed" }]) {
    const built = await read(opts, clan);
    const s = built.timeline.find(
      (it) => it.kind === "battle_session" && it.facts.player_tag === TAG,
    );
    assert.ok(s, `${JSON.stringify(opts)}: ${JSON.stringify(built.timeline)}`);
    assert.equal(s.at, iso(SITTING));
    assert.equal(s.facts.battles, 4);
    assert.equal(s.id, mine.id, "the member's own story");
    assert.equal(s.evidence.version, mine.evidence.version);
    assert.equal(learnedLate(s), true);
    // The clan's counts hold every battle: TAG's four and MIX's three,
    // six of them learned late; nobody returned from a late batch.
    const [entry] = built.entries;
    assert.equal(entry.activity.battles, 7, JSON.stringify(entry.activity));
    assert.equal(entry.activity.late_captures, 6);
    assert.equal(entry.activity.sessions, 2);
    assert.equal(entry.presence.returned.items.length, 0);
  }
  // An observed window opened after the sitting's play: still told, late.
  const late = await read(
    { ...about, basis: "observed", fromMs: LEARNED - H },
    clan,
  );
  const s = late.timeline.find(
    (it) => it.kind === "battle_session" && it.facts.player_tag === TAG,
  );
  assert.ok(s, JSON.stringify(late.timeline));
  assert.equal(s.at, iso(SITTING));
  assert.equal(s.late, true);
  assert.equal(s.id, mine.id);
  assert.equal(late.entries[0].activity.learned_here_played_before, 4);
});

test("a batched read tells what each player's own read tells", async () => {
  const subjects = [TAG, FOE, MIX].map(player);
  for (const basis of ["occurred", "observed"]) {
    const opts = { basis };
    const sittings = (built) =>
      built.timeline
        .filter((it) => it.kind === "battle_session")
        .map((it) => [
          it.subject_tag,
          it.id,
          it.revision,
          it.evidence.version,
          it.late,
          learnedLate(it),
        ])
        .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`));
    const batched = await read(opts, subjects);
    const alone = await read({ ...opts, batchPlayers: false }, subjects);
    assert.deepEqual(sittings(batched), sittings(alone), basis);
    assert.ok(sittings(batched).length >= 3, basis);
    const late = (built) =>
      Object.fromEntries(
        built.entries.map((e) => [e.subject_tag, e.battles.late_captures]),
      );
    assert.deepEqual(late(batched), late(alone), basis);
    assert.equal(late(batched)[TAG], 4, basis);
  }
});
