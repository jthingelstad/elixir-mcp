/**
 * The timeline as published content (11.8.0, feedback #373-#376). The
 * reproduction was a default 24-hour read on a Saturday morning: Friday's
 * games in Saturday's window, one sitting served twice under one id (once
 * with the reader's nickname), a trophy rung beside a net that never
 * reached it, a war line about a day after the race had finished, and six
 * revocations as six items. Synthetic tags and names throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  buildTimeline,
  subjectsFor,
  warDeckTallyOpen,
} from "../src/activity/entries.mjs";
import {
  TIMELINE_KIND_SCHEMAS,
  missingFacts,
} from "../src/activity/schemas.mjs";
import { elixir_timeline } from "../src/tools/elixir/timeline.mjs";

const PILOT = "#2PYLQ0";
const CLAN = "#2PYLQJ";
const TZ = "America/Chicago";
// Saturday 2026-10-10 in Chicago (CDT, UTC-5).
const SAT_FROM = Date.parse("2026-10-10T05:00:00Z");
const SAT_TO = Date.parse("2026-10-11T05:00:00Z");
const FRIDAY_PLAY = Date.parse("2026-10-09T20:00:00Z"); // Fri 15:00 CDT
const SATURDAY_PLAY = Date.parse("2026-10-10T14:00:00Z"); // Sat 09:00 CDT
const iso = (ms) => new Date(ms).toISOString();
let scratch,
  db,
  owner,
  n = 0;

async function battle(at, createdAt, outcome, trophyChange) {
  n += 1;
  const id = n.toString(16).padStart(64, "0");
  await db.query(
    "insert into battle (battle_id,battle_time,type,type_class,created_at) values ($1,$2,'PvP','pvp',$3)",
    [id, iso(at), iso(createdAt)],
  );
  await db.query(
    "insert into battle_participant (battle_id,player_tag,battle_time,side,type,type_class,outcome,trophy_change,clan_tag) values ($1,$2,$3,0,'PvP','pvp',$4,$5,$6)",
    [id, PILOT, iso(at), outcome, trophyChange, CLAN],
  );
}

before(async () => {
  scratch = await scratchDb("timeline_publication");
  db = scratch.db;
  await db.query(
    "insert into player (player_tag,name) values ($1,'Example Pilot')",
    [PILOT],
  );
  await db.query(
    "insert into clan (clan_tag,name) values ($1,'Example Clan')",
    [CLAN],
  );
  owner = (
    await db.query(
      `insert into account (email_hash,status,timezone)
       values ('publication-owner','approved',$1) returning account_id`,
      [TZ],
    )
  ).rows[0].account_id;
  // The reader follows the pilot (with a private nickname) and the clan
  // the pilot plays in: one sitting is news on both timelines.
  await db.query(
    "insert into claim (account_id,player_tag,status,notify) values ($1,$2,'unverified',true)",
    [owner, PILOT],
  );
  await db.query(
    "insert into player_nickname (account_id,player_tag,nickname) values ($1,$2,'Pal')",
    [owner, PILOT],
  );
  await db.query(
    "insert into account_clan (account_id,clan_tag,scope,notify) values ($1,$2,'comprehensive',true)",
    [owner, CLAN],
  );
  await db.query(
    "insert into clan_membership (clan_tag,player_tag,role,joined_observed_at) values ($1,$2,'member','2026-09-01T00:00:00Z')",
    [CLAN, PILOT],
  );
  // Friday afternoon's three games, learned Saturday morning.
  for (let i = 0; i < 3; i++)
    await battle(
      FRIDAY_PLAY + i * 3 * 60_000,
      Date.parse("2026-10-10T16:00:00Z"),
      "win",
      30,
    );
  // Saturday's sitting: six wins (+180, the 150 rung crossed on the
  // fifth), then two losses: the net ends at +120.
  const outcomes = ["win", "win", "win", "win", "win", "win", "loss", "loss"];
  for (const [i, o] of outcomes.entries())
    await battle(
      SATURDAY_PLAY + i * 3 * 60_000,
      SATURDAY_PLAY + 40 * 60_000,
      o,
      o === "win" ? 30 : -30,
    );
  // Six revocations in half a minute, one app (the account burst).
  await db.query(
    `insert into oauth_client (client_id,client_name,redirect_uris,expires_at)
     values ('example-app','Example App','{}','2027-01-01T00:00:00Z')`,
  );
  for (let i = 0; i < 6; i++) {
    const {
      rows: [f],
    } = await db.query(
      `insert into oauth_family (client_id,account_id,absolute_expires_at)
       values ('example-app',$1,'2027-01-01T00:00:00Z') returning family_id`,
      [owner],
    );
    await db.query(
      "insert into account_event (account_id,kind,detail,created_at) values ($1,'connection_revoked',$2,$3)",
      [
        owner,
        JSON.stringify({ family_id: f.family_id }),
        iso(Date.parse("2026-10-10T12:00:00Z") + i * 5_000),
      ],
    );
  }
});
after(async () => scratch.drop());

const saturday = async (basis) =>
  buildTimeline(db, await subjectsFor(db, owner), {
    fromMs: SAT_FROM,
    toMs: SAT_TO,
    accountId: owner,
    timezone: TZ,
    interactive: true,
    basis,
  });
const sittings = (items) =>
  items.filter((it) =>
    ["battle_session", "session_standout"].includes(it.kind),
  );

test("Friday's games stay out of Saturday's window; a poller sees them late, dated Friday (#373)", async () => {
  const happened = await saturday("occurred");
  const sat = sittings(happened.timeline);
  assert.equal(sat.length, 1, JSON.stringify(sat.map((s) => s.at)));
  assert.equal(sat[0].facts.started_at, iso(SATURDAY_PLAY));
  assert.ok(happened.timeline.every((it) => Date.parse(it.sort_at) > SAT_FROM));
  assert.ok(happened.timeline.every((it) => it.late === false));

  const learned = await saturday("observed");
  const friday = sittings(learned.timeline).find(
    (s) => s.at === iso(FRIDAY_PLAY),
  );
  assert.ok(friday, "learned Saturday, so in a poller's Saturday window");
  assert.equal(friday.late, true);
  assert.deepEqual(friday.local, {
    date: "2026-10-09",
    time: "15:00",
    weekday: "Fri",
    tz: TZ,
  });
  assert.equal(friday.at_unix, FRIDAY_PLAY / 1000);
  // The sentence never carries a time: the reader's clock is the
  // renderer's (Discord's <t:at_unix:f>, the console's local fields).
  for (const it of learned.timeline) {
    assert.doesNotMatch(it.text, /\b\d{1,2}:\d{2}\b/, it.text);
    assert.doesNotMatch(it.text, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /, it.text);
  }
});

test("one story is one item: the followed member's sitting, named in game, about both subjects (#374)", async () => {
  const { timeline } = await saturday("occurred");
  const ids = timeline.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length, "no id served twice");
  const [sitting] = sittings(timeline);
  assert.equal(sitting.kind, "session_standout", "the richer telling");
  assert.equal(sitting.subject_tag, PILOT);
  assert.equal(sitting.subject_name, "Example Pilot");
  assert.equal(sitting.nickname, "Pal", "the reader's nickname, a field");
  assert.doesNotMatch(sitting.text, /Pal\b/, "never in the sentence");
  assert.match(sitting.text, /^Example Pilot /);
  assert.deepEqual(
    sitting.subjects.map((s) => [s.kind, s.tag]),
    [
      ["player", PILOT],
      ["clan", CLAN],
    ],
  );
  assert.equal(sitting.facts.player_tag, PILOT);
  assert.equal(sitting.publishable, true);
  assert.equal(sitting.visibility, "public");
});

test("a rung names the value that crossed it; the net and the peak are both told (#375)", async () => {
  const [sitting] = sittings((await saturday("occurred")).timeline);
  // Both rungs fell on the fifth win; each names its own value there.
  const fifth = iso(SATURDAY_PLAY + 4 * 3 * 60_000);
  assert.deepEqual(sitting.facts.newly, ["won_in_a_row>=5", "trophy_net>=150"]);
  assert.deepEqual(sitting.facts.crossings, [
    {
      rung: "won_in_a_row>=5",
      key: "won_in_a_row",
      threshold: 5,
      value: 5,
      at: fifth,
    },
    {
      rung: "trophy_net>=150",
      key: "trophy_net",
      threshold: 150,
      value: 150,
      at: fifth,
    },
  ]);
  assert.equal(sitting.facts.trophy_net, 120);
  assert.equal(sitting.facts.trophy_net_peak, 180);
  assert.match(sitting.text, /\+120 trophies, peak \+180/);
  // The sitting's evidence is the sitting the item counts.
  assert.equal(sitting.evidence.count, sitting.facts.battles);
  assert.equal(sitting.facts.battles, 8);
  assert.equal(sitting.sort_at, iso(SATURDAY_PLAY + 7 * 3 * 60_000));
});

test("a burst of account administration is one item, names its app, and never publishes", async () => {
  const { timeline } = await saturday("occurred");
  const account = timeline.filter((it) => it.section === "account");
  assert.equal(account.length, 1, JSON.stringify(account));
  const [burst] = account;
  assert.equal(burst.kind, "account_connection_revoked");
  assert.equal(burst.facts.count, 6);
  assert.deepEqual(burst.facts.apps, ["Example App"]);
  assert.equal(burst.visibility, "owner");
  assert.equal(burst.publishable, false);
  assert.deepEqual(burst.subjects, []);
  assert.match(burst.text, /6 at once/);
  assert.match(burst.text, /Example App/);
});

test("the war line tallies decks only on the day in progress, and not after the race finished (#376)", () => {
  // War day 4 of a week: Sunday 10:00Z to Monday 10:00Z.
  const period = {
    startMs: Date.parse("2026-10-11T10:00:00Z"),
    endMs: Date.parse("2026-10-12T10:00:00Z"),
  };
  const nowMs = Date.parse("2026-10-11T10:30:00Z");
  const open = { period, sameWeek: true, toMs: nowMs, nowMs };
  assert.equal(warDeckTallyOpen({ ...open, finishedAt: null }), true);
  // The reproduction: the race finished at 09:48Z, before the day began.
  assert.equal(
    warDeckTallyOpen({ ...open, finishedAt: "2026-10-11T09:48:00Z" }),
    false,
  );
  // A finish after the window's end is not yet the window's news.
  assert.equal(
    warDeckTallyOpen({
      ...open,
      toMs: Date.parse("2026-10-11T10:15:00Z"),
      finishedAt: "2026-10-11T10:20:00Z",
    }),
    true,
  );
  // A day that is not in progress, or another week, never tallies.
  assert.equal(
    warDeckTallyOpen({
      ...open,
      nowMs: Date.parse("2026-10-12T10:30:00Z"),
      finishedAt: null,
    }),
    false,
  );
  assert.equal(
    warDeckTallyOpen({ ...open, sameWeek: false, finishedAt: null }),
    false,
  );
});

test("every item carries its kind's facts and schema, and the docs list every kind at its version", async () => {
  const items = [
    ...(await saturday("observed")).timeline,
    ...(await saturday("occurred")).timeline,
  ];
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.deepEqual(
      missingFacts(it),
      [],
      `${it.kind}: ${JSON.stringify(it.facts)}`,
    );
    const kind = it.kind.startsWith("account_") ? "account" : it.kind;
    assert.equal(
      it.schema,
      `${it.kind}/${TIMELINE_KIND_SCHEMAS[kind].version}`,
    );
    for (const k of [
      "sort_at",
      "at_unix",
      "local",
      "late",
      "visibility",
      "publishable",
      "subjects",
    ])
      assert.ok(Object.hasOwn(it, k), `${it.kind} lacks ${k}`);
  }
  const docs = await readFile(
    new URL("../../../apps/site/src/docs/timeline.md", import.meta.url),
    "utf8",
  );
  for (const [kind, s] of Object.entries(TIMELINE_KIND_SCHEMAS))
    assert.match(
      docs,
      new RegExp(`\\| \`${kind}\` \\| ${s.version} \\|`),
      `the docs' facts table lists ${kind} at version ${s.version}`,
    );
});

test("basis: an ad hoc window reads what happened and keeps the pointer; a poller reads what was learned; occurred never marks", async () => {
  const ctx = { db, account: { accountId: owner, timezone: TZ } };
  const adHoc = await elixir_timeline.handler(ctx, {
    from: iso(SAT_FROM),
    to: iso(SAT_TO),
  });
  assert.equal(adHoc.applied.basis, "occurred");
  assert.equal(adHoc.applied.mark_read, false);
  const { rows } = await db.query(
    "select activity_seen_at from account where account_id = $1",
    [owner],
  );
  assert.equal(rows[0].activity_seen_at, null, "the pointer did not move");

  const poller = await elixir_timeline.handler(ctx, {
    reader: "example-bot",
    from: iso(SAT_FROM),
    to: iso(SAT_TO),
    mark_read: false,
  });
  assert.equal(poller.applied.basis, "observed");
  assert.ok(poller.timeline.some((it) => it.late));

  await assert.rejects(
    () =>
      elixir_timeline.handler(ctx, {
        from: iso(SAT_FROM),
        basis: "occurred",
        mark_read: true,
      }),
    /never moves a read pointer/,
  );
});

test("a member read whose window cuts a standout sitting says it recurs under the same id (Gym #321, 11.8.0)", async () => {
  const ctx = { db, account: { accountId: owner, timezone: TZ } };
  const out = await elixir_timeline.handler(ctx, {
    player_tag: PILOT,
    // Learned at 14:40Z, begun at 14:00Z; Friday's games were learned at
    // 16:00Z, outside this window, so the standout is the only sitting.
    from: iso(SATURDAY_PLAY + 5 * 60_000),
    to: iso(SATURDAY_PLAY + 60 * 60_000),
    mark_read: false,
    basis: "observed",
  });
  assert.deepEqual(
    sittings(out.timeline).map((it) => it.kind),
    ["session_standout"],
    "the member's sitting is served as its standout, alone",
  );
  assert.ok(
    out.notes.some((n) => /same id with a higher revision/.test(n)),
    "a standout begun before from is a cut sitting too",
  );
});

test("an occurred window that starts mid-sitting serves the whole sitting (Codex on #472)", async () => {
  // The player's own timeline only: the clan's standout is built from a
  // day-wide fetch already and would mask the player path.
  const playerOnly = (await subjectsFor(db, owner)).filter(
    (x) => x.kind === "player",
  );
  const out = await buildTimeline(db, playerOnly, {
    fromMs: SATURDAY_PLAY + 10 * 60_000,
    toMs: SAT_TO,
    accountId: owner,
    timezone: TZ,
    interactive: true,
    basis: "occurred",
  });
  const [sitting] = sittings(out.timeline);
  assert.ok(sitting, "the sitting ended in the window");
  assert.equal(
    sitting.facts.battles,
    8,
    "every battle of the sitting, not the window's slice",
  );
  assert.equal(sitting.facts.started_at, iso(SATURDAY_PLAY));
});

test("an evidence read with no basis finds a poller's late item (Codex on #472)", async () => {
  const ctx = { db, account: { accountId: owner, timezone: TZ } };
  const window = { from: iso(SAT_FROM), to: iso(SAT_TO) };
  const polled = await elixir_timeline.handler(ctx, {
    ...window,
    reader: "example-bot",
    mark_read: false,
  });
  const late = polled.timeline.find(
    (it) => it.late && it.kind === "battle_session",
  );
  assert.ok(late, "Friday's sitting reached the poller late");
  const read = await elixir_timeline.handler(ctx, {
    ...window,
    evidence_item_id: late.id,
  });
  assert.equal(read.timeline[0].id, late.id);
  assert.equal(read.applied.basis, "observed");
  assert.equal(read.evidence.count, late.facts.battles);
});

test("a full read's items say where they lead, and a sitting's own address reads it back (11.9.0)", async () => {
  const ctx = { db, account: { accountId: owner, timezone: TZ } };
  const window = { from: iso(SAT_FROM), to: iso(SAT_TO), basis: "occurred" };
  const read = await elixir_timeline.handler(ctx, window);
  assert.ok(read.timeline.every((it) => Array.isArray(it.follow)));
  const [sitting] = sittings(read.timeline);
  const tools = sitting.follow.map((x) => x.tool);
  assert.deepEqual(tools, ["elixir_timeline", "battles_performance"]);
  const back = await elixir_timeline.handler(ctx, sitting.follow[0].args);
  assert.equal(back.timeline[0].id, sitting.id);
  assert.equal(back.evidence.count, sitting.facts.battles);
  const compact = await elixir_timeline.handler(ctx, {
    ...window,
    verbosity: "compact",
  });
  assert.ok(compact.timeline.every((it) => !("follow" in it)));
});
