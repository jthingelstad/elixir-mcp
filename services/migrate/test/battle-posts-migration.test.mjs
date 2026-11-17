/**
 * 0292: a highlight is a post with a battle attached (Jamie, 2026-11-17).
 * Run here as the migrate runner does (one transaction around the file),
 * on a scratch database put back to the state before it, with highlights
 * in every state: words and none, edited, shared, posted in a clan's
 * Discord. Each becomes an account_post row with its author, player,
 * battle, words, times, revision, share link and Discord stamp, under the
 * item id the timeline served for it (storyId in @elixir-mcp/tools), so
 * cheers and comments keyed by that id still name it. After it, the old
 * table refuses writes, and a delete on it (the old code's, an account
 * removal's or a battle cascade's) takes the post with it. Invented tags.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { storyId } from "../../../packages/tools/src/activity/entries.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../db/migrations");

const TAG = "#0YVQPC";
const OTHER = "#0YVQPG";
const H = {
  plain: "00000000-0000-4000-8000-000000000001",
  shared: "00000000-0000-4000-8000-000000000002",
  bare: "00000000-0000-4000-8000-000000000003",
  later: "00000000-0000-4000-8000-000000000004",
  cascade: "00000000-0000-4000-8000-000000000005",
};

let scratch, sql, account;

/** Put the database back to 0290: undo what 0292 adds. */
async function before0292(db) {
  await db.query(`
    drop trigger battle_highlight_moved on battle_highlight;
    drop function battle_highlight_moved();
    delete from account_post where battle_id is not null;
    drop index account_post_player_battle, account_post_battle,
               account_post_player_changed;
    alter table account_post
      drop constraint account_post_battle_fkey,
      drop constraint account_post_share_battle,
      drop constraint account_post_battle_alone,
      drop constraint account_post_body_check,
      drop column battle_id, drop column share_id, drop column shared_at,
      drop column clan_discord_at, drop column clan_discord_clan,
      drop column revision, drop column updated_at;
    alter table account_post add constraint account_post_body_check
      check (char_length(body) between 1 and 500);
    alter table comment_check drop constraint comment_check_kind_check;
    alter table comment_check add constraint comment_check_kind_check
      check (kind in ('comment', 'post'));`);
}

