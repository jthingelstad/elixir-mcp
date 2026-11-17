/**
 * Posts (2026-11-17; Jamie: "now that we have commenting and a moderation
 * capability it feels like a player could start a new post with just
 * text. Like a question they are asking? ... A variant would be a
 * question and they paste a deck link from the game and elixir
 * understands the deck link and renders the cards as a deck in the post.
 * In general a player could attach cards to a post.").
 * docs/notes/2026-11-17-posts.md.
 *
 * A post is a few words of plain text (POST_MAX, no links, mentioning
 * nobody) a person writes as their Verified player, perhaps marked as a
 * question, perhaps carrying a deck read from the game's deck link or a
 * few cards from the catalog. It is a timeline item of its own
 * (`kind: "post"`, a random `tl_` id), so cheers and comments name it as
 * they name any item; a battle highlight is the same idea about a battle,
 * a post is about nothing in the record.
 *
 * Posts are not game record. They are built here, in the web API, and
 * never in @elixir-mcp/tools, so no MCP tool, `/api/v1` route, digest,
 * activity mail, push, RSS feed or Discord post can carry one: those all
 * build their items there.
 *
 * Who may post: a signed-in person with a Verified player (primary or
 * alt), the same rule as commenting, not suspended from commenting, while
 * the stack's PostsEnabled and CommentsEnabled are both true.
 *
 * Who sees one: its author; on Home, readers who follow the player it
 * was written as (a friend follow or an account follow) and whose
 * follows reach it now; in Clan's Feed, the members of the clan the
 * player is in now. Never anyone in a block with the author, either way.
 *
 * Every post passes the comment check first (comment-check.mjs, with the
 * post policy), counted in the same log, under the same monthly cap.
 */
import { randomBytes } from "node:crypto";
import { blockedSql } from "@elixir-mcp/claims";
import {
  classifyDeck,
  deckLink,
  findDeckLink,
  parseDeckLink,
  postUrl,
} from "@elixir-mcp/contracts";
import { battlePostFacts } from "@elixir-mcp/tools/activity/entries";
import { battleFor, pickPlayer } from "./battle-posts.mjs";
import { cachedVocabulary } from "@elixir-mcp/ingest/card-roles";
import { checkComment, POST_REFUSAL_WORDS } from "./comment-check.mjs";
import { tidyComment } from "./comment-filter.mjs";
import {
  COOLDOWN_AFTER,
  COOLDOWN_MINUTES,
  HIDE_AT_REPORTS,
  REPORT_REASONS,
} from "./comments.mjs";

/** Posts one account may start a check for: per minute and per day. */
export const POSTS_PER_MINUTE = 1;
export const POSTS_PER_DAY = 5;
/** The same for posts about a battle, whose words are checked apart. */
export const BATTLE_POSTS_PER_MINUTE = 3;
export const BATTLE_POSTS_PER_DAY = 30;
/** The most loose cards one post carries. */
export const POST_CARDS_MAX = 8;
/** The most posts one read returns (a page's list). */
export const POSTS_PAGE = 30;

/** A new post's item id: random, never derived from anything. */
const newItemId = () => `tl_${randomBytes(10).toString("hex")}`;

const POST_ID = /^[1-9][0-9]{0,18}$/;

/* ------------------------------------------------------------------ */
/* Reading a request                                                    */
/* ------------------------------------------------------------------ */

/**
 * What a post request asks for: `{ text, question, deck, cards, battle,
 * player_tag }` (deck as the link reads it, ids not yet checked), or
 * `{ error, message }`. The deck comes from `deck_link`, or else from a
 * deck link in the words, which is taken out of them: the post keeps the
 * cards, never the link. A post about a battle (`battle`, its id or link,
 * and `player_tag`, which of the author's players played it) carries the
 * battle alone, and its words may be empty (0292).
 */
