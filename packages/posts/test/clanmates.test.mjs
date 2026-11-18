import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  clanPosts,
  clanQuestionCounts,
  countNewPosts,
  postsBy,
  readVisiblePost,
  readVisiblePostPage,
  readVisiblePosts,
} from "../src/index.mjs";
import {
  AUTHOR_TAG,
  READER_TAG,
  STRANGER_TAG,
  postFixture,
} from "./fixture.mjs";

const CLAN = "#0VGJQ28P";
let ctx, people, post;
const window = () => ({
  subjects: [],
  plain: true,
  fromMs: Date.now() - 86400_000,
  toMs: Date.now() + 60_000,
});
const ids = (items) => items.map((it) => it.post.id);
const list = (extra = {}, reader = people.reader) =>
  readVisiblePosts(ctx.db, reader, { ...window(), clanmates: true, ...extra });
const count = (extra = {}) =>
  countNewPosts(ctx.db, people.reader, Date.now() - 3600_000, {
    plain: true,
    clanmates: true,
    ...extra,
  });
const clanWindow = () => ({ ...window(), clanTag: CLAN });

before(async () => {
  ctx = await scratchDb("post_clanmates");
  people = await postFixture(ctx.db, "post-clanmates");
  await ctx.db.query(
    `delete from claim where account_id=$1 and player_tag=$2`,
    [people.reader, AUTHOR_TAG],
  );
  await ctx.db.query(
    `insert into clan(clan_tag,name) values($1,'Invented Clan')`,
    [CLAN],
  );
  for (const tag of [AUTHOR_TAG, READER_TAG])
    await ctx.db.query(
      `insert into clan_membership(clan_tag,player_tag,joined_observed_at,role)
       values($1,$2,now()-interval '2 days','member')`,
      [CLAN, tag],
    );
  post = await people.post({ at: new Date(Date.now() - 60_000) });
});
after(async () => ctx?.drop());

test("automatic clanmate posts are a member-web opt-in, never a delivery default", async () => {
  assert.deepEqual(ids(await list()), [post.id]);
  assert.equal(await count(), 1);
  assert.deepEqual(
    ids(await readVisiblePosts(ctx.db, people.reader, window())),
    [],
  );
  assert.equal(await count({ clanmates: false }), 0);
  assert.deepEqual(
    (await readVisiblePostPage(ctx.db, people.reader, window())).items,
    [],
  );
  assert.deepEqual(
    ids(
      (
        await readVisiblePostPage(ctx.db, people.reader, {
          ...window(),
          clanmates: true,
        })
      ).items,
    ),
    [post.id],
  );
  assert.deepEqual(
    ids(await readVisiblePosts(ctx.db, people.fan, window())),
    [post.id],
    "an existing account follow retains its delivery audience",
  );
  for (const by of [{ playerTag: AUTHOR_TAG }, { accountId: people.author }])
    assert.deepEqual(
      ids(
        await postsBy(ctx.db, people.reader, {
          ...window(),
          ...by,
          clanmates: true,
        }),
      ),
      [post.id],
      "named member pages share the already-permitted current-clan audience",
    );
});

test("an explicit friend mute still wins over automatic clanmate Home inclusion", async () => {
  await ctx.db.query(
    `insert into claim(account_id,player_tag,relationship,notify)
     values($1,$2,'friend',false)`,
    [people.reader, AUTHOR_TAG],
  );
  await ctx.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [people.reader, people.author],
  );
  try {
    assert.deepEqual(await list(), []);
    assert.equal(await count(), 0);
    assert.deepEqual(
      (
        await readVisiblePostPage(ctx.db, people.reader, {
          ...window(),
          clanmates: true,
        })
      ).items,
      [],
    );
    assert.equal(
      (await readVisiblePost(ctx.db, people.reader, post.id, { plain: true }))
        .post.id,
      post.id,
      "a feed mute does not revoke an accessible member destination",
    );
    assert.deepEqual(
      ids(await readVisiblePosts(ctx.db, people.reader, window())),
      [post.id],
      "existing delivery logic is unchanged",
    );
  } finally {
    await ctx.db.query(
      `delete from account_follow where account_id=$1 and followed_account_id=$2`,
      [people.reader, people.author],
    );
    await ctx.db.query(
      `delete from claim where account_id=$1 and player_tag=$2`,
      [people.reader, AUTHOR_TAG],
    );
  }
});

