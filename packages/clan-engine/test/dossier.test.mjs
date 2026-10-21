/**
 * A member's dossier as a draft is told it, and the story angles Elixir
 * picks from it (Jamie, 2026-10-20): all of it for a promotion or a
 * welcome; only what they gave before the recent weeks for a demotion,
 * never a zero, a missed week, days since or the recent numbers; only
 * the war weeks they played for a removal or a departure. Every angle's
 * number is one the member's record states. Synthetic people only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  angleLines,
  dossierBlock,
  dossierLines,
  memberLines,
  numbersOf,
  recentWeeksFor,
  storyAngles,
} from "../src/index.mjs";

const week = (
  season_id,
  section_index,
  ago,
  decks_used,
  points,
  colo = false,
) => ({
  season_id,
  section_index,
  is_colosseum: colo,
  ago,
  decks_used,
  points,
});

/** Played the last two weeks, missed the two before, played the five
 *  before those, missed one (no row), then played seven in a row. */
const DOSSIER = {
  days: 28,
  war: [
    week(136, 1, 0, 16, 3300),
    week(136, 0, 1, 12, 2400),
    week(135, 4, 2, 0, 0, true),
    week(135, 3, 3, 0, 0),
    week(135, 2, 4, 16, 2900),
    week(135, 1, 5, 16, 2750),
    week(135, 0, 6, 12, 2050),
    week(134, 3, 7, 16, 3100),
    week(134, 2, 8, 8, 1200),
    week(134, 0, 10, 16, 2600),
    week(133, 3, 11, 4, 600),
    week(133, 2, 12, 16, 2500),
    week(133, 1, 13, 16, 2450),
    week(133, 0, 14, 16, 2400),
    week(132, 3, 15, 16, 2300),
    week(132, 2, 16, 16, 2200),
  ],
  donations: {
    weeks: [
      { week: "2026-10-12", ago: 0, donations: 40 },
      { week: "2026-10-05", ago: 1, donations: 0 },
      { week: "2026-09-28", ago: 2, donations: 0 },
      { week: "2026-09-21", ago: 3, donations: 0 },
      { week: "2026-09-14", ago: 4, donations: 0 },
      { week: "2026-09-07", ago: 5, donations: 0 },
      { week: "2026-08-31", ago: 6, donations: 210 },
      { week: "2026-08-24", ago: 7, donations: 330 },
    ],
    career: 45210,
  },
  profile: {
    years_played: 6,
    favorite_card: "Hog Rider",
    masteries_at_top: 11,
    mastery_level: 10,
    masteries: [
      "Hog Rider",
      "Musketeer",
      "Knight",
      "Valkyrie",
      "Fireball",
      "Zap",
      "Archers",
      "Goblin Barrel",
    ],
    legendary_badges: ["Classic Challenge 12 Wins", "Grand Challenge 12 Wins"],
    pol_best: { season: "2026-09", league: 6, name: "Royal Champion" },
    clan_war_wins: 150,
  },
  decks: [
    {
      mode: "ladder",
      games: 54,
      wins: 31,
      losses: 23,
      decks: [
        { label: "Hog Rider cycle", games: 34, wins: 20, losses: 14 },
        { label: "Golem beatdown", games: 12, wins: 7, losses: 5 },
      ],
    },
    {
      mode: "ranked",
      games: 9,
      wins: 4,
      losses: 5,
      decks: [{ label: "X-Bow siege", games: 9, wins: 4, losses: 5 }],
    },
    { mode: "war", games: 14, wins: 9, losses: 5, decks: [] },
  ],
  moments: [
    {
      at: "2026-10-14T09:00:00Z",
      text: "Dot reached Legendary Arena on Trophy Road.",
    },
    {
      at: "2026-10-02T09:00:00Z",
      text: "Dot earned the legendary badge Classic Challenge 12 Wins.",
    },
  ],
  roles: [{ at: "2026-06-01T06:00:00Z", before: "member", after: "elder" }],
  awards: [{ name: "Steady Hand", season_id: 136 }],
};

