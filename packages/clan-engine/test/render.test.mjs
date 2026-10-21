import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/evaluate.mjs";
import {
  cardFacts,
  cardRationale,
  participationPhrase,
  standingForMembers,
  nextSteps,
  judgmentReasons,
  describePolicy,
  inGameCopy,
  REMOVAL_UNSEEN,
} from "../src/render.mjs";
import { defaults } from "../src/policy.mjs";
import { member, participation, NOW, EXAMPLE_POLICY } from "./fixture.mjs";

const policy = EXAMPLE_POLICY;

test("removal evidence explanations have one terminal period", () => {
  const p = participation([member("#QUIET", { lastBattleDaysAgo: 20 })]);
  p.members[0].activity_evidence = { unavailable: true, observations: [] };
  const v = evaluate({ participation: p, policy, now: NOW });
  const reasons = judgmentReasons(v.members[0], v.boundaries, policy);
  assert.ok(
    reasons.some(
      (r) =>
        r ===
        "Removal held: Elixir could not read the member's activity just now.",
    ),
  );
  assert.ok(reasons.every((r) => !r.endsWith("..")));
});

test("held and unknown judgments explain the missing evidence without changing the verdict", () => {
  const p = participation([
    member("#UNKNOWN", { tenureKnown: false }),
    member("#WAR", { war: [null, null, null, null, null, null] }),
    member("#ELDER", {
      role: "elder",
      war: [null, null, null, null, null, null],
    }),
    {
      ...member("#ANCHOR", { lastBattleDaysAgo: null }),
      joined_observed_at: null,
    },
  ]);
  const v = evaluate({ participation: p, policy, now: NOW });
  const reasons = (tag) =>
    judgmentReasons(
      v.members.find((m) => m.player_tag === tag),
      v.boundaries,
      policy,
    );
  assert.deepEqual(reasons("#UNKNOWN"), [
    "Promotion: tenure unknown because the join predates the record.",
  ]);
  assert.deepEqual(reasons("#WAR"), [
    "Promotion held: war record incomplete in the review window.",
  ]);
  assert.deepEqual(reasons("#ELDER"), [
    "Promotion held: war record incomplete in the review window.",
    "Demotion held: war record incomplete in the review window.",
  ]);
  assert.deepEqual(reasons("#ANCHOR"), [
    "Removal held: There is no recorded battle or join to start the clock from.",
  ]);
  const noReviews = evaluate({
    participation: participation([member("#NEW")], { war_weeks: [] }),
    policy,
    now: NOW,
  });
  assert.deepEqual(
    judgmentReasons(noReviews.members[0], noReviews.boundaries, policy),
    ["Promotion held: no closed weekly review yet."],
  );
  for (const m of v.members) {
    for (const [dimension, status] of Object.entries(m.judgment)) {
      if (status === "held" || status === "unknown")
        assert.equal(m.actionable[dimension], false);
    }
  }
  const ready = evaluate({
    participation: participation([member("#READY")]),
    policy,
    now: NOW,
  });
  assert.deepEqual(
    judgmentReasons(ready.members[0], ready.boundaries, policy),
    [],
  );

  const unrecorded = evaluate({
    participation: participation([
      { ...member("#UNRECORDED"), log_recorded: false },
    ]),
    policy,
    now: NOW,
  });
  assert.deepEqual(
    judgmentReasons(unrecorded.members[0], unrecorded.boundaries, policy),
    [
      "Promotion held: battle log is not recorded, so standing cannot be judged.",
    ],
  );
});

