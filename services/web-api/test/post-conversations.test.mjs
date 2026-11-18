/** Questions are posts: source-filtered before caps, with an author's
 * reversible state and private, coalesced reply notifications. Synthetic data. */
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { ownFeedItem } from "../src/cheers.mjs";
import { battlePostRows } from "../../../packages/posts/src/battle.mjs";
import { buildTimeline } from "../../../packages/tools/src/activity/entries.mjs";
import { readPostTimeline } from "../../../packages/tools/src/activity/posts.mjs";
import { readBell } from "../src/bell.mjs";
import { readFile } from "node:fs/promises";
import {
  commentsOnItem,
  readCommentCursor,
  withComments,
  postComment,
  deleteComment,
} from "../src/comments.mjs";
import { setQuestionAnswered } from "../src/posts.mjs";
import {
  readVisiblePosts,
  clanPosts,
  clanQuestionCounts,
  countNewPosts,
} from "@elixir-mcp/posts";

let scratch, owner, other, question, normal;
const TAG = "#0PGQ2UYL";
const CLAN = "#0VGJQ28P";
const opts = { plain: true };
async function post(n, isQuestion = false, minutes = 1) {
  return (
    await scratch.db.query(
      `insert into account_post
    (item_id,account_id,player_tag,body,question,created_at)
    values ($1,$2,$3,'Invented words',$4,now()-make_interval(mins=>$5))
    returning post_id::text as id,item_id,created_at,updated_at,revision`,
      [`tl_${String(n).padStart(20, "0")}`, owner, TAG, isQuestion, minutes],
    )
  ).rows[0];
}
async function comment(p, body, minutes, who = other, status = "visible") {
  await scratch.db.query(
    `insert into timeline_comment
    (item_id,account_id,subject_tag,owner_account_id,body,created_at,status)
    values($1,$2,$3,$4,$5,now()-make_interval(mins=>$6),$7)`,
    [p.item_id, who, TAG, owner, body, minutes, status],
  );
}
before(async () => {
  scratch = await scratchDb("post_conversations");
  const { db } = scratch;
  owner = (
    await db.query(
      `insert into account(email_hash,status) values('question-author','approved') returning account_id`,
    )
  ).rows[0].account_id;
  other = (
    await db.query(
      `insert into account(email_hash,status) values('question-reader','approved') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into player(player_tag,name) values($1,'Invented Author')`,
    [TAG],
  );
  await db.query(`insert into clan(clan_tag,name) values($1,'Invented Clan')`, [
    CLAN,
  ]);
  await db.query(
    `insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values($1,$2,now(),'member')`,
    [CLAN, TAG],
  );
  question = await post(1, true, 50);
  normal = await post(2, false, 40);
  for (let n = 3; n <= 105; n++) await post(n, false, 1);
});
after(async () => {
  await scratch?.drop();
});

test("Questions is a complete source view before Home and Clan post caps", async () => {
  const window = {
    subjects: [],
    fromMs: Date.now() - 86400000,
    toMs: Date.now(),
    plain: true,
    questionsOnly: true,
    limit: 3,
  };
  assert.deepEqual(
    (await readVisiblePosts(scratch.db, owner, window)).map((it) => it.post.id),
    [question.id],
  );
  assert.deepEqual(
    (await clanPosts(scratch.db, owner, { ...window, clanTag: CLAN })).map(
      (it) => it.post.id,
    ),
    [question.id],
  );
  assert.equal(
    (
      await readVisiblePosts(scratch.db, owner, {
        ...window,
        questionsOnly: false,
      })
    ).length,
    3,
  );
});
test("Unanswered skips resolved questions before the clan cap and counts the permitted source", async () => {
  for (let n = 200; n < 310; n++) await post(n, true, 1);
  await scratch.db.query(
    `update account_post set answered_at=now() where question and post_id<>$1`,
    [question.id],
  );
  const window = {
    clanTag: CLAN,
    fromMs: Date.now() - 86400000,
    toMs: Date.now(),
    plain: true,
    questionsOnly: true,
    unansweredOnly: true,
  };
  const open = await clanPosts(scratch.db, owner, window);
  assert.deepEqual(
    open.map((it) => it.post.id),
    [question.id],
  );
  assert.deepEqual(await clanQuestionCounts(scratch.db, owner, window), {
    questions: 111,
    unanswered: 1,
  });
});

test("answer-state edits keep creation order but advance the current-state observed revision; repeats, new counts and digest stay quiet", async () => {
  const db = scratch.db;
  const since = Date.now() - 120000;
  const fresh = await countNewPosts(db, owner, since, opts);
  assert.equal(
    (
      await setQuestionAnswered(
        db,
        { accountId: other },
        question.id,
        true,
        opts,
      )
    ).error,
    "not_found",
  );
  assert.equal(
    (await setQuestionAnswered(db, { accountId: owner }, normal.id, true, opts))
      .error,
    "not_found",
  );
  assert.equal(
    (
      await setQuestionAnswered(
        db,
        { accountId: owner },
        question.id,
        "yes",
        opts,
      )
    ).error,
    "bad_request",
  );
  assert.equal(
    (await setQuestionAnswered(db, { accountId: owner }, question.id, true, {}))
      .error,
    "posts_off",
  );
  const from = Date.now() - 1;
  const marked = await setQuestionAnswered(
    db,
    { accountId: owner },
    question.id,
    true,
    opts,
  );
  const markTo = Date.now();
  const poll = async (fromMs, toMs) =>
    (
      await readPostTimeline(db, owner, {
        subjects: [],
        fromMs,
        toMs,
        basis: "observed",
        timezone: "UTC",
      })
    ).items.filter((it) => it.facts.post_id === question.id);
  const seen = await poll(from, markTo);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].facts.answered, true);
  assert.equal(seen[0].revision, Number(question.revision) + 1);
  assert.equal(seen[0].id, question.item_id);
  assert.equal(seen[0].at, question.created_at.toISOString());
  assert.equal(seen[0].sort_at, question.created_at.toISOString());
  assert.equal("comments" in seen[0], false);
  assert.equal("post" in seen[0], false);
  const row = async () =>
    (
      await db.query(
        "select created_at,updated_at,revision from account_post where post_id=$1",
        [question.id],
      )
    ).rows[0];
  const edited = await row();
  assert.equal(
    edited.created_at.toISOString(),
    question.created_at.toISOString(),
  );
  assert.ok(edited.updated_at);
  assert.equal(edited.revision, Number(question.revision) + 1);
  assert.equal(marked.post.post.edited, true);
  assert.equal(
    (
      await setQuestionAnswered(
        db,
        { accountId: owner },
        question.id,
        true,
        opts,
      )
    ).changed,
    false,
  );
  assert.deepEqual(await row(), edited);
  assert.deepEqual(await poll(markTo, Date.now()), []);
  // Separate real query windows; this is a current-state poll, not a toggle log.
  await db.query("select pg_sleep(0.002)");
  const reopened = await setQuestionAnswered(
    db,
    { accountId: owner },
    question.id,
    false,
    opts,
  );
  const reopenTo = Date.now();
  const after = await poll(markTo, reopenTo);
  assert.equal(after.length, 1);
  assert.equal(after[0].facts.answered, false);
  assert.equal(after[0].revision, Number(question.revision) + 2);
  assert.equal(after[0].id, seen[0].id);
  assert.equal(after[0].sort_at, seen[0].sort_at);
  assert.equal(reopened.changed, true);
  const openRow = await row();
  assert.equal(
    (
      await setQuestionAnswered(
        db,
        { accountId: owner },
        question.id,
        false,
        opts,
      )
    ).changed,
    false,
  );
  assert.deepEqual(await row(), openRow);
  assert.deepEqual(await poll(reopenTo, Date.now()), []);
  assert.equal(await countNewPosts(db, owner, since, opts), fresh);
  const digest = await readVisiblePosts(db, owner, {
    subjects: [],
    fromMs: from,
    toMs: Date.now(),
    plain: true,
    visibleOnly: true,
    plainOnly: true,
    createdOnly: true,
  });
  assert.equal(
    digest.some((it) => it.post.id === question.id),
    false,
  );
});
test("post replies coalesce with unread counts, distinguish answers and preserve game comment behavior", async () => {
  const postBefore = (
    await scratch.db.query(
      "select revision,updated_at from account_post where post_id=$1",
      [question.id],
    )
  ).rows[0];
  await comment(question, "Earlier answer", 20);
  await comment(question, "Latest answer", 1);
  await comment(question, "Own answer", 0, owner);
  await comment(question, "Hidden answer", 0, other, "hidden");
  await comment(normal, "A comment", 2);
  const game = { item_id: "tl_99999999999999999999" };
  await scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values($1,$2,'verified',true,'primary',now())`,
    [owner, TAG],
  );
  await comment(game, "On your play", 3);
  await scratch.db.query(
    `insert into bell_seen(account_id,seen_at) values($1,now()-interval '10 minutes')`,
    [owner],
  );
  assert.deepEqual(
    (
      await scratch.db.query(
        "select revision,updated_at from account_post where post_id=$1",
        [question.id],
      )
    ).rows[0],
    postBefore,
  );
  const bell = await readBell(scratch.db, owner, {
    comments: true,
    posts: true,
  });
  const answer = bell.comments.items.find((c) => c.post_id === question.id);
  assert.equal(answer.count, 2);
  assert.equal(answer.unread_count, 1);
  assert.equal(answer.question, true);
  assert.equal(answer.new, true);
  assert.equal(answer.text, "Latest answer");
  assert.equal(
    bell.comments.items.filter((c) => c.post_id === question.id).length,
    1,
  );
  assert.equal(
    bell.comments.items.find((c) => c.post_id === normal.id).question,
    false,
  );
  assert.equal(
    bell.comments.items.find((c) => c.item_id === game.item_id).post_id,
    undefined,
  );
  await scratch.db.query(
    `delete from claim where account_id=$1 and player_tag=$2`,
    [owner, TAG],
  );
  await scratch.db.query(
    `update bell_seen set seen_at=now() where account_id=$1`,
    [owner],
  );
  const seen = await readBell(scratch.db, owner, {
    comments: true,
    posts: true,
  });
  assert.equal(seen.comments.new, 0);
  assert.equal(
    seen.comments.items.find((c) => c.post_id === question.id).count,
    2,
  );
  await comment(question, "A later answer", 0);
  assert.equal(
    await countNewPosts(scratch.db, owner, Date.now() - 500, opts),
    0,
  );
});
test("moderation and blocks remove a post conversation immediately", async () => {
  const db = scratch.db;
  await db.query(`update account_post set status='hidden' where post_id=$1`, [
    question.id,
  ]);
  assert.equal(
    (
      await readBell(db, owner, { comments: true, posts: true })
    ).comments.items.some((c) => c.post_id === question.id),
    false,
  );
  assert.equal(
    (
      await setQuestionAnswered(
        db,
        { accountId: owner },
        question.id,
        true,
        opts,
      )
    ).error,
    "not_found",
  );
  await db.query(
    `insert into account_block(account_id,blocked_account_id) values($1,$2)`,
    [owner, other],
  );
  assert.deepEqual(
    (await readBell(db, owner, { comments: true, posts: true })).comments.items,
    [],
  );
});

test("reported replies leave the notification's count, latest author and words", async () => {
  const db = scratch.db;
  await db.query("delete from account_block");
  await db.query(`update account_post set status='visible' where post_id=$1`, [
    question.id,
  ]);
  const newest = (
    await db.query(
      `select comment_id from timeline_comment where item_id=$1 and body='A later answer'`,
      [question.item_id],
    )
  ).rows[0];
  await db.query(
    `insert into comment_report(comment_id,account_id,reason) values($1,$2,'other')`,
    [newest.comment_id, owner],
  );
  const bell = await readBell(db, owner, { comments: true, posts: true });
  const reply = bell.comments.items.find((c) => c.post_id === question.id);
  assert.equal(reply.count, 2);
  assert.equal(reply.text, "Latest answer");
  assert.equal(reply.unread_count, 0);
});

test("a long thread anchors the notified visible reply and pages older without gaps", async () => {
  const db = scratch.db;
  await db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
    values($1,$2,'verified',true,'primary',now())`,
    [owner, TAG],
  );
  await db.query(
    `insert into timeline_comment(item_id,account_id,subject_tag,owner_account_id,body,created_at)
    select $1,$2,$3,$4,'Older answer ' || n,now()-interval '3 hours' + n*interval '1 microsecond'
    from generate_series(1,105) n`,
    [normal.item_id, other, TAG, owner],
  );
  const anchor = (
    await db.query(
      `select comment_id::text as id from timeline_comment where item_id=$1 and body='Older answer 105'`,
      [normal.item_id],
    )
  ).rows[0].id;
  const item = {
    id: normal.item_id,
    kind: "post",
    subjects: [{ kind: "player", tag: TAG }],
  };
  const first = await commentsOnItem(db, owner, item, { around: anchor });
  assert.equal(first.anchored, true);
  assert.equal(first.comments.at(-1).id, anchor);
  assert.equal(first.comments.length, 100);
  assert.ok(first.next_before);
  const second = await commentsOnItem(db, owner, item, {
    before: readCommentCursor(first.next_before),
  });
  assert.equal(second.comments.length, 5);
  assert.equal(second.next_before, null);
  assert.equal(
    new Set([...first.comments, ...second.comments].map((c) => c.id)).size,
    105,
  );
  assert.equal(readCommentCursor("bad"), null);
  for (const c of [
    { at: "2026-11-18T01:00:00.123456Z", id: "9223372036854775808" },
    { at: "2026-02-30T01:00:00.123456Z", id: "1" },
    { at: "November 18 2026", id: "1" },
    { at: "2026-11-18T99:00:00.123456Z", id: "1" },
  ])
    assert.equal(
      readCommentCursor(Buffer.from(JSON.stringify(c)).toString("base64url")),
      null,
    );
  const latest = await commentsOnItem(db, owner, item);
  assert.equal(latest.comments.at(-1).text, "A comment");
});