export function readPostInput(body) {
  const battle =
    body?.battle != null && body.battle !== ""
      ? String(body.battle).slice(0, 400)
      : null;
  if (battle) {
    if (body.text != null && typeof body.text !== "string")
      return { error: "bad_request", message: "Write something first." };
    if (
      (body.deck_link != null && body.deck_link !== "") ||
      (Array.isArray(body.cards) && body.cards.length)
    )
      return {
        error: "refused",
        category: "cards",
        message: "A post about a battle carries the battle alone.",
      };
    return {
      text: body.text ?? "",
      question: body.question === true,
      deck: null,
      cards: [],
      battle,
      player_tag:
        body.player_tag != null && body.player_tag !== ""
          ? String(body.player_tag)
          : null,
    };
  }
  if (typeof body?.text !== "string")
    return { error: "bad_request", message: "Write something first." };
  let text = body.text;
  let deck = null;
  if (body.deck_link != null && body.deck_link !== "") {
    deck = parseDeckLink(String(body.deck_link));
    if (!deck)
      return {
        error: "refused",
        category: "deck",
        message: "That isn't a deck link from the game.",
      };
  } else {
    const found = findDeckLink(text);
    if (found) {
      deck = found.deck;
      text =
        text.slice(0, found.index) +
        text.slice(found.index + found.link.length);
    }
  }
  const raw = Array.isArray(body.cards) ? body.cards : [];
  if (raw.length > POST_CARDS_MAX)
    return {
      error: "refused",
      category: "cards",
      message: `A post carries ${POST_CARDS_MAX} cards at most.`,
    };
  const cards = [];
  for (const c of raw) {
    const n = Number(c);
    if (!Number.isInteger(n) || n <= 0 || n > 999_999_999)
      return {
        error: "refused",
        category: "cards",
        message: "Pick cards from the list.",
      };
    if (!cards.includes(n)) cards.push(n);
  }
  if (deck && cards.length)
    return {
      error: "refused",
      category: "cards",
      message: "A post carries a deck or some cards, not both.",
    };
  return {
    text,
    question: body.question === true,
    deck,
    cards,
    battle: null,
    player_tag: null,
  };
}

/** The catalog's rows for some ids: a Map of id to `{ id, name, kind,
 *  elixir_cost, in_catalog }`. */
async function catalogRows(db, ids) {
  const list = [...new Set(ids.filter((n) => Number.isInteger(n)))];
  if (list.length === 0) return new Map();
  const { rows } = await db.query(
    `select card_id, name, kind, elixir_cost, in_catalog
       from card where card_id = any($1::bigint[])`,
    [list],
  );
  return new Map(
    rows.map((r) => [
      Number(r.card_id),
      {
        id: Number(r.card_id),
        name: r.name,
        kind: r.kind,
        elixir_cost: r.elixir_cost,
        in_catalog: r.in_catalog,
      },
    ]),
  );
}

/** Whether a deck's and cards' ids are in the current catalog: eight
 *  cards and a tower troop for a deck, cards for loose ones. */
