/**
 * How a standout sitting went, and who carried a war week (2026-10-11,
 * "moments carry the story"). Two clanmates' 2v2 sitting is two true
 * sittings, never thinned: each names the other as `teammate` and says
 * "with ... in 2v2", so a narrator can tell the pair once (feedback
 * #370: two identical 8W-1L lines). `best_win` is the win over the
 * opponent who started it with the most trophies; a rung's crossing
 * names its battle. A resolved week's text names its top three by
 * points, with decks. Synthetic tags and names throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { buildTimeline, subjectsFor } from "../src/activity/entries.mjs";
import { itemText } from "../src/activity/summary.mjs";
import { followFor } from "../src/activity/follow.mjs";

const CLAN = "#2PYLQJ";
const ANN = "#2PYLQ0";
const BEA = "#2PYLQ2";
const CAL = "#2PYLQ8";
const FOES = ["#2PYLQV", "#2PYLQY", "#2PYLQU", "#2PYLQG"];
const FROM = Date.parse("2026-10-10T05:00:00Z");
const TO = Date.parse("2026-10-11T05:00:00Z");
const PLAY = Date.parse("2026-10-10T14:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
let scratch,
  db,
  owner,
  n = 0;
const id = (k) => k.toString(16).padStart(64, "0");

/** One battle: `team` on side 0 (all with `outcome`), `foes` on side 1. */
async function battle(at, type, team, foes, { outcome, crowns, against }) {
  n += 1;
  await db.query(
    "insert into battle (battle_id,battle_time,type,type_class,created_at) values ($1,$2,$3,'pvp',$4)",
    [id(n), iso(at), type, iso(at + 60_000)],
  );
  const lost = outcome === "win" ? "loss" : "win";
  for (const [tag, side, result, c, trophies] of [
    ...team.map((t) => [t.tag, 0, outcome, crowns, t.trophies]),
    ...foes.map((f) => [f.tag, 1, lost, against, f.trophies]),
  ])
    await db.query(
      `insert into battle_participant
         (battle_id,player_tag,battle_time,side,type,type_class,outcome,crowns,
          trophy_change,starting_trophies,clan_tag)
       values ($1,$2,$3,$4,$5,'pvp',$6,$7,$8,$9,$10)`,
      [
        id(n),
        tag,
        iso(at),
        side,
        type,
        result,
        c,
        type === "PvP" ? (result === "win" ? 30 : -30) : null,
        trophies ?? null,
        side === 0 ? CLAN : null,
      ],
    );
  return id(n);
}

