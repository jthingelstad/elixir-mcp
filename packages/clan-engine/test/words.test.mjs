import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_LINES,
  clanChatFromDraft,
  clanChatRequest,
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
import { ANGLES_HEADING, clanContext, VOICE_RULE } from "../src/context.mjs";
import { editorPreviewRequest, editorRequest } from "../src/editor.mjs";
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

test("chat drafts carry the clan as a cached prefix, the moment as the packet, the plain words as the floor, medium effort and a strict lines tool", () => {
  for (const kind of ["welcome", "removal", "promotion", "demotion"]) {
    const r = clanChatRequest({
      kind,
      context: CONTEXT,
      packet: PACKET,
      plain: { lines: ["Welcome to the clan, Secretname!"] },
      tone: "warm",
    });
    assert.equal(r.purpose, "clan_chat");
    assert.equal(r.effort, "medium");
    assert.equal(r.max_tokens, 600);
    assert.equal(r.tool.name, "write_clan_chat");
    assert.equal(r.tool.strict, true);
    assert.equal(r.tool.input_schema.additionalProperties, false);
    assert.deepEqual(r.tool.input_schema.required, ["lines"]);
    assert.equal(r.tool.input_schema.properties.lines.type, "array");
    assert.equal(r.context, CONTEXT);
    assert.match(r.prompt, /MEMBER: Secretname/);
    assert.match(r.prompt, /Tone: Warm and brief/);
    assert.match(
      r.prompt,
      /ELIXIR'S PLAIN WORDS \(the floor: say at least this, then go further\)\nWelcome to the clan, Secretname!/,
    );
    // The destination is named: the game's clan chat, line by line.
    assert.match(r.system, /clan's chat in the game/);
    assert.match(r.system, /The floor: say at least what they say/i);
    assert.match(r.system, /two to four facts that belong to this person/);
    // The member's dossier and Elixir's angles are named, the angles as
    // where to start, and every number is one the packet states.
    assert.match(r.system, /MEMBER DOSSIER/);
    assert.match(r.system, /starting from the STORY ANGLES/);
    assert.match(r.system, /Every number you write is one the packet states/);
    assert.match(r.system, /Say what a number means/);
    assert.match(r.system, /"by clan rules"/);
    assert.match(r.system, /"better with you in it"/);
    assert.match(r.system, /"keep climbing with us"/);
    assert.match(r.system, /"earned it" without the fact/);
    assert.match(r.system, /Never judge a member: no score, rank, percentile/);
    assert.match(r.system, /never a member's share of fame/);
    assert.match(r.system, /no advice/);
    assert.match(r.system, /never '&'/);
    assert.match(r.system, /never round a number up/);
    assert.match(r.system, /name as it is given/);
    // What the old prompt said, which made drafts say less than the plain words.
    assert.doesNotMatch(
      r.system,
      /one or two details|Never list statistics|No speeches/,
    );
    if (kind === "removal") {
      assert.match(r.system, /You write one line/);
      assert.match(r.system, /within 170 characters/);
      assert.match(r.prompt, /only AFTER a leader decides/);
      assert.match(r.prompt, /Never mention numbers about their inactivity/);
      // The words after a removal take a tone, never a note.
      assert.doesNotMatch(r.system, /note/i);
    } else {
      assert.match(r.system, /each its own chat message/);
      assert.match(r.system, /within 190 characters/);
      assert.match(r.system, /the first names the member/);
    }
  }
  assert.match(clanChatRequest({ kind: "promotion" }).system, /up to 3 lines/);
  for (const kind of ["welcome", "demotion", "departure"])
    assert.equal(CHAT_LINES[kind], 2, kind);
  assert.equal(CHAT_LINES.removal, 1);
  assert.throws(() =>
    clanChatRequest({ kind: "welcome", tone: "Secretname idle 999 days" }),
  );
  assert.throws(() => clanChatRequest({ kind: "awards" }));
  assert.throws(() => clanChatRequest({ kind: "departure" }));
  assert.throws(() => clanChatFromDraft({}, { kind: "departure" }));
});

test("a welcome or a farewell takes the leader's note as written; the words after a removal never do", () => {
  const welcome = clanChatRequest({
    kind: "welcome",
    packet: PACKET,
    note: "Say hi from the war crew & mention Colosseum",
    tone: "warm",
  });
  assert.match(
    welcome.prompt,
    /THE LEADER'S NOTE \(follow it; it may add facts of its own\): Say hi from the war crew & mention Colosseum/,
  );
  assert.match(welcome.system, /from those facts or from the leader's note/);
  assert.throws(
    () => clanChatRequest({ kind: "removal", note: "Say they were lazy" }),
    /never a note/,
  );
  // A blank note is no note.
  assert.doesNotMatch(
    clanChatRequest({ kind: "removal", note: "  " }).prompt,
    /NOTE/,
  );
});

test("chat drafts keep the kind's lines, name the member first, apply the filter's rules per line and clip each to the game's limit", () => {
  const welcome = clanChatFromDraft(
    { lines: ["Welcome, {name} & friends!", "Glad you are here."] },
    { kind: "welcome", name: "Ab-Cdef" },
  );
  assert.deepEqual(welcome.lines, [
    "Welcome, Ab Cdef and friends!",
    "Glad you are here.",
  ]);
  assert.deepEqual(welcome.warnings, []);
  // More lines than the kind takes are dropped; a long one is clipped.
  const long = clanChatFromDraft(
    {
      lines: [
        "Welcome to the clan, Newcomer. ".repeat(10),
        "Second.",
        "Third, never sent.",
      ],
    },
    { kind: "welcome", name: "Newcomer" },
  );
  assert.equal(long.lines.length, 2);
  assert.ok(long.lines[0].length <= 200);
  // A promotion takes three; a removal one.
  assert.equal(
    clanChatFromDraft(
      { lines: ["Ada is an Elder.", "Two.", "Three.", "Four."] },
      { kind: "promotion", name: "Ada" },
    ).lines.length,
    3,
  );
  assert.equal(
    clanChatFromDraft(
      { lines: ["Ada, thanks.", "Two."] },
      { kind: "removal", name: "Ada" },
    ).lines.length,
    1,
  );
  // The first line names the member when the model did not.
  const unnamed = clanChatFromDraft(
    { lines: ["Big news today.", "Ada played every war deck."] },
    { kind: "promotion", name: "Ada" },
  );
  assert.equal(unnamed.lines[0], "Ada: Big news today.");
  // A warning names its line when there are several.
  const scored = clanChatFromDraft(
    { lines: ["Ada is an Elder.", "Ada had score 0.5."] },
    { kind: "promotion", name: "Ada" },
  );
  assert.ok(scored.warnings.some((w) => /^line 2: .*score/.test(w)));
  // An empty answer is the plain words, or the game copy without them.
  assert.deepEqual(
    clanChatFromDraft(
      { lines: [] },
      {
        kind: "promotion",
        name: "Ada",
        plain: { lines: ["Congrats, new Elder! Ada is now an Elder."] },
      },
    ).lines,
    ["Congrats, new Elder! Ada is now an Elder."],
  );
  assert.match(
    clanChatFromDraft({}, { kind: "removal", name: "Member" }).lines[0],
    /Welcome back/,
  );
});

test("a welcome's ask follows the Action: back again, or new; its frozen detail still words the plain fallback", () => {
  const stamp = "2026-09-24T12:00:00Z";
  assert.match(
    clanChatRequest({ kind: "welcome", welcome: { returning: true } }).prompt,
    /Welcome this member back/,
  );
  assert.match(
    clanChatRequest({ kind: "welcome", welcome: null }).prompt,
    /true details about them/,
  );
  assert.match(
    clanChatFromDraft(
      {},
      { kind: "welcome", name: "Newcomer", welcome: { returning: true } },
    ).lines[0],
    /Welcome back, Newcomer/,
  );
  assert.match(
    clanChatFromDraft(
      {},
      {
        kind: "welcome",
        name: "Newcomer",
        welcome: { kind: "career_wins", value: 12456, source_as_of: stamp },
      },
    ).lines[0],
    /12,000\+ career wins/,
  );
  // A name or a number the model was not told is flagged for the leader.
  const told = `${CONTEXT}\n${PACKET}`;
  const checked = clanChatFromDraft(
    {
      lines: [
        "Welcome Secretname, 9,000 trophies!",
        "Say hi to Jotaro, 4,400 wins.",
      ],
    },
    { kind: "welcome", name: "Secretname", told },
  );
  assert.ok(checked.warnings.some((w) => /4,400 is not in anything/.test(w)));
  assert.ok(checked.warnings.some((w) => /Jotaro is not a name/.test(w)));
  assert.ok(!checked.warnings.some((w) => /9,000/.test(w)));
});

test("a draft that says less than Elixir's plain words is flagged, never refused", () => {
  const plain = {
    lines: [
      "Congrats, new Elder! Ada is now an Elder: 48 of 48 war decks (100%), ~150 donations a week.",
    ],
  };
  const thin = clanChatFromDraft(
    { lines: ["Congrats Ada, our new Elder!"] },
    { kind: "promotion", name: "Ada", plain },
  );
  assert.deepEqual(thin.lines, ["Congrats Ada, our new Elder!"]);
  assert.ok(
    thin.warnings.includes(
      "This draft says less of the record than Elixir's plain words: it leaves out 48, 150",
    ),
    thin.warnings.join(" | "),
  );
  // Every number kept (a share said in words is fine) passes.
  const full = clanChatFromDraft(
    {
      lines: [
        "Congrats Ada, our new Elder!",
        "All 48 of 48 war decks played, and about 150 donations a week.",
      ],
    },
    { kind: "promotion", name: "Ada", plain },
  );
  assert.ok(!full.warnings.some((w) => /says less/.test(w)));
  // A plain "12,000+" is met by any number at least that big.
  const welcomePlain = { lines: ["Welcome, Ada! 12,000+ career wins."] };
  assert.ok(
    !clanChatFromDraft(
      { lines: ["Welcome Ada, 12,456 career wins!"] },
      { kind: "welcome", name: "Ada", plain: welcomePlain },
    ).warnings.some((w) => /says less/.test(w)),
  );
  assert.ok(
    clanChatFromDraft(
      { lines: ["Welcome Ada!"] },
      { kind: "welcome", name: "Ada", plain: welcomePlain },
    ).warnings.some((w) => /leaves out 12,000\+/.test(w)),
  );
});

test("a demotion draft that hints at why is flagged", () => {
  for (const line of [
    "Ada has been quiet lately.",
    "Ada missed some war days.",
    "Ada is inactive for now.",
    "Ada was absent this month.",
    "Ada dropped off a bit.",
  ]) {
    const d = clanChatFromDraft(
      { lines: [line] },
      { kind: "demotion", name: "Ada" },
    );
    assert.ok(
      d.warnings.some((w) => /hints at why/.test(w)),
      `${line}: ${d.warnings.join(" | ")}`,
    );
  }
  const kind = clanChatFromDraft(
    {
      lines: [
        "Ada moves back to Member for now; Elder can come back.",
        "Thank you for 214 days with us and your Iron Deck award.",
      ],
    },
    { kind: "demotion", name: "Ada" },
  );
  assert.ok(!kind.warnings.some((w) => /hints at why/.test(w)));
  // A promotion may say "missed" freely: only a demotion is checked.
  assert.ok(
    !clanChatFromDraft(
      { lines: ["Ada never missed a war deck."] },
      { kind: "promotion", name: "Ada" },
    ).warnings.some((w) => /hints at why/.test(w)),
  );
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
    const request = clanChatRequest({
      kind: "departure",
      departure,
      context: CONTEXT,
      packet: "WHAT HAPPENED\nMEMBER: Secretname\nTime in the clan: 38 days",
    });
    assert.match(
      request.prompt,
      classification === "member_left"
        ? /left on their own.*friendly farewell/
        : /was removed.*respectful.*Never describe it as a voluntary leave/,
    );
    assert.match(request.prompt, /Time in the clan: 38 days/);
    assert.doesNotMatch(
      JSON.stringify(request),
      /999|recommended|Private evidence|Private reason/,
    );
    const output = clanChatFromDraft(
      {},
      { kind: "departure", name: "Member", departure },
    );
    assert.doesNotMatch(output.lines.join(" "), /inactivity|kicked|removed/);
    assert.ok(output.lines.every((l) => l.length <= 200));
  }
  for (const departure of [
    null,
    { classification: "member_left" },
    { classification: "ignored", confirmed_at: "2026-09-25T12:00:00Z" },
  ])
    assert.throws(
      () => clanChatRequest({ kind: "departure", departure }),
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

test("a Leader Message request carries the clan, the member by name, the leader's note as written, the plain words as the floor and its destination", () => {
  const r = leaderMessageRequest({
    kind: "promotion",
    context: CONTEXT,
    packet:
      "WHAT HAPPENED\nThe clan's own rules just made this member an Elder.\n\nMEMBER: Secretname",
    plain: {
      title: "Congrats, new Elder!",
      body: "Secretname is now an Elder.",
    },
    note: "Mention the Colosseum week & keep it short",
  });
  assert.equal(r.purpose, "leader_message");
  assert.equal(r.effort, "medium");
  assert.equal(r.tool.strict, true);
  assert.equal(r.context, CONTEXT);
  assert.match(r.system, /^You draft a Clan Leader Message/);
  assert.match(r.system, /in-game Inbox/);
  assert.match(r.system, /Write the member's name as it is given/);
  assert.match(r.system, /two to four facts that belong to this person/);
  assert.doesNotMatch(
    r.system,
    /one or two details|Never list statistics|No speeches/,
  );
  assert.match(r.system, /never '&'/);
  assert.match(r.system, /from those facts or from the leader's note/);
  // The game's message limit is observed, not specified: the model is
  // still asked for 150 of the 180.
  assert.match(r.system, /the message to 150/);
  assert.doesNotMatch(r.system, /Never write a member's name/);
  assert.match(r.prompt, /MEMBER: Secretname/);
  assert.match(
    r.prompt,
    /ELIXIR'S PLAIN WORDS \(the floor[^)]*\)\nTitle: Congrats, new Elder!\nMessage: Secretname is now an Elder\./,
  );
  assert.match(
    r.prompt,
    /THE LEADER'S NOTE \(follow it; it may add facts of its own\): Mention the Colosseum week & keep it short/,
  );
  assert.match(r.prompt, /THE ASK: Tell the clan this member is now an Elder/);
  // The ask points at the story angles only when the packet has them.
  assert.doesNotMatch(r.prompt, /STORY ANGLES/);
  const angled = leaderMessageRequest({
    kind: "promotion",
    packet: [
      "MEMBER: Secretname",
      "",
      ANGLES_HEADING,
      "1. Played every war week of the last 12.",
    ].join("\n"),
  });
  assert.match(
    angled.prompt,
    /THE ASK: .*Start from the STORY ANGLES; every number you use is in the packet\.$/,
  );
  const demotion = leaderMessageRequest({ kind: "demotion" });
  assert.match(demotion.prompt, /never say or hint why/);
  assert.doesNotMatch(demotion.prompt, /short/i);
  const awards = leaderMessageRequest({
    kind: "awards",
    packet:
      "WHAT HAPPENED\nSeason 131 closed and the clan granted these awards:\n- Cup: Ada (3,100 points)",
  });
  assert.match(awards.prompt, /Season 131 closed/);
  assert.match(awards.prompt, /Cup: Ada \(3,100 points\)/);
  assert.match(awards.system, /\{winners\}/);
  // An announcement sent in clan chat says so.
  const chat = leaderMessageRequest({
    kind: "rules",
    destination: "clan_chat",
  });
  assert.match(
    chat.system,
    /^You draft a heading and a message a leader posts in the game's clan chat/,
  );
  assert.doesNotMatch(chat.system, /Inbox/);
  assert.throws(() => leaderMessageRequest({ kind: "removal" }));
  assert.throws(() =>
    leaderMessageRequest({ kind: "rules", destination: "discord" }),
  );
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

test("one voice for the drafts and the Discord editor (call 5): the leaders' words in THE CLAN, the same rule in both instructions, which lifts none", () => {
  const voice = "Dry and short. Cheer the grinders. Spanish please.";
  const withVoice = clanContext({ name: "Example Clan", voice });
  assert.match(
    withVoice,
    /How its leaders want it to sound: Dry and short\. Cheer the grinders\. Spanish please\./,
  );
  assert.doesNotMatch(
    clanContext({ name: "Example Clan" }),
    /want it to sound/,
  );
  const requests = [
    ...["welcome", "removal", "promotion", "demotion"].map((kind) =>
      clanChatRequest({ kind, context: withVoice, packet: PACKET }),
    ),
    ...["promotion", "demotion", "awards", "rules"].map((kind) =>
      leaderMessageRequest({ kind, context: withVoice, packet: PACKET }),
    ),
    editorRequest({ context: withVoice }),
    editorPreviewRequest({ context: withVoice }),
  ];
  for (const r of requests) {
    assert.equal(
      r.context,
      withVoice,
      "the voice rides in THE CLAN, the cached prefix",
    );
    assert.ok(r.system.includes(VOICE_RULE), r.purpose);
    assert.match(r.system, /clan's voice asks for another language/);
    // The voice is never the system's: a clan with none gets the same instructions.
    assert.doesNotMatch(r.system, /Cheer the grinders/);
  }
  assert.match(VOICE_RULE, /never the facts/);
  assert.match(VOICE_RULE, /never lifts a rule/);
  // The rules it never lifts are still there, after it.
  const chat = clanChatRequest({
    kind: "promotion",
    context: withVoice,
  }).system;
  assert.ok(chat.indexOf(VOICE_RULE) < chat.indexOf("Never judge a member"));
  assert.ok(chat.indexOf(VOICE_RULE) < chat.indexOf("never '&'"));
  assert.equal(
    clanChatRequest({ kind: "promotion", context: withVoice }).system,
    clanChatRequest({ kind: "promotion", context: CONTEXT }).system,
  );
  // The words after a removal take no note, but the clan's voice still.
  assert.match(
    clanChatRequest({ kind: "removal", context: withVoice }).system,
    /Write in English unless the clan's voice asks for another language\./,
  );
  assert.match(
    clanChatRequest({ kind: "welcome", context: withVoice }).system,
    /unless the leader's note or the clan's voice asks for another language/,
  );
});
