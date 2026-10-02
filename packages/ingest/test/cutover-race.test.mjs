import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { gzipSync } from "node:zlib";
import { scratchDb } from "./helpers.mjs";
import { processResult } from "../src/pipeline.mjs";
import { retireBoardRecordings } from "../../../services/migrate/src/ops-retire-boards.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("cutover drains an in-flight archive admission, then refuses its stale bulk retry", async () => {
  const ctx = await scratchDb("cutoverrace");
  const other = new pg.Client({ connectionString: ctx.url });
  await other.connect();
  const {
    rows: [backend],
  } = await other.query("select pg_backend_pid() as pid");
  const archiveEntered = deferred();
  const releaseArchive = deferred();
  const lockRequested = deferred();
  let admission, cutover;
  try {
    const {
      rows: [a],
    } = await ctx.db.query(
      "insert into account (email_hash,status,is_owner) values ('race-owner','approved',true) returning account_id",
    );
    const {
      rows: [gw],
    } = await ctx.db.query(
      "insert into gateway (owner_account_id,name,status) values ($1,'race-gateway','active') returning gateway_id",
      [a.account_id],
    );
    const tag = "#20JJJ2CCRU";
    await ctx.db.query("insert into player (player_tag) values ($1)", [tag]);
    await ctx.db.query(
      "insert into recording (subject_type,subject_tag,requested_by,origin) values ('player',$1,$2,'ranking')",
      [tag, a.account_id],
    );
    const {
      rows: [job],
    } = await ctx.db.query(
      "insert into job (endpoint,entity_key,lane,status,leased_by,leased_at) values ('player_battlelog',$1,'bulk','leased',$2,now()) returning job_id",
      [tag, gw.gateway_id],
    );
    const envelope = {
      v: 1,
      job: { endpoint: "player_battlelog", entity_key: tag, lane: "bulk" },
      job_id: Number(job.job_id),
      gateway_id: gw.gateway_id,
      fetched_at: new Date().toISOString(),
      status: "ok",
      body_gzip_b64: gzipSync("[]").toString("base64"),
    };
    let archives = 0;
    const deps = {
      archive: {
        put: async () => {
          archives++;
          archiveEntered.resolve();
          await releaseArchive.promise;
        },
      },
      emitMetrics: () => {},
    };
    admission = processResult(ctx.db, envelope, deps);
    await archiveEntered.promise;
    let completed = false;
    const observedDb = {
      query: (sql, params) => {
        const result = other.query(sql, params);
        if (sql === "select pg_advisory_xact_lock(hashtext($1))")
          lockRequested.resolve();
        return result;
      },
    };
    cutover = retireBoardRecordings(null, { apply: true }, observedDb).then(
      (r) => {
        completed = true;
        return r;
      },
    );
    await lockRequested.promise;
    let waiting = false;
    for (let attempt = 0; attempt < 20 && !waiting; attempt++) {
      const {
        rows: [lock],
      } = await ctx.db.query(
        "select exists (select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as waiting",
        [backend.pid],
      );
      waiting = lock.waiting;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(
      waiting,
      true,
      "cutover is blocked on the admission's advisory lock",
    );
    assert.equal(completed, false, "cutover must wait for the older admission");
    releaseArchive.resolve();
    assert.equal((await admission).outcome, "admitted");
    const result = await cutover;
    assert.equal(result.stopped, 1);
    assert.equal(result.done, true);
    assert.equal(
      (await processResult(ctx.db, envelope, deps)).outcome,
      "retired",
    );
    assert.equal(archives, 1, "no archive write after the cutover");
    const {
      rows: [locks],
    } = await ctx.db.query(
      "select count(*)::int n from pg_locks where locktype='advisory' and pid=pg_backend_pid()",
    );
    assert.equal(
      locks.n,
      0,
      "session admission lock is released on refusal too",
    );
  } finally {
    releaseArchive.resolve();
    await Promise.allSettled([admission, cutover].filter(Boolean));
    await other.end();
    await ctx.drop();
  }
});
