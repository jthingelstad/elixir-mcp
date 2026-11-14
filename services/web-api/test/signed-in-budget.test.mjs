/**
 * What the player page, Stats, Find, the bell and the search sheet cost
 * the database (2026-11-13), over a synthetic record
 * (`signed-in-seed.mjs`): King Thing signed in, a clan among others,
 * months of battles and day rows, 55 follows. Every read
 * each page makes on load goes through the web API's own handler, one at
 * a time in page order, held to a statement count; every statement's
 * plan is held to never scanning a large table whole, never reading more
 * than a quarter of one, and the named index where a fix depends on it.
 * Counts, plan shapes and a shared-buffer ceiling, never milliseconds.
 *
 * The fixes these pin also have to answer exactly what the statements
 * they replaced answered: each is run again here in its old form against
 * the same record, and the rows must match.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seedSignedIn } from "./signed-in-seed.mjs";
import { makeHandler } from "../src/handler.mjs";
import { createClanRequest } from "../src/clan.mjs";
import { makeDatabase } from "@elixir-mcp/http/database";
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";
import {
  LARGE,
  captureStatements,
  plans,
  releaseStatements,
  request,
} from "./statement-budget.mjs";

/** Read by range like the large tables, though smaller. */
const BOUNDED = [...LARGE, "battle_participant_round"];

let seed, handler, database;
const sizes = {};
/** Every statement every request below made, for the results check. */
const ran = [];

before(async () => {
  seed = await seedSignedIn("signed_in_budget", { weeks: 26, clans: 8 });
  captureStatements();
  database = makeDatabase({ connectionString: seed.scratch.url });
  handler = makeHandler({
    database,
    secret: "test",
    clan: createClanRequest({ origin: "https://elixir.poapkings.com" }),
  });
  for (const t of BOUNDED)
    sizes[t] = (
      await seed.db.query(`select count(*)::int as n from ${t}`)
    ).rows[0].n;
});
after(async () => {
  releaseStatements();
  await database?.close();
  await seed?.scratch.drop();
});

const tool = (name, args) => ({
  method: "POST",
  body: { tool: name, args },
});

/**
 * One read: its status, its statement count against the budget, every
 * plan bounded, and the plans' shared buffers under the ceiling. Answers
 * the plans for the read's own checks.
 */
async function read(label, path, opts, { statements, buffers }) {
  const r = await request(handler, seed.cookie, path, opts);
  ran.push(...r.seen);
  assert.equal(r.status, 200, `${label}: ${JSON.stringify(r.body)}`);
  assert.ok(
    r.seen.length <= statements,
    `${label}: ${r.seen.length} statements, budget ${statements}`,
  );
  const planned = await plans(seed.db, r.seen);
  for (const p of planned)
    for (const s of p.scans) {
      if (!BOUNDED.includes(s.table)) continue;
      assert.notEqual(
        s.node,
        "Seq Scan",
        `${label}: a whole-table scan of ${s.table}: ${p.text}`,
      );
      assert.ok(
        s.read <= sizes[s.table] / 4,
        `${label}: ${s.read} of ${sizes[s.table]} ${s.table} rows read (${s.index}): ${p.text}`,
      );
    }
  const total = planned.reduce((a, p) => a + p.buffers, 0);
  assert.ok(
    total <= buffers,
    `${label}: ${total} shared buffers, ceiling ${buffers}`,
  );
  return { ...r, planned };
}

/** The scans of `table` in the statement whose text matches `re`. */
const scansOf = (planned, re, table) => {
  const p = planned.find((x) => re.test(x.full));
  assert.ok(p, `no statement matching ${re}`);
  return p.scans.filter((s) => s.table === table);
};

/**
 * The statements each read may make, and the shared buffers its plans
 * may touch on this record, as of this change: ceilings to come down,
 * never to rise without a reason in a pull request.
 */
const PLAYER_PAGE = {
  "/api/player": { statements: 29, buffers: 6000 },
  "/api/me/cheers": { statements: 26, buffers: 1500 },
  "/api/clan/me": { statements: 15, buffers: 300 },
  "/api/me/follow-plan": { statements: 9, buffers: 500 },
  "/api/me/follow-cost": { statements: 4, buffers: 250 },
  players_summary: { statements: 28, buffers: 3500 },
  players_profile: { statements: 12, buffers: 60 },
};