test("friend and clanmate overlap is counted once and unfriending retains the current clan audience", async () => {
  await ctx.db.query(
    `insert into claim(account_id,player_tag,relationship,notify)
     values($1,$2,'friend',true)`,
    [people.reader, AUTHOR_TAG],
  );
  await ctx.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [people.reader, people.author],
  );
  try {
    assert.deepEqual(
      ids(
        await list({
          subjects: [
            { kind: "player", tag: AUTHOR_TAG, relationship: "friend" },
          ],
        }),
      ),
      [post.id],
    );
    assert.equal(await count(), 1);
  } finally {
    await ctx.db.query(
      `delete from account_follow where account_id=$1 and followed_account_id=$2`,
      [people.reader, people.author],
    );
    await ctx.db.query(
      `delete from claim where account_id=$1 and player_tag=$2`,
      [people.reader, AUTHOR_TAG],
    );
  }
  assert.deepEqual(ids(await list()), [post.id]);
  assert.equal(await count(), 1);
});

test("an edit is current state, never a newly-created clanmate post", async () => {
  await ctx.db.query(
    `update account_post set created_at=now()-interval '2 hours',updated_at=now(),revision=2
     where post_id=$1`,
    [post.id],
  );
  try {
    assert.deepEqual(ids(await list()), [post.id]);
    assert.equal(await count(), 0);
  } finally {
    await ctx.db.query(
      `update account_post set created_at=now()-interval '1 minute',updated_at=null,revision=1
       where post_id=$1`,
      [post.id],
    );
  }
});

test("newer explicit absence closes stale roster access on every clan post reader", async () => {
  for (const tag of [READER_TAG, AUTHOR_TAG]) {
    await ctx.db.query(
      `insert into player_profile_membership(player_tag,state,observed_at)
       values($1,'none',now())`,
      [tag],
    );
    try {
      assert.deepEqual(await list(), []);
      assert.equal(await count(), 0);
      assert.equal(
        await readVisiblePost(ctx.db, people.reader, post.id, { plain: true }),
        null,
        `${tag} left despite an older open membership row`,
      );
      assert.deepEqual(
        await clanPosts(ctx.db, people.reader, clanWindow()),
        [],
      );
      assert.deepEqual(
        await clanQuestionCounts(ctx.db, people.reader, clanWindow()),
        { questions: 0, unanswered: 0 },
      );
      assert.deepEqual(
        await postsBy(ctx.db, people.reader, {
          subjects: [],
          playerTag: AUTHOR_TAG,
          plain: true,
          clanmates: true,
        }),
        [],
      );
      assert.deepEqual(
        await list({
          subjects: [
            { kind: "player", tag: AUTHOR_TAG, relationship: "clanmate" },
          ],
        }),
        [],
        "a kept Home subject cannot substitute for current membership",
      );
    } finally {
      await ctx.db.query(
        `delete from player_profile_membership where player_tag=$1`,
        [tag],
      );
    }
  }
});

test("an explicit follow survives departure while the Clan source closes", async () => {
  await ctx.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [people.reader, people.author],
  );
  await ctx.db.query(
    `update clan_membership set left_observed_at=now() where player_tag=$1`,
    [AUTHOR_TAG],
  );
  try {
    assert.deepEqual(ids(await list()), [post.id]);
    assert.equal(await count(), 1);
    assert.equal(
      (await readVisiblePost(ctx.db, people.reader, post.id, { plain: true }))
        .post.id,
      post.id,
    );
    assert.deepEqual(await clanPosts(ctx.db, people.reader, clanWindow()), []);
  } finally {
    await ctx.db.query(
      `delete from account_follow where account_id=$1 and followed_account_id=$2`,
      [people.reader, people.author],
    );
    await ctx.db.query(
      `update clan_membership set left_observed_at=null where player_tag=$1`,
      [AUTHOR_TAG],
    );
  }
});