let annBest, calBest;
before(async () => {
  scratch = await scratchDb("timeline_standout_story");
  db = scratch.db;
  for (const [tag, name] of [
    [ANN, "Ann"],
    [BEA, "Bea"],
    [CAL, "Cal"],
    [FOES[0], "Foe One"],
    [FOES[1], "Foe Two"],
    [FOES[2], "Foe Three"],
    [FOES[3], "Foe Four"],
  ])
    await db.query("insert into player (player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  await db.query(
    "insert into clan (clan_tag,name) values ($1,'Example Clan')",
    [CLAN],
  );
  for (const tag of [ANN, BEA, CAL])
    await db.query(
      "insert into clan_membership (clan_tag,player_tag,role,joined_observed_at) values ($1,$2,'member','2026-09-01T00:00:00Z')",
      [CLAN, tag],
    );
  owner = (
    await db.query(
      `insert into account (email_hash,status,timezone)
       values ('standout-owner','approved','UTC') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    "insert into account_clan (account_id,clan_tag,scope,notify) values ($1,$2,'comprehensive',true)",
    [owner, CLAN],
  );
  // Ann and Bea: one 2v2 sitting together, five wins in a row. The
  // third win is over the pair with the most trophies.
  const pair = [
    { tag: ANN, trophies: 7000 },
    { tag: BEA, trophies: 6900 },
  ];
  const foeTrophies = [6000, 6100, 7400, 6200, 6300];
  for (const [i, t] of foeTrophies.entries()) {
    const b = await battle(
      PLAY + i * 4 * 60_000,
      "trail",
      pair,
      [
        { tag: FOES[0], trophies: t },
        { tag: FOES[1], trophies: t - 200 },
      ],
      { outcome: "win", crowns: i === 2 ? 1 : 3, against: 0 },
    );
    if (i === 2) annBest = b;
  }
  // Cal: a Trophy Road sitting alone. Two wins over equal opponents: the
  // one with more crowns is the best; a loss to a stronger one is not.
  const solo = [
    [5200, "win", 1],
    [5300, "win", 2],
    [5300, "win", 3],
    [5100, "win", 1],
    [5000, "win", 1],
    [9000, "loss", 0],
  ];
  for (const [i, [t, outcome, crowns]] of solo.entries()) {
    const b = await battle(
      PLAY + i * 4 * 60_000,
      "PvP",
      [{ tag: CAL, trophies: 5150 + i * 30 }],
      [{ tag: FOES[2 + (i % 2)], trophies: t }],
      { outcome, crowns, against: outcome === "win" ? 0 : 1 },
    );
    if (i === 2) calBest = b;
  }
});
after(async () => scratch.drop());

const standouts = async () =>
  (
    await buildTimeline(db, await subjectsFor(db, owner), {
      fromMs: FROM,
      toMs: TO,
      accountId: owner,
      timezone: "UTC",
      interactive: true,
      basis: "occurred",
    })
  ).timeline.filter((it) => it.kind === "session_standout");

test("a 2v2 pair's sittings are both told, each naming the other as teammate", async () => {
  const items = await standouts();
  const ann = items.find((it) => it.facts.player_tag === ANN);
  const bea = items.find((it) => it.facts.player_tag === BEA);
  assert.ok(ann && bea, "both sittings are items: never thinned");
  assert.notEqual(ann.id, bea.id);
  assert.equal(ann.schema, "session_standout/3");
  assert.deepEqual(ann.facts.teammate, {
    player_tag: BEA,
    name: "Bea",
    battles: 5,
  });
  assert.deepEqual(bea.facts.teammate, {
    player_tag: ANN,
    name: "Ann",
    battles: 5,
  });
  assert.match(
    ann.text,
    /^Ann played 5 battles in one sitting with Bea in 2v2 \(/,
  );
  assert.match(
    bea.text,
    /^Bea played 5 battles in one sitting with Ann in 2v2 \(/,
  );
});

test("best_win is the win over the highest-rated opponent, with its battle", async () => {
  const items = await standouts();
  const ann = items.find((it) => it.facts.player_tag === ANN);
  assert.equal(ann.facts.best_win.battle_id, annBest);
  assert.equal(ann.facts.best_win.mode, "casual");
  assert.deepEqual(
    ann.facts.best_win.opponents.map((o) => [o.name, o.starting_trophies]),
    [
      ["Foe One", 7400],
      ["Foe Two", 7200],
    ],
  );
  assert.equal("opponent" in ann.facts.best_win, false);
  assert.equal(ann.facts.best_win.crowns, 1);
  assert.equal(ann.facts.best_win.crowns_against, 0);
  assert.match(
    ann.text,
    /best win 1-0 over Foe One \(7,400\) and Foe Two \(7,200\)/,
  );
  assert.ok(
    followFor(ann, { from: iso(FROM), to: iso(TO) }).some(
      (f) => f.tool === "battles_query" && f.args.battle_id === annBest,
    ),
    "the best win is an address",
  );

  const cal = items.find((it) => it.facts.player_tag === CAL);
  assert.equal(
    cal.facts.best_win.battle_id,
    calBest,
    "tie on trophies: more crowns",
  );
  assert.deepEqual(cal.facts.best_win.opponent, {
    player_tag: FOES[2],
    name: "Foe Three",
    starting_trophies: 5300,
  });
  assert.equal(cal.facts.best_win.mode, "ladder");
  assert.equal(cal.facts.best_win.trophy_change, 30);
  assert.equal(typeof cal.facts.best_win.trophies_after, "number");
  assert.equal("teammate" in cal.facts, false, "no partner, no teammate");
  assert.doesNotMatch(cal.text, /2v2/);
  // Each crossing names the battle that crossed it: the fifth win.
  const five = cal.facts.crossings.find((c) => c.rung === "won_in_a_row>=5");
  assert.equal(five.battle_id, id(10));
});

test("a resolved week names who carried it, by points and decks; never fame per member", () => {
  const item = {
    kind: "week_resolved",
    subject_name: "Example Clan",
    facts: {
      season_id: 137,
      section_index: 0,
      fame: 10_400,
      rank: 1,
      trophy_change: 100,
      members: [
        { player_tag: ANN, name: "Ann", decks_used: 16, points: 3200 },
        { player_tag: BEA, name: "Bea", decks_used: 16, points: 2900 },
        { player_tag: CAL, name: "Cal", decks_used: 12, points: 2100 },
        { player_tag: FOES[0], name: "Dee", decks_used: 4, points: 800 },
        { player_tag: FOES[1], name: "Eve", decks_used: 0, points: 0 },
      ],
    },
  };
  assert.equal(
    itemText(item),
    "Example Clan finished week 1 in place 1 with 10,400 fame (+100 war trophies), led by Ann (3,200 points, 16 decks), Bea (2,900 points, 16 decks) and Cal (2,100 points, 12 decks).",
  );
  assert.equal(
    itemText({
      ...item,
      facts: {
        ...item.facts,
        members: [{ player_tag: ANN, name: "Ann", decks_used: 1, points: 100 }],
      },
    }),
    "Example Clan finished week 1 in place 1 with 10,400 fame (+100 war trophies), led by Ann (100 points, 1 deck).",
  );
  assert.equal(
    itemText({ ...item, facts: { ...item.facts, members: [] } }),
    "Example Clan finished week 1 in place 1 with 10,400 fame (+100 war trophies).",
  );
});
