import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatMessageFromDraft,
  chatMessageRequest,
  leaderMessageFromDraft,
  leaderMessageRequest,
  MODEL_PREFERENCE,
  NOTE_MAX,
  PURPOSES,
  chooseModel,
  pitchFromDraft,
  pitchRequest,
} from "../src/words.mjs";
import { PITCH_FIELDS } from "../src/recruit.mjs";
import { describePolicy } from "../src/render.mjs";
import { policyFromGoals } from "../src/goals.mjs";

const FACTS = {
  name: "Example Clan",
  type: "open",
  members: 41,
  open_slots: 9,
  required_trophies: 6000,
  clan_score: 70000,
  war_trophies: 2500,
  donations_per_week: 9100,
  location: "International",
  description: "Friendly",
  top_trophies: [{ name: "Topplayer", value: 9000 }],
  top_donors: [{ name: "Givername", value: 800 }],
};

test("a model writes words for a closed list of uses, none a judgment about a member", () => {
  assert.deepEqual(Object.keys(PURPOSES), [
    "recruit_pitch",
    "leader_message",
    "clan_chat",
  ]);
  assert.doesNotMatch(
    JSON.stringify(PURPOSES),
    /judge|score|rank|remove|kick|recommend/i,
  );
});

test("chat drafts carry clan voice and a fixed purpose, never evidence for a judgment", () => {
  for (const kind of ["welcome", "removal"]) {
    const r = chatMessageRequest({
      kind,
      clanName: "Example Clan",
      voice: { tagline: "Play together" },
      goals: ["war"],
      note: "warm",
    });
    assert.equal(r.purpose, "clan_chat");
    assert.equal(r.max_tokens, 250);
    assert.equal(r.tool.name, "write_chat_message");
    assert.match(r.prompt, /Play together/);
    assert.match(r.prompt, /Warm and brief/);
    assert.match(r.system, /Never judge a member/);
    if (kind === "removal")
      assert.match(r.prompt, /only AFTER a leader decides/);
  }
  assert.throws(() =>
    chatMessageRequest({ kind: "welcome", note: "Secretname idle 999 days" }),
  );
  assert.throws(() => chatMessageRequest({ kind: "departure" }));
  assert.throws(() => chatMessageFromDraft({}, { kind: "departure" }));
});

test("chat drafts restore names locally, keep game limits, and flag scoring language", () => {
  const welcome = chatMessageFromDraft(
    { line: "Welcome, {name} & friends!" },
    { kind: "welcome", name: "Ab-Cdef" },
  );
  assert.equal(welcome.line, "Welcome, Ab Cdef and friends!");
  assert.deepEqual(welcome.warnings, []);
  const long = chatMessageFromDraft(
    { line: "Welcome to the clan. ".repeat(30) },
    { kind: "welcome", name: "Newcomer" },
  );
  assert.ok(long.line.length <= 120);
  assert.match(long.line, /Newcomer/);
  const removal = chatMessageFromDraft(
    { line: "{name} had score 0.5." },
    { kind: "removal", name: "Member" },
  );
  assert.ok(removal.warnings.some((w) => /score/.test(w)));
  assert.match(
    chatMessageFromDraft({}, { kind: "removal", name: "Member" }).line,
    /Welcome back/,
  );
});

