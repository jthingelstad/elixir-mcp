/** Comment eligibility for canonical visible game, people and post items.
 * Source access is checked by the caller; this suite pins audience, storage,
 * moderation and current-owner rights on that admitted item. Invented people. */
import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { ensurePassport } from "@elixir-mcp/stamps";
import { readBell } from "../src/bell.mjs";
import {
  withComments,
  commentsOnItem,
  postComment,
  deleteComment,
} from "../src/comments.mjs";

const READER_TAG = "#0LCVJ8YR";
const OTHER_TAG = "#0UVC8J9R";
const OLD_TAG = "#0PJ8LQ2Y";
const NEW_TAG = "#0YRL2GQP";
const TARGET = "#0QYC9U2P";
const CLAN = "#0RQYGC2L";
const id = (n) => `tl_${String(n).padStart(20, "0")}`;
const playerItem = {
  id: id(111),
  kind: "member_joined",
  section: "roster",
  visibility: "public",
  text: "Invented Player joined Invented Clan",
  subjects: [
    { kind: "player", tag: TARGET },
    { kind: "clan", tag: CLAN },
  ],
};
const clanItem = {
  id: id(112),
  kind: "race_finished",
  section: "war",
  visibility: "public",
  text: "Invented Clan finished its River Race",
  subjects: [{ kind: "clan", tag: CLAN }],
};
let scratch, reader, other, oldOwner, newOwner, unverified, oldPage;
let calls, allow;
const config = {
  enabled: true,
  capUsd: 10,
  moderate: async () => {
    calls++;
    return {
      ok: true,
      input: { allow, category: allow ? "none" : "harassment" },
      usage: { input_tokens: 100, output_tokens: 10 },
    };
  },
};
const card = async (who, item = playerItem) =>
  (await withComments(scratch.db, [item], who, { enabled: true }))[0];
