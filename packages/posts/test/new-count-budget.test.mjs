import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
  READER_TAG,
  STRANGER_TAG,
} from "./fixture.mjs";
import { countNewPosts } from "../src/read.mjs";

test("the New count probes each named audience only inside its creation watermark", async () => {
  const ctx = await scratchDb("post_new_count_budget");
  try {
    const people = await postFixture(ctx.db, "new-count-budget");
    await ctx.db.query(
      "delete from claim where account_id=$1 and relationship='friend'",
      [people.reader],
    );
    const clan = "#0QC8RCGY";
    await ctx.db.query(
      "insert into clan(clan_tag,name)values($1,'Invented Count Clan')",
      [clan],
    );
    await ctx.db.query(
      "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role)select $1,tag,now()-interval '2 days','member' from unnest($2::text[])tag",
      [clan, [AUTHOR_TAG, READER_TAG]],
    );
    // Old posts were edited today. They remain old creations; unrelated
    // recent posts must never consume this named clan's candidates or work.
    await ctx.db.query(
      `insert into account_post(item_id,account_id,player_tag,body,question,created_at,updated_at)
      select 'tl_'||lpad(to_hex(20000+i),20,'0'),case when i<=10000 then $1::uuid else $2::uuid end,
       case when i<=10000 then $3 else $4 end,'Invented count post',false,
       case when i<=10000 then now()-interval '2 days' else now()-interval '2 seconds' end,now()
      from generate_series(1,20000)i`,
      [people.author, people.stranger, AUTHOR_TAG, STRANGER_TAG],
    );
    const fresh = await people.post({ at: new Date(Date.now() - 1000) });
    await ctx.db.query(
      "analyze account_post; analyze claim; analyze account_follow; analyze clan_membership; analyze clan; analyze account",
    );
    const calls = [];
    const tracked = {
      query(sql, values) {
        calls.push({ sql, values });
        return ctx.db.query(sql, values);
      },
    };
    assert.equal(
      await countNewPosts(tracked, people.reader, Date.now() - 10000, {
        plain: true,
        clanmates: true,
      }),
      1,
    );
    assert.equal(calls.length, 1, "one canonical post count statement");
    const result = await ctx.db.query(
      `explain(analyze,buffers,format json) ${calls[0].sql}`,
      calls[0].values,
    );
    const nodes = (n) => [n, ...(n.Plans ?? []).flatMap(nodes)];
    const plan = result.rows[0]["QUERY PLAN"][0].Plan;
    const work = nodes(plan)
      .filter((n) => n["Relation Name"] === "account_post")
      .reduce(
        (sum, n) =>
          sum +
          ((n["Actual Rows"] ?? 0) + (n["Rows Removed by Filter"] ?? 0)) *
            (n["Actual Loops"] ?? 1),
        0,
      );
    assert.ok(
      work <= 60,
      `inspected ${work} post rows for one new named-clan post`,
    );
    const buffers =
      (plan["Shared Hit Blocks"] ?? 0) + (plan["Shared Read Blocks"] ?? 0);
    assert.ok(
      buffers <= 64,
      `canonical post count used ${buffers} shared buffers`,
    );
    assert.ok(
      !nodes(plan).some((n) =>
        [
          "player",
          "battle",
          "battle_participant",
          "player_snapshot_daily",
        ].includes(n["Relation Name"]),
      ),
      "poll uses current membership metadata, never game-record hydration",
    );
    assert.ok(fresh.id);
  } finally {
    await ctx.drop();
  }
});
