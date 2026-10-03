import test from "node:test";
import assert from "node:assert/strict";
import { awardUpdateParts } from "../src/manage/award-week.mjs";

const podium = (kind, name, rows) => ({
  kind,
  name,
  state: "live",
  computed: true,
  rows,
});
const row = (name, place, points) => ({
  name,
  place,
  points,
  total: points,
  on_podium: true,
});
test("a compact game update fits podiums and attendance without repeating award names or time metadata", () => {
  const season = {
    awards: [
      podium("points_podium", "Points Cup", [
        row("Ari", 1, 9000),
        row("Bo", 2, 8600),
        row("Cy", 3, 8300),
      ]),
      podium(
        "perfect_attendance",
        "Attendance",
        Array.from({ length: 9 }, () => ({})),
      ),
      podium("donations_podium", "Donations", [
        row("Dee", 1, 4300),
        row("Eli", 2, 2600),
      ]),
      { kind: "manual", name: "Leaders Pick", state: "manual" },
    ],
  };
  const parts = awardUpdateParts(season, {
    prefix: "So far: ",
    title: "Season 136",
    complete: true,
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].message.title, "Season 136");
  assert.equal(
    parts[0].message.body,
    "So far: Points Cup: 1. Ari 9,000. 2. Bo 8,600. 3. Cy 8,300. Attendance: 9 on track. Donations: 1. Dee 4,300. 2. Eli 2,600.",
  );
  assert.ok(parts[0].message.body.length <= 180);
});

test("overflow preserves every tied podium recipient across ordered bounded parts without player IDs", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    ...row(`Example recipient ${i} ${"long ".repeat(20)}`, 1, 12345),
    player_tag: `#PRIVATE${i}`,
  }));
  const parts = awardUpdateParts(
    { awards: [podium("points_podium", "Points Cup", rows)] },
    { prefix: "So far: ", title: "Season 136", complete: true },
  );
  assert.ok(parts.length > 1);
  assert.deepEqual(
    parts.map((p) => p.part),
    Array.from({ length: parts.length }, (_, i) => i + 1),
  );
  const text = parts.map((p) => p.message.body).join(" ");
  rows.forEach((_, i) =>
    assert.ok(text.includes(`Example recipient ${i} `), i),
  );
  assert.equal((text.match(/12,345/g) ?? []).length, rows.length);
  assert.doesNotMatch(text, /#PRIVATE/);
  assert.ok(
    parts.every(
      (p) => p.message.body.length <= 180 && p.message.title.length <= 24,
    ),
  );
});

test("incomplete standings withhold ranks using short honest game wording", () => {
  const parts = awardUpdateParts(
    {
      awards: [
        podium("points_podium", "Points Cup", [row("Example", 1, 9000)]),
      ],
    },
    { prefix: "So far: ", title: "Season 136", complete: false },
  );
  assert.equal(
    parts[0].message.body,
    "So far: Points Cup: standings not ready.",
  );
  assert.doesNotMatch(parts[0].message.body, /9,000|1\./);
});

test("unknown podium metrics withhold places instead of publishing zero", () => {
  for (const metric of [null, undefined, NaN, Infinity]) {
    const parts = awardUpdateParts(
      {
        awards: [
          podium("points_podium", "Points Cup", [row("Example", 1, metric)]),
        ],
      },
      { prefix: "So far: ", title: "Season 136", complete: true },
    );
    assert.equal(
      parts[0].message.body,
      "So far: Points Cup: standings not ready.",
    );
  }
});
