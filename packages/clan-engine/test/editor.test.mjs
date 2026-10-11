/**
 * The activity channel's editor with the clan's own model (2026-10-11):
 * each story as a packet, the rounds of lookups and the answer, and the
 * checks a post must pass: no link, mention or clock time, names kept,
 * nothing it was not given, a departure in the record's words; merges
 * and skips only where they may be.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_ANSWER,
  EDITOR_POST_MAX,
  EDITOR_ROUNDS,
  EDITOR_STORIES_MAX,
  editorAnswer,
  editorNext,
  editorPreviewRequest,
  editorProblem,
  editorRequest,
  editorStory,
} from "../src/editor.mjs";
import { PURPOSES } from "../src/words.mjs";

const item = (id, kind, facts) => ({
  id,
  kind,
  revision: 1,
  at: "2026-10-11T18:00:00Z",
  facts,
});
const post = (key, items, render) => ({
  key,
  revision: 1,
  story: { key, items },
  render,
});

const JOIN = editorStory(
  post(
    "tl_1",
    [item("tl_1", "member_joined", { player_tag: "#AAA", name: "Ada" })],
    "Ada joined the clan.",
  ),
  {
    members: [{ name: "Ada", role: "member", trophies: 9120 }],
    history: [{ kind: "member_joined", name: "Ada", count: 1 }],
  },
);
const WINS = editorStory(
  post(
    "tl_2",
    [
      item("tl_2", "career_wins_step", {
        player_tag: "#BBB",
        name: "Bo",
        wins: 5000,
        step: 5000,
      }),
    ],
    "Bo passed 5,000 career wins.",
  ),
);
const LEFT = editorStory(
  post(
    "tl_3",
    [item("tl_3", "member_left", { player_tag: "#CCC", name: "Cy" })],
    "Cy departed the clan after 40 days.",
  ),
);
const KICK = editorStory(
  post(
    "tl_4",
    [
      item("tl_9", "departure_classified", {
        player_tag: "#DDD",
        name: "Di",
        kind: "kick",
      }),
    ],
    "Di was removed from the clan.",
  ),
  { edit: true },
);

test("a story's packet: its key and kind, Elixir's version, the facts, the member and what the channel told this week", () => {
  assert.match(JOIN.packet, /^STORY tl_1 \(member joined\)\n/);
  assert.match(JOIN.packet, /^Elixir's version: Ada joined the clan\.$/m);
  assert.match(JOIN.packet, /^ABOUT: Ada$/m);
  assert.match(
    JOIN.packet,
    /^The channel already told 1 other member joined post about Ada in the last 7 days\.$/m,
  );
  assert.doesNotMatch(JOIN.packet, /#AAA/, "no tag reaches the model");
  assert.deepEqual(JOIN.names, ["Ada"]);
  assert.equal(JOIN.alone, false);
  // A departure says what the record says, and stands alone.
  assert.equal(LEFT.departure, "departed");
  assert.match(
    LEFT.packet,
    /^A departure: keep this sentence word for word, and give no reason: Cy departed the clan after 40 days\.$/m,
  );
  assert.equal(LEFT.must, "Cy departed the clan after 40 days.");
  const lateLeft = editorStory(
    post(
      "tl_6",
      [item("tl_6", "member_left", { name: "Cy" })],
      "Earlier today: Cy departed the clan.",
    ),
  );
  assert.equal(lateLeft.must, "Cy departed the clan.", "the when is apart");
  assert.equal(lateLeft.late, "Earlier today");
  assert.equal(LEFT.alone, true);
  // A leader's word edits the post already in the channel.
  assert.equal(KICK.departure, "kick");
  assert.match(KICK.packet, /^EDIT: this post is already in the channel/m);
  assert.match(KICK.packet, /give no reason: Di was removed from the clan\.$/m);
});

test("the request: the stories and the round, the lookups and the answer as strict tools; each round adds the turn and the lookups' answers", () => {
  const many = Array.from({ length: EDITOR_STORIES_MAX + 3 }, (_, i) => ({
    ...WINS,
    key: `tl_${i}`,
    packet: `STORY tl_${i} (x)`,
  }));
  const req = editorRequest({ context: "THE CLAN\nName: X", stories: many });
  assert.equal(req.purpose, "discord_activity");
  assert.equal(req.effort, "low");
  assert.equal(req.answer, EDITOR_ANSWER);
  assert.equal(req.context, "THE CLAN\nName: X");
  assert.deepEqual(
    req.tools.map((t) => [t.name, t.strict]),
    [
      ["member_record", true],
      ["member_battles", true],
      ["channel_recent", true],
      ["write_posts", true],
    ],
  );
  assert.equal(
    req.tools[1].input_schema.additionalProperties,
    false,
    "closed schemas",
  );
  assert.equal(req.messages.length, 1);
  const first = req.messages[0].content;
  assert.equal(
    (first.match(/^STORY /gm) ?? []).length,
    EDITOR_STORIES_MAX,
    "a run hands over at most a batch",
  );
  assert.match(first, /Round 1 of 3: look up/);
  assert.equal(req.max_tokens, 3400);

  const turn = [
    { type: "tool_use", id: "t1", name: "channel_recent", input: {} },
  ];
  const next = editorNext(
    req,
    { content: turn },
    [{ id: "t1", name: "channel_recent", text: "x".repeat(5000) }],
    EDITOR_ROUNDS,
  );
  assert.deepEqual(
    next.messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.deepEqual(next.messages[1].content, turn, "the turn as it came");
  const [result, note] = next.messages[2].content;
  assert.equal(result.type, "tool_result");
  assert.equal(result.tool_use_id, "t1");
  assert.equal(result.content.length, 1500, "an answer is clipped");
  assert.match(note.text, /^Round 3 of 3: no more lookups\. Answer now/);
  assert.equal(req.messages.length, 1, "the request is not changed");
  assert.match(req.system, /member_record/);
});

test("a leader's preview: the same stories and rules in one request, the answer as its one strict tool, no lookups", () => {
  const req = editorPreviewRequest({
    context:
      "THE CLAN\nName: The Clan\nHow its leaders want it to sound: Pirate talk",
    stories: [JOIN, WINS],
  });
  assert.equal(req.purpose, "discord_activity");
  assert.ok(PURPOSES[req.purpose], "a purpose the key may be used for");
  assert.equal(req.effort, "low");
  assert.equal(req.messages, undefined, "a draft's prompt, not a turn");
  assert.equal(req.tools, undefined);
  assert.equal(req.tool.name, EDITOR_ANSWER);
  assert.equal(req.tool.strict, true);
  assert.equal(req.tool.input_schema.additionalProperties, false);
  assert.match(req.context, /Pirate talk/);
  assert.match(req.prompt, /^STORY tl_1 /);
  assert.match(req.prompt, /^STORY tl_2 /m);
  assert.match(req.prompt, /no lookups\. Answer now by calling write_posts\.$/);
  assert.doesNotMatch(req.system, /member_record|lookup/);
  assert.match(
    req.system,
    /only a short thank-you or farewell .*never a reason, a guess at why or anything else/,
  );
  assert.match(req.system, /share of the clan's fame is never told/);
});

test("the checks: a post is refused for a link, a mention, a clock time, a lost name, an invented number or name, or a departure's words", () => {
  const read = "THE CLAN\nName: X";
  const ok = (stories, text) => editorProblem(stories, text, read);
  assert.equal(ok([JOIN], "Welcome to the clan, Ada! 🎉"), null);
  assert.equal(ok([JOIN], ""), "empty");
  assert.equal(ok([JOIN], "Ada joined: https://example.com"), "link");
  assert.equal(ok([JOIN], "Ada joined, see clan.gg"), "link");
  assert.equal(ok([JOIN], "Ada joined @everyone"), "mention");
  assert.equal(ok([JOIN], "Ada joined, say hi @Ada"), "mention");
  assert.equal(ok([JOIN], `Ada ${"joined ".repeat(100)}`), "too_long");
  assert.ok(EDITOR_POST_MAX === 600);
  assert.equal(ok([JOIN], "Ada joined at 6:05 pm."), "clock_time");
  assert.equal(ok([JOIN], "Ada joined at 6pm."), "clock_time");
  assert.equal(ok([JOIN], "Ada joined at 18.05."), "clock_time");
  assert.equal(ok([JOIN], "Ada joined around 6h30."), "clock_time");
  assert.equal(ok([JOIN], "Ada joined at 18:05."), "clock_time");
  assert.equal(ok([JOIN], "Ada joined at 6.05 pm."), "clock_time");
  // A late story says when, in words.
  const LATE_WINS = editorStory(
    post(
      "tl_5",
      [
        item("tl_5", "career_wins_step", {
          name: "Bo",
          wins: 5000,
          step: 5000,
        }),
      ],
      "Yesterday: Bo passed 5,000 career wins.",
    ),
  );
  assert.equal(LATE_WINS.late, "Yesterday");
  assert.match(
    LATE_WINS.packet,
    /^LATE: this happened yesterday; the post must say "yesterday", never a time of day\.$/m,
  );
  assert.equal(
    ok([LATE_WINS], "Bo passed 5,000 career wins! 🎉"),
    "when_dropped",
  );
  assert.equal(ok([LATE_WINS], "Yesterday Bo passed 5,000 career wins!"), null);
  assert.equal(ok([JOIN], "A new member joined!"), "name_changed");
  assert.equal(
    ok([JOIN], "Ada joined with 12,000 trophies."),
    "number_invented",
  );
  // The member's record was in the packet: its numbers may be told.
  assert.equal(ok([JOIN], "Ada joined with 9,120 trophies."), null);
  // A lookup's answer counts as given.
  assert.equal(
    editorProblem([JOIN], "Ada joined, fresh off a win over Zed.", read),
    "name_invented",
  );
  assert.equal(
    editorProblem(
      [JOIN],
      "Ada joined, fresh off a win over Zed.",
      `${read}\n- win 3-0 against Zed, ladder`,
    ),
    null,
  );
  assert.equal(
    ok(
      [LEFT],
      "Cy departed the clan after 40 days. Thanks for everything, Cy!",
    ),
    null,
  );
  // Elixir's sentence word for word: shortened is refused.
  assert.equal(
    ok([LEFT], "Cy departed the clan. Thanks, Cy!"),
    "departure_words",
  );
  assert.equal(
    ok([LEFT], "Cy left the clan after 40 days."),
    "departure_words",
  );
  assert.equal(ok([KICK], "Di was removed from the clan."), null);
  // No reason the record never gave, in the sentence or beside it.
  assert.equal(
    ok([KICK], "Di was removed from the clan for inactivity."),
    "departure_words",
  );
  assert.equal(
    ok([KICK], "Di was removed from the clan. Rules are rules."),
    "departure_words",
  );
  // Around the sentence, only a thank-you or a farewell: anything else
  // could be a reason (Codex on #506).
  assert.equal(
    ok([KICK], "Di was removed from the clan. They were toxic."),
    "departure_words",
  );
  assert.equal(
    ok([KICK], "Good luck out there, Di! 👋 Di was removed from the clan."),
    null,
  );
  const late = editorStory(
    post(
      "tl_5",
      [item("tl_5", "member_left", { player_tag: "#EEE", name: "Ed" })],
      "Yesterday: Ed departed the clan after 12 days. Ed donated 1,200 cards.",
    ),
  );
  assert.equal(
    ok(
      [late],
      "Yesterday, Ed departed the clan after 12 days. Ed donated 1,200 cards. We'll miss you, Ed!",
    ),
    null,
    "when, Elixir's other sentences and a farewell",
  );
  assert.equal(
    ok(
      [late],
      "Yesterday, Ed departed the clan after 12 days. Not a big loss.",
    ),
    "departure_words",
  );
  assert.equal(ok([KICK], "Di left; Di was removed."), "departure_words");
  assert.equal(ok([KICK], "Di is gone from the clan."), "departure_words");
});

test("the answer: stories told together under the first one's key, skips with a cleaned reason; a departure or an edit never merged, a departure never skipped", () => {
  const stories = [JOIN, WINS, LEFT, KICK];
  const out = editorAnswer(
    {
      posts: [
        // Listed out of order: the post goes under the first story's key.
        {
          keys: ["tl_2", "tl_1", "tl_404"],
          text: "Ada joined and Bo passed 5,000 career wins!",
        },
        // A departure told with another is refused, and posted as Elixir's.
        { keys: ["tl_3", "tl_4"], text: "Cy departed; Di was removed." },
        // A story already told is never told again, nor trimmed away.
        {
          keys: ["tl_1", "tl_2"],
          text: "Ada joined and Bo passed 5,000 career wins!",
        },
        { keys: ["tl_4"], text: "Di was removed from the clan." },
      ],
      skips: [
        { key: "tl_3", reason: "Not news." },
        { key: "tl_1", reason: "Told above" },
        { key: "tl_404", reason: "x" },
      ],
    },
    stories,
    "THE CLAN",
  );
  assert.deepEqual(out.posts, [
    {
      key: "tl_1",
      keys: ["tl_1", "tl_2"],
      text: "Ada joined and Bo passed 5,000 career wins!",
    },
    { key: "tl_4", keys: ["tl_4"], text: "Di was removed from the clan." },
  ]);
  assert.deepEqual(
    out.skips,
    [],
    "a departure is told; a told story is not skipped",
  );
  assert.deepEqual(out.refused, {
    merge_refused: 1,
    key_reused: 1,
    skip_refused: 1,
  });
  assert.deepEqual(
    out.rejected,
    [
      { keys: ["tl_3", "tl_4"], why: "merge_refused" },
      { keys: ["tl_1", "tl_2"], why: "key_reused" },
      { keys: ["tl_3"], why: "skip_refused" },
    ],
    "each refusal with the stories it was for, for the preview",
  );

  const skipped = editorAnswer(
    {
      posts: [],
      skips: [
        { key: "tl_2", reason: "  Small step; see https://x.y @here `code`  " },
        { key: "tl_4", reason: "Already said." },
      ],
    },
    stories,
  );
  assert.deepEqual(skipped.skips, [
    { key: "tl_2", reason: "Small step; see here code" },
  ]);
  assert.deepEqual(
    skipped.refused,
    { skip_refused: 1 },
    "an edit is never skipped",
  );
  assert.deepEqual(editorAnswer(null, stories), {
    posts: [],
    skips: [],
    refused: {},
    rejected: [],
  });
});