test("both block directions close clanmate posts and counts without erasing membership", async () => {
  for (const [blocker, blocked] of [
    [people.reader, people.author],
    [people.author, people.reader],
  ]) {
    await ctx.db.query(
      `insert into account_block(account_id,blocked_account_id) values($1,$2)`,
      [blocker, blocked],
    );
    try {
      assert.deepEqual(await list(), []);
      assert.equal(await count(), 0);
      assert.equal(
        await readVisiblePost(ctx.db, people.reader, post.id, { plain: true }),
        null,
      );
      assert.deepEqual(
        await clanPosts(ctx.db, people.reader, clanWindow()),
        [],
      );
      assert.deepEqual(
        await clanQuestionCounts(ctx.db, people.reader, clanWindow()),
        { questions: 0, unanswered: 0 },
      );
    } finally {
      await ctx.db.query(
        `delete from account_block where account_id=$1 and blocked_account_id=$2`,
        [blocker, blocked],
      );
    }
  }
});

test("an unrelated reader cannot use the Clan readers as an audience bypass", async () => {
  assert.deepEqual(await clanPosts(ctx.db, people.stranger, clanWindow()), []);
  assert.deepEqual(
    await clanQuestionCounts(ctx.db, people.stranger, clanWindow()),
    { questions: 0, unanswered: 0 },
  );
  assert.deepEqual(ids(await clanPosts(ctx.db, people.reader, clanWindow())), [
    post.id,
  ]);
});

test("clanmate post readers probe the named roster before caps and hydration", async () => {
  await ctx.db.query(
    `insert into account_post(item_id,account_id,player_tag,body,question,created_at)
     select 'tl_' || lpad(to_hex(1000+i),20,'0'),
       case when i<=100 then $1::uuid else $2::uuid end,
       case when i<=100 then $3 else $4 end,'Invented post',false,now()
       from generate_series(1,10000) i`,
    [people.author, people.stranger, AUTHOR_TAG, STRANGER_TAG],
  );
  await ctx.db.query("analyze account_post");
  const calls = [];
  const tracked = {
    query(sql, values) {
      calls.push({ sql, values });
      return ctx.db.query(sql, values);
    },
  };
  const nodes = (node) => [node, ...(node.Plans ?? []).flatMap(nodes)];
  const options = { ...window(), clanmates: true, limit: 10 };
  for (const [label, read] of [
    [
      "page",
      async () => {
        const page = await readVisiblePostPage(tracked, people.reader, options);
        assert.equal(page.items.length, 10);
        assert.equal(page.more, 91);
      },
    ],
    [
      "Home",
      async () => {
        assert.equal(
          (await readVisiblePosts(tracked, people.reader, options)).length,
          10,
        );
      },
    ],
    [
      "New count",
      async () => {
        assert.equal(
          await countNewPosts(
            tracked,
            people.reader,
            Date.now() - 3600_000,
            options,
          ),
          101,
        );
      },
    ],
  ]) {
    calls.length = 0;
    await read();
    const query = calls[0];
    const result = await ctx.db.query(
      `explain (analyze,buffers,format json) ${query.sql}`,
      query.values,
    );
    const work = nodes(result.rows[0]["QUERY PLAN"][0].Plan)
      .filter((node) => node["Relation Name"] === "account_post")
      .reduce(
        (sum, node) =>
          sum +
          ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) *
            node["Actual Loops"],
        0,
      );
    assert.ok(
      work <= 600,
      `${label} inspected ${work} post rows for a 101-post audience`,
    );
  }
  assert.deepEqual(ids(await list({ questionsOnly: true, limit: 1 })), [
    post.id,
  ]);
  assert.equal(await count({ questionsOnly: true }), 1);
});
