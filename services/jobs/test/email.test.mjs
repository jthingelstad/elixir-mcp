import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lastGameWeek,
  lastCollectorWeek,
  isoWeekKey,
  rangeLabel,
  whenLabel,
} from "../src/email/week.mjs";
import { momentKey } from "../src/email/build-milestone.mjs";
import { modeLabel } from "../src/email/shared.mjs";

test("the game week is Monday 10:00Z to Monday 10:00Z, the last completed one", () => {
  // Friday 2026-09-18 22:00Z: the week that closed Monday 09-14 10:00Z.
  const w = lastGameWeek(new Date("2026-09-18T22:00:00Z"));
  assert.equal(w.from.toISOString(), "2026-09-07T10:00:00.000Z");
  assert.equal(w.to.toISOString(), "2026-09-14T10:00:00.000Z");
  assert.equal(w.key, "2026-W37");
  assert.equal(w.label, "Sep 7 – 14");
  // Monday 09:59Z still belongs to the previous week's close.
  const early = lastGameWeek(new Date("2026-09-14T09:59:00Z"));
  assert.equal(early.to.toISOString(), "2026-09-07T10:00:00.000Z");
  // Monday 14:00Z, the Clan Report's slot: the week that just closed.
  const send = lastGameWeek(new Date("2026-09-14T14:00:00Z"));
  assert.equal(send.to.toISOString(), "2026-09-14T10:00:00.000Z");
});

test("the collector week is Sunday 14:00Z to Sunday 14:00Z", () => {
  const w = lastCollectorWeek(new Date("2026-09-20T14:00:00Z"));
  assert.equal(w.from.toISOString(), "2026-09-13T14:00:00.000Z");
  assert.equal(w.to.toISOString(), "2026-09-20T14:00:00.000Z");
  assert.ok(w.key.endsWith("c"));
});

test("labels cross a month boundary and iso weeks are numbered", () => {
  assert.equal(
    rangeLabel(
      new Date("2026-09-28T10:00:00Z"),
      new Date("2026-10-05T10:00:00Z"),
    ),
    "Sep 28 – Oct 5",
  );
  assert.equal(isoWeekKey(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  assert.equal(
    whenLabel("2026-09-12T02:10:00Z", "America/Chicago"),
    "Fri 21:10",
  );
});

test("milestone keys are firsts: up only, by the moment's own identity", () => {
  assert.equal(
    momentKey("arena_changed", { from: 54000021, to: 54000022 }),
    "arena:54000022",
  );
  assert.equal(
    momentKey("arena_changed", { from: 54000022, to: 54000021 }),
    null,
  );
  assert.equal(momentKey("ranked_promotion", { from: 3, to: 4 }), "league:4");
  assert.equal(momentKey("ranked_promotion", { from: 5, to: 4 }), null);
  assert.equal(
    momentKey("best_trophies_band", { best: 12510, band: 12000 }),
    "band:12000",
  );
  assert.equal(
    momentKey("badge_earned", { badge: "MasteryMiner", level: 3 }),
    "badge:MasteryMiner:3",
  );
  assert.equal(
    momentKey("card_unlocked", { card: "Witch", evolution: 1 }),
    "card:Witch:1",
  );
  assert.equal(momentKey("battle_session", {}), null);
});

test("mode labels say what a player calls the mode", () => {
  assert.equal(modeLabel("Ladder", "PvP"), "Trophy Road");
  assert.equal(modeLabel("CW_Duel_1v1", "riverRaceDuel"), "War · Duel");
  assert.equal(modeLabel("CW_Battle_1v1", "riverRacePvP"), "War · 1v1");
  assert.equal(modeLabel("Showdown_Friendly", "trail"), "Friendly");
  assert.equal(modeLabel("ranked", ""), "Ranked");
  assert.equal(modeLabel("war", ""), "War");
});