const MEMBER = {
  name: "Dot",
  role: "elder",
  trophies: 9100,
  best_trophies: 9400,
  tenure_days: 169,
  joined_at: "2026-05-04T12:00:00Z",
  baseline: false,
  stints_before: 0,
  war: [],
  moments: [],
  awards: [
    { name: "Steady Hand", season_id: 136, value: 13000, unit: "points" },
  ],
};

/** What the member's record told: the member block and the dossier. */
const told = (kind, member = MEMBER, opts = {}) =>
  [
    ...memberLines(member, {
      scope:
        kind === "removal" || kind === "departure" ? "contribution" : "full",
    }),
    ...dossierLines(DOSSIER, kind, opts),
  ].join("\n");

const NO_JUDGMENT =
  /\brate\b|%|percent|\brank|score|standing|rating|should|try to/i;

test("a promotion is told the whole dossier, labelled, and no judgment", () => {
  const lines = dossierLines(DOSSIER, "promotion");
  const text = lines.join("\n");
  assert.equal(
    lines[0],
    "MEMBER DOSSIER (more of Elixir's record of this member)",
  );
  // Played weeks only, newest first, twelve listed and the rest by season.
  assert.match(
    text,
    /War weeks they played in this clan, newest first \(decks used, points\): season 136 week 2: 16 decks, 3,300 points; season 136 week 1: 12 decks, 2,400 points; season 135 week 3: 16 decks, 2,900 points;/,
  );
  assert.match(
    text,
    /season 133 week 1: 16 decks, 2,400 points\nEarlier war weeks they played here, by season: season 132: 2 weeks, 32 decks, 4,500 points/,
  );
  assert.match(
    text,
    /Across those war weeks: 14 weeks played, 196 decks, 32,750 points; their best week season 136 week 2: 16 decks, 3,300 points$/m,
  );
  assert.match(
    text,
    /Their longest run of war weeks played in a row: 7 weeks, season 132 week 3 to season 134 week 1, 15,050 points together/,
  );
  assert.match(
    text,
    /Donations they gave in this clan, by week \(the week starting\): 2026-10-12: 40; 2026-08-31: 210; 2026-08-24: 330; 580 across these 3 weeks, 330 their best \(the week of 2026-08-24\)/,
  );
  assert.match(text, /Donations in their career, every clan: 45,210/);
  assert.match(
    text,
    /In the game \(their profile\): 6 years playing Clash Royale; favourite card Hog Rider; 11 cards at Mastery level 10 \(Hog Rider, Musketeer, Knight, Valkyrie, Fireball, Zap, Archers, Goblin Barrel and more\); best Path of Legends league in a season on record: Royal Champion \(finished the 2026-09 season there\); Clan War Wins badge at 150/,
  );
  assert.match(
    text,
    /Legendary badges they hold: Classic Challenge 12 Wins, Grand Challenge 12 Wins/,
  );
  assert.match(
    text,
    /Their decks over the last 28 days, each mode on its own: Trophy Road: 54 games, 31 wins, 23 losses; most played Hog Rider cycle \(34 games, 20 wins, 14 losses\), Golem beatdown \(12 games, 7 wins, 5 losses\) \| Path of Legends: 9 games, 4 wins, 5 losses; most played X-Bow siege \(9 games, 4 wins, 5 losses\) \| War: 14 games, 9 wins, 5 losses/,
  );
  assert.match(
    text,
    /Their milestones over the last 28 days: 2026-10-14 Dot reached Legendary Arena/,
  );
  assert.match(
    text,
    /Their role changes in this clan, newest first: 2026-06-01: Member to Elder/,
  );
  assert.doesNotMatch(text, /\b0 decks|fame/);
  assert.doesNotMatch(text, NO_JUDGMENT);
});