test("welcome prompts preserve frozen approved facts and provenance, never arbitrary evidence", () => {
  const stamp = "2026-09-24T12:00:00Z";
  for (const [welcome, expected] of [
    [{ returning: true, source_as_of: stamp }, /recorded return/],
    [
      { kind: "career_wins", value: 12456, source_as_of: stamp },
      /12,000\+ career wins/,
    ],
    [
      { kind: "best_trophies", value: 9000, source_as_of: stamp },
      /Recorded best: 9,000 trophies/,
    ],
  ]) {
    const frozen = {
      ...welcome,
      fact: "Secretname #8QCV private note score 0.1234",
      private_note: "hidden",
    };
    const request = chatMessageRequest({ kind: "welcome", welcome: frozen });
    assert.match(request.prompt, expected);
    assert.match(request.prompt, /2026-09-24T12:00:00.000Z/);
    assert.match(
      request.prompt,
      /not claim it is current, newly achieved or a recent milestone/,
    );
    assert.doesNotMatch(
      JSON.stringify(request),
      /Secretname|8QCV|private note|hidden|0\.1234|12456/,
    );
    assert.deepEqual(frozen, {
      ...welcome,
      fact: "Secretname #8QCV private note score 0.1234",
      private_note: "hidden",
    });
  }
  for (const welcome of [
    null,
    { fact: "Unsupported private text" },
    { kind: "career_wins", value: 999, source_as_of: stamp },
    { kind: "best_trophies", value: -1, source_as_of: stamp },
    { kind: "best_trophies", value: 9000, source_as_of: "Secretname" },
    { kind: "score", value: 9000, source_as_of: stamp },
  ]) {
    const request = chatMessageRequest({ kind: "welcome", welcome });
    assert.doesNotMatch(
      request.prompt,
      /Frozen context|Unsupported private text|Secretname|9,000/,
    );
  }
  assert.match(
    chatMessageFromDraft(
      {},
      { kind: "welcome", name: "Newcomer", welcome: { returning: true } },
    ).line,
    /Welcome back, Newcomer/,
  );
  assert.match(
    chatMessageFromDraft(
      {},
      {
        kind: "welcome",
        name: "Newcomer",
        welcome: { kind: "career_wins", value: 12456, source_as_of: stamp },
      },
    ).line,
    /12,000\+ career wins/,
  );
});

test("departure prompts trust explicit confirmation, preserve observation uncertainty and omit private rationale", () => {
  for (const classification of ["member_left", "member_kicked"]) {
    const departure = {
      classification,
      confirmed_at: "2026-09-25T12:00:00Z",
      observed_left_at: "2026-09-24T12:00:00Z",
      tenure_days: 38,
      days_idle: 999,
      removal_state: "recommended",
      phrase: "Secretname Private evidence",
      decision_note: "Private reason",
    };
    const request = chatMessageRequest({ kind: "departure", departure });
    assert.match(
      request.prompt,
      /explicit leader confirmation at 2026-09-25T12:00:00.000Z/,
    );
    assert.match(request.prompt, /observed at 2026-09-24T12:00:00.000Z/);
    assert.match(request.prompt, /recorded tenure 38 days/);
    assert.match(request.prompt, /metric observation time is not stored/);
    assert.match(request.prompt, /raw roster observation did not distinguish/);
    assert.match(
      request.prompt,
      classification === "member_left"
        ? /member left.*friendly farewell/
        : /member was kicked.*respectful departure/,
    );
    assert.doesNotMatch(
      JSON.stringify(request),
      /999|recommended|Secretname|Private evidence|Private reason/,
    );
    const output = chatMessageFromDraft(
      {},
      { kind: "departure", name: "Member", departure },
    );
    assert.doesNotMatch(output.line, /inactivity|kicked|removed/);
    assert.ok(output.line.length <= 200);
  }
  for (const departure of [
    null,
    { classification: "member_left" },
    { classification: "ignored", confirmed_at: "2026-09-25T12:00:00Z" },
  ])
    assert.throws(
      () => chatMessageRequest({ kind: "departure", departure }),
      /not confirmed/,
    );
  const missing = chatMessageRequest({
    kind: "departure",
    departure: {
      classification: "member_left",
      confirmed_at: "2026-09-25T12:00:00Z",
    },
  });
  assert.match(missing.prompt, /observation time is unknown/);
  assert.doesNotMatch(missing.prompt, /recorded tenure/);
});