/** The player page on load, then its Record tab, as the page asks. */
async function playerPage(tag) {
  const out = {};
  out.player = await read(
    "/api/player",
    "/api/player",
    { query: { tag } },
    PLAYER_PAGE["/api/player"],
  );
  out.cheers = await read(
    "/api/me/cheers",
    "/api/me/cheers",
    { query: { player: tag } },
    PLAYER_PAGE["/api/me/cheers"],
  );
  out.clans = await read(
    "/api/clan/me",
    "/api/clan/me",
    {},
    PLAYER_PAGE["/api/clan/me"],
  );
  out.plan = await read(
    "/api/me/follow-plan",
    "/api/me/follow-plan",
    { query: { clan_tag: seed.clanTag } },
    PLAYER_PAGE["/api/me/follow-plan"],
  );
  out.cost = await read(
    "/api/me/follow-cost",
    "/api/me/follow-cost",
    {},
    PLAYER_PAGE["/api/me/follow-cost"],
  );
  out.summary = await read(
    "players_summary",
    "/api/explore",
    tool("players_summary", { player_tag: tag }),
    PLAYER_PAGE.players_summary,
  );
  out.profile = await read(
    "players_profile",
    "/api/explore",
    tool("players_profile", { player_tag: tag }),
    PLAYER_PAGE.players_profile,
  );
  return out;
}

test("your own player page stays in its budgets, and reads each highlight's row by key", async () => {
  const page = await playerPage(seed.leaderTag);
  // Each highlight's participant row by its primary key, never off the
  // player's whole history once per highlight.
  for (const s of scansOf(
    page.player.planned,
    /from battle_highlight h/,
    "battle_participant",
  ))
    assert.equal(s.index, "battle_participant_pkey", JSON.stringify(s));
  // Your players' names by key, never a walk along player_pkey.
  for (const s of scansOf(page.clans.planned, /from claim c/, "player"))
    assert.ok(s.read <= 100, `player rows read for your claims: ${s.read}`);
  // Asked again, warm: the same budgets.
  await playerPage(seed.leaderTag);
});

test("a clanmate's and a stranger's player pages stay in their budgets", async () => {
  const mate = seed.follows[0];
  const { rows } = await seed.db.query(
    `select player_tag from clan_membership
      where clan_tag <> $1 and left_observed_at is null
        and player_tag <> all($2::text[])
      order by player_tag limit 1`,
    [seed.clanTag, seed.follows],
  );
  await playerPage(mate);
  await playerPage(rows[0].player_tag);
});

/** Stats' reads, tab by tab, as the page asks them. */
const STATS = (t) => [
  ["players_summary", { player_tag: t }, 29, 3500],
  // The season list, from the first recorded battle: a long window, read
  // battle by battle, never by hashing the battle table.
  ["battles_performance", { player_tag: t, from: "LONG" }, 18, 14000],
  ["battles_performance", { player_tag: t, season: "current" }, 18, 1100],
  [
    "battles_performance",
    { player_tag: t, season: "current", mode: "ladder" },
    18,
    1000,
  ],
  ["elixir_coverage", { player_tag: t }, 16, 200],
  [
    "battles_query",
    { player_tag: t, season: "current", verbosity: "compact" },
    21,
    900,
  ],
  [
    "battles_performance",
    { player_tag: t, season: "current", mode: "ladder", group_by: "week" },
    18,
    500,
  ],
  [
    "battles_decks",
    { player_tag: t, season: "current", mode: "ladder" },
    22,
    800,
  ],
  [
    "battles_decks",
    { player_tag: t, season: "previous", mode: "ladder" },
    22,
    1800,
  ],
  [
    "battles_cards",
    { player_tag: t, season: "current", mode: "ladder", perspective: "mine" },
    15,
    1300,
  ],
  [
    "battles_cards",
    {
      player_tag: t,
      season: "current",
      mode: "ladder",
      perspective: "opponent",
    },
    15,
    1500,
  ],
  [
    "battles_cards",
    { player_tag: t, season: "current", mode: "war", perspective: "mine" },
    15,
    1300,
  ],
  [
    "battles_opponents",
    { player_tag: t, season: "current", mode: "ladder" },
    15,
    1300,
  ],
  ["war_current", { clan_tag: "#J2RGCRVG", verbosity: "compact" }, 19, 650],
  ["war_history", { clan_tag: "#J2RGCRVG", player_tag: t, seasons: 4 }, 18, 80],
];

