import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { retireBoardRecordings } from "../src/ops-retire-boards.mjs";
import { bulkJobWanted } from "@elixir-mcp/ledger";

test("capture cutover previews the same reasons, preserves overlaps and provenance, and repeats safely", async () => {
  const ctx = await scratchDb("retireboards");
  const db = ctx.db;
  try {
    const {
      rows: [a],
    } = await db.query(`insert into account (email_hash, status, is_owner)
      values ('retire-test', 'approved', true) returning account_id`);
    const tags = [
      "#20JJJ2CCRU",
      "#2YG98VVQ",
      "#PLCCYUQL",
      "#U08P889Y0",
      "#2QUR9PQ8",
    ];
    await db.query(
      "insert into player (player_tag) select unnest($1::text[])",
      [tags],
    );
    for (const [i, tag] of tags.entries())
      await db.query(
        `insert into recording (subject_type, subject_tag, requested_by, origin)
        values ('player', $1, $2, $3)`,
        [tag, a.account_id, i === 2 ? "ops" : "ranking"],
      );
    await db.query(
      "insert into claim (account_id, player_tag) values ($1, $2)",
      [a.account_id, tags[0]],
    );
    for (const [slug, tag] of [
      ["pol-global-top-100", tags[1]],
      ["personal-list", tags[3]],
    ]) {
      const {
        rows: [c],
      } = await db.query(
        `insert into collection (slug,title,kind,owner_account)
        values ($1,$1,'player',$2) returning collection_id`,
        [slug, a.account_id],
      );
      await db.query(
        "insert into collection_member (collection_id,subject_tag) values ($1,$2)",
        [c.collection_id, tag],
      );
    }
    await db.query("insert into clan (clan_tag) values ('#J2RGCRVG')");
    await db.query(
      `insert into recording (subject_type,subject_tag,requested_by,origin,scope)
      values ('clan','#J2RGCRVG',$1,'ops','comprehensive')`,
      [a.account_id],
    );
    await db.query(
      `insert into clan_membership (clan_tag,player_tag,joined_observed_at)
      values ('#J2RGCRVG',$1,now())`,
      [tags[4]],
    );
    const preview = await retireBoardRecordings(null, {}, db);
    assert.equal(preview.stopped, 3);
    assert.equal(preview.retained, 3);
    const { rows: before } = await db.query("select status from recording");
    assert.ok(
      before.every((r) => r.status === "active"),
      "preview is read only",
    );
    let after = "";
    let stopped = 0;
    do {
      const r = await retireBoardRecordings(
        null,
        { apply: true, limit: 2, after },
        db,
      );
      stopped += r.stopped;
      after = r.next_after;
    } while (after);
    assert.equal(stopped, 3);
    assert.equal(
      (await retireBoardRecordings(null, { apply: true }, db)).stopped,
      0,
    );
    for (const tag of [tags[0], tags[2]]) {
      const {
        rows: [r],
      } = await db.query("select status from recording where subject_tag=$1", [
        tag,
      ]);
      assert.equal(r.status, "active", "claim and ops survive stale origin");
    }
    assert.equal(
      await bulkJobWanted(db, {
        endpoint: "player_battlelog",
        entity_key: tags[1],
      }),
      false,
    );
    assert.equal(
      await bulkJobWanted(db, {
        endpoint: "player_battlelog",
        entity_key: tags[4],
      }),
      true,
      "clan member capture survives",
    );
    const {
      rows: [history],
    } = await db.query("select count(*)::int n from collection_member");
    assert.equal(history.n, 2, "membership provenance retained");
    const {
      rows: [boards],
    } = await db.query(
      "select count(*)::int n from ranking_board where enabled or record_top<>0",
    );
    assert.equal(boards.n, 0);
  } finally {
    await ctx.drop();
  }
});

test("capture cutover remains incomplete while obsolete work is locked elsewhere", async () => {
  const { default: pg } = await import("pg");
  const ctx = await scratchDb("retirelocked");
  const other = new pg.Client({ connectionString: ctx.url });
  await other.connect();
  try {
    const {
      rows: [job],
    } = await ctx.db.query(
      "insert into job (endpoint,entity_key,lane,status) values ('rankings_pol','global','bulk','dead') returning job_id",
    );
    await other.query("begin");
    await other.query("select job_id from job where job_id=$1 for update", [
      job.job_id,
    ]);
    const held = await retireBoardRecordings(
      null,
      { apply: true, job_limit: 2 },
      ctx.db,
    );
    assert.equal(held.retired_jobs, 0);
    assert.equal(held.retired_jobs_pending, true);
    assert.equal(held.done, false);
    assert.equal(held.next_after, "");
    await other.query("rollback");
    const finished = await retireBoardRecordings(
      null,
      { apply: true, after: held.next_after },
      ctx.db,
    );
    assert.equal(finished.retired_jobs, 1);
    assert.equal(finished.retired_jobs_pending, false);
    assert.equal(finished.done, true);
  } finally {
    await other.query("rollback");
    await other.end();
    await ctx.drop();
  }
});
