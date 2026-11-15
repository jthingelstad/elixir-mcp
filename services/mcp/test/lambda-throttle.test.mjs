/**
 * Bounded backoff on a throttled invoke (#456; lib/lambda-throttle.mjs),
 * and the deploy's migrate and public-statistics invokes riding it. A
 * fake client throws the SDK's throttle shape; the clock is a recorded
 * sleep. Nothing reaches AWS.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  backoffSchedule,
  budgetFor,
  isThrottle,
  sendWithThrottleBackoff,
} from "../../../infra/scripts/lib/lambda-throttle.mjs";
import { invokeWaitingOutThrottle } from "../../../infra/scripts/deploy.mjs";

/** The SDK's TooManyRequestsException, as client-lambda throws it. */
function throttle() {
  const error = new Error("Rate Exceeded.");
  error.name = "TooManyRequestsException";
  error.Reason = "ReservedFunctionConcurrentInvocationLimitExceeded";
  error.$metadata = { httpStatusCode: 429 };
  return error;
}

/** A client that answers each send from the script in order. */
function scripted(...answers) {
  const sent = [];
  return {
    sent,
    send: async (command) => {
      sent.push(command);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const quiet = { log: () => {} };

test("throttle: only the refused-before-running 429 counts", () => {
  assert.equal(isThrottle(throttle()), true);
  const bare = new Error("x");
  bare.$metadata = { httpStatusCode: 429 };
  assert.equal(isThrottle(bare), true);
  for (const other of [
    Object.assign(new Error("x"), { name: "ServiceException" }),
    Object.assign(new Error("x"), { name: "TimeoutError" }),
    Object.assign(new Error("x"), { $metadata: { httpStatusCode: 500 } }),
    null,
  ])
    assert.equal(isThrottle(other), false);
});

test("throttle: the schedule doubles, caps, and adds up to exactly the budget", () => {
  assert.deepEqual(
    backoffSchedule({ budgetMs: 10_000 }),
    [2_000, 4_000, 4_000],
  );
  for (const timeoutS of [300, 900]) {
    const waits = backoffSchedule({ budgetMs: budgetFor(timeoutS) });
    assert.equal(
      waits.reduce((a, b) => a + b, 0),
      (timeoutS + 30) * 1000,
    );
    assert.ok(waits.every((w) => w > 0 && w <= 30_000));
    assert.deepEqual(waits.slice(0, 4), [2_000, 4_000, 8_000, 16_000]);
  }
});

test("throttle: waits out a throttle and returns the answer; the command is the same one", async () => {
  const client = scripted(throttle(), throttle(), { StatusCode: 200 });
  const slept = [];
  const res = await sendWithThrottleBackoff({
    ...quiet,
    client,
    command: { input: "c" },
    schedule: [1, 2, 3],
    label: "t",
    sleep: async (ms) => slept.push(ms),
  });
  assert.deepEqual(res, { StatusCode: 200 });
  assert.equal(client.sent.length, 3);
  assert.ok(client.sent.every((c) => c === client.sent[0]));
  assert.deepEqual(slept, [1, 2]);
});

test("throttle: gives up when the schedule is spent, and never retries anything else", async () => {
  const spent = scripted(throttle(), throttle(), throttle());
  const lines = [];
  await assert.rejects(
    sendWithThrottleBackoff({
      client: spent,
      command: {},
      schedule: [1, 1],
      label: "t",
      sleep: async () => {},
      log: (l) => lines.push(l),
    }),
    { name: "TooManyRequestsException" },
  );
  assert.equal(spent.sent.length, 3);
  assert.match(lines.at(-1), /still throttled after 2 retries/);

  const failed = Object.assign(new Error("boom"), { name: "ServiceException" });
  const once = scripted(failed);
  await assert.rejects(
    sendWithThrottleBackoff({
      ...quiet,
      client: once,
      command: {},
      schedule: [1, 1],
      label: "t",
      sleep: async () => {},
    }),
    { name: "ServiceException" },
  );
  assert.equal(once.sent.length, 1);
});

test("throttle: beforeRetry can stop the wait before the next send", async () => {
  const client = scripted(throttle(), { StatusCode: 200 });
  const slept = [];
  await assert.rejects(
    sendWithThrottleBackoff({
      ...quiet,
      client,
      command: {},
      schedule: [1, 1],
      label: "t",
      sleep: async (ms) => slept.push(ms),
      beforeRetry: () => "locked by deploy",
    }),
    { name: "ThrottleRetryStopped", message: "locked by deploy" },
  );
  assert.equal(client.sent.length, 1);
  assert.deepEqual(slept, []);
});

test("throttle: beforeRetry is asked again after the wait, right before the resend", async () => {
  const client = scripted(throttle(), { StatusCode: 200 });
  const asked = [];
  let stopAfterWait = false;
  await assert.rejects(
    sendWithThrottleBackoff({
      ...quiet,
      client,
      command: {},
      schedule: [1, 1],
      label: "t",
      sleep: async () => {
        stopAfterWait = true;
      },
      beforeRetry: (attempt) => {
        asked.push(attempt);
        return stopAfterWait ? "locked during the wait" : null;
      },
    }),
    { name: "ThrottleRetryStopped", message: "locked during the wait" },
  );
  assert.equal(client.sent.length, 1);
  assert.deepEqual(asked, [1, 1]);
});

test("deploy: the migrate and public-statistics invokes wait out a throttle within the function's timeout", async () => {
  for (const [timeoutS, input] of [
    [300, { FunctionName: "elixir-mcp-migrate", Payload: "{}" }],
    [
      900,
      {
        FunctionName: "elixir-mcp-jobs",
        Payload: JSON.stringify({ public_stats: true }),
      },
    ],
  ]) {
    const lambda = scripted(throttle(), throttle(), { StatusCode: 200 });
    const slept = [];
    const d = { lambda, sleep: async (ms) => slept.push(ms) };
    const original = console.error;
    console.error = () => {};
    try {
      const res = await invokeWaitingOutThrottle(d, input, timeoutS, "deploy");
      assert.deepEqual(res, { StatusCode: 200 });
    } finally {
      console.error = original;
    }
    assert.equal(lambda.sent.length, 3);
    assert.deepEqual(lambda.sent[0].input, input);
    assert.deepEqual(slept, [2_000, 4_000]);
  }
});

test("deploy: a throttle that outlasts the budget fails the invoke as the SDK threw it", async () => {
  const always = {
    sent: 0,
    send: async () => (always.sent++, Promise.reject(throttle())),
  };
  const original = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      invokeWaitingOutThrottle(
        { lambda: always, sleep: async () => {} },
        { FunctionName: "elixir-mcp-migrate", Payload: "{}" },
        300,
        "deploy",
      ),
      { name: "TooManyRequestsException" },
    );
  } finally {
    console.error = original;
  }
  assert.equal(
    always.sent,
    backoffSchedule({ budgetMs: budgetFor(300) }).length + 1,
  );
});