test("Stats' reads stay in their budgets and read the record by range", async () => {
  const long = new Date(Date.now() - 400 * 86_400_000).toISOString();
  for (const [name, args, statements, buffers] of STATS(seed.leaderTag)) {
    const a = args.from === "LONG" ? { ...args, from: long } : args;
    const label = `${name} ${JSON.stringify(a)}`;
    const r = await read(label, "/api/me/stats", tool(name, a), {
      statements,
      buffers,
    });
    if (args.from === "LONG")
      for (const s of scansOf(
        r.planned,
        /with sample as materialized/,
        "battle",
      ))
        assert.ok(
          ["battle_pkey", "battle_timeline_cover"].includes(s.index),
          `${label}: battle read by ${s.index}`,
        );
    if (name === "elixir_coverage")
      assert.deepEqual(
        scansOf(r.planned, /as appearances/, "battle"),
        [],
        "coverage's count never touches battle",
      );
  }
});

/**
 * Find, the bell and the search sheet (2026-11-13), as each asks on
 * load: Home's needs and the bell first (the shell's), then Find's tabs
 * (Suggested, From your battles, Your clan with its follow plan), the
 * slots and the clans, and the search sheet's reads (a player's tag, a
 * clan's tag, a name).
 */
const FIND = {
  "/api/me/home/needs": { statements: 12, buffers: 300 },
  "/api/me/follow-slots": { statements: 6, buffers: 700 },
  "/api/me/people/suggested": { statements: 10, buffers: 600 },
  "/api/me/people/battles": { statements: 8, buffers: 1300 },
  "/api/me/people/clan": { statements: 11, buffers: 700 },
  "/api/me/follow-plan": { statements: 9, buffers: 500 },
  "/api/me/clans": { statements: 6, buffers: 300 },
  "/api/me/home/clan": { statements: 9, buffers: 300 },
};

test("the bell stays in its budgets, built and stored, and never counts late captures", async () => {
  // Built: the first read of the week (no stored row).
  await seed.db.query("delete from bell_week");
  const built = await read(
    "/api/me/bell (built)",
    "/api/me/bell",
    {},
    {
      statements: 34,
      buffers: 1100,
    },
  );
  // The late count read every battle the record learned in the week,
  // anyone's; the bell serves items, never an entry's late_captures.
  assert.ok(
    !built.seen.some((s) =>
      /b\.battle_time < b\.created_at - interval '1 day'/.test(s.text),
    ),
    "the bell read the late-capture count",
  );
  // Stored: every read after it in the next three hours.
  await read(
    "/api/me/bell (stored)",
    "/api/me/bell",
    {},
    {
      statements: 13,
      buffers: 400,
    },
  );
});

