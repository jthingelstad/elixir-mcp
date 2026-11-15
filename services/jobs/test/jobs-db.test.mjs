/**
 * A jobs run fails fast when its database goes away (#814). On
 * 2026-11-12 RDS restarted under a run that held a bare pg.Client; the
 * run sat to the 900 s Lambda timeout and held the function's one
 * reserved slot. Every case here ends in about a second with an error
 * that names the op and the cause:
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
 */
import { test, before, after } from "node:test";
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

async function timed(promise) {
  const started = Date.now();
  try {
    await promise;
  } catch (error) {
    return { error, ms: Date.now() - started };
  }
  return { error: null, ms: Date.now() - started };
}

test("a server that never answers ends the run at the connect timeout", async () => {
  const port = await listen(() => {}); // accepts, says nothing
  const url = `postgres://nobody@127.0.0.1:${port}/none`;
  const { error, ms } = await timed(
    runJob("sweep_operational", null, () => sweepOperational(url), {
      limits: FAST,
    }),
  );
  assert.ok(error, "the run must fail");
  assert.equal(error.code, "jobs_db_aborted");
  assert.match(error.message, /sweep_operational: no connection within/);
  assert.ok(ms < 2_000, `ended in ${ms} ms`);
});

test("a connection that goes silent mid-run ends it when the answer is overdue", async () => {
  const p = await proxy();
  const { error, ms } = await timed(
    runJob(
      "home_feeds",
      null,
      async () => {
        const db = await openJobsClient(p.url);
        try {
          await db.query("select 1");
          p.silence();
          await db.query("select 2");
          return "unreachable";
        } finally {
          await db.end();
        }
      },
      { limits: FAST },
    ),
  );
  assert.ok(error, "the run must fail");
  assert.equal(error.code, "jobs_db_aborted");
  assert.match(error.message, /home_feeds: no answer from the database/);
  assert.ok(ms < 3_000, `ended in ${ms} ms`);
});

test("a connection reset mid-run ends it at once", async () => {
  const p = await proxy();
  const { error, ms } = await timed(
    runJob(
      "clan_evaluate",
      null,
      async () => {
        const db = await openJobsClient(p.url);
        try {
          await db.query("select 1");
          setTimeout(p.reset, 100);
          // Long enough that only the reset can end it.
          await db.query("select pg_sleep(30)");
          return "unreachable";
        } finally {
          await db.end();
        }
      },
      { limits: { ...FAST, statementMs: 60_000 } },
    ),
  );
  assert.ok(error, "the run must fail");
  assert.equal(error.code, "jobs_db_aborted");
  assert.match(error.message, /clan_evaluate: connection lost/);
  assert.ok(ms < 2_000, `ended in ${ms} ms`);
});

test("a run stuck past its deadline settles and drops its connection", async () => {
  let client;
  const { error, ms } = await timed(
    runJob(
      "sweep_fleet",
      null,
      async () => {
        client = await openJobsClient(ctx.url);
        await new Promise(() => {}); // an S3 call that never returns
      },
      { limits: { runMs: 300 } },
    ),
  );
  assert.ok(error, "the run must fail");
  assert.match(error.message, /sweep_fleet: run passed its .* deadline/);
  assert.ok(ms < 1_500, `ended in ${ms} ms`);
  assert.ok(client.connection.stream.destroyed, "its connection is closed");
  await assert.rejects(client.query("select 1"), /jobs_db_aborted/);
});

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
  const { error } = await timed(
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
  );
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