async function battle(db, id, tags) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, '2026-11-10T12:00:00Z', 'PvP', 'pvp')`,
    [id],
  );
  for (const [side, tag] of tags.entries())
    await db.query(
      `insert into battle_participant
         (battle_id, player_tag, battle_time, side, type, type_class, outcome)
       values ($1, $2, '2026-11-10T12:00:00Z', $3, 'PvP', 'pvp', $4)`,
      [id, tag, side, side === 0 ? "win" : "loss"],
    );
}

async function runFile() {
  await scratch.db.query("begin");
  try {
    await scratch.db.query(sql);
    await scratch.db.query("commit");
  } catch (err) {
    await scratch.db.query("rollback");
    throw err;
  }
}

const posts = async () =>
  Object.fromEntries(
    (
      await scratch.db.query(
        `select item_id, account_id, player_tag, body, battle_id, share_id,
                shared_at, clan_discord_at, clan_discord_clan, revision,
                created_at, updated_at, status, deck, cards
           from account_post where battle_id is not null`,
      )
    ).rows.map((r) => [r.item_id, r]),
  );

before(async () => {
  scratch = await scratchDb("battle_posts_0292");
  const db = scratch.db;
  sql = await readFile(path.join(MIGRATIONS, "0292_battle_posts.sql"), "utf8");
  await before0292(db);
  for (const tag of [TAG, OTHER])
    await db.query(
      `insert into player (player_tag, name) values ($1, 'Invented')`,
      [tag],
    );
  ({
    rows: [{ account_id: account }],
  } = await db.query(
    `insert into account (email_hash, kind, status, role)
     values ('battle-posts-0292', 'person', 'approved', 'member')
     returning account_id`,
  ));
  for (const id of ["b-plain", "b-shared", "b-bare", "b-later", "b-cascade"])
    await battle(db, id, [TAG, OTHER]);
  const h = (id, battleId, extra = "") =>
    db.query(
      `insert into battle_highlight
         (highlight_id, player_tag, battle_id, account_id, words,
          created_at, updated_at${extra ? ", " + extra.cols : ""})
       values ($1, $2, $3, $4, $5, '2026-11-10T13:00:00Z',
               '2026-11-10T13:00:00Z'${extra ? ", " + extra.vals : ""})`,
      [id, TAG, battleId, account, extra.words ?? "what a game"],
    );
  await h(H.plain, "b-plain");
  await h(H.shared, "b-shared", {
    cols: "share_id, shared_at, clan_discord_at, clan_discord_clan, revision",
    vals: `'abcdefghij23456', '2026-11-10T14:00:00Z',
           '2026-11-10T15:00:00Z', '#0YVQPJ', 3`,
    words: "edited twice",
  });
  await h(H.bare, "b-bare", { cols: "revision", vals: "1", words: "" });
  await h(H.later, "b-later");
  await h(H.cascade, "b-cascade");
  // A plain post written before 0292: untouched.
  await db.query(
    `insert into account_post (item_id, account_id, player_tag, body)
     values ('tl_00000000000000000001', $1, $2, 'just words')`,
    [account, TAG],
  );
});
after(async () => scratch?.drop());

test("0292 copies every highlight into a post under the id the timeline served", async () => {
  await runFile();
  const got = await posts();
  const id = (h) => storyId("battle_highlight", h);
  assert.deepEqual(
    Object.keys(got).sort(),
    Object.values(H).map(id).sort(),
  );
  const shared = got[id(H.shared)];
  assert.equal(shared.account_id, account);
  assert.equal(shared.player_tag, TAG);
  assert.equal(shared.battle_id, "b-shared");
  assert.equal(shared.body, "edited twice");
  assert.equal(shared.share_id, "abcdefghij23456");
  assert.equal(shared.shared_at.toISOString(), "2026-11-10T14:00:00.000Z");
  assert.equal(
    shared.clan_discord_at.toISOString(),
    "2026-11-10T15:00:00.000Z",
  );
  assert.equal(shared.clan_discord_clan, "#0YVQPJ");
  assert.equal(shared.revision, 3);
  assert.equal(shared.created_at.toISOString(), "2026-11-10T13:00:00.000Z");
  assert.equal(shared.status, "visible");
  assert.equal(shared.deck, null);
  assert.deepEqual(shared.cards, []);
  // Words were optional on a highlight and stay so on a battle post.
  assert.equal(got[id(H.bare)].body, "");
  // The plain post is as it was.
  const {
    rows: [plain],
  } = await scratch.db.query(
    `select body, battle_id, revision from account_post
      where item_id = 'tl_00000000000000000001'`,
  );
  assert.deepEqual(plain, { body: "just words", battle_id: null, revision: 1 });
});

test("after 0292 the old table refuses writes, and a delete takes the post", async () => {
  const db = scratch.db;
  await assert.rejects(
    db.query(`update battle_highlight set words = 'x' where highlight_id = $1`, [
      H.plain,
    ]),
    (err) => err.code === "25006",
  );
  await assert.rejects(
    db.query(
      `insert into battle_highlight (player_tag, battle_id, account_id)
       values ($1, 'b-plain', $2)`,
      [OTHER, account],
    ),
    (err) => err.code === "25006",
  );
  // The old code's delete (or an account removal's).
  await db.query(`delete from battle_highlight where highlight_id = $1`, [
    H.later,
  ]);
  // A participant the record drops (retention deletes them before the
  // battle) cascades to both.
  await db.query(
    `delete from battle_participant where battle_id = 'b-cascade'`,
  );
  const left = await posts();
  assert.equal(left[storyId("battle_highlight", H.later)], undefined);
  assert.equal(left[storyId("battle_highlight", H.cascade)], undefined);
  assert.ok(left[storyId("battle_highlight", H.plain)]);
});

test("after 0292 a post's battle excludes a deck, and only a battle post may be empty", async () => {
  const db = scratch.db;
  await assert.rejects(
    db.query(
      `insert into account_post (item_id, account_id, player_tag, body)
       values ('tl_00000000000000000002', $1, $2, '')`,
      [account, TAG],
    ),
    /account_post_body_check/,
  );
  await assert.rejects(
    db.query(
      `insert into account_post (item_id, account_id, player_tag, body, battle_id, cards)
       values ('tl_00000000000000000003', $1, $2, 'x', 'b-bare', '{26000000}')`,
      [account, OTHER],
    ),
    /account_post_battle_alone/,
  );
  // One post per player per battle.
  await assert.rejects(
    db.query(
      `insert into account_post (item_id, account_id, player_tag, body, battle_id)
       values ('tl_00000000000000000004', $1, $2, '', 'b-plain')`,
      [account, TAG],
    ),
    /account_post_player_battle/,
  );
  // And only a player who played it.
  await assert.rejects(
    db.query(
      `insert into account_post (item_id, account_id, player_tag, body, battle_id)
       values ('tl_00000000000000000005', $1, '#0YVQPJ', '', 'b-plain')`,
      [account],
    ),
    /account_post_battle_fkey/,
  );
});