test("the default model is the first preferred one the key reaches", () => {
  assert.deepEqual(MODEL_PREFERENCE, [
    "claude-sonnet-5",
    "claude-opus-5-5",
    "claude-haiku-5-5",
  ]);
  assert.equal(
    chooseModel(["claude-haiku-5-5", "claude-sonnet-5"]),
    "claude-sonnet-5",
  );
  assert.equal(
    chooseModel(["claude-haiku-5-5", "claude-opus-5-5"]),
    "claude-opus-5-5",
  );
  // A key that reaches neither Sonnet 5 nor Opus 5.5 gets Haiku 5.5, not
  // the Haiku 4.5 it also lists.
  assert.equal(
    chooseModel(["claude-haiku-4-5-20251001", "claude-haiku-5-5"]),
    "claude-haiku-5-5",
  );
  assert.equal(chooseModel(["claude-haiku-5-5"]), MODEL_PREFERENCE[2]);
  // Haiku 4.5 is no longer preferred, but a key that reaches only it still
  // gets a model.
  assert.equal(
    chooseModel(["claude-haiku-4-5-20251001"]),
    "claude-haiku-4-5-20251001",
  );
  assert.equal(chooseModel(["claude-new-thing"]), "claude-new-thing");
  assert.equal(chooseModel(["gpt-x"]), null);
  assert.equal(chooseModel([]), null);
});