test("the member phrase carries no score, percentile, rank or slot count", () => {
  const v = evaluate({
    participation: participation([
      member("#A", { ranked: [3, 3, 3, 3, 3, 0] }),
      member("#B"),
    ]),
    policy,
    now: NOW,
  });
  const phrase = participationPhrase(v.members[0], policy);
  assert.match(phrase, /war decks over 4 war weeks/);
  assert.match(phrase, /12 ranked battles/);
  assert.match(phrase, /~200 donations a week/);
  const banned = /\b(score|percentile|rank|slots?|median|competitive)\b/i;
  assert.ok(!banned.test(phrase), phrase);
  const rows = standingForMembers(v, policy);
  assert.ok(!banned.test(JSON.stringify(rows)));
  // A category the clan does not count is never mentioned.
  const donationsOnly = {
    ...policy,
    war_enabled: false,
    ranked_enabled: false,
  };
  assert.equal(
    participationPhrase(v.members[0], donationsOnly),
    "~200 donations a week",
  );
});

test("card facts state windows and fidelity; an unknown is said, never zeroed", () => {
  const p = participation([
    member("#A", { tenureKnown: false, tenureDays: 9 }),
  ]);
  const v = evaluate({ participation: p, policy, now: NOW });
  const facts = cardFacts(v.members[0], policy);
  const tenure = facts.find((f) => f.key === "tenure");
  assert.match(tenure.value, /at least 9 days/);
  assert.equal(tenure.fidelity, "unknown");
  assert.equal(facts.find((f) => f.key === "war").window, "last 4 war weeks");
});

test("an eligible removal card says what it rests on and what it cannot see (#532)", () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const idle = member("#X", { lastBattleDaysAgo: 20, war: [0, 0, 0, 0, 0, 0] });
  idle.last_battle_mode_group = "ranked";
  idle.last_battle_game_mode = "Ranked1v1_NewArena";
  const v = evaluate({
    participation: participation([...others, idle]),
    policy,
    now: NOW,
  });
  const m = v.members.find((x) => x.player_tag === "#X");
  assert.equal(m.actionable.removal, true);
  const row = cardFacts(m, policy, "removal").at(-1);
  assert.equal(row.key, "rests_on");
  assert.equal(row.label, "Rests on");
  assert.equal(
    row.value,
    "Last recorded battle 2026-08-23 20:00 UTC, Path of Legends; joined 2026-05-15; battle count rose by 1 between 2026-05-14 20:00 UTC and 2026-08-23 20:00 UTC, not since (last read 2026-09-12 20:00 UTC)",
  );
  assert.deepEqual(row.last_battle, {
    at: "2026-08-23T20:00:00.000Z",
    mode_group: "ranked",
    game_mode: "Ranked1v1_NewArena",
  });
  assert.deepEqual(row.joined, { at: "2026-05-15T20:00:00.000Z", known: true });
  assert.equal(row.counter.reads, 3);
  assert.equal(row.counter.rise.counter_increase, 1);
  assert.equal(
    row.note,
    "Modes the battle log does not carry are not seen, so the leader weighs it.",
  );
  assert.equal(row.note, REMOVAL_UNSEEN);
  // A promotion or demotion card has no such row.
  assert.ok(!cardFacts(m, policy).some((f) => f.key === "rests_on"));
  assert.ok(
    !cardFacts(m, policy, "demotion").some((f) => f.key === "rests_on"),
  );
});

