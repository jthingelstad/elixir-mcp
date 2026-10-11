import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionLines,
  clanContext,
  inventedNumbers,
  itemFactLines,
  memberLines,
  namesInFacts,
  strictTool,
  unknownNames,
  weekName,
} from "../src/context.mjs";

const MEMBER = {
  name: "Ada",
  role: "elder",
  trophies: 10040,
  best_trophies: 10500,
  arena: "Legendary Arena",
  career_wins: 4321,
  collection_level: 52,
  joined_at: "2026-07-01T10:00:00Z",
  tenure_days: 102,
  stints_before: 1,
  last_left_at: "2026-05-01T00:00:00Z",
  war: [
    { season_id: 135, section_index: 3, decks_used: 16, points: 2900 },
    { season_id: 135, section_index: 2, decks_used: 0, points: 0 },
  ],
  moments: [
    { at: "2026-10-09T20:00:00Z", text: "Ada reached a new best of 10,500." },
  ],
  awards: [{ name: "Cup", season_id: 134, value: 3100, unit: "points" }],
};

test("the clan block is stable, labelled and holds only what the clan says and the record shows", () => {
  const input = {
    name: "Example Clan",
    pitch: { tagline: "Steady wars", about: "We war,\nwe chat." },
    voice: "Pirate talk",
    goals: ["war"],
    facts: {
      members: 41,
      war: [
        {
          season_id: 135,
          section_index: 3,
          rank: 2,
          trophy_change: 40,
          is_colosseum: true,
        },
        { season_id: 135, section_index: 2, rank: null },
      ],
    },
  };
  const text = clanContext(input);
  assert.equal(text, clanContext(structuredClone(input)), "the cached prefix");
  assert.equal(
    text,
    [
      "THE CLAN",
      "Name: Example Clan",
      "Its tagline: Steady wars",
      "In its own words: We war, we chat.",
      "How its leaders want it to sound: Pirate talk",
      `What it is for: ${text.split("What it is for: ")[1].split("\n")[0]}`,
      "Members now: 41",
      "Recent war weeks: season 135 week 4 (Colosseum): place 2, +40 war trophies",
    ].join("\n"),
  );
  assert.equal(clanContext(), "THE CLAN\nName: a Clash Royale clan");
  assert.equal(weekName({ season_id: 1, section_index: 0 }), "season 1 week 1");
});

