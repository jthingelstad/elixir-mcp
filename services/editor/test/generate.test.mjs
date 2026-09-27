/**
 * The editor's two passes against a fake client (review 2026-09-27
 * §6.7): the brief is its own cached content block in both passes and
 * every turn's usage is logged, and an error is final only when a retry
 * cannot change it - the model's own stop or a 4xx - while a 429, a 5xx
 * or a lost connection goes back to the queue.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  generateIssue,
  isFinal,
  finalError,
  FinalEditorError,
} from "../src/generate.mjs";

const brief = { board: { cutoff_rating: 2434 }, podium: [] };
const answer = {
  subject: "S",
  subjects: [],
  preheader: "P",
  body_markdown: "The floor is 2434.",
  numbers_used: [],
};

/** A client that answers from a script, one response per call, and
 *  keeps every request it was sent. */
function fakeClient(script) {
  const requests = [];
  let i = 0;
  return {
    requests,
    messages: {
      create: async (req) => {
        requests.push(structuredClone(req));
        const next = script[i++];
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

const usage = (read) => ({
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: read ? 0 : 900,
  cache_read_input_tokens: read ? 900 : 0,
});
const toolTurn = (id) => ({
  stop_reason: "tool_use",
  usage: usage(false),
  content: [
    {
      type: "tool_use",
      id,
      name: "brief_value",
      input: { paths: ["board.cutoff_rating"] },
    },
  ],
});
const done = (read = true) => ({
  stop_reason: "end_turn",
  usage: usage(read),
  content: [{ type: "text", text: JSON.stringify(answer) }],
});

test("the brief is a cached block in both passes, and each turn's usage is logged", async () => {
  const client = fakeClient([toolTurn("t1"), done(), done()]);
  const logs = [];
  const out = await generateIssue({
    brief,
    lint: () => [],
    client,
    log: (l) => logs.push(l),
  });
  assert.deepEqual(out.issue, answer);
  assert.deepEqual(out.paths_read, ["board.cutoff_rating"]);
  assert.equal(client.requests.length, 3);
  for (const req of client.requests) {
    const [first] = req.messages[0].content;
    assert.equal(first.type, "text");
    assert.match(first.text, /^<brief>\n\{"board":\{"cutoff_rating":2434\}/);
    assert.deepEqual(first.cache_control, { type: "ephemeral" });
    assert.deepEqual(req.system[0].cache_control, { type: "ephemeral" });
  }
  // The second writer turn resends the same prefix: brief first.
  assert.equal(client.requests[1].messages.length, 3);
  assert.deepEqual(
    logs.map((l) => [l.pass, l.turn, l.usage.cache_read_input_tokens]),
    [
      ["writer", 0, 0],
      ["writer", 1, 900],
      ["editor", 0, 900],
    ],
  );
});

for (const [stop, kind] of [
  ["refusal", "refusal"],
  ["max_tokens", "max_tokens"],
  ["model_context_window_exceeded", "context_window"],
]) {
  test(`a ${stop} stop is final`, async () => {
    const client = fakeClient([
      { stop_reason: stop, usage: usage(), content: [] },
    ]);
    const err = await generateIssue({ brief, lint: () => [], client }).catch(
      (e) => e,
    );
    assert.ok(err instanceof FinalEditorError);
    assert.equal(err.kind, kind);
    assert.equal(isFinal(err), true);
    assert.equal(finalError(err).kind, kind);
  });
}

test("an answer that is not JSON is final", async () => {
  const client = fakeClient([
    {
      stop_reason: "end_turn",
      usage: usage(),
      content: [{ type: "text", text: "{nope" }],
    },
  ]);
  const err = await generateIssue({ brief, lint: () => [], client }).catch(
    (e) => e,
  );
  assert.equal(err.kind, "bad_json");
  assert.equal(isFinal(err), true);
});

test("twelve tool turns without an answer is final", async () => {
  const client = fakeClient(
    Array.from({ length: 12 }, (_, i) => toolTurn(`t${i}`)),
  );
  const err = await generateIssue({ brief, lint: () => [], client }).catch(
    (e) => e,
  );
  assert.equal(err.kind, "turn_limit");
  assert.equal(isFinal(err), true);
});

test("a 429, a 5xx and a lost connection rethrow; a 4xx is final", () => {
  const h = new Headers();
  assert.equal(
    isFinal(new Anthropic.RateLimitError(429, {}, "slow", h)),
    false,
  );
  assert.equal(
    isFinal(new Anthropic.InternalServerError(529, {}, "overloaded", h)),
    false,
  );
  assert.equal(
    isFinal(new Anthropic.APIConnectionError({ message: "x" })),
    false,
  );
  assert.equal(
    isFinal(new Anthropic.APIConnectionTimeoutError({ message: "t" })),
    false,
  );
  const bad = new Anthropic.BadRequestError(400, {}, "bad schema", h);
  assert.equal(isFinal(bad), true);
  assert.equal(finalError(bad).kind, "api_400");
  assert.equal(
    isFinal(new Anthropic.AuthenticationError(401, {}, "key", h)),
    true,
  );
  // Anything that is not the API's (an S3 hiccup, a bug) is not final.
  assert.equal(isFinal(new Error("socket hang up")), false);
});
