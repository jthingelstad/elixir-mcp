/** Canonical member-post reads. The web app and digest share audience,
 * moderation, blocks and normalized attachments here; no service imports.
 * Plain posts remain outside MCP and the game-record timeline.
 */
import { blockedSql } from "@elixir-mcp/claims";
import { classifyDeck, deckLink, postUrl } from "@elixir-mcp/contracts";
import { cachedVocabulary } from "@elixir-mcp/ingest/card-roles";
import { battlePostFacts } from "@elixir-mcp/tools/activity/entries";
import { memberPostPath } from "./paths.mjs";

const POSTS_PAGE = 30;

/** The catalog's rows for some ids: a Map of id to `{ id, name, kind,
 *  elixir_cost, in_catalog }`. */
export async function catalogRows(db, ids) {
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
const seen = (plain, visibleOnly = false) => `(p.status = 'visible'
         or (${visibleOnly ? "false" : "p.status = 'hidden' and p.account_id = $1::uuid"}))
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
  { plain = false, visibleOnly = false, limit = POSTS_PAGE } = {},
) {
  const { rows } = await db.query(
    `select ${POST_COLS}
       from account_post p
       ${POST_JOIN}
      where ${seen(plain, visibleOnly)} and ${where}
      order by p.created_at desc, p.post_id desc
      limit ${Number(limit)}`,
    params,
  );
  return rows;
}

/** A Home reader's audience condition: the post's player is one the
 *  reader follows now (the feed's own player subjects), its author an
 *  account they follow, or the post is their own. `$2` the player tags. */
const audience = (players = "$2::text[]") => `(p.account_id = $1::uuid
          or p.player_tag = any(${players})
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
export async function readVisiblePosts(
  db,
  readerId,
  {
    subjects,
    fromMs,
    toMs,
    plain = false,
    visibleOnly = false,
    plainOnly = false,
    createdOnly = false,
    limit = 200,
  },
) {
  const tags = subjects.filter((s) => s.kind === "player").map((s) => s.tag);
  const rows = await readRows(
    db,
    `${audience()} and ${createdOnly ? "p.created_at" : "coalesce(p.updated_at, p.created_at)"} >= $3
        and p.created_at ${createdOnly ? "<" : "<="} $4${plainOnly ? " and p.battle_id is null" : ""}`,
    [readerId, tags, new Date(fromMs), new Date(toMs)],
    { plain, visibleOnly, limit },
  );
  return postItems(db, rows, readerId);
}

/** The live posts the Home read could show that were CREATED after its
 * watermark. Same audience/status predicate, without attachment/game reads.
 * Current notify-enabled claims are read in the same statement; account-only
 * follows and own posts do not require a cached game week. Edits never count.
 */
export async function countNewPosts(
  db,
  readerId,
  sinceMs,
  { plain = false, nowMs = Date.now() } = {},
) {
  const players = `array(select c.player_tag from claim c
                         where c.account_id = $1::uuid and c.notify)`;
  const { rows } = await db.query(
    `select count(*)::int as fresh from (
       select p.created_at from account_post p
       ${POST_JOIN}
       where ${seen(plain)} and ${audience(players)}
         and coalesce(p.updated_at, p.created_at) >= $3
         and p.created_at <= $4
       order by p.created_at desc, p.post_id desc limit 200
     ) visible where created_at > $2`,
    [
      readerId,
      new Date(sinceMs),
      new Date(nowMs - 7 * 86400_000),
      new Date(nowMs),
    ],
  );
  return rows[0]?.fresh ?? 0;
}

/** Whether a post (its row) is one the reader may see now: the same
 *  audience Home reads, or any post about a battle. */
async function postForReader(
  db,
  readerId,
  ref,
  subjects,
  { plain = false, open = false, visibleOnly = false } = {},
  column = "item_id",
) {
  const tags = subjects.filter((s) => s.kind === "player").map((s) => s.tag);
  const key = `p.${column}`;
  const cast = column === "post_id" ? "::bigint" : "";
  const home = await readRows(
    db,
    `${open ? `(${audience()} or p.battle_id is not null)` : audience()} and ${key} = $3${cast}`,
    [readerId, tags, ref],
    { plain, visibleOnly, limit: 1 },
  );
  if (home.length) return (await postItems(db, home, readerId))[0];
  const rows = await readRows(db, `${key} = $2${cast}`, [readerId, ref], {
    plain,
    visibleOnly,
    limit: 1,
  });
  if (!rows.length || !(await inClanWith(db, readerId, rows[0].player_tag)))
    return null;
  return (await postItems(db, rows, readerId))[0];
}

/** Existing item-id access for cheers, comments and reports. */
export async function visiblePost(
  db,
  readerId,
  itemId,
  subjects,
  options = {},
) {
  return postForReader(db, readerId, itemId, subjects, options);
}

/** One signed-in member destination: the same Home-or-Clan audience. */
export async function readVisiblePost(
  db,
  readerId,
  postId,
  { subjects = [], plain = false, visibleOnly = false } = {},
) {
  if (!readerId || !memberPostPath(postId)) return null;
  return postForReader(
    db,
    readerId,
    String(postId),
    subjects,
    { plain, visibleOnly },
    "post_id",
  );
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
        `(${audience()} or p.battle_id is not null) and p.player_tag = $3`,
        [readerId, tags, playerTag],
        { plain },
      )
    : await readRows(
        db,
        `(${audience()} or p.battle_id is not null) and p.account_id = $3::uuid`,
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