test("a demotion is told only what they gave before the recent weeks: never a zero, a gap, days since or the recent numbers", () => {
  const recentWeeks = recentWeeksFor(null);
  assert.equal(recentWeeks, 6);
  const text = dossierLines(DOSSIER, "demotion", { recentWeeks }).join("\n");
  assert.match(
    text,
    /War weeks they played in this clan, newest first \(decks used, points\): season 135 week 1: 12 decks, 2,050 points; season 134 week 4: 16 decks, 3,100 points; season 134 week 3: 8 decks, 1,200 points; season 134 week 1: 16 decks/,
  );
  assert.match(
    text,
    /Donations they gave in this clan, by week \(the week starting\): 2026-08-31: 210; 2026-08-24: 330;/,
  );
  // The recent weeks (war ago < 6, donations ago < 6) are not told, nor
  // anything that is not what they gave here.
  for (const recent of [
    "3,300",
    "2,400 points; season 135",
    "2,900",
    "2,750",
    "2026-10-12",
    "season 136",
  ])
    assert.ok(!text.includes(recent), `told ${recent}`);
  assert.doesNotMatch(
    text,
    /\b0\b|days ago|days since|last \d+ days|Mastery|Path of Legends|Trophy Road|milestones|role changes|career|years playing/,
  );
  const angles = storyAngles(DOSSIER, "demotion", {
    recentWeeks,
    member: MEMBER,
  });
  assert.ok(angles.length >= 3 && angles.length <= 4);
  for (const a of angles)
    assert.doesNotMatch(a, /\b0\b|days ago|days since|3,300|season 136 week/);
  assert.match(
    angles[0],
    /^7 war weeks in a row in this clan, season 132 week 3 to season 134 week 1: 15,050 points together\.$/,
  );
  assert.ok(
    angles.some((a) => /Steady Hand/.test(a)),
    "the award they hold",
  );
});

test("a removal or a departure is told the war weeks they played, nothing else", () => {
  for (const kind of ["removal", "departure"]) {
    const text = dossierLines(DOSSIER, kind).join("\n");
    assert.match(text, /War weeks they played in this clan/);
    assert.match(text, /Across those war weeks: 14 weeks played/);
    assert.doesNotMatch(
      text,
      /Donations|career|Mastery|years playing|Legendary badges|decks over|milestones|role changes|\b0 decks/,
    );
    const angles = storyAngles(DOSSIER, kind, {
      member: { ...MEMBER, awards: [] },
    });
    assert.match(
      angles[0],
      /^14 war weeks played in this clan: 196 decks and 32,750 points across them\.$/,
    );
    assert.ok(angles.every((a) => !/donation|Mastery|award/i.test(a)));
  }
});

test("a run that is every week they played is told once, in the total", () => {
  const d = {
    ...DOSSIER,
    war: [
      week(136, 1, 0, 16, 3300),
      week(136, 0, 1, 12, 2400),
      week(135, 4, 2, 16, 2900),
    ],
  };
  const text = dossierLines(d, "departure").join("\n");
  assert.match(
    text,
    /Across those war weeks: 3 weeks played, 44 decks, 8,600 points; their best week season 136 week 2: 16 decks, 3,300 points; all 3 in a row, season 135 week 5 to season 136 week 2$/m,
  );
  assert.doesNotMatch(text, /longest run/);
  const angles = storyAngles(d, "departure", {
    member: { ...MEMBER, awards: [] },
  });
  assert.match(
    angles[0],
    /^3 war weeks in a row in this clan, season 135 week 5 to season 136 week 2: 8,600 points together\.$/,
  );
  assert.ok(!angles.some((a) => /across them/.test(a)), angles.join("\n"));
});

test("a welcome leads with who they are in the game; a returning member with their return", () => {
  const fresh = { ...MEMBER, role: "member", tenure_days: 1, awards: [] };
  const angles = storyAngles(DOSSIER, "welcome", { member: fresh });
  assert.equal(angles.length, 4);
  assert.match(
    angles[0],
    /^On Trophy Road over the last 28 days: Hog Rider cycle, 20 wins and 14 losses\.$/,
  );
  assert.match(
    angles[1],
    /^Legendary badges: Classic Challenge 12 Wins, Grand Challenge 12 Wins\.$/,
  );
  assert.match(
    angles[2],
    /^6 years playing Clash Royale, with 11 cards at Mastery level 10\.$/,
  );
  const back = storyAngles(DOSSIER, "welcome", {
    member: { ...fresh, stints_before: 1 },
  });
  assert.match(back[0], /^They are back: 1 earlier stint in this clan\.$/);
});

