/**
 * A jobs run fails fast when its database goes away (#814). On
 * 2026-11-12 RDS restarted under a run that held a bare pg.Client; the
 * run sat to the 900 s Lambda timeout and held the function's one
 * reserved slot. Every case here ends the run with an error that names
 * the op and the cause:
 *
 * - a server that accepts the connection and never answers;
 * - a connection that goes silent mid-run (packets dropped, no reset:
 *   what a restart behind the VPC looked like);
 * - a connection reset mid-run;
 * - a run stuck on something that is not the database, past its
 *   deadline.
 *
 * And a healthy run keeps its op's statement limit, so a long legitimate
 * statement is not cut off.
 *
 * The timeout cases read no wall clock. Each mocks setTimeout (pg's
 * connect and read timers and the run's deadline all use it), waits for
 * the run to reach the state under test, then moves the clock to the
 * limit and checks that the limit is what ended the run. Until
 * 2026-11-17 they used 300 ms real limits and asserted "ended in under
 * 2 s"; on a loaded host the healthy connect to the scratch database
 * itself outran 300 ms, so the run failed for the wrong reason
 * ("no connection" where the test wanted "no answer").
 */
import { test, before, after } from "node:test";
import { setImmediate as macrotask } from "node:timers/promises";
import assert from "node:assert/strict";
import net from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { makeOutbox } from "@elixir-mcp/outbox";
import {
  JOB_LIMITS,
  assertRunLive,
  guardS3,
  limitsFor,
  openJobsClient,
  runJob,
  runRemainingMs,
} from "../src/db.mjs";
import { eventOps, handler, sweepOperational } from "../src/index.mjs";

let ctx;
const servers = [];

before(async () => {
  ctx = await scratchDb("jobsdb");
});
after(async () => {
  for (const s of servers) s.close();
  await ctx?.drop();
});

async function listen(onSocket) {
  const server = net.createServer(onSocket);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

/** A TCP proxy in front of the scratch database whose plug can be
 *  pulled: `silence()` stops passing bytes either way and closes
 *  nothing; `reset()` destroys every socket. */
async function proxy() {
  const target = new URL(ctx.url);
  const pairs = [];
  let silent = false;
  const port = await listen((inbound) => {
    const outbound = net.connect(Number(target.port || 5432), target.hostname);
    pairs.push([inbound, outbound]);
    inbound.on("data", (b) => silent || outbound.write(b));
    outbound.on("data", (b) => silent || inbound.write(b));
    inbound.on("error", () => {});
    outbound.on("error", () => {});
    inbound.on("close", () => outbound.destroy());
    outbound.on("close", () => inbound.destroy());
  });
  const url = new URL(ctx.url);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return {
    url: url.toString(),
    silence: () => (silent = true),
    reset: () => pairs.flat().forEach((s) => s.resetAndDestroy()),
  };
}

const FAST = { connectMs: 300, statementMs: 400, answerGraceMs: 300 };

/** A promise and its resolver: the run tells the test it has reached
 *  the state under test. */
function signal() {
  let fire;
  const reached = new Promise((resolve) => (fire = resolve));
  return { fire, reached };
}

/** The run's outcome, and whether it has settled yet, without awaiting
 *  it: `settled()` lets a test check that nothing ended the run before
 *  the clock reached its limit. */
function watch(promise) {
  let done = false;
  const outcome = promise.then(
    () => ({ error: null }),
    (error) => ({ error }),
  );
  outcome.then(() => (done = true));
  return { outcome, settled: () => done };
}

/** Moves the mocked clock to just short of `ms` and checks the run is
 *  still waiting, then to `ms` and returns how it ended. Real I/O and
 *  microtasks get a macrotask turn between the steps. */
async function endsAt(t, run, ms) {
  await macrotask();
  t.mock.timers.tick(ms - 1);
  await macrotask();
  assert.equal(run.settled(), false, `still waiting at ${ms - 1} ms`);
  t.mock.timers.tick(1);
  return run.outcome;
}

// A case that regresses to hanging fails at this bound rather than
// stalling the suite; it is no budget the cases are measured against.
const HANG = { timeout: 30_000 };

test(
  "a server that never answers ends the run at the connect timeout",
  HANG,
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const accepted = signal();
    const port = await listen(() => accepted.fire()); // accepts, says nothing
    const url = `postgres://nobody@127.0.0.1:${port}/none`;
    const run = watch(
      runJob("sweep_operational", null, () => sweepOperational(url), {
        limits: FAST,
      }),
    );
    await accepted.reached;
    const { error } = await endsAt(t, run, FAST.connectMs);
    assert.ok(error, "the run must fail");
    assert.equal(error.code, "jobs_db_aborted");
    assert.match(error.message, /sweep_operational: no connection within/);
    assert.match(error.cause?.message ?? "", /timeout expired/);
  },
);