test("a pitch request carries the clan's facts, goals, rules, words and note, and never a member", () => {
  const policy = policyFromGoals(["war"], "strict");
  const r = pitchRequest({
    clanName: "Example Clan",
    facts: FACTS,
    goals: ["war"],
    posture: "strict",
    howItWorks: describePolicy(policy),
    pitch: {
      tagline: "Old tagline",
      about: "Old about.",
      points: ["Old point"],
      looking_for: "Old look.",
    },
    note: `in Spanish ${"x".repeat(400)}`,
  });
  assert.equal(r.purpose, "recruit_pitch");
  assert.equal(r.tool.name, "write_pitch");
  assert.ok(r.max_tokens > 0 && r.max_tokens <= 2000);
  assert.match(r.system, /Never invent a number/);
  assert.match(r.system, /Never name a member/);
  assert.match(r.prompt, /Joining: open/);
  assert.match(r.prompt, /Required trophies to join: 6,000/);
  assert.match(r.prompt, /Clan Wars: We fight the River Race together/);
  assert.match(r.prompt, /How hard it asks: Every week counts/);
  assert.match(r.prompt, /How it runs \(its saved policy\)/);
  assert.match(r.prompt, /Tagline: Old tagline/);
  assert.match(r.prompt, /The leader's note: in Spanish/);
  assert.doesNotMatch(r.prompt, /Topplayer|Givername/);
  const note = r.prompt.split("The leader's note: ")[1];
  assert.ok(note.length <= NOTE_MAX);
  // A first pitch for a clan with nothing saved still asks well.
  const bare = pitchRequest({ facts: null });
  assert.match(bare.prompt, /a Clash Royale clan/);
});

test("a draft is tidied, clipped to each field, keeps the clan's own website and contact, and flags numbers it was not given", () => {
  const long = "Word ".repeat(200);
  const d = pitchFromDraft(
    {
      tagline: `\`${long}\``,
      about:
        "**We war.** Join at www.example.com today. We have 6,000 trophies.",
      points: Array.from({ length: 9 }, (_, i) => `• Point ${i + 1}`),
      looking_for: "Someone kind, top 100 in the world.",
      website_url: "https://model.invented",
    },
    { website_url: "https://clan.example", contact: "DM a leader" },
    { prompt: "Required trophies to join: 6,000." },
  );
  assert.ok(d.values.tagline.length <= PITCH_FIELDS.tagline.max);
  assert.doesNotMatch(d.values.tagline, /`/);
  assert.equal(
    d.values.about,
    "We war. Join at today. We have 6,000 trophies.",
  );
  assert.equal(d.values.points.length, 6);
  assert.equal(d.values.points[0], "Point 1");
  assert.equal(d.values.website_url, "https://clan.example");
  assert.equal(d.values.contact, "DM a leader");
  assert.deepEqual(d.errors, {});
  assert.equal(d.checks.length, 1);
  assert.match(d.checks[0], /100/);
  assert.doesNotMatch(d.checks[0], /6,000/);
  // A missing answer is an empty draft with the fields it lacks named.
  const empty = pitchFromDraft(null, null);
  assert.ok(empty.errors.tagline && empty.errors.about);
});

test("a Leader Message request never carries a member's name; the model writes placeholders", () => {
  const r = leaderMessageRequest({
    kind: "promotion",
    clanName: "Example Clan",
    voice: { tagline: "Steady wars", about: "We war." },
    goals: ["war"],
    current: { title: "Congrats, new Elder!", body: "{name} is now an Elder." },
  });
  assert.equal(r.purpose, "leader_message");
  assert.match(r.system, /Never write a member's name/);
  assert.match(r.system, /never '&'/);
  assert.match(r.prompt, /Write \{name\}/);
  assert.match(r.prompt, /Tagline: Steady wars/);
  const awards = leaderMessageRequest({
    kind: "awards",
    seasonId: 131,
    awardCount: 2,
  });
  assert.match(awards.prompt, /Season 131 closed/);
  assert.match(awards.prompt, /\{winners\}/);
  assert.throws(() => leaderMessageRequest({ kind: "removal" }));
});

test("a drafted Leader Message gets its names back, the game's filter rules and its limits", () => {
  const promo = leaderMessageFromDraft(
    {
      title: "New Elder & friends",
      body: "Cheers to {name} for every war day +4!",
    },
    { kind: "promotion", name: "Ab-Cd" },
  );
  assert.equal(promo.title, "New Elder and friends");
  assert.equal(promo.body, "Cheers to Ab Cd for every war day 4!");
  assert.deepEqual(promo.warnings, []);
  // A model that forgot the placeholder still names the member.
  const forgot = leaderMessageFromDraft(
    { title: "Elder update", body: "Back to Member for now." },
    { kind: "demotion", name: "Sleepy" },
  );
  assert.match(forgot.body, /^Sleepy: /);
  const awards = leaderMessageFromDraft(
    {
      title: "Season 131 awards are in and they are great",
      body: "Well played! {winners}",
    },
    {
      kind: "awards",
      awards: [
        { name: "Iron Deck", winners: ["Ada", "Ben"] },
        { name: "Top Donor", winners: ["Cy"] },
      ],
    },
  );
  assert.ok(awards.title.length <= 24, awards.title);
  assert.equal(awards.body, "Well played! Iron Deck: Ada, Ben; Top Donor: Cy.");
  const ranked = leaderMessageFromDraft(
    { title: "Rules", body: "You rank 5 of 39 now." },
    { kind: "rules" },
  );
  assert.ok(ranked.warnings.some((w) => /score, rank or band/.test(w)));
});

test("award drafts reserve space for every recipient, including a full-size segment", () => {
  for (const length of [150, 170]) {
    const name = "x".repeat(length);
    const result = leaderMessageFromDraft(
      {
        title: "Awards",
        body: "A celebratory introduction ".repeat(20) + "{winners}",
      },
      { kind: "awards", awards: [{ name: "Cup", winners: [name, "Ben"] }] },
    );
    assert.ok(result.body.length <= 180);
    assert.ok(result.body.includes(name));
    assert.ok(result.body.includes("Ben"));
    assert.doesNotMatch(result.body, /more/);
  }
  assert.throws(
    () =>
      leaderMessageFromDraft(
        {},
        {
          kind: "awards",
          awards: [{ name: "Cup", winners: ["x".repeat(181)] }],
        },
      ),
    RangeError,
  );
});