export async function checkAttachments(db, { deck, cards }) {
  const ids = [
    ...(deck?.cards ?? []),
    ...(deck?.tower_troop != null ? [deck.tower_troop] : []),
    ...cards,
  ];
  if (ids.length === 0) return { ok: true };
  const known = await catalogRows(db, ids);
  const isCard = (id) =>
    known.get(id)?.kind === "card" && known.get(id)?.in_catalog === true;
  if (deck) {
    const troop = deck.tower_troop;
    if (
      !deck.cards.every(isCard) ||
      (troop != null &&
        !(known.get(troop)?.kind === "support" && known.get(troop)?.in_catalog))
    )
      return {
        error: "refused",
        category: "deck",
        message: "That deck link names cards Elixir doesn't know.",
      };
  }
  if (!cards.every(isCard))
    return {
      error: "refused",
      category: "cards",
      message: "Pick cards from the list.",
    };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

/** The player an account posts as: its primary Verified player, else a
 *  Verified alt; null when it has none. */
async function posterTag(db, accountId) {
  const { rows } = await db.query(
    `select player_tag from claim
      where account_id = $1 and status = 'verified'
        and (is_primary or relationship in ('primary', 'alt'))
      order by is_primary desc, relationship = 'primary' desc, verified_at
      limit 1`,
    [accountId],
  );
  return rows[0]?.player_tag ?? null;
}

/** Whether an admin has stopped the account commenting, which stops its
 *  posting too: the one control. */
async function suspended(db, accountId) {
  const { rows } = await db.query(
    `select 1 from comment_setting
      where account_id = $1 and suspended_until > now()`,
    [accountId],
  );
  return rows.length > 0;
}

/** Why the account may not start a post's check now, or null: posts' own
 *  per-minute and per-day caps, and the cooldown after repeated refusals
 *  of comments and posts alike. A post about a battle counts against its
 *  own, wider caps (BATTLE_POSTS_*): highlighting was bounded only by
 *  one a battle, and a sitting can hold several worth telling. */
async function throttled(db, accountId, battle = false) {
  const kind = battle ? "battle_post" : "post";
  const perMinute = battle ? BATTLE_POSTS_PER_MINUTE : POSTS_PER_MINUTE;
  const perDay = battle ? BATTLE_POSTS_PER_DAY : POSTS_PER_DAY;
  const { rows } = await db.query(
    `select count(*) filter (where kind = $3
                               and created_at > now() - interval '1 minute')::int as minute,
            count(*) filter (where kind = $3)::int as day,
            count(*) filter (where verdict = 'refuse'
                               and created_at > now() - make_interval(mins => $2))::int as refused,
            min(created_at) filter (where verdict = 'refuse'
                               and created_at > now() - make_interval(mins => $2)) as first_refused
       from comment_check
      where account_id = $1 and created_at > now() - interval '1 day'`,
    [accountId, COOLDOWN_MINUTES, kind],
  );
  const r = rows[0];
  if (r.refused >= COOLDOWN_AFTER)
    return {
      error: "cooldown",
      until: new Date(
        new Date(r.first_refused).getTime() + COOLDOWN_MINUTES * 60_000,
      ).toISOString(),
      message: "Take a break for a bit, then try again.",
    };
  if (r.minute >= perMinute)
    return {
      error: "rate_limited",
      retry: 60,
      message: "Give it a minute before the next post.",
    };
  if (r.day >= perDay)
    return {
      error: "rate_limited",
      retry: 3600,
      message: `That's ${perDay} posts today. Try again tomorrow.`,
    };
  return null;
}

/** The same words from the same author in the last day: spam. */
async function repeated(db, accountId, body) {
  const { rows } = await db.query(
    `select 1 from account_post
      where account_id = $1 and lower(body) = lower($2)
        and created_at > now() - interval '1 day' limit 1`,
    [accountId, body],
  );
  return rows.length > 0;
}

/** What a post carries, for the check's line about it. */
function carriesOf({ deck, cards, battle }) {
  if (battle) return "one of their battles attached";
  if (deck) return "a deck of eight cards attached";
  if (cards.length)
    return `${cards.length} card${cards.length === 1 ? "" : "s"} attached`;
  return "";
}

/**
 * Write a post. `cfg` is `{ plain, check }`: `plain` whether posts about
 * nothing in the record are on (the stack's PostsEnabled with
 * CommentsEnabled); `check` the comments config (`{ capUsd, moderate }`)
 * while comments are on, else null. A post about a battle is a
 * highlight's successor and works with either flag off (0292): its words
 * pass the post check while comments are on, and with them off are kept
 * as a highlight's were, after the plain filter alone. `input` is
 * readPostInput's answer. Returns `{ ok, post }` (the post as its
 * author's feed draws it) or `{ error, category?, message }`.
 */
export async function writePost(db, account, input, cfg) {
  const accountId = account.accountId;
  let tag;
  let battleId = null;
  if (input.battle) {
    const on = await battleFor(db, accountId, input.battle);
    if (on.error) return on;
    battleId = on.battle_id;
    tag = pickPlayer(on.players, input.player_tag);
    if (!tag)
      return {
        error: "not_your_battle",
        message:
          "Only a player you have verified, who played this battle, can post about it.",
      };
  } else {
    if (!cfg?.plain) return { error: "posts_off" };
    tag = await posterTag(db, accountId);
    if (!tag)
      return { error: "not_verified", message: "Verify your player to post." };
  }
  if (await suspended(db, accountId))
    return { error: "not_open", message: "You can't post right now." };
  const fine = await checkAttachments(db, input);
  if (!fine.ok) return fine;
  // One check at a time per account, comments and posts alike: the
  // limits count logged checks, which land only once the model answers.
  return withCheckLock(db, accountId, () =>
    writeChecked(db, accountId, tag, battleId, input, cfg),
  );
}

/** Run `fn` holding the account's one check at a time. */
async function withCheckLock(db, accountId, fn) {
  const key = `comment-post:${accountId}`;
  const { rows: got } = await db.query(
    "select pg_try_advisory_lock(hashtext($1)) as ok",
    [key],
  );
  if (!got[0]?.ok)
    return {
      error: "rate_limited",
      retry: 5,
      message: "Your last post is still being checked. Try again soon.",
    };
  try {
    return await fn();
  } finally {
    await db.query("select pg_advisory_unlock(hashtext($1))", [key]);
  }
}

/** The words' check, or why they are refused: `{ ok }` or a refusal.
 *  Empty words on a post about a battle need none. */
async function checkWords(db, accountId, itemId, body, input, cfg) {
  const battle = Boolean(input.battle);
  if (battle && body === "") return { ok: true };
  const slow = await throttled(db, accountId, battle);
  if (slow) return slow;
  // The same words twice is spam in a post about nothing; "gg" under two
  // battles is not.
  if (!battle && body && (await repeated(db, accountId, body)))
    return {
      error: "refused",
      category: "spam",
      message: POST_REFUSAL_WORDS.spam,
    };
  const verdict = await checkComment(db, {
    moderate: cfg?.check?.moderate ?? null,
    capUsd: cfg?.check?.capUsd ?? 0,
    accountId,
    itemId,
    body,
    post: { question: input.question, carries: carriesOf(input), battle },
  });
  // With comments off there is no model to ask: a post about a battle
  // keeps its words after the plain filter, as a highlight did.
  if (verdict.verdict === "error" && battle && !cfg?.check) return { ok: true };
  if (verdict.verdict === "paused")
    return { error: "paused", message: POST_REFUSAL_WORDS.paused };
  if (verdict.verdict === "error")
    return { error: "unavailable", message: POST_REFUSAL_WORDS.unavailable };
  if (verdict.verdict === "refuse")
    return {
      error: "refused",
      category: verdict.category,
      message:
        POST_REFUSAL_WORDS[verdict.category] ?? POST_REFUSAL_WORDS.harassment,
    };
  return { ok: true };
}

async function writeChecked(db, accountId, tag, battleId, input, cfg) {
  const body = tidyComment(input.text);
  if (battleId) {
    const { rows } = await db.query(
      `select 1 from account_post where player_tag = $1 and battle_id = $2`,
      [tag, battleId],
    );
    if (rows.length)
      return {
        error: "already_posted",
        message: "You've already posted about this battle as that player.",
      };
  }
  const itemId = newItemId();
  const checked = await checkWords(db, accountId, itemId, body, input, cfg);
  if (!checked.ok) return checked;
  const { rows } = await db.query(
    `insert into account_post
       (item_id, account_id, player_tag, body, question, deck, cards, battle_id)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::int[], $8)
     on conflict (player_tag, battle_id) where battle_id is not null do nothing
     returning post_id`,
    [
      itemId,
      accountId,
      tag,
      body,
      input.question === true,
      input.deck ? JSON.stringify(input.deck) : null,
      input.cards,
      battleId,
    ],
  );
  if (rows.length === 0)
    return {
      error: "already_posted",
      message: "You've already posted about this battle as that player.",
    };
  const [post] = await postItems(
    db,
    await readRows(
      db,
      `p.post_id = $2::bigint`,
      [accountId, rows[0].post_id],
      { plain: true },
    ),
    accountId,
  );
  return { ok: true, post };
}

/**
 * The author changes a post's words (2026-11-17, as a highlight's could
 * be): they pass the same check, and words that change count up its
 * revision and stamp updated_at, so the timeline serves the same item
 * grown and a cross-posted line is edited in place. A post about nothing
 * keeps some words; a post about a battle may drop them. The same words
 * again change nothing. `{ ok, post, changed }` or `{ error, ... }`.
 */
export async function editPost(db, account, id, text, cfg) {
  const row = await postRow(db, id);
  if (!row || row.status === "removed" || row.account_id !== account.accountId)
    return { error: "not_found" };
  const battle = row.battle_id !== null;
  if (!battle && !cfg?.plain) return { error: "posts_off" };
  if (typeof text !== "string")
    return { error: "bad_request", message: "Write something first." };
  const body = tidyComment(text);
  if (await suspended(db, account.accountId))
    return { error: "not_open", message: "You can't post right now." };
  let changed = body !== row.body;
  if (changed) {
    const input = {
      question: row.question,
      battle: battle ? row.battle_id : null,
      deck: row.deck,
      cards: row.cards ?? [],
    };
    const checked = await withCheckLock(db, account.accountId, () =>
      checkWords(db, account.accountId, row.item_id, body, input, cfg),
    );
    if (!checked.ok) return checked;
    const { rowCount } = await db.query(
      `update account_post
          set body = $2, revision = revision + 1, updated_at = now()
        where post_id = $1::bigint and body <> $2`,
      [row.post_id, body],
    );
    changed = rowCount > 0;
  }
  const [post] = await postItems(
    db,
    await readRows(
      db,
      `p.post_id = $2::bigint`,
      [account.accountId, row.post_id],
      { plain: true },
    ),
    account.accountId,
  );
  return { ok: true, post, changed };
}

/** One post's row for its author or an admin, or null. */
async function postRow(db, id) {
  if (!POST_ID.test(String(id ?? ""))) return null;
  const { rows } = await db.query(
    `select post_id::text as post_id, item_id, account_id, player_tag, status,
            battle_id, body, question, deck, cards
       from account_post where post_id = $1::bigint`,
    [String(id)],
  );
  return rows[0] ?? null;
}

/**
 * The author deletes their post: it goes at once, with its cheers; the
 * comments on it are removed as by the item's owner, kept for admins 30
 * days as any removed comment is. `{ ok }` or `{ error }`.
 */
export async function deletePost(db, account, id) {
  const row = await postRow(db, id);
  if (!row || row.status === "removed" || row.account_id !== account.accountId)
    return { error: "not_found" };
  await db.query(
    `update timeline_comment
        set status = 'removed', removed_by = 'owner', removed_at = now()
      where item_id = $1 and status <> 'removed'`,
    [row.item_id],
  );
  await db.query(`delete from timeline_cheer where item_id = $1`, [
    row.item_id,
  ]);
  await db.query(`delete from account_post where post_id = $1::bigint`, [
    row.post_id,
  ]);
  return { ok: true, deleted: true };
}

/** An admin removes a post: kept 30 days for review (sweepOperational),
 *  its open reports resolved as removed. */
export async function removePost(db, id) {
  if (!POST_ID.test(String(id ?? ""))) return false;
  const { rowCount } = await db.query(
    `update account_post
        set status = 'removed', removed_by = 'admin', removed_at = now()
      where post_id = $1::bigint and status <> 'removed'`,
    [String(id)],
  );
  await db.query(
    `update post_report set resolved_at = now(), resolution = 'removed'
      where post_id = $1::bigint and resolved_at is null`,
    [String(id)],
  );
  return rowCount > 0;
}

/** Report a post the reader can see (`canSee(row)`). Two reports from
 *  different accounts hide it until an admin decides; its author is never
 *  told, and the reporter stops seeing it at once. */
export async function reportPost(db, account, id, reason, canSee) {
  if (!REPORT_REASONS.includes(reason)) return { error: "invalid_reason" };
  const row = await postRow(db, id);
  if (!row || row.status !== "visible") return { error: "not_found" };
  if (row.account_id === account.accountId) return { error: "not_found" };
  if (!(await canSee(row))) return { error: "not_found" };
  await db.query(
    `insert into post_report (post_id, account_id, reason)
     values ($1::bigint, $2, $3)
     on conflict (post_id, account_id) do update
       set reason = excluded.reason
     where post_report.resolved_at is null`,
    [row.post_id, account.accountId, reason],
  );
  const { rows } = await db.query(
    `select count(distinct account_id)::int as n from post_report
      where post_id = $1::bigint and resolved_at is null`,
    [row.post_id],
  );
  if (rows[0].n >= HIDE_AT_REPORTS)
    await db.query(
      `update account_post set status = 'hidden'
        where post_id = $1::bigint and status = 'visible'`,
      [row.post_id],
    );
  return { ok: true };
}

/** An admin's dismissal: the open reports close and a hidden post shows
 *  again. */
export async function dismissPostReports(db, id) {
  const row = await postRow(db, id);
  if (!row) return { error: "not_found" };
  await db.query(
    `update post_report set resolved_at = now(), resolution = 'dismissed'
      where post_id = $1::bigint and resolved_at is null`,
    [row.post_id],
  );
  await db.query(
    `update account_post set status = 'visible'
      where post_id = $1::bigint and status = 'hidden'`,
    [row.post_id],
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

const POST_COLS = `p.post_id::text as post_id, p.item_id, p.account_id,
       p.player_tag, p.body, p.question, p.deck, p.cards, p.status,
       p.battle_id, p.share_id, p.revision, p.created_at,
       pl.name as player_name, ap.passport_id as author_page`;
const POST_JOIN = `join account a on a.account_id = p.account_id
                     and a.kind = 'person' and a.status = 'approved'
       left join player pl on pl.player_tag = p.player_tag
       left join account_passport ap on ap.account_id = p.account_id`;
/** What a reader (`$1`) sees: visible posts, and their own while hidden
 *  for review; never one by anyone in a block with them, either way, and
 *  never one they reported while the report is open. A post about
 *  nothing in the record only while `plain` (posts are on); a post about
 *  a battle always, as a highlight was (0292). */
const seen = (plain) => `(p.status = 'visible'
         or (p.status = 'hidden' and p.account_id = $1::uuid))
        and not ${blockedSql("p.account_id", "$1::uuid")}
        and not exists (select 1 from post_report pr
                         where pr.post_id = p.post_id
                           and pr.account_id = $1::uuid and pr.resolved_at is null)
        ${plain ? "" : "and p.battle_id is not null"}`;

/** Posts a reader sees, by an extra condition (its parameters from $2),
 *  newest first. */
async function readRows(
  db,
  where,
  params,
  { plain = false, limit = POSTS_PAGE } = {},
) {
  const { rows } = await db.query(
    `select ${POST_COLS}
       from account_post p
       ${POST_JOIN}
      where ${seen(plain)} and ${where}
      order by p.created_at desc, p.post_id desc
      limit ${Number(limit)}`,
    params,
  );
  return rows;
}

/** A Home reader's audience condition: the post's player is one the
 *  reader follows now (the feed's own player subjects), its author an
 *  account they follow, or the post is their own. `$2` the player tags. */
const AUDIENCE = `(p.account_id = $1::uuid
          or p.player_tag = any($2::text[])
          or exists (select 1 from account_follow f
                      where f.account_id = $1::uuid
                        and f.followed_account_id = p.account_id))`;

/**
 * The posts in a reader's Home window (`fromMs` to `toMs`), as feed items:
 * their own, and those of the players and accounts they follow. `subjects`
 * are the feed's own (subjectsFor), so a follow with its notice off reads
 * the same as it does for the reader's other items. A post about a battle
 * shows from when its words last changed, as a highlight did.
 */
export async function homePosts(
  db,
  readerId,
  { subjects, fromMs, toMs, plain = false },
) {
  const tags = subjects.filter((s) => s.kind === "player").map((s) => s.tag);
  const rows = await readRows(
    db,
    `${AUDIENCE} and coalesce(p.updated_at, p.created_at) >= $3
        and p.created_at <= $4`,
    [readerId, tags, new Date(fromMs), new Date(toMs)],
    { plain, limit: 200 },
  );
  return postItems(db, rows, readerId);
}

/** Whether a post (its row) is one the reader may see now: the same
 *  audience Home reads, or any post about a battle. */
async function canSeePost(db, readerId, itemId, subjects, plain, open) {
  const tags = subjects.filter((s) => s.kind === "player").map((s) => s.tag);
  const rows = await readRows(
    db,
    open
      ? `(${AUDIENCE} or p.battle_id is not null) and p.item_id = $3`
      : `${AUDIENCE} and p.item_id = $3`,
    [readerId, tags, itemId],
    { plain },
  );
  return rows.length ? (await postItems(db, rows, readerId))[0] : null;
}

/** A post the reader may see by either road: their Home audience, or
 *  Clan's Feed (the post's player is in a clan with one of theirs now).
 *  Cheers, comments and reports on a post ask this. `open`: a post about
 *  a battle counts wherever its player's page shows it (to everyone), as
 *  for a report; a cheer or a comment stays with the feeds, as on a
 *  highlight. */
export async function visiblePost(
  db,
  readerId,
  itemId,
  subjects,
  { plain = false, open = false } = {},
) {
  const home = await canSeePost(db, readerId, itemId, subjects, plain, open);
  if (home) return home;
  const rows = await readRows(db, `p.item_id = $2`, [readerId, itemId], {
    plain,
    limit: 1,
  });
  if (rows.length === 0) return null;
  if (!(await inClanWith(db, readerId, rows[0].player_tag))) return null;
  return (await postItems(db, rows, readerId))[0];
}

/** Whether the reader's own player is in the clan a post's player is in
 *  now: Clan's Feed shows them that post, so they may report it. */
async function inClanWith(db, readerId, playerTag) {
  const { rows } = await db.query(
    `select 1 from claim c
       join clan_membership mine on mine.player_tag = c.player_tag
                                and mine.left_observed_at is null
       join clan_membership theirs on theirs.clan_tag = mine.clan_tag
                                  and theirs.left_observed_at is null
      where c.account_id = $1 and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
        and theirs.player_tag = $2
      limit 1`,
    [readerId, playerTag],
  );
  return rows.length > 0;
}

/** A player's posts a reader may see (their page and their account's
 *  page): the same audience as Home, newest first; every post about a
 *  battle, which a player's page showed to everyone as a highlight. */
export async function postsBy(
  db,
  readerId,
  { subjects, playerTag = null, accountId = null, plain = false },
) {
  const tags = subjects.filter((s) => s.kind === "player").map((s) => s.tag);
  const rows = playerTag
    ? await readRows(
        db,
        `(${AUDIENCE} or p.battle_id is not null) and p.player_tag = $3`,
        [readerId, tags, playerTag],
        { plain },
      )
    : await readRows(
        db,
        `(${AUDIENCE} or p.battle_id is not null) and p.account_id = $3::uuid`,
        [readerId, tags, accountId],
        { plain },
      );
  return postItems(db, rows, readerId);
}

/** A clan's Feed: the posts of its members now, in the window, for a
 *  reader the Clan handler has proved is in the clan. */
export async function clanPosts(
  db,
  readerId,
  { clanTag, fromMs, toMs, plain = false },
) {
  const rows = await readRows(
    db,
    `p.player_tag in (select player_tag from clan_membership
                       where clan_tag = $2 and left_observed_at is null)
        and coalesce(p.updated_at, p.created_at) >= $3
        and p.created_at <= $4`,
    [readerId, clanTag, new Date(fromMs), new Date(toMs)],
    { plain, limit: 100 },
  );
  return postItems(db, rows, readerId);
}

/** The reader's own posts about one battle (the battle page's panel). */
export async function ownPostsOn(db, readerId, battleId) {
  const rows = await readRows(
    db,
    `p.account_id = $1::uuid and p.battle_id = $2`,
    [readerId, battleId],
  );
  return postItems(db, rows, readerId);
}

/** A stored deck as the post draws it: its cards with names and costs,
 *  the tower troop, the labeller's label (a label, not a verdict), the
 *  average elixir, and the game's link to copy it. */
function deckView(deck, catalog, roles) {
  const cards = deck.cards.map((id) => {
    const c = catalog.get(id);
    return {
      id,
      name: c?.name ?? String(id),
      elixir_cost: c?.elixir_cost ?? null,
    };
  });
  const a = classifyDeck(
    cards.map((c) => ({ ...c, form: null })),
    roles,
  );
  const troop = deck.tower_troop != null ? catalog.get(deck.tower_troop) : null;
  return {
    cards,
    tower_troop: troop ? { id: troop.id, name: troop.name } : null,
    label: a?.label ?? null,
    average_elixir: a?.average_elixir ?? null,
    copy_link: deckLink({
      cards: deck.cards,
      tower_troop: deck.tower_troop ?? null,
    }),
  };
}

/**
 * Rows as feed items: `kind: "post"`, the item id cheers and comments
 * name, the player it was written as for its subject, and `post` with
 * the words (plain text, drawn as text, never as links), whether it is a
 * question, its deck or cards, and what the reader may do.
 */
export async function postItems(db, rows, readerId) {
  if (rows.length === 0) return [];
  const ids = rows.flatMap((r) => [
    ...(r.deck?.cards ?? []),
    ...(r.deck?.tower_troop != null ? [r.deck.tower_troop] : []),
    ...(r.cards ?? []),
  ]);
  const catalog = await catalogRows(db, ids.map(Number));
  const battles = await battlePostFacts(
    db,
    rows.filter((r) => r.battle_id).map((r) => r.item_id),
  );
  const roles = rows.some((r) => r.deck)
    ? (await cachedVocabulary(db)).roles
    : [];
  return rows.map((r) => {
    const at = new Date(r.created_at).toISOString();
    const mine = r.account_id === readerId;
    const about = r.battle_id ? (battles.get(r.item_id) ?? null) : null;
    return {
      id: r.item_id,
      kind: "post",
      at,
      sort_at: at,
      observed_at: at,
      subject_tag: r.player_tag,
      subjects: [
        { kind: "player", tag: r.player_tag, name: r.player_name ?? null },
      ],
      // The words, for a comment's check (its line about the item).
      text: String(r.body ?? ""),
      post: {
        id: r.post_id,
        text: String(r.body ?? ""),
        question: r.question === true,
        deck: r.deck ? deckView(r.deck, catalog, roles) : null,
        cards: (r.cards ?? []).map((id) => {
          const c = catalog.get(Number(id));
          return { id: Number(id), name: c?.name ?? String(id) };
        }),
        // A post about a battle (0292): the battle as the timeline tells
        // it, both decks, and its share link for its author.
        battle: about?.battle ?? null,
        versus: about?.versus ?? null,
        share_url: mine && r.share_id ? postUrl(r.share_id) : null,
        edited: Number(r.revision) > 1,
        author: {
          account_id: r.author_page ?? null,
          player_tag: r.player_tag,
          name: r.player_name ?? null,
        },
        status: mine && r.status !== "visible" ? r.status : undefined,
        mine,
        can_edit: mine,
        can_delete: mine,
        can_report: !mine,
        can_block: !mine,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Admin                                                                */
/* ------------------------------------------------------------------ */

/** The admin queue's posts: those with open reports or hidden for
 *  review, with their reports. Refused posts are in the comment queue's
 *  refusals (one log, `kind`). */
export async function postQueue(db) {
  const { rows } = await db.query(
    `select ${POST_COLS},
            coalesce(json_agg(json_build_object('reason', r.reason,
                       'at', r.created_at) order by r.created_at)
                     filter (where r.post_id is not null), '[]') as reports
       from account_post p
       ${POST_JOIN}
       left join post_report r on r.post_id = p.post_id
                              and r.resolved_at is null
      where p.status = 'hidden'
         or exists (select 1 from post_report o
                     where o.post_id = p.post_id and o.resolved_at is null)
      group by p.post_id, pl.name, ap.passport_id
      order by min(r.created_at) nulls last, p.created_at
      limit 100`,
  );
  const items = await postItems(db, rows, null);
  return items.map((it, i) => ({
    id: it.post.id,
    item_id: it.id,
    at: it.at,
    text: it.post.text,
    question: it.post.question,
    deck: it.post.deck,
    cards: it.post.cards,
    author: it.post.author,
    status: rows[i].status,
    reports: rows[i].reports,
  }));
}
