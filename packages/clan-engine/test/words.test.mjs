import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatMessageFromDraft,
  chatMessageRequest,
  leaderMessageFromDraft,
  leaderMessageRequest,
  MODEL_FOR,
  NOTE_MAX,
  PURPOSES,
  modelFor,
  modelName,
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

const CONTEXT = "THE CLAN\nName: Example Clan\nIts tagline: Play together";
const PACKET =
  "WHAT HAPPENED\nA new member joined the clan.\n\nMEMBER: Secretname\nBest trophies: 9,000";

test("a model writes words for a closed list of uses, none a judgment about a member", () => {
  assert.deepEqual(Object.keys(PURPOSES), [
    "recruit_pitch",
    "leader_message",
    "clan_chat",
    "discord_activity",
  ]);
  assert.doesNotMatch(
    JSON.stringify(PURPOSES),
    /judge|score|rank|remove|kick|recommend/i,
  );
});

test("chat drafts carry the clan as a cached prefix, the moment as the packet, a tone, medium effort and a strict tool", () => {
  for (const kind of ["welcome", "removal"]) {
    const r = chatMessageRequest({
      kind,
      context: CONTEXT,
      packet: PACKET,
      tone: "warm",
    });
    assert.equal(r.purpose, "clan_chat");
    assert.equal(r.effort, "medium");
    assert.equal(r.max_tokens, 250);
    assert.equal(r.tool.name, "write_chat_message");
    assert.equal(r.tool.strict, true);
    assert.equal(r.tool.input_schema.additionalProperties, false);
    assert.equal(r.context, CONTEXT);
    assert.match(r.prompt, /MEMBER: Secretname/);
    assert.match(r.prompt, /Tone: Warm and brief/);
    assert.match(r.system, /Never judge a member/);
    assert.match(r.system, /never '&'/);
    assert.match(r.system, /write the member's name as it is given/);
    // A chat draft takes a tone, never a note: the prompt names none.
    assert.doesNotMatch(r.system, /note/i);
    assert.doesNotMatch(r.prompt, /NOTE/);
    if (kind === "removal") {
      assert.match(r.prompt, /only AFTER a leader decides/);
      assert.match(r.prompt, /Never mention numbers about their inactivity/);
    }
  }
  assert.throws(() =>
    chatMessageRequest({ kind: "welcome", tone: "Secretname idle 999 days" }),
  );
  assert.throws(() => chatMessageRequest({ kind: "departure" }));
  assert.throws(() => chatMessageFromDraft({}, { kind: "departure" }));
});

test("chat drafts always name the member, keep game limits, and flag scoring language", () => {
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

test("a welcome's ask follows the Action: back again, or new; its frozen detail still words the plain fallback", () => {
  const stamp = "2026-09-24T12:00:00Z";
  assert.match(
    chatMessageRequest({ kind: "welcome", welcome: { returning: true } })
      .prompt,
    /welcoming this member back/,
  );
  assert.match(
    chatMessageRequest({ kind: "welcome", welcome: null }).prompt,
    /one true detail about them/,
  );
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
  // A name or a number the model was not told is flagged for the leader.
  const told = `${CONTEXT}\n${PACKET}`;
  const checked = chatMessageFromDraft(
    {
      line: "Welcome Secretname, 9,000 trophies! Say hi to Jotaro, 4,400 wins.",
    },
    { kind: "welcome", name: "Secretname", told },
  );
  assert.ok(checked.warnings.some((w) => /4,400 is not in anything/.test(w)));
  assert.ok(checked.warnings.some((w) => /Jotaro is not a name/.test(w)));
  assert.ok(!checked.warnings.some((w) => /9,000/.test(w)));
});

test("departure drafts need a leader's confirmation and ask by its classification; nothing private rides in the request", () => {
  for (const classification of ["member_left", "member_kicked"]) {
    const departure = {
      classification,
      confirmed_at: "2026-09-25T12:00:00Z",
      observed_left_at: "2026-09-24T12:00:00Z",
      tenure_days: 38,
      days_idle: 999,
      removal_state: "recommended",
      phrase: "Private evidence",
      decision_note: "Private reason",
    };
    const request = chatMessageRequest({
      kind: "departure",
      departure,
      context: CONTEXT,
      packet: "WHAT HAPPENED\nMEMBER: Secretname\nTime in the clan: 38 days",
    });
    assert.match(
      request.prompt,
      classification === "member_left"
        ? /left on their own.*friendly clan-chat farewell/
        : /was removed.*respectful.*Never describe it as a voluntary leave/,
    );
    assert.match(request.prompt, /Time in the clan: 38 days/);
    assert.doesNotMatch(
      JSON.stringify(request),
      /999|recommended|Private evidence|Private reason/,
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
});

test("Elixir Clan chooses each use's model: the 5.5 generation, in the purpose's order", () => {
  // Every use has an ordered list, and only of the 5.5 generation (Jamie,
  // 2026-10-11): an older model is never a fallback.
  assert.deepEqual(Object.keys(MODEL_FOR), Object.keys(PURPOSES));
  for (const [purpose, ids] of Object.entries(MODEL_FOR)) {
    assert.ok(ids.length > 0, purpose);
    assert.equal(new Set(ids).size, ids.length, `${purpose}: no repeats`);
    for (const id of ids) assert.match(id, /^claude-[a-z]+-5-5$/, purpose);
  }
  // The leaders' drafts start on Opus 5.5; the unread Discord rewrites on
  // Sonnet 5.5.
  for (const p of ["recruit_pitch", "leader_message", "clan_chat"])
    assert.equal(modelFor(p), "claude-opus-5-5", p);
  assert.equal(modelFor("discord_activity"), "claude-sonnet-5-5");
});

test("a use takes the first of its models the key reaches, and none outside the generation", () => {
  const all = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
  assert.equal(modelFor("leader_message", all), "claude-opus-5-5");
  assert.equal(modelFor("discord_activity", all), "claude-sonnet-5-5");
  // Opus 5.5 out of reach: the drafts take Sonnet 5.5.
  assert.equal(
    modelFor("recruit_pitch", ["claude-haiku-5-5", "claude-sonnet-5-5"]),
    "claude-sonnet-5-5",
  );
  // Sonnet 5.5 out of reach: the rewrites take Opus 5.5, then Haiku 5.5.
  assert.equal(
    modelFor("discord_activity", ["claude-opus-5-5", "claude-haiku-5-5"]),
    "claude-opus-5-5",
  );
  assert.equal(
    modelFor("discord_activity", ["claude-haiku-5-5"]),
    "claude-haiku-5-5",
  );
  // A key that reaches only older models gets none of them.
  assert.equal(
    modelFor("clan_chat", [
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-5",
    ]),
    null,
  );
  // An unknown list (never read, or empty) takes the first.
  assert.equal(
    modelFor("clan_chat", []),
    null,
    "an emptied list is known: it reaches nothing",
  );
  assert.equal(modelFor("clan_chat", null), "claude-opus-5-5");
  assert.equal(modelFor("no_such_use", all), null);
});

test("a model's name reads as people write it", () => {
  assert.equal(modelName("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(modelName("claude-sonnet-5"), "Claude Sonnet 5");
  assert.equal(modelName("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
  assert.equal(modelName("something-else"), "something-else");
  assert.equal(modelName(null), "");
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

test("a Leader Message request carries the clan, the member by name, the leader's note as written and the plain draft", () => {
  const r = leaderMessageRequest({
    kind: "promotion",
    context: CONTEXT,
    packet:
      "WHAT HAPPENED\nThe clan's own rules just made this member an Elder.\n\nMEMBER: Secretname",
    current: {
      title: "Congrats, new Elder!",
      body: "Secretname is now an Elder.",
    },
    note: "Mention the Colosseum week & keep it short",
  });
  assert.equal(r.purpose, "leader_message");
  assert.equal(r.effort, "medium");
  assert.equal(r.tool.strict, true);
  assert.equal(r.context, CONTEXT);
  assert.match(r.system, /Write the member's name as it is given/);
  assert.match(r.system, /Pick the one or two details/);
  assert.match(r.system, /Never list statistics/);
  assert.match(r.system, /never '&'/);
  assert.match(r.system, /from those facts or from the leader's note/);
  assert.doesNotMatch(r.system, /Never write a member's name/);
  assert.match(r.prompt, /MEMBER: Secretname/);
  assert.match(
    r.prompt,
    /ELIXIR'S PLAIN DRAFT[\s\S]*Message: Secretname is now an Elder\./,
  );
  assert.match(
    r.prompt,
    /THE LEADER'S NOTE \(follow it; it may add facts of its own\): Mention the Colosseum week & keep it short/,
  );
  assert.match(
    r.prompt,
    /THE ASK: Write the Leader Message that tells the clan this member is now an Elder/,
  );
  const awards = leaderMessageRequest({
    kind: "awards",
    packet:
      "WHAT HAPPENED\nSeason 131 closed and the clan granted these awards:\n- Cup: Ada (3,100 points)",
  });
  assert.match(awards.prompt, /Season 131 closed/);
  assert.match(awards.prompt, /Cup: Ada \(3,100 points\)/);
  assert.match(awards.system, /\{winners\}/);
  assert.throws(() => leaderMessageRequest({ kind: "removal" }));
});

test("a drafted Leader Message names its member and the full winners list, with the game's filter rules and its limits", () => {
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
  // A draft that leaves the member out still names them.
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