test("a removal with no recorded battle says so, and runs from the join", () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const never = member("#N", {
    lastBattleDaysAgo: null,
    tenureDays: 30,
    war: [0, 0, 0, 0, 0, 0],
  });
  const v = evaluate({
    participation: participation([...others, never]),
    policy,
    now: NOW,
  });
  const m = v.members.find((x) => x.player_tag === "#N");
  assert.equal(m.actionable.removal, true);
  const row = cardFacts(m, policy, "removal").at(-1);
  assert.equal(
    row.value,
    "No battle recorded; joined 2026-08-13; battle count did not rise across 2 reads from 2026-08-12 20:00 UTC to 2026-09-12 20:00 UTC",
  );
  assert.equal(row.last_battle, null);
  assert.equal(row.fidelity, "unknown");
  assert.equal(row.counter.rise, null);
  // A join that predates the record, a mode the record does not group,
  // and no profile reads at all are each said, never guessed.
  never.tenure_known = false;
  never.last_battle_time = "2026-08-01T09:30:00.000Z";
  never.last_battle_game_mode = "Some_New_Mode";
  never.activity_evidence = { current_member: true, observations: [] };
  const w = evaluate({
    participation: participation([...others, never]),
    policy,
    now: NOW,
  });
  assert.equal(
    cardFacts(
      w.members.find((x) => x.player_tag === "#N"),
      policy,
      "removal",
    ).at(-1).value,
    "Last recorded battle 2026-08-01 09:30 UTC, Some_New_Mode; in the clan before recording began, first seen 2026-08-13; battle count never read",
  );
  // A later read lower than an earlier one is not called unchanged: only
  // a rise is play, so the row says the count did not rise (Codex, #551).
  never.activity_evidence = {
    current_member: true,
    observations: [
      { profile_observed_at: "2026-09-01T00:00:00.000Z", battle_count: 5 },
      { profile_observed_at: "2026-09-10T00:00:00.000Z", battle_count: 3 },
    ],
  };
  const lower = evaluate({
    participation: participation([...others, never]),
    policy,
    now: NOW,
  });
  assert.match(
    cardFacts(
      lower.members.find((x) => x.player_tag === "#N"),
      policy,
      "removal",
    ).at(-1).value,
    /; battle count did not rise across 2 reads from 2026-09-01 00:00 UTC to 2026-09-10 00:00 UTC$/,
  );
});

test("rationales name the policy clauses that fired", () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const idle = member("#X", { lastBattleDaysAgo: 20, war: [0, 0, 0, 0, 0, 0] });
  const v = evaluate({
    participation: participation([...others, idle]),
    policy,
    now: NOW,
  });
  const m = v.members.find((x) => x.player_tag === "#X");
  const r = cardRationale("removal", m, policy, v);
  assert.equal(
    r.headline,
    "20 days without a battle: at risk at 5, an action at 8.",
  );
  assert.deepEqual(r.clauses, ["at_risk_days", "confirm_days"]);
});

test("next steps tell a member the one or two things that would move them", () => {
  const p = participation([
    member("#A", {
      tenureDays: 10,
      war: [0, 0, 0, 0, 0, 0],
      donations: [10, 10, 10, 10, 10, 0],
    }),
  ]);
  const v = evaluate({ participation: p, policy, now: NOW });
  const steps = nextSteps(v.members[0], policy);
  assert.equal(steps.length, 2);
  assert.match(steps[0], /18 more days/);
  assert.equal(
    steps[1],
    "Meet the minimums: 1 war deck or 5 ranked battles in 2 weeks.",
  );
  // Advice follows what the clan counts: a donations clan hears nothing
  // about war.
  const donationsClan = {
    ...defaults(),
    donations_enabled: true,
    elder_mode: "categories",
    elder_weight_donations: 1,
    tenure_min_days: 0,
  };
  const d = evaluate({
    participation: participation([
      member("#LOW", { donations: [5, 5, 5, 5, 5, 0] }),
      member("#HIGH", { donations: [500, 500, 500, 500, 500, 0] }),
    ]),
    policy: donationsClan,
    now: NOW,
  });
  const low = nextSteps(
    d.members.find((m) => m.player_tag === "#LOW"),
    donationsClan,
  );
  assert.deepEqual(low, [
    "Donate every week: the average over 4 weeks counts, not one big week.",
  ]);
  assert.deepEqual(
    nextSteps(d.members[0], { ...donationsClan, elder_mode: "manual" }),
    [],
  );
});

