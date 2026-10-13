/**
 * `follow` (11.9.0): every address an item names is a tool in the
 * registry, called with arguments its own input schema accepts, built
 * from the item alone. A synthetic item of every kind the timeline
 * serves; no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { followFor, forCaller } from "../src/activity/follow.mjs";
import { TIMELINE_KIND_SCHEMAS } from "../src/activity/schemas.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { validateArgs } from "../src/validate.mjs";

const PLAYER = "#2PYLQ0";
const CLAN = "#2PYLQJ";
const RIVAL = "#2PYLQ2";
const WINDOW = {
  from: "2026-10-10T05:00:00.000Z",
  to: "2026-10-11T05:00:00.000Z",
  basis: "occurred",
};
const declarations = new Map(
  makeRegistry()
    .declarations()
    .map((d) => [d.name, d]),
);

// A plausible value for each facts key an item of a kind carries.
const VALUES = {
  player_tag: PLAYER,
  name: "Example Pilot",
  started_at: "2026-10-10T14:00:00.000Z",
  ended_at: "2026-10-10T14:21:00.000Z",
  promoted_by: {
    battle_id: "example-battle",
    battle_time: "2026-10-10T14:21:00.000Z",
  },
  crossed_by: {
    battle_id: "example-battle",
    battle_time: "2026-10-10T14:21:00.000Z",
  },
  best_win: {
    battle_id: "example-battle",
    battle_time: "2026-10-10T14:21:00.000Z",
  },
  teammate: { player_tag: "#2PYLQ8", name: "Example Mate", battles: 3 },
  card_id: 26000011,
  clan_tag: CLAN,
  season_id: 136,
  section_index: 1,
  rivals: [{ tag: RIVAL, name: "Example Rival" }],
  // The answer's item names its feedback item as the ledger holds it.
  feedback_id: 9001,
};
const CLAN_KINDS = new Set([
  "member_joined",
  "member_left",
  "member_role_changed",
  "bracket_observed",
  "race_finished",
  "week_resolved",
]);

function itemOf(kind, schema) {
  const facts = {};
  for (const k of [...schema.facts, ...(schema.optional ?? [])])
    facts[k] = VALUES[k] ?? null;
  const clanItem = CLAN_KINDS.has(kind);
  return {
    // A story id as the timeline mints them: tl_ and 20 hex digits.
    id: `tl_${Buffer.from(kind).toString("hex").padEnd(20, "0").slice(0, 20)}`,
    kind,
    section: schema.at.includes("attested") ? "attested" : "activity",
    subject_tag: clanItem ? CLAN : PLAYER,
    subjects: clanItem
      ? [{ tag: CLAN, kind: "clan" }]
      : [{ tag: PLAYER, kind: "player" }],
    evidence: { status: "proved", version: "v1" },
    facts,
  };
}

test("every follow address is a registered tool called with arguments its schema accepts", () => {
  for (const [kind, schema] of Object.entries(TIMELINE_KIND_SCHEMAS)) {
    const item = itemOf(kind, schema);
    for (const { tool, args } of followFor(item, WINDOW)) {
      const d = declarations.get(tool);
      assert.ok(d, `${kind}: ${tool} is a registered tool`);
      assert.equal(
        validateArgs(d.inputSchema, args),
        null,
        `${kind}: ${tool} accepts ${JSON.stringify(args)}`,
      );
      for (const req of d.inputSchema.required ?? [])
        assert.ok(req in args, `${kind}: ${tool} gets its required ${req}`);
    }
  }
});

test("every game story leads somewhere; the account's administration leads nowhere", () => {
  for (const [kind, schema] of Object.entries(TIMELINE_KIND_SCHEMAS)) {
    const follow = followFor(itemOf(kind, schema), WINDOW);
    if (kind === "account") assert.deepEqual(follow, [], "account");
    else if (!schema.at.includes("attested"))
      assert.ok(follow.length > 0, `${kind} names at least one read`);
  }
});

test("an answer to feedback leads to the item whole, by its id as the tool takes it (#536)", () => {
  const item = itemOf(
    "account_feedback_responded",
    TIMELINE_KIND_SCHEMAS.account_feedback_responded,
  );
  assert.deepEqual(followFor({ ...item, section: "account" }, WINDOW), [
    { tool: "elixir_my_feedback", args: { feedback_id: "9001" } },
  ]);
  // An event that names no item leads nowhere, like the rest of the
  // account's own administration.
  assert.deepEqual(
    followFor(
      {
        ...item,
        section: "account",
        facts: { ...item.facts, feedback_id: null },
      },
      WINDOW,
    ),
    [],
  );
});

test("a sitting leads to its own evidence, from the window that served it, to its span and to its best win", () => {
  const item = itemOf(
    "session_standout",
    TIMELINE_KIND_SCHEMAS.session_standout,
  );
  const [evidence, span, best] = followFor(item, WINDOW);
  assert.deepEqual(best, {
    tool: "battles_query",
    args: { player_tag: PLAYER, battle_id: "example-battle" },
  });
  assert.deepEqual(evidence, {
    tool: "elixir_timeline",
    args: { evidence_item_id: item.id, ...WINDOW },
  });
  assert.deepEqual(span, {
    tool: "battles_performance",
    args: {
      player_tag: PLAYER,
      from: "2026-10-10T14:00:00.000Z",
      to: "2026-10-10T14:21:01.000Z",
    },
  });
});

test("a player's own clan move names no roster read; a clan feed's move does", () => {
  const tools = (kind) =>
    followFor(itemOf(kind, TIMELINE_KIND_SCHEMAS[kind]), WINDOW).map(
      (x) => x.tool,
    );
  assert.deepEqual(tools("clan_joined"), ["players_summary"]);
  assert.deepEqual(tools("clan_left"), ["players_summary"]);
  assert.deepEqual(tools("member_joined"), ["players_summary", "clans_roster"]);
});

test("a read the caller may not make is no address for it", () => {
  const item = itemOf(
    "ranked_promotion",
    TIMELINE_KIND_SCHEMAS.ranked_promotion,
  );
  const all = followFor(item, WINDOW);
  assert.deepEqual(
    forCaller(all, (tool) => tool !== "battles_query").map((x) => x.tool),
    ["players_summary"],
  );
});