test("a member in full: record, time here, war weeks as decks and points, moments and awards; never fame", () => {
  const lines = memberLines({
    ...MEMBER,
    war: [{ ...MEMBER.war[0], fame: 2900, fame_share: 0.2 }],
  });
  assert.deepEqual(lines, [
    "MEMBER: Ada",
    "Role in the clan: Elder",
    "Trophies: 10,040; best ever 10,500",
    "Arena: Legendary Arena",
    "Career wins: 4,321",
    "Collection level: 52",
    "Time in the clan: 102 days (joined 2026-07-01)",
    "Earlier time in this clan: 1 earlier stint, the last ending 2026-05-01",
    "War weeks (their decks used and points): season 135 week 4: 16 decks, 2,900 points",
    "Their recent moments: 2026-10-09 Ada reached a new best of 10,500.",
    "Awards they hold in this clan: Cup (season 134, 3,100 points)",
  ]);
  assert.doesNotMatch(lines.join("\n"), /fame|0\.2/);
  // Recorded since the clan was first read: a floor, said as one.
  assert.match(
    memberLines({
      name: "Bo",
      tenure_days: 30,
      joined_at: "2026-03-07T00:00:00Z",
      baseline: true,
    }).join("\n"),
    /at least 30 days \(recorded since 2026-03-07, when Elixir first read the clan/,
  );
  // Absence over a guess: nothing the record lacks is filled in.
  assert.deepEqual(memberLines({ name: "Cy" }), ["MEMBER: Cy"]);
});

test("a member for a departure or a removal: time here and what they gave, nothing else", () => {
  const lines = memberLines(
    { ...MEMBER, war: MEMBER.war.filter((w) => w.decks_used > 0), awards: [] },
    { scope: "contribution" },
  ).join("\n");
  assert.match(lines, /Time in the clan: 102 days/);
  assert.match(lines, /16 decks, 2,900 points/);
  assert.doesNotMatch(
    lines,
    /Trophies|Arena|Career|Collection|moments|0 decks|Elder/,
  );
});

test("what happened, per Action kind: the rule's evidence, the winners' numbers, the policy, the departure as confirmed", () => {
  const promo = actionLines("promotion", {
    card: {
      evidence: {
        phrase: "played every war deck",
        facts: [
          { label: "War decks", value: "48 of 48", window: "last 3 weeks" },
        ],
        rationale: { headline: "INTERNAL" },
        decision_note: "Private reason",
        holds: [{ note: "Private hold" }],
      },
    },
  }).join("\n");
  assert.match(promo, /made this member an Elder/);
  assert.match(promo, /In short: played every war deck/);
  assert.match(promo, /- War decks: 48 of 48 \(last 3 weeks\)/);
  assert.doesNotMatch(promo, /INTERNAL|Private/);
  assert.match(
    actionLines("demotion", { card: { evidence: {} } }).join("\n"),
    /it can come back/,
  );
  const awards = actionLines("awards", {
    card: { evidence: { season_id: 135, parts: 2, part: 1 } },
    grants: [
      {
        name: "Cup",
        player_name: "Ada",
        player_tag: "#8QCV",
        metric_value: 3100,
        metric_unit: "points",
        note: "PRIVATE",
      },
      { name: "Shield", player_name: "Ben", metric_value: null },
    ],
  }).join("\n");
  assert.match(awards, /Season 135 closed/);
  assert.match(awards, /- Cup: Ada \(3,100 points\)/);
  assert.match(awards, /- Shield: Ben$/m);
  assert.match(awards, /announcement 1 of 2/);
  assert.doesNotMatch(awards, /PRIVATE|8QCV/);
  const rules = actionLines("rules", {
    card: { evidence: { version: 3, changes: ["the Elder band"] } },
    policyLines: ["Elder: 12 war decks in each of the last 2 weeks."],
  }).join("\n");
  assert.match(rules, /changed how it runs: the Elder band/);
  assert.match(rules, /- Elder: 12 war decks/);
  assert.match(
    actionLines("welcome", {
      card: {
        evidence: {
          joined_at: "2026-10-01T00:00:00Z",
          welcome: { returning: true },
        },
      },
    }).join("\n"),
    /came back[\s\S]*Joined: 2026-10-01/,
  );
  for (const [classification, said] of [
    ["member_left", /left the clan on their own/],
    ["member_kicked", /was removed from the clan/],
  ])
    assert.match(
      actionLines("departure", {
        card: {
          outcome: { classification },
          decision_note: "Private reason",
          evidence: { left_at: "2026-10-02T00:00:00Z", days_idle: 999 },
        },
      }).join("\n"),
      said,
    );
  const removal = actionLines("removal", {
    card: {
      evidence: {
        days_idle: 999,
        phrase: "idle 999 days",
        removal_state: "recommended",
      },
    },
  }).join("\n");
  assert.match(removal, /only after a leader has done it/);
  assert.doesNotMatch(removal, /999|idle|recommended/);
});

test("a timeline item's facts: flattened, capped, never a tag, an id, a link, a time or fame per member", () => {
  const lines = itemFactLines({
    name: "Ada",
    player_tag: "#8QCV",
    battle_id: "b1",
    season_id: 135,
    url: "https://x.test",
    at: "2026-10-10T01:00:00Z",
    started_at: "2026-10-10T01:00:00Z",
    best_win: { opponent: { name: "Jotaro", tag: "#J" }, crowns: 3 },
    decks: [1, 2, 3, 4, 5, 6, 7],
    members: [{ name: "Ada", decks_used: 16, fame: 2900 }],
    huge: "x".repeat(500),
  });
  const text = lines.join("\n");
  assert.match(text, /^name: Ada$/m);
  assert.match(text, /^best_win\.opponent\.name: Jotaro$/m);
  assert.match(text, /^best_win\.crowns: 3$/m);
  assert.match(text, /^season_id: 135$/m, "a season is the moment's");
  assert.match(text, /members\.0\.decks_used: 16|members.*decks_used: 16/);
  assert.doesNotMatch(text, /8QCV|#J|b1|https|2026-10-10|fame|2900|xxxx/);
  assert.ok(!/decks.*7/.test(text), "a list keeps five");
});

test("the checks: a number or a proper name the model was not given", () => {
  const packet =
    "MEMBER: Ada\nTrophies: 10,040\nbest_win.opponent.name: Jotaro\nseason 135 week 4";
  assert.deepEqual(
    inventedNumbers("Ada hit 10,040 in S135 week 4!", packet),
    [],
  );
  assert.deepEqual(inventedNumbers("Ada hit 10,400!", packet), [10400]);
  assert.deepEqual(
    unknownNames(
      "Huge week. Ada beat Jotaro on Monday in the Colosseum.",
      packet,
    ),
    [],
  );
  assert.deepEqual(unknownNames("Ada beat Jotarro and Kenji.", packet), [
    "Jotarro",
    "Kenji",
  ]);
  assert.deepEqual(
    namesInFacts(
      {
        name: "Ada",
        arena: { name: "Arena 7" },
        best_win: { opponent: { name: "Jo" } },
      },
      { people: true },
    ),
    ["Ada", "Jo"],
  );
  assert.deepEqual(namesInFacts({ name: "Ada", arena_name: "Arena 7" }), [
    "Ada",
    "Arena 7",
  ]);
});

test("a strict tool: closed objects, every field required, the limits strict mode refuses left out", () => {
  const tool = strictTool({
    name: "t",
    description: "d",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 24 },
        list: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            properties: { a: { type: "integer", minimum: 0 } },
          },
        },
      },
      required: ["title"],
    },
  });
  assert.equal(tool.strict, true);
  assert.deepEqual(tool.input_schema, {
    type: "object",
    properties: {
      title: { type: "string" },
      list: {
        type: "array",
        items: {
          type: "object",
          properties: { a: { type: "integer" } },
          additionalProperties: false,
          required: ["a"],
        },
      },
    },
    required: ["title", "list"],
    additionalProperties: false,
  });
});