test(
  "a connection that goes silent mid-run ends it when the answer is overdue",
  HANG,
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const p = await proxy();
    const asked = signal();
    const run = watch(
      runJob(
        "home_feeds",
        null,
        async () => {
          const db = await openJobsClient(p.url);
          try {
            await db.query("select 1");
            p.silence();
            const pending = db.query("select 2");
            asked.fire();
            await pending;
            return "unreachable";
          } finally {
            await db.end();
          }
        },
        { limits: FAST },
      ),
    );
    await asked.reached;
    const { error } = await endsAt(
      t,
      run,
      FAST.statementMs + FAST.answerGraceMs,
    );
    assert.ok(error, "the run must fail");
    assert.equal(error.code, "jobs_db_aborted");
    assert.match(error.message, /home_feeds: no answer from the database/);
    assert.equal(error.cause?.message, "Query read timeout");
  },
);

test("a connection reset mid-run ends it at once", HANG, async () => {
  const p = await proxy();
  const { error } = await watch(
    runJob(
      "clan_evaluate",
      null,
      async () => {
        const db = await openJobsClient(p.url);
        try {
          await db.query("select 1");
          // Longer than HANG and inside the statement limit, so only the
          // reset can end it in time.
          const pending = db.query("select pg_sleep(60)");
          p.reset();
          await pending;
          return "unreachable";
        } finally {
          await db.end();
        }
      },
      { limits: { statementMs: 600_000 } },
    ),
  ).outcome;
  assert.ok(error, "the run must fail");
  assert.equal(error.code, "jobs_db_aborted");
  assert.match(error.message, /clan_evaluate: connection lost/);
});

test(
  "a run stuck past its deadline settles and drops its connection",
  HANG,
  async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let client;
    const stuck = signal();
    const run = watch(
      runJob(
        "sweep_fleet",
        null,
        async () => {
          client = await openJobsClient(ctx.url);
          stuck.fire();
          await new Promise(() => {}); // an S3 call that never returns
        },
        { limits: { runMs: 300 } },
      ),
    );
    await stuck.reached;
    const { error } = await endsAt(t, run, 300);
    assert.ok(error, "the run must fail");
    assert.match(error.message, /sweep_fleet: run passed its .* deadline/);
    assert.ok(client.connection.stream.destroyed, "its connection is closed");
    await assert.rejects(client.query("select 1"), /jobs_db_aborted/);
  },
);

/** An S3 client that never reaches the network: it counts the requests
 *  that got as far as being sent. */
function countingS3() {
  const sent = [];
  const s3 = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: {
      handle: async (request) => {
        sent.push(request.path);
        return {
          response: { statusCode: 200, headers: {}, body: undefined },
        };
      },
    },
  });
  return { s3: guardS3(s3), sent };
}