test("Ultimate Champion leads a welcome and a promotion, from a recorded season or the profile's best", () => {
  const withPol = (pol) => ({
    ...DOSSIER,
    profile: { ...DOSSIER.profile, pol_best: pol },
  });
  const recorded = withPol({
    season: "2026-08",
    league: 7,
    name: "Ultimate Champion",
    ultimate_seasons: 3,
  });
  const fresh = { ...MEMBER, role: "member", tenure_days: 1, awards: [] };
  for (const [kind, member] of [
    ["welcome", fresh],
    ["promotion", MEMBER],
  ])
    assert.equal(
      storyAngles(recorded, kind, { member })[0],
      "They finished the 2026-08 season in Ultimate Champion, Path of Legends' top league (3 of their recorded seasons ended there).",
    );
  assert.match(
    dossierLines(recorded, "promotion").join("\n"),
    /; Path of Legends: finished the 2026-08 season in Ultimate Champion, the top league \(3 recorded seasons ended there\); /,
  );
  // Before Elixir's record: the profile's rated best, with no season.
  const before = withPol({
    season: null,
    league: 7,
    name: "Ultimate Champion",
    ultimate_seasons: 0,
  });
  assert.equal(
    storyAngles(before, "welcome", { member: fresh })[0],
    "They have reached Ultimate Champion, Path of Legends' top league (their profile's best; that season is not in Elixir's record).",
  );
  assert.match(
    dossierLines(before, "welcome").join("\n"),
    /Path of Legends: has reached Ultimate Champion, the top league \(the profile's best; that season is not in Elixir's record\)/,
  );
  // Any other league is one angle among the rest.
  assert.ok(
    !/Path of Legends/.test(
      storyAngles(DOSSIER, "promotion", { member: MEMBER })[0],
    ),
  );
});

test("every angle's number is one the member's record states, for every kind", () => {
  for (const kind of [
    "promotion",
    "demotion",
    "welcome",
    "removal",
    "departure",
  ]) {
    const member =
      kind === "removal" || kind === "departure"
        ? { ...MEMBER, awards: [] }
        : MEMBER;
    const recentWeeks = 6;
    const record = new Set(numbersOf(told(kind, member, { recentWeeks })));
    const angles = storyAngles(DOSSIER, kind, { recentWeeks, member });
    assert.ok(
      angles.length >= 3 && angles.length <= 4,
      `${kind}: ${angles.length}`,
    );
    for (const a of angles) {
      for (const x of numbersOf(a))
        assert.ok(record.has(x), `${kind}: ${x} in "${a}"`);
      assert.doesNotMatch(a, NO_JUDGMENT);
    }
  }
});

test("the angles block is numbered strongest first; nothing is added without a dossier", () => {
  assert.deepEqual(angleLines(["One.", "Two."]), [
    "STORY ANGLES (Elixir's pick from the record, strongest first)",
    "1. One.",
    "2. Two.",
  ]);
  assert.deepEqual(angleLines([]), []);
  assert.deepEqual(dossierBlock(null, "promotion"), []);
  assert.deepEqual(
    dossierLines({ war: [], donations: { weeks: [] } }, "demotion"),
    [],
  );
  const block = dossierBlock(DOSSIER, "promotion", { member: MEMBER });
  assert.equal(block[0], "");
  assert.equal(
    block[1],
    "MEMBER DOSSIER (more of Elixir's record of this member)",
  );
  assert.ok(
    block.includes(
      "STORY ANGLES (Elixir's pick from the record, strongest first)",
    ),
  );
});

test("the recent weeks a demotion leaves out follow the clan's policy", () => {
  assert.equal(recentWeeksFor({}), 6);
  assert.equal(
    recentWeeksFor({
      minimums_window_weeks: 1,
      war_window_weeks: 1,
      ranked_window_weeks: 1,
      donations_window_weeks: 1,
      demote_abandoned_weeks: 1,
      demote_outranked_weeks: 1,
    }),
    4,
  );
  assert.equal(
    recentWeeksFor({ war_window_weeks: 8, demote_outranked_weeks: 8 }),
    15,
  );
  assert.equal(
    recentWeeksFor({
      war_window_weeks: 8,
      demote_abandoned_weeks: 8,
      demote_outranked_weeks: 8,
    }),
    15,
  );
});