test("how it works here is written from the policy, and leaves out what the clan does not do", () => {
  const all = describePolicy(policy);
  const text = JSON.stringify(all);
  // What the clan is for opens it: the categories it counts are its goals.
  assert.deepEqual(
    all.map((s) => s.key),
    ["about", "counts", "minimums", "elder", "removal"],
  );
  assert.match(all[0].lines[0], /^This clan is about Clan Wars/);
  assert.match(text, /Clan Wars 55%/);
  assert.match(text, /Donations 30%/);
  assert.match(
    text,
    /Any one of: 1 war deck or 5 ranked battles, over 2 weeks/,
  );
  assert.match(
    text,
    /A member with no battle for 5 days is at risk; at 8 days without one the leaders decide on removal/,
  );
  assert.match(text, /Elders are not removed for inactivity/);
  assert.doesNotMatch(text, /percentile|median|margin|score|slot/i);
  // A clan that only lets leaders choose Elders, counts nothing and does
  // not track inactivity is described in one line.
  assert.deepEqual(describePolicy(defaults()), [
    { key: "elder", title: "Elder", lines: ["Leaders choose Elders."] },
  ]);
});

test("in-game copy is plain, filter-safe, and names nobody's rules", () => {
  const lines = ["promotion", "demotion", "removal", "welcome", "farewell"].map(
    (k) => inGameCopy(k, { name: "A&B +5", days_idle: 9, phrase: "war +12" }),
  );
  for (const l of lines) {
    assert.ok(l.length <= 200);
    assert.doesNotMatch(l, /&|\+\d/);
    assert.doesNotMatch(l, /war days|donate|how Elder works/i);
  }
});

test("Elixir's own demotion message says Elder can come back and never hints why", async () => {
  const { leaderMessage } = await import("../src/render.mjs");
  const m = leaderMessage("demotion", { name: "Ada" });
  assert.equal(m.title, "Elder update");
  assert.equal(
    m.body,
    "Ada moves from Elder back to Member for now, and Elder can come back.",
  );
  assert.doesNotMatch(m.body, /keep playing|lately|quiet|inactiv|active/i);
});

test("a Clan Leader Message fits the game: a title of 24 and a message of 180, filter-safe", async () => {
  const { leaderMessage, LEADER_MESSAGE } = await import("../src/render.mjs");
  assert.deepEqual(LEADER_MESSAGE, { title: 24, body: 180 });
  const long = "N".repeat(40);
  const winners = Array.from({ length: 30 }, (_, i) => `Player${i}`);
  const all = [
    leaderMessage("promotion", { name: long, phrase: "x ".repeat(200) }),
    leaderMessage("demotion", { name: "A&B +5" }),
    leaderMessage("awards", {
      season_id: 1234,
      awards: [
        { name: "Season Champion", winners: winners.slice(0, 3) },
        { name: "Ever Present", winners },
        { name: "Top Donor", winners: winners.slice(3, 6) },
      ],
    }),
    leaderMessage("rules", { first: true, goals: "Clan Wars and donations" }),
    leaderMessage("rules", {
      changes: Array.from({ length: 30 }, (_, i) => `Setting ${i}`),
    }),
  ];
  for (const m of all) {
    assert.ok(m.title.length <= 24, m.title);
    assert.ok(m.body.length <= 180, m.body);
    assert.doesNotMatch(`${m.title} ${m.body}`, /&|\+\d/);
  }
  assert.match(all[1].body, /^A and B 5 moves from Elder/);
  assert.match(all[2].body, /and \d+ more\.$|Well played!$/);
  assert.equal(all[3].title, "How our clan runs");
  assert.match(
    all[4].body,
    /and \d+ more\. See How it works here|See How it works here/,
  );
  assert.equal(leaderMessage("nonsense", {}), null);
});

test("invite lines fit clan chat, carry no link and name the clan", async () => {
  const { inviteCopy } = await import("../src/render.mjs");
  for (const kind of ["leaders", "clanmates"]) {
    const line = inviteCopy(kind, { clanName: "Kings & Queens +1" });
    assert.ok(line.length <= 200);
    assert.doesNotMatch(line, /https?:|&|\+\d/);
    assert.match(line, /Kings and Queens/);
  }
  assert.match(inviteCopy("clanmates"), /our clan/);
  assert.equal(inviteCopy("nonsense"), null);
});
