import assert from "node:assert/strict";
import { test } from "node:test";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { readVisiblePosts } from "../src/read.mjs";
import { postFixture, AUTHOR_TAG, READER_TAG } from "./fixture.mjs";

test("the member Timeline reads only in-window candidates across all audience paths", async (t) => {
  const ctx = await scratchDb("post_timeline_window");
  const { db } = ctx;
  try {
    const people = await postFixture(db, "post-window");
    const clan = "#0QC8RCGY";
    await db.query(
      "insert into clan(clan_tag,name) values($1,'Invented Clan')",
      [clan],
    );
    await db.query(
      `insert into clan_membership(clan_tag,player_tag,joined_observed_at,role)
       select $1, tag, now(), 'member' from unnest($2::text[]) tag`,
      [clan, [AUTHOR_TAG, READER_TAG]],
    );
    const toMs = Date.now();
    const fromMs = toMs - 7 * 86_400_000;
    const old = new Date(fromMs - 30 * 86_400_000);
    await db.query(
      `insert into account_post(item_id,account_id,player_tag,body,created_at)
       select 'tl_' || lpad(to_hex(20000+i),20,'0'), $1, $2, 'Older post', $3
       from generate_series(1,10000)i`,
      [people.author, AUTHOR_TAG, old],
    );
    const edited = await people.post({ at: old });
    await db.query("update account_post set updated_at=$2 where post_id=$1", [
      edited.id,
      new Date(fromMs),
    ]);
    const fresh = await people.post({ at: new Date(toMs) });
    await people.post({ at: new Date(toMs + 1) });
    await db.query(
      "analyze account_post; analyze claim; analyze account_follow; analyze clan_membership; analyze clan; analyze account",
    );

    for (const [path, reader, subjects] of [
      ["own", people.author, []],
      ["account follow", people.fan, []],
      [
        "explicit player",
        people.stranger,
        [{ kind: "player", tag: AUTHOR_TAG }],
      ],
      ["current clanmate", people.reader, []],
    ]) {
      let plan;
      const tracked = {
        async query(sql, params) {
          const result = await db.query(
            `explain (analyze,buffers,format json) ${sql}`,
            params,
          );
          plan = result.rows[0]["QUERY PLAN"][0].Plan;
          return db.query(sql, params);
        },
      };
      const rows = await readVisiblePosts(tracked, reader, {
        subjects,
        fromMs,
        toMs,
        plain: true,
        clanmates: true,
      });
      assert.deepEqual(
        rows.map((r) => r.post.id),
        [fresh.id, edited.id],
        path,
      );
      const buffers = plan["Shared Hit Blocks"] + plan["Shared Read Blocks"];
      t.diagnostic(`${path}: ${buffers} shared buffers`);
      assert.ok(
        buffers <= 140,
        `${path} used ${buffers} shared buffers for two posts`,
      );
    }
  } finally {
    await ctx.drop();
  }
});