test("a post's author keeps its answers and settings when the player claim changes; stale writers normalize at storage", async () => {
  const db = scratch.db;
  const third = (
    await db.query(
      `insert into account(email_hash,status) values('question-third','approved') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `update claim set status='unverified',verified_at=null where account_id=$1 and player_tag=$2`,
    [owner, TAG],
  );
  await db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
    values($1,$2,'verified',true,'primary',now())`,
    [other, TAG],
  );
  await db.query(
    `insert into comment_setting(account_id,who) values($1,'nobody') on conflict(account_id) do update set who='nobody'`,
    [owner],
  );
  const oldWrite = (
    await db.query(
      `insert into timeline_comment(item_id,account_id,subject_tag,owner_account_id,body)
    values($1,$2,$3,$4,'Old writer, new reply') returning comment_id::text as id,owner_account_id`,
      [normal.item_id, third, TAG, other],
    )
  ).rows[0];
  assert.equal(oldWrite.owner_account_id, owner);
  await db.query(
    `update timeline_comment set owner_account_id=$2 where comment_id=$1`,
    [oldWrite.id, other],
  );
  assert.equal(
    (
      await db.query(
        "select owner_account_id from timeline_comment where comment_id=$1",
        [oldWrite.id],
      )
    ).rows[0].owner_account_id,
    owner,
  );
  const item = {
    id: normal.item_id,
    kind: "post",
    subjects: [{ kind: "player", tag: TAG }],
  };
  const summary = (await withComments(db, [item], owner, { enabled: true }))[0]
    .comments;
  assert.ok(summary.count > 100);
  assert.ok(summary.latest.some((c) => c.id === oldWrite.id && c.can_delete));
  const theirThread = await commentsOnItem(db, other, item);
  assert.equal(theirThread.open, false);
  assert.equal(
    theirThread.comments.find((c) => c.id === oldWrite.id).can_delete,
    false,
  );
  assert.equal(
    (
      await postComment(db, { accountId: other }, item, "No bypass", {
        enabled: true,
      })
    ).error,
    "not_open",
  );
  assert.equal(
    (await deleteComment(db, { accountId: other }, oldWrite.id)).error,
    "not_found",
  );
  assert.equal(
    (
      await readBell(db, owner, { comments: true, posts: true })
    ).comments.items.find((c) => c.post_id === normal.id).text,
    "Old writer, new reply",
  );
  assert.equal(
    (
      await readBell(db, other, { comments: true, posts: true })
    ).comments.items.some((c) => c.post_id === normal.id),
    false,
  );
  assert.equal(
    (await deleteComment(db, { accountId: owner }, oldWrite.id)).removed,
    true,
  );
  const game = {
    id: "tl_77777777777777777777",
    kind: "badge_earned",
    subjects: [{ kind: "player", tag: TAG }],
  };
  assert.equal(
    (await withComments(db, [game], other, { enabled: true }))[0].comments.open,
    true,
  );
});

test("the historical repair changes only a proven post owner stamp, keeping words, dates, moderation and game ownership", async () => {
  const db = scratch.db;
  const sql = await readFile(
    new URL(
      "../../../db/migrations/0297_question_answered.sql",
      import.meta.url,
    ),
    "utf8",
  );
  let id;
  await db.query(
    "alter table timeline_comment disable trigger timeline_comment_post_owner",
  );
  try {
    const row = (
      await db.query(
        `insert into timeline_comment(item_id,account_id,subject_tag,owner_account_id,body,created_at,status)
      values($1,$2,$3,$2,'Historical hidden answer',now()-interval '2 days','hidden') returning *`,
        [normal.item_id, other, TAG],
      )
    ).rows[0];
    id = row.comment_id;
    const game = (
      await db.query(
        `insert into timeline_comment(item_id,account_id,subject_tag,owner_account_id,body)
      values('tl_88888888888888888888',$1,$2,$1,'Game ownership unchanged') returning *`,
        [other, TAG],
      )
    ).rows[0];
    await db.query(sql.slice(sql.lastIndexOf("update timeline_comment tc")));
    const fixed = (
      await db.query("select * from timeline_comment where comment_id=$1", [id])
    ).rows[0];
    assert.equal(fixed.owner_account_id, owner);
    assert.deepEqual({ ...fixed, owner_account_id: row.owner_account_id }, row);
    assert.deepEqual(
      (
        await db.query("select * from timeline_comment where comment_id=$1", [
          game.comment_id,
        ])
      ).rows[0],
      game,
    );
  } finally {
    await db.query(
      "alter table timeline_comment enable trigger timeline_comment_post_owner",
    );
  }
});

test("a denied battle post cannot reopen its thread through an older game projection", async () => {
  const db = scratch.db;
  await db.query(`insert into battle(battle_id,battle_time,type,type_class,created_at)
    values('conversation-battle',now()-interval '1 minute','PvP','pvp',now())`);
  await db.query(
    `insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,crowns,outcome)
    values('conversation-battle',$1,now()-interval '1 minute',0,'PvP','pvp',3,'win')`,
    [TAG],
  );
  const post = (
    await db.query(
      `insert into account_post(item_id,account_id,player_tag,battle_id,body,created_at)
    values('tl_66666666666666666666',$1,$2,'conversation-battle','A battle conversation',now()-interval '1 minute') returning post_id::text as id,item_id`,
      [owner, TAG],
    )
  ).rows[0];
  const subjects = [{ kind: "player", tag: TAG }];
  const ask = {
    accountId: other,
    itemId: post.item_id,
    tags: [TAG],
    subjects,
    posts: true,
  };
  assert.equal((await ownFeedItem(db, ask)).kind, "post");
  const cached = await battlePostRows(
    db,
    "p.item_id=$2",
    [post.item_id],
    other,
  );
  assert.equal(cached.length, 1);
  // Replay only the older game projection. The canonical member-post read
  // still queries current visibility and is never replaced by this snapshot.
  const stale = {
    query: (sql, args) =>
      String(sql).includes("from account_post p") &&
      String(sql).includes("join account au")
        ? Promise.resolve({ rows: cached, rowCount: cached.length })
        : db.query(sql, args),
  };
  await db.query(
    `insert into post_report(post_id,account_id,reason) values($1,$2,'other')`,
    [post.id, other],
  );
  assert.equal(
    await ownFeedItem(stale, ask),
    null,
    "a reported post stays denied",
  );
  await db.query("delete from post_report where post_id=$1", [post.id]);
  for (const status of ["hidden", "removed"]) {
    await db.query(
      `update account_post set status=$2,removed_at=case when $2='removed' then now() else null end where post_id=$1`,
      [post.id, status],
    );
    assert.equal(await ownFeedItem(stale, ask), null, `${status} stays denied`);
  }
  await db.query(
    `update account_post set status='visible',removed_at=null where post_id=$1`,
    [post.id],
  );
  await db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [other, owner],
  );
  assert.equal(
    await ownFeedItem(stale, ask),
    null,
    "a blocked post stays denied",
  );
  await db.query(
    "delete from account_block where account_id=$1 and blocked_account_id=$2",
    [other, owner],
  );
  await db.query(
    `insert into clan_event(clan_tag,event_type,timing,occurred_at,window_start,window_end,player_tag,role_after)
    values($1,'member_joined','exact',now(),now(),now(),$2,'member')`,
    [CLAN, TAG],
  );
  const clanSubjects = [{ kind: "clan", tag: CLAN, scope: "comprehensive" }];
  const built = await buildTimeline(db, clanSubjects, {
    fromMs: Date.now() - 3600000,
    toMs: Date.now() + 1000,
    accountId: other,
    interactive: true,
    accountLines: false,
    lateCounts: false,
  });
  const game = built.timeline.find((it) => it.kind === "member_joined");
  assert.ok(game);
  assert.equal(
    (
      await ownFeedItem(db, {
        accountId: other,
        itemId: game.id,
        tags: [CLAN],
        subjects: clanSubjects,
        posts: true,
      })
    ).kind,
    "member_joined",
  );
});