test("an aborted run's leftover work enqueues nothing (Codex on #1042)", async () => {
  // A mail run awaiting its archive write when the deadline passes: the
  // write finishes after the handler has failed, and the continuation
  // would hand the mail to the outbox although its send record can no
  // longer be written, so the retry would send it again.
  const { s3, sent } = countingS3();
  const outbox = makeOutbox("outbox-test", s3);
  let resumeArchive;
  let leftover;
  const { error } = await watch(
    runJob(
      "email",
      null,
      async () => {
        await new Promise((resolve) => (resumeArchive = resolve));
        leftover = outbox("email", { to: "nobody" }).then(
          () => "enqueued",
          (e) => e,
        );
      },
      { limits: { runMs: 200 } },
    ),
  ).outcome;
  assert.match(error.message, /email: run passed its .* deadline/);
  resumeArchive();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const outcome = await leftover;
  assert.equal(outcome.code, "jobs_db_aborted", "the enqueue was refused");
  assert.deepEqual(sent, [], "nothing reached the outbox bucket");
});

test("a live run's S3 writes go through", async () => {
  const { s3, sent } = countingS3();
  await runJob("email", null, async () => {
    assertRunLive();
    await s3.send(
      new PutObjectCommand({ Bucket: "b", Key: "email/x", Body: "{}" }),
    );
  });
  assert.equal(sent.length, 1);
  assertRunLive(); // outside a run: nothing to check
});

test("the deadline stays inside the Lambda's own clock", async () => {
  const left = await runJob(
    "email",
    { getRemainingTimeInMillis: () => 100_000 },
    async () => runRemainingMs(),
  );
  assert.ok(left <= 70_000 && left > 60_000, `left ${left}`);
  assert.equal(runRemainingMs(), null, "no run, no clock");
});

test("a healthy run keeps its op's statement limit and closes cleanly", async () => {
  const out = await runJob("archetype_stamp", null, async () => {
    const db = await openJobsClient(ctx.url);
    try {
      return (await db.query("show statement_timeout")).rows[0]
        .statement_timeout;
    } finally {
      await db.end();
    }
  });
  // The nightly analytics keep the 300 s the function always gave them.
  assert.equal(out, "5min");
  const tick = await runJob("home_feeds", null, async () => {
    const db = await openJobsClient(ctx.url);
    try {
      return (await db.query("show statement_timeout")).rows[0]
        .statement_timeout;
    } finally {
      await db.end();
    }
  });
  assert.equal(tick, "30s");
});

test("a server-side statement timeout is an ordinary error, not an abort", async () => {
  const out = await runJob(
    "sweep_operational",
    null,
    async () => {
      const db = await openJobsClient(ctx.url);
      try {
        await assert.rejects(db.query("select pg_sleep(5)"), {
          code: "57014",
        });
        // The connection is still good after the server cancelled.
        return (await db.query("select 7 as n")).rows[0].n;
      } finally {
        await db.end();
      }
    },
    { limits: { statementMs: 200, answerGraceMs: 2_000 } },
  );
  assert.equal(out, 7);
});

test("a combined event takes the widest limits of its ops", () => {
  assert.deepEqual(
    eventOps({ sweep_payloads: true, sweep_operational: true }),
    ["sweep_payloads", "sweep_operational", "sweep_fleet"],
  );
  assert.deepEqual(
    limitsFor(["sweep_payloads", "sweep_operational"]),
    JOB_LIMITS.sweep_payloads,
  );
  // Every limit leaves the run well inside the Lambda's 900 s.
  for (const [op, l] of Object.entries(JOB_LIMITS)) {
    assert.ok(l.runMs <= 600_000, `${op} run ${l.runMs}`);
    assert.ok(l.statementMs < l.runMs, `${op} statement under run`);
  }
});

test("an event with no op is refused before any connection", async () => {
  await assert.rejects(handler({}), /no recognized op/);
});

test("every jobs entry point opens its connection through db.mjs", () => {
  const src = new URL("../src/", import.meta.url).pathname;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".mjs")) files.push(path);
    }
  };
  walk(src);
  for (const path of files) {
    if (path.endsWith("/db.mjs")) continue;
    const text = readFileSync(path, "utf8");
    assert.doesNotMatch(text, /new pg\.(Client|Pool)\b/, path);
    assert.doesNotMatch(text, /from "pg"/, path);
  }
});
