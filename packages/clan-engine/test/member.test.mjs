import { test } from "node:test";
import assert from "node:assert/strict";
import { memberWeeks } from "../src/member.mjs";
import { member, participation, NOW } from "./fixture.mjs";

test("a member's own weeks: this week so far, the open war week, decks asked on closed weeks, time here", () => {
  const p = participation([
    member("#A", { name: "Ada", tenureDays: 40 }),
    member("#B"),
  ]);
  const roster = {
    members: [{ player_tag: "#A", trophies: 9100 }],
    recent_events: [
      {
        type: "role_changed",
        at: "2026-09-01T00:00:00Z",
        detail: {
          player_tag: "#A",
          role_before: "member",
          role_after: "elder",
        },
      },
      {
        type: "role_changed",
        at: "2026-09-02T00:00:00Z",
        detail: {
          player_tag: "#B",
          role_before: "member",
          role_after: "elder",
        },
      },
    ],
  };
  const y = memberWeeks(p, "#A", roster, NOW);
  assert.equal(y.name, "Ada");
  assert.equal(y.trophies, 9100);
  assert.equal(y.this_week.complete, false);
  assert.equal(y.this_week.battles, 10);
  assert.equal(y.this_war_week.open, true);
  assert.equal(
    y.this_war_week.decks_asked,
    null,
    "an open week asks nothing yet",
  );
  assert.ok(
    y.war_weeks.filter((w) => !w.open).every((w) => w.decks_asked === 16),
  );
  assert.equal(y.time_here.days, 40);
  assert.deepEqual(
    y.time_here.events.map((e) => e.role_after),
    ["elder"],
    "only this member's events",
  );
  assert.equal(memberWeeks(p, "#NOBODY", roster, NOW), null);
});

test("this week keeps Monday's reset: until 10:00 UTC it is still last week, and the ISO rows do not move", () => {
  const p = participation([member("#A"), member("#B")]);
  const last = p.weeks.at(-1);
  const monday = new Date(last.from);
  const before = new Date(monday.getTime() + 5 * 3600_000);
  const after = new Date(monday.getTime() + 11 * 3600_000);
  const early = memberWeeks(p, "#A", null, before);
  const later = memberWeeks(p, "#A", null, after);
  assert.equal(early.this_week.iso_week, p.weeks.at(-2).iso_week);
  assert.equal(early.this_week.complete, false);
  assert.equal(later.this_week.iso_week, last.iso_week);
  assert.equal(later.this_week.reset_from.slice(11, 16), "10:00");
  assert.equal(later.this_week.reset_to.slice(11, 16), "10:00");
  assert.equal(early.weeks.length, later.weeks.length);
  assert.deepEqual(
    early.weeks.map((w) => [w.iso_week, w.battles, w.donations]),
    later.weeks.map((w) => [w.iso_week, w.battles, w.donations]),
    "the ISO rows are the same at both hours",
  );
});

test("this week counts the clan's own battles; a failed read is unknown, never another clock's number", () => {
  const p = participation([member("#A"), member("#B")]);
  const read = {
    members: [{ player_tag: "#A", battles: 7, ranked: 2 }],
  };
  const a = memberWeeks(p, "#A", null, NOW, { clanBattles: read }).this_week;
  assert.equal(a.battles, 7);
  assert.equal(a.ranked_battles, 2);
  const b = memberWeeks(p, "#B", null, NOW, { clanBattles: read }).this_week;
  assert.equal(b.battles, 0, "the read worked and has none for them");
  const no = memberWeeks(p, "#A", null, NOW, { clanBattles: null }).this_week;
  assert.equal(no.battles, null);
  assert.equal(no.ranked_battles, null);
  const iso = memberWeeks(p, "#A", null, NOW).this_week;
  assert.equal(no.donations, iso.donations, "donations keep their own row");
});
