/**
 * Three surfaces, one clan's week (A13). The clan report counts battles
 * played between Monday resets for this clan; Friends' clan entry counted
 * what the record learned in the window; Clan's The week counted each
 * member's battles by ISO week, for any clan. This seeds a week that tells
 * them apart, then pins that the report, Friends and The week agree.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  clanActivityWeeks,
  clanWeekBattles,
} from "../../record/src/member-activity.mjs";
import { participationQueries } from "../../record/src/participation-sql.mjs";
import { weeklyReport } from "../../clan-engine/src/week.mjs";
import { buildClanEntry } from "../src/activity/entries.mjs";

const CLAN = "#PYL";
const OTHER = "#PYQ";
const ANN = "#9QY";
const BEA = "#9QU";
const FROM = Date.parse("2026-10-05T10:00:00Z");
const TO = Date.parse("2026-10-12T10:00:00Z");
const MINUTE = 60_000;

/** id, when played, who played it, when learned if not a minute later. */
const BATTLES = [
  ["at-the-reset", "2026-10-05T10:00:00Z", [ANN]],
  ["ordinary", "2026-10-06T12:00:00Z", [ANN]],
  // Both members in one battle: one battle for the clan.
  ["pair", "2026-10-07T12:00:00Z", [ANN, BEA]],
  // Played in the week, learned days later: a late capture.
  ["late", "2026-10-08T12:00:00Z", [ANN], "2026-10-10T12:00:00Z"],
  // Before the closing reset, learned after it.
  ["lagged", "2026-10-12T09:30:00Z", [ANN], "2026-10-12T10:05:00Z"],
  // Same ISO week, last game week: Monday morning before the reset.
  ["before-reset", "2026-10-05T09:00:00Z", [ANN]],
  // Next game week.
  ["after-reset", "2026-10-12T11:00:00Z", [ANN]],
];

async function seed(db) {
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Ann'), ($2, 'Bea')`,
    [ANN, BEA],
  );
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Example Clan'), ($2, 'Other Clan')`,
    [CLAN, OTHER],
  );
  const put = async (id, at, tags, learned, { clan = CLAN, boat } = {}) => {
    await db.query(
      `insert into battle (battle_id, battle_time, created_at, type, type_class, boat_battle_side)
       values ($1, $2, $3, $4, 'pvp', $5)`,
      [
        id,
        at,
        learned ?? new Date(Date.parse(at) + MINUTE).toISOString(),
        boat ? "boatBattle" : "PvP",
        boat ?? null,
      ],
    );
    for (const tag of tags)
      await db.query(
        `insert into battle_participant (battle_id, player_tag, clan_tag, side, outcome, battle_time, type, type_class)
         values ($1, $2, $3, 0, 'win', $4, $5, 'pvp')`,
        [id, tag, clan, at, boat ? "boatBattle" : "PvP"],
      );
  };
  for (const [id, at, tags, learned] of BATTLES)
    await put(id, at, tags, learned);
  // Not the member's battle (0171).
  await put("boat-defense", "2026-10-07T13:00:00Z", [ANN], null, {
    boat: "defender",
  });
  // Played for another clan while in the week.
  await put("other-clan", "2026-10-06T13:00:00Z", [ANN], null, {
    clan: OTHER,
  });
}

test("the report, Friends and Clan's week read one number for one clan's week", async () => {
  const scratch = await scratchDb("clan_week_counts");
  try {
    const db = scratch.db;
    await seed(db);
    const window = { from: new Date(FROM), to: new Date(TO) };
    // The report's count: the reference.
    const [report] = await clanActivityWeeks(db, CLAN, [window]);
    assert.equal(report.battles, 5);
    assert.equal(report.active, 2);

    // Clan's week.
    const [week] = await clanWeekBattles(db, CLAN, [
      { iso_week: "2026-W41", from: window.from, to: window.to },
    ]);
    assert.equal(week.battles, report.battles);
    assert.equal(week.active, report.active);
    assert.deepEqual(
      Object.fromEntries(week.members.map((m) => [m.name, m.battles])),
      { Ann: 5, Bea: 1 },
    );

    // Friends' clan entry, read on the battle clock.
    const { entry } = await buildClanEntry(db, {
      tag: CLAN,
      fromMs: FROM,
      toMs: TO,
      basis: "occurred",
    });
    assert.equal(entry.activity.battles, report.battles);
    assert.equal(entry.activity.members_active, report.active);
    assert.equal(entry.activity.basis, "played");

    // The Clan page, built from the same count, whatever the columns say.
    const part = {
      weeks: [
        {
          iso_week: "2026-W41",
          from: "2026-10-05T00:00:00.000Z",
          to: "2026-10-12T00:00:00.000Z",
        },
      ],
      war_weeks: [],
      members: [
        { player_tag: ANN, name: "Ann", battles: [99], ranked_battles: [0] },
      ],
    };
    const page = weeklyReport(part, {
      now: new Date("2026-10-13T00:00:00Z"),
      clanBattles: { "2026-W41": week },
    });
    const battles = page.areas.find((a) => a.key === "battles");
    assert.equal(battles.total, report.battles);
    assert.equal(battles.participants.length, report.active);
  } finally {
    await scratch.drop();
  }
});

test("why they differed: the learned clock and the ISO week count other battles", async () => {
  const scratch = await scratchDb("clan_week_causes");
  try {
    const db = scratch.db;
    await seed(db);
    // The timeline's default read counts what the record learned in the
    // window, which is right for a poll and not a week's battles: the late
    // capture and the lagged battle are not in it.
    const { entry } = await buildClanEntry(db, {
      tag: CLAN,
      fromMs: FROM,
      toMs: TO,
    });
    assert.equal(entry.activity.basis, "recorded");
    assert.equal(entry.activity.battles, 3);
    assert.equal(entry.activity.late_captures, 1);

    // A read that serves no activity (#649) leaves the two late counts
    // out and says everything else the same, its sentence included.
    const lean = (
      await buildClanEntry(db, {
        tag: CLAN,
        fromMs: FROM,
        toMs: TO,
        lateCounts: false,
      })
    ).entry;
    assert.equal(lean.activity.late_captures, null);
    assert.equal(lean.activity.played_here_learned_later, null);
    const strip = (e) => ({
      ...e,
      activity: {
        ...e.activity,
        late_captures: null,
        played_here_learned_later: null,
      },
    });
    assert.deepEqual(lean, strip(entry));

    // clans_participation counts per member by ISO week, any clan: Monday
    // morning's battle and the other clan's are in Ann's six, and the pair
    // is in both members', so the column sums to seven against five.
    const q = participationQueries({
      clanTag: CLAN,
      tags: [ANN, BEA],
      from: "2026-10-05T00:00:00Z",
      rankedTypes: ["pathOfLegend"],
    }).find((x) => x.name === "battles_by_week");
    const { rows } = await db.query(q.text, q.values);
    const iso = rows.filter(
      (r) => new Date(r.week_start).toISOString().slice(0, 10) === "2026-10-05",
    );
    assert.deepEqual(
      Object.fromEntries(iso.map((r) => [r.player_tag, r.battles])),
      { [ANN]: 6, [BEA]: 1 },
    );
  } finally {
    await scratch.drop();
  }
});