const account = async (label, tag) => {
  const {
    rows: [row],
  } = await scratch.db.query(
    `insert into account(email_hash,status) values($1,'approved') returning account_id`,
    [label],
  );
  if (tag)
    await scratch.db.query(
      `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at) values($1,$2,'verified',true,'primary',now())`,
      [row.account_id, tag],
    );
  return row.account_id;
};
const verify = async (owner) => {
  await scratch.db.query(`delete from claim where player_tag=$1`, [TARGET]);
  await scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at) values($1,$2,'verified',false,'alt',now())`,
    [owner, TARGET],
  );
};
before(async () => {
  scratch = await scratchDb("ownerless_comments");
  for (const tag of [READER_TAG, OTHER_TAG, OLD_TAG, NEW_TAG, TARGET])
    await scratch.db.query(
      `insert into player(player_tag,name) values($1,'Invented Player')`,
      [tag],
    );
  reader = await account("ownerless-reader", READER_TAG);
  other = await account("ownerless-other", OTHER_TAG);
  oldOwner = await account("ownerless-old", OLD_TAG);
  newOwner = await account("ownerless-new", NEW_TAG);
  unverified = await account("ownerless-unverified");
  oldPage = (await ensurePassport(scratch.db, oldOwner)).passport_id;
});
after(async () => scratch?.drop());
beforeEach(async () => {
  await scratch.db.query(
    "truncate timeline_comment, comment_check, comment_setting, account_block, account_follow cascade",
  );
  await scratch.db.query(`delete from claim where player_tag=$1`, [TARGET]);
  calls = 0;
  allow = true;
});

test("an unclaimed public player moment carries an open, moderated thread", async () => {
  assert.deepEqual((await card(reader)).comments, {
    count: 0,
    latest: [],
    open: true,
  });
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    playerItem,
    "Good game in that race",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(calls, 1);
  const {
    rows: [stored],
  } = await scratch.db.query(
    `select subject_tag,owner_account_id from timeline_comment where comment_id=$1`,
    [out.comment.id],
  );
  assert.equal(stored.subject_tag, TARGET);
  assert.equal(stored.owner_account_id, null);
  assert.equal((await card(other)).comments.count, 1);
  assert.equal(
    (await commentsOnItem(scratch.db, other, playerItem)).comments[0].text,
    "Good game in that race",
  );
});

test("a clan-only public game moment stores no invented player or owner", async () => {
  assert.equal((await card(reader, clanItem)).comments.open, true);
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    clanItem,
    "A close River Race",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  const {
    rows: [stored],
  } = await scratch.db.query(
    `select subject_tag,owner_account_id from timeline_comment where comment_id=$1`,
    [out.comment.id],
  );
  assert.deepEqual(stored, { subject_tag: null, owner_account_id: null });
  assert.equal(
    (await deleteComment(scratch.db, { accountId: other }, out.comment.id))
      .error,
    "not_found",
  );
  assert.equal(
    (await deleteComment(scratch.db, { accountId: reader }, out.comment.id))
      .deleted,
    true,
  );
});

test("unverified and suspended people cannot write ownerless threads or call the model", async () => {
  assert.equal((await card(unverified)).comments.open, false);
  assert.equal(
    (
      await postComment(
        scratch.db,
        { accountId: unverified },
        playerItem,
        "A friendly game",
        config,
      )
    ).error,
    "not_verified",
  );
  await scratch.db.query(
    `insert into comment_setting(account_id,suspended_until) values($1,now()+interval '1 hour')`,
    [reader],
  );
  assert.equal((await card(reader)).comments.open, false);
  assert.equal(
    (
      await postComment(
        scratch.db,
        { accountId: reader },
        playerItem,
        "A friendly game",
        config,
      )
    ).error,
    "not_open",
  );
  assert.equal(calls, 0);
});

test("ownerless comments retain moderation and two-way block visibility", async () => {
  allow = false;
  const refused = await postComment(
    scratch.db,
    { accountId: reader },
    playerItem,
    "That game was rough",
    config,
  );
  assert.equal(refused.error, "refused");
  assert.equal((await card(reader)).comments.count, 0);
  allow = true;
  const out = await postComment(
    scratch.db,
    { accountId: other },
    playerItem,
    "The final battle was close",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal((await card(reader)).comments.count, 1);
  await scratch.db.query(
    `insert into account_block(account_id,blocked_account_id) values($1,$2)`,
    [reader, other],
  );
  assert.equal((await card(reader)).comments.count, 0);
  assert.deepEqual(
    (await commentsOnItem(scratch.db, reader, playerItem)).comments,
    [],
  );
  assert.equal(
    (await card(other)).comments.count,
    1,
    "its author keeps their own comment",
  );
});

test("verification gives the current game-player owner removal rights over prior ownerless comments", async () => {
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    playerItem,
    "A strong final defence",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  await verify(oldOwner);
  assert.equal((await card(oldOwner)).comments.latest[0].can_delete, true);
  const removed = await deleteComment(
    scratch.db,
    { accountId: oldOwner },
    out.comment.id,
  );
  assert.equal(removed.removed, true, JSON.stringify(removed));
});

test("a game-player reassignment transfers moderation rights and respects the current owner audience", async () => {
  await verify(oldOwner);
  await scratch.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [reader, oldOwner],
  );
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    playerItem,
    "A great match from both sides",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  await verify(newOwner);
  assert.equal((await card(oldOwner)).comments.latest[0].can_delete, false);
  assert.equal((await card(newOwner)).comments.latest[0].can_delete, true);
  assert.equal(
    (await card(reader)).comments.open,
    false,
    "following the former owner does not open the new owner audience",
  );
  assert.equal(
    (await deleteComment(scratch.db, { accountId: oldOwner }, out.comment.id))
      .error,
    "not_found",
  );
  assert.equal(
    (await deleteComment(scratch.db, { accountId: newOwner }, out.comment.id))
      .removed,
    true,
  );
});

test("a people moment retains its canonical account owner when its displayed tag changes hands", async () => {
  await verify(oldOwner);
  await scratch.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [reader, oldOwner],
  );
  const item = {
    ...playerItem,
    id: id(113),
    kind: "stamp_earned",
    section: "people",
    visibility: undefined,
    facts: {
      account_id: oldPage,
      stamps: [{ stamp_id: "storyteller", level: 1 }],
    },
  };
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    item,
    "A fun Stamp to earn",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  await verify(newOwner);
  assert.equal(
    (await card(reader, item)).comments.open,
    true,
    "the canonical account audience stays open after a displayed tag moves",
  );
  assert.equal(
    (await card(newOwner, item)).comments.open,
    false,
    "the new tag owner is not the owner of this account event",
  );
  assert.equal(
    (await card(oldOwner, item)).comments.latest[0].can_delete,
    true,
  );
  assert.equal(
    (await card(newOwner, item)).comments.latest[0].can_delete,
    false,
  );
  assert.equal(
    (await deleteComment(scratch.db, { accountId: newOwner }, out.comment.id))
      .error,
    "not_found",
  );
  assert.equal(
    (await deleteComment(scratch.db, { accountId: oldOwner }, out.comment.id))
      .removed,
    true,
  );
});

test("a public-looking post without its canonical author never opens an ownerless thread", async () => {
  const item = {
    ...playerItem,
    id: id(114),
    kind: "post",
    post: { id: "9", author: { account_id: reader } },
  };
  assert.equal((await card(reader, item)).comments, null);
  assert.equal(
    (
      await postComment(
        scratch.db,
        { accountId: reader },
        item,
        "A friendly answer",
        config,
      )
    ).error,
    "not_open",
  );
  assert.equal(calls, 0);
});

test("an admitted private Clan fact allows verified readers but never creates an owner receipt", async () => {
  await verify(oldOwner);
  await scratch.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [reader, oldOwner],
  );
  const item = {
    ...playerItem,
    id: id(115),
    kind: "member_away",
    section: "attested",
    visibility: "leaders",
  };
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    item,
    "This war week is still open",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(
    (await card(oldOwner, item)).comments.latest[0].can_delete,
    true,
  );
  assert.deepEqual(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items,
    [],
  );
  const stored = (
    await scratch.db.query(
      `select owner_account_id,owner_is_account,receipt_allowed from timeline_comment where comment_id=$1`,
      [out.comment.id],
    )
  ).rows[0];
  assert.deepEqual(stored, {
    owner_account_id: oldOwner,
    owner_is_account: false,
    receipt_allowed: false,
  });
});

test("an admitted ownerless private Clan fact uses the same verified commenter rule", async () => {
  const item = {
    ...clanItem,
    id: id(116),
    kind: "clan_message",
    section: "attested",
    visibility: "clan",
  };
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    item,
    "A busy war week for the clan",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal((await card(other, item)).comments.count, 1);
  assert.equal((await card(unverified, item)).comments.open, false);
});

test("a People conversation never creates a receipt outside its admitted audience", async () => {
  await scratch.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [reader, oldOwner],
  );
  const item = {
    ...playerItem,
    id: id(117),
    kind: "place_set",
    section: "people",
    visibility: "member",
    facts: { account_id: oldPage },
  };
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    item,
    "A fun game to play together",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items,
    [],
  );
});

test("a reassigned public-game comment is not delivered to the former owner", async () => {
  await verify(oldOwner);
  await scratch.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [reader, oldOwner],
  );
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    playerItem,
    "A good final battle",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items
      .length,
    1,
  );
  await verify(newOwner);
  assert.deepEqual(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items,
    [],
  );
});

test("unknown kinds and account administration never gain a thread", async () => {
  for (const item of [
    { ...playerItem, kind: "unknown_kind" },
    { ...playerItem, kind: "account", section: "account" },
    { ...playerItem, kind: "account_feedback_responded" },
    { ...playerItem, kind: "battle_highlight" },
    { ...playerItem, kind: "stamp_earned", section: "people", facts: {} },
  ]) {
    assert.equal(
      (
        await postComment(
          scratch.db,
          { accountId: reader },
          item,
          "A friendly game",
          config,
        )
      ).error,
      "not_open",
      item.kind,
    );
  }
  assert.equal(calls, 0);
});

test("a newly verified owner can close the audience while a comment is checked", async () => {
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    playerItem,
    "A strong war week",
    {
      ...config,
      moderate: async () => {
        await verify(oldOwner);
        await scratch.db.query(
          `insert into comment_setting(account_id,who) values($1,'nobody')`,
          [oldOwner],
        );
        return config.moderate();
      },
    },
  );
  assert.equal(out.error, "not_open");
  assert.equal((await card(oldOwner)).comments.count, 0);
});

test("public-game receipts retain the canonical two-way comment visibility predicate", async () => {
  await verify(oldOwner);
  await scratch.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [reader, oldOwner],
  );
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    playerItem,
    "A good finish to the race",
    config,
  );
  assert.equal(out.ok, true);
  assert.equal(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items
      .length,
    1,
  );
  await scratch.db.query(
    `insert into comment_report(comment_id,account_id,reason) values($1,$2,'other')`,
    [out.comment.id, oldOwner],
  );
  assert.deepEqual(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items,
    [],
  );
  await scratch.db.query(`delete from comment_report where comment_id=$1`, [
    out.comment.id,
  ]);
  await scratch.db.query(
    `insert into account_block(account_id,blocked_account_id) values($1,$2)`,
    [reader, oldOwner],
  );
  assert.deepEqual(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items,
    [],
  );
});

test("an owned item still obeys nobody and following settings, independently of source admission", async () => {
  await verify(oldOwner);
  await scratch.db.query(
    `insert into comment_setting(account_id,who) values($1,'nobody')`,
    [oldOwner],
  );
  assert.equal((await card(reader)).comments.open, false);
  assert.equal((await card(oldOwner)).comments.open, true);
  await scratch.db.query(
    `update comment_setting set who='following' where account_id=$1`,
    [oldOwner],
  );
  assert.equal((await card(reader)).comments.open, false);
  await scratch.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [oldOwner, reader],
  );
  assert.equal((await card(reader)).comments.open, true);
});

test("source access revoked during moderation prevents the insert", async () => {
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    clanItem,
    "A strong final race",
    { ...config, canSee: async () => false },
  );
  assert.equal(calls, 1, "the source is checked again after moderation");
  assert.equal(out.error, "not_open");
  assert.equal((await card(reader, clanItem)).comments.count, 0);
});

test("owner removal requires admitted source access while authors may erase their own words", async () => {
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    playerItem,
    "A great race to watch",
    config,
  );
  await verify(oldOwner);
  assert.equal(
    (
      await deleteComment(scratch.db, { accountId: oldOwner }, out.comment.id, {
        canSee: async () => false,
      })
    ).error,
    "not_found",
  );
  assert.equal(
    (
      await deleteComment(scratch.db, { accountId: reader }, out.comment.id, {
        canSee: async () => false,
      })
    ).deleted,
    true,
  );
});

test("a removed canonical post cannot turn its retained account-owned comment into a game receipt", async () => {
  const item = { ...playerItem, id: id(118), kind: "post" };
  await scratch.db.query(
    `insert into account_post(item_id,account_id,player_tag,body)
    values($1,$2,$3,'Invented post for a retained comment')`,
    [item.id, oldOwner, TARGET],
  );
  await scratch.db.query(
    `insert into timeline_comment(item_id,account_id,subject_tag,owner_account_id,body)
    values($1,$2,$3,$4,'A retained answer')`,
    [item.id, reader, TARGET, oldOwner],
  );
  assert.equal(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items
      .length,
    1,
  );
  await scratch.db.query(`delete from account_post where item_id=$1`, [
    item.id,
  ]);
  assert.deepEqual(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items,
    [],
  );
  assert.equal((await card(oldOwner, item)).comments, null);
});

test("an admitted Drop game uses canonical player ownership and retains its owner receipt", async () => {
  await verify(oldOwner);
  await scratch.db.query(
    `insert into account_follow(account_id,followed_account_id) values($1,$2)`,
    [reader, oldOwner],
  );
  const item = {
    ...playerItem,
    id: id(119),
    kind: "drop_game",
    section: "attested",
    visibility: "player",
    facts: {
      player_tag: TARGET,
      name: "Invented Player",
      game_id: "00000000-0000-4000-8000-000000000001",
      mode: "practice",
      started_at: "2026-11-14T12:00:00Z",
      score: 4,
      answers: 4,
      cards: [26000000],
    },
  };
  const out = await postComment(
    scratch.db,
    { accountId: reader },
    item,
    "A fun game to play",
    config,
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  const stored = (
    await scratch.db.query(
      `select subject_tag,owner_account_id,owner_is_account,receipt_allowed from timeline_comment where comment_id=$1`,
      [out.comment.id],
    )
  ).rows[0];
  assert.deepEqual(stored, {
    subject_tag: TARGET,
    owner_account_id: oldOwner,
    owner_is_account: false,
    receipt_allowed: true,
  });
  assert.equal(
    (await card(oldOwner, item)).comments.latest[0].can_delete,
    true,
  );
  assert.equal(
    (await readBell(scratch.db, oldOwner, { comments: true })).comments.items
      .length,
    1,
  );
});
