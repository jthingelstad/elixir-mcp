/**
 * A raw editor run replayed (2026-10-11): its own answer through
 * today's checks, and today's editor on a fake model whose lookups are
 * answered from the run's own (one it never made, as unavailable). No
 * model, database or Discord: pure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDITOR_ANSWER, editorStory } from "@elixir-mcp/clan-engine";
import {
  NOT_IN_RUN,
  checksOnly,
  originalOf,
  readRawRun,
  recordedLookups,
  replayRun,
} from "../src/editor-replay.mjs";

const item = (id, kind, facts) => ({
  id,
  kind,
  revision: 1,
  at: "2026-10-11T18:00:00Z",
  facts,
});
const story = (key, kind, facts, render) =>
  editorStory(
    {
      key,
      revision: 1,
      story: { key, items: [item(key, kind, facts)] },
      render,
    },
    { members: [], history: [] },
  );
const JOIN = story(
  "tl_1",
  "member_joined",
  { player_tag: "#AAA", name: "Ada" },
  "Ada joined the clan.",
);
const WINS = story(
  "tl_2",
  "career_wins_step",
  { player_tag: "#BBB", name: "Bo", wins: 5000, step: 5000 },
  "Bo passed 5,000 career wins.",
);

const RAW = {
  v: 1,
  run_id: "clan-J2RGCRVG.1791741600000",
  clan_tag: "#J2RGCRVG",
  at: "2026-10-11T18:00:00.000Z",
  model: "a-model",
  outcome: "ok",
  context: "The clan POAP KINGS.",
  stories: [JOIN, WINS],
  rounds: [
    {
      round: 1,
      ok: true,
      calls: [{ id: "c1", name: "member_record", input: { name: "Bo" } }],
      results: [{ id: "c1", text: "Bo: 7,200 trophies, best 7,450." }],
    },
    { round: 2, ok: true },
  ],
  answer: {
    posts: [
      {
        keys: ["tl_2"],
        text: "Bo passed 5,000 career wins at 7,200 trophies.",
      },
      { keys: ["tl_1"], text: "Welcome Ada, at 6:05 sharp!" },
    ],
    skips: [],
  },
  checked: {
    posts: [
      {
        key: "tl_2",
        keys: ["tl_2"],
        text: "Bo passed 5,000 career wins at 7,200 trophies.",
      },
    ],
    skips: [],
    rejected: [
      {
        keys: ["tl_1"],
        why: "clock_time",
        text: "Welcome Ada, at 6:05 sharp!",
      },
    ],
  },
};

test("a raw record is read only when it is one", () => {
  assert.equal(readRawRun(null).error, "not_a_run");
  assert.equal(readRawRun({ v: 2 }).error, "not_a_run");
  assert.equal(readRawRun({ v: 1, stories: [] }).error, "no_stories");
  assert.equal(readRawRun(RAW).run, RAW);
});

test("the run's own answer goes through today's checks, the lookups counted as read", () => {
  const out = checksOnly(RAW);
  assert.deepEqual(
    out.posts.map((p) => p.keys),
    [["tl_2"]],
    "7,200 was looked up, so it is not invented",
  );
  assert.equal(out.rejected[0].why, "clock_time");
  assert.deepEqual(originalOf(RAW).rejected, RAW.checked.rejected);
  assert.equal(checksOnly({ ...RAW, answer: null }).error, "no_answer");
});

test("a replay answers the lookups the run made from the run, and any other as unavailable", async () => {
  assert.equal(
    recordedLookups(RAW).get('member_record {"name":"Bo"}'),
    "Bo: 7,200 trophies, best 7,450.",
  );
  const sent = [];
  const turn = async (request, round) => {
    sent.push(request);
    if (round === 1)
      return {
        ok: true,
        calls: [
          { id: "x1", name: "member_record", input: { name: "Bo" } },
          { id: "x2", name: "member_record", input: { name: "Ada" } },
        ],
        content: [{ type: "tool_use", id: "x1" }],
        usage: { input_tokens: 10 },
      };
    return {
      ok: true,
      answer: {
        posts: [
          { keys: ["tl_2"], text: "Bo passed 5,000 career wins, best 7,450." },
          { keys: ["tl_1"], text: "Ada joined the clan." },
        ],
        skips: [],
      },
    };
  };
  const out = await replayRun(RAW, { turn });
  assert.equal(out.ok, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].answer, EDITOR_ANSWER);
  assert.equal(sent[0].context, RAW.context);
  const results = sent[1].messages
    .at(-1)
    .content.filter((c) => c.type === "tool_result");
  assert.deepEqual(
    results.map((r) => r.content),
    ["Bo: 7,200 trophies, best 7,450.", NOT_IN_RUN],
  );
  assert.deepEqual(out.rounds[0].lookups, [
    { name: "member_record", input: { name: "Bo" }, recorded: true },
    { name: "member_record", input: { name: "Ada" }, recorded: false },
  ]);
  assert.deepEqual(
    out.posts.map((p) => p.keys),
    [["tl_2"], ["tl_1"]],
  );
});

test("a model that refuses or never answers is reported, not filled in", async () => {
  const refused = await replayRun(RAW, {
    turn: async () => ({ ok: false, code: "refusal" }),
  });
  assert.deepEqual(
    { ok: refused.ok, code: refused.code },
    { ok: false, code: "refusal" },
  );
  const looping = await replayRun(RAW, {
    turn: async () => ({
      ok: true,
      calls: [{ id: "y", name: "member_record", input: { name: "Bo" } }],
      content: [],
    }),
  });
  assert.equal(looping.code, "no_answer");
});