test("Find's tabs stay in their budgets and read each battle's other side by key", async () => {
  const r = {};
  for (const [key, opts] of [
    ["/api/me/home/needs", {}],
    ["/api/me/people/suggested", {}],
    ["/api/me/people/battles", {}],
    ["/api/me/people/clan", {}],
    ["/api/me/follow-plan", { query: { clan_tag: seed.clanTag } }],
    ["/api/me/follow-slots", {}],
    ["/api/me/clans", {}],
    ["/api/me/home/clan", {}],
  ])
    r[key] = await read(key, key, opts, FIND[key]);
  for (const key of ["/api/me/people/suggested", "/api/me/people/battles"])
    for (const s of scansOf(
      r[key].planned,
      /cross join lateral \(\s*select o\.player_tag, o\.side, o\.clan_tag/,
      "battle_participant",
    ))
      assert.ok(
        [
          "battle_participant_pkey",
          "battle_participant_player_time_cover",
        ].includes(s.index),
        `${key}: battle_participant read by ${s.index}`,
      );
});

test("the search sheet's reads stay in their budgets", async () => {
  const stranger = (
    await seed.db.query(
      `select player_tag from clan_membership
        where clan_tag <> $1 and left_observed_at is null
        order by player_tag limit 1`,
      [seed.clanTag],
    )
  ).rows[0].player_tag;
  // A player's tag: the summary answers it.
  await read(
    "search: players_summary",
    "/api/explore",
    tool("players_summary", { player_tag: stranger }),
    { statements: 28, buffers: 1300 },
  );
  // A clan's tag: no player, so the roster.
  await read(
    "search: clans_roster",
    "/api/explore",
    tool("clans_roster", { clan_tag: seed.clanTag }),
    { statements: 14, buffers: 1400 },
  );
  // A name, few matches and nearly every player matching: the clan and
  // trophies are read for the rows shown only. The name itself is a
  // substring, so `player` is read whole by name (a trigram index is the
  // lead's call, after sizing the table in production).
  for (const query of ["King", "Invented"]) {
    const r = await request(
      handler,
      seed.cookie,
      "/api/explore",
      tool("players_search", { query, limit: 8 }),
    );
    ran.push(...r.seen);
    assert.equal(r.status, 200);
    assert.ok(r.seen.length <= 6, `players_search: ${r.seen.length}`);
    const planned = await plans(seed.db, r.seen);
    const p = planned.find((x) => /with mine as materialized/.test(x.full));
    assert.ok(p, "players_search ran");
    assert.ok(p.buffers <= 400, `players_search ${query}: ${p.buffers}`);
    for (const s of p.scans)
      if (s.table === "player_snapshot_daily" || s.table === "clan_membership")
        assert.ok(s.loops <= 8, `${s.table} probed ${s.loops} times`);
  }
});

/** players_search as it was before 2026-11-13: every match probed. */
const OLD_SEARCH = `with hits as (
   select p.player_tag, p.name, nn.nickname,
          case
            when nn.nickname ilike $2 then 'nickname'
            when exists (select 1 from claim c
                         where c.account_id = $1 and c.player_tag = p.player_tag)
              then 'claim'
            when exists (select 1 from claim c
                         join clan_membership cm on cm.player_tag = c.player_tag
                           and cm.left_observed_at is null
                         join clan_membership cm2 on cm2.clan_tag = cm.clan_tag
                           and cm2.left_observed_at is null
                         where c.account_id = $1 and cm2.player_tag = p.player_tag)
              or exists (select 1 from account_clan ac
                         join clan_membership cm3 on cm3.clan_tag = ac.clan_tag
                           and cm3.left_observed_at is null
                         where ac.account_id = $1 and cm3.player_tag = p.player_tag)
              then 'clanmate'
            else 'corpus'
          end as source
   from player p
   left join player_nickname nn on nn.account_id = $1
     and nn.player_tag = p.player_tag
   where p.name ilike $2 or nn.nickname ilike $2)
 select h.player_tag, h.name, h.nickname, h.source,
        cl.clan_tag, cl.name as clan_name, tr.trophies,
        count(*) over ()::int as total_matches
 from hits h
 left join lateral (
   select cm.clan_tag, c.name from clan_membership cm
   left join clan c on c.clan_tag = cm.clan_tag
   where cm.player_tag = h.player_tag and cm.left_observed_at is null
   limit 1) cl on true
 left join lateral (
   select s.trophies from player_snapshot_daily s
   where s.player_tag = h.player_tag
   order by s.snapshot_date desc, s.snapshot_kind desc
   limit 1) tr on true
 order by case h.source when 'nickname' then -1 when 'claim' then 0 when 'clanmate' then 1 else 2 end,
          (lower(h.name) = lower($4)) desc,
          h.name
 limit $3`;

test("players_search answers what it answered before", async () => {
  // A nickname of the reader's, so every source is in the record.
  const nicked = seed.follows[1];
  await seed.db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, $2, 'Kingfisher') on conflict do nothing`,
    [seed.accountId, nicked],
  );
  const now = ran.find((s) => /with mine as materialized/.test(s.text));
  assert.ok(now, "players_search ran above");
  const key = (r) => [
    r.source === "nickname" ? -1 : ({ claim: 0, clanmate: 1 }[r.source] ?? 2),
    r.name,
  ];
  for (const q of ["King", "Invented", "Kingfisher", "zzz"]) {
    const args = (limit) => [seed.accountId, `%${q}%`, limit, q];
    // Every match: the same rows, as sets.
    const [all, allOld] = [
      (await seed.db.query(now.text, args(100_000))).rows,
      (await seed.db.query(OLD_SEARCH, args(100_000))).rows,
    ];
    const set = (rows) => rows.map((x) => JSON.stringify(x)).sort();
    assert.deepEqual(set(all), set(allOld), `${q}: every match`);
    // The first eight: the same order, row for row where the old order
    // was settled, and the same ranks where it tied.
    const [top, topOld] = [
      (await seed.db.query(now.text, args(8))).rows,
      (await seed.db.query(OLD_SEARCH, args(8))).rows,
    ];
    assert.deepEqual(top.map(key), topOld.map(key), `${q}: the ranking`);
    assert.deepEqual(top, all.slice(0, 8), `${q}: a prefix of every match`);
    if (q === "Kingfisher") assert.equal(top[0]?.source, "nickname");
  }
  await seed.db.query(
    "delete from player_nickname where account_id = $1 and player_tag = $2",
    [seed.accountId, nicked],
  );
});

test("the bell's and cheers' items are the ones a build with late counts makes", async () => {
  const now = Date.now();
  const subjects = [
    { kind: "player", tag: seed.leaderTag, relationship: "primary" },
    ...seed.follows
      .slice(0, 6)
      .map((tag) => ({ kind: "player", tag, relationship: "friend" })),
  ];
  for (const subs of [subjects.slice(0, 1), subjects]) {
    const build = (lateCounts) =>
      buildTimeline(seed.db, subs, {
        fromMs: now - 7 * 86_400_000,
        toMs: now,
        accountId: seed.accountId,
        interactive: true,
        accountLines: false,
        lateCounts,
      });
    const [full, lean] = [await build(true), await build(false)];
    assert.ok(full.timeline.length > 0, "the week has items");
    assert.deepEqual(lean.timeline, full.timeline);
    // The entries differ only in the count left out.
    for (const [i, e] of full.entries.entries()) {
      const l = lean.entries[i];
      if (e.battles) {
        assert.equal(l.battles.late_captures, null);
        assert.deepEqual(
          { ...l, battles: { ...l.battles, late_captures: 0 } },
          { ...e, battles: { ...e.battles, late_captures: 0 } },
        );
      }
    }
  }
});

/**
 * Each fix against the statement it replaced: the old form, rebuilt from
 * the new statement as it ran, must answer the same rows.
 */
const OLD = [
  {
    name: "a highlight's own row (highlightItems)",
    re: /cross join lateral \(\s*select bp\.side, bp\.crowns, bp\.outcome, bp\.trophy_change, bp\.deck_hash\s+from battle_participant bp\s+where bp\.battle_id = h\.battle_id and bp\.player_tag = h\.player_tag\s+limit 1\) me/,
    old: "join battle_participant me on me.battle_id = h.battle_id and me.player_tag = h.player_tag",
  },
  {
    name: "your players' names (myPlayers)",
    re: /cross join lateral \(\s*select p\.name, p\.last_known_clan_tag from player p\s+where p\.player_tag = c\.player_tag limit 1\) p/,
    old: "join player p on p.player_tag = c.player_tag",
  },
  {
    name: "the race's names (war_current)",
    re: /cross join lateral \(\s*select p\.name from player p where p\.player_tag = wp\.player_tag limit 1\) p/,
    old: "join player p on p.player_tag = wp.player_tag",
  },
  {
    name: "a window's battles (battles_performance)",
    re: /cross join lateral \(\s*select b\.type_class, b\.type, b\.event_tag from battle b\s+where b\.battle_id = bp\.battle_id limit 1\) b/,
    old: "join battle b on b.battle_id = bp.battle_id",
  },
  {
    name: "a window's games (battles_cards)",
    re: /cross join lateral \(\s*select b\.type, b\.event_tag from battle b\s+where b\.battle_id = bp\.battle_id limit 1\) b/,
    old: "join battle b on b.battle_id = bp.battle_id",
  },
  {
    name: "a deck the player chose (players_summary)",
    re: /coalesce\(\(select \(cb\.deck_selection is null\s+or cb\.deck_selection in \('collection', 'warDeckPick'\)\)\s+-- Nor a boat defense \(Gym #262\.1\)\.\s+and not \(cb\.boat_battle_side is not null\s+and \(cb\.boat_battle_side = 'defender'\) = \(bp\.side = 0\)\)\s+from battle cb where cb\.battle_id = bp\.battle_id\), false\)/,
    old: "exists (select 1 from battle cb where cb.battle_id = bp.battle_id and (cb.deck_selection is null or cb.deck_selection in ('collection', 'warDeckPick')) and not (cb.boat_battle_side is not null and (cb.boat_battle_side = 'defender') = (bp.side = 0)))",
  },
  {
    name: "a duel by its round rows (duelSql)",
    re: /\(select true from battle_participant_round duel_r\s+where duel_r\.battle_id = ([\w.]+) limit 1\) is not null/,
    old: "exists (select 1 from battle_participant_round duel_r where duel_r.battle_id = $1)",
  },
  {
    name: "a boat defense by key (battles_* windows)",
    re: /not \(bp\.type = 'boatBattle' and coalesce\(\(\s*select bd\.boat_battle_side is not null\s+and \(bd\.boat_battle_side = 'defender'\) = \(bp\.side = 0\)\s+from battle bd where bd\.battle_id = bp\.battle_id\s+\), false\)\)/,
    old: "not (bp.type = 'boatBattle' and exists (select 1 from battle bd where bd.battle_id = bp.battle_id and bd.boat_battle_side is not null and (bd.boat_battle_side = 'defender') = (bp.side = 0)))",
  },
  {
    name: "a player's appearances (elixir_coverage)",
    re: /min\(bp\.battle_time\) as first_seen, max\(bp\.battle_time\) as last_seen\s+from battle_participant bp\s+where/,
    old: "min(b.battle_time) as first_seen, max(b.battle_time) as last_seen from battle_participant bp join battle b on b.battle_id = bp.battle_id where",
  },
  {
    name: "the ladder's floor and last arena (controls)",
    re: /^\s*with l as \(\s*select count\(\*\)::int as ladder_battles,[\s\S]*?from battle_participant bp\s+where ([\s\S]*?)\)\s+select l\.ladder_battles[\s\S]*$/,
    old: `select count(*)::int as ladder_battles,
            count(*) filter (where bp.outcome = 'loss' and bp.trophy_change is null)::int as on_floor_losses,
            min(bp.starting_trophies) filter (where bp.outcome = 'loss' and bp.trophy_change is null) as floor_from_losses,
            min(bp.starting_trophies + coalesce(bp.trophy_change, 0)) as lowest,
            max(bp.starting_trophies + coalesce(bp.trophy_change, 0)) as highest,
            (array_agg(b.arena order by bp.battle_time desc))[1] as last_arena,
            (array_agg(b.arena_id order by bp.battle_time desc))[1] as last_arena_id
     from battle_participant bp join battle b on b.battle_id = bp.battle_id
     where $1`,
  },
];

test("every fix answers what the statement it replaced answered", async () => {
  // Run last: `ran` holds every statement the reads above made.
  assert.ok(ran.length > 0, "the budget tests ran first");
  for (const o of OLD) {
    let compared = 0;
    for (const s of ran) {
      if (!o.re.test(s.text)) continue;
      const old = s.text.replace(o.re, (...m) =>
        o.old.replace("$1", () => m[1]),
      );
      assert.notEqual(old, s.text, o.name);
      const [now, then] = [
        await seed.db.query(s.text, s.values),
        await seed.db.query(old, s.values),
      ];
      // As sets of rows: rows tied on a statement's order may come back
      // in either order from either plan.
      const rows = (r) => r.rows.map((x) => JSON.stringify(x)).sort();
      assert.deepEqual(
        rows(now),
        rows(then),
        `${o.name}: ${s.text.slice(0, 200)}`,
      );
      compared += 1;
    }
    assert.ok(compared > 0, `${o.name}: no statement ran to compare`);
  }
});
