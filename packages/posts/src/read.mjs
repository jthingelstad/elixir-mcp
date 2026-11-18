/** Canonical member-post reads. The web app and digest share moderation,
 * blocks and normalized attachments here; no service imports. Automatic
 * clanmate feeds are a member-web opt-in, never a delivery default.
 */
import {
  blockedSql,
  clanmatePlayersSql,
  currentClanmates,
  currentClanPlayersSql,
  currentOwnClansSql,
} from "@elixir-mcp/claims";
import { classifyDeck, deckLink, postUrl } from "@elixir-mcp/contracts";
import { cachedVocabulary } from "@elixir-mcp/ingest/card-roles";
import { battlePostFacts } from "./battle.mjs";
import { readPostMoment } from "./moment.mjs";
import { memberPostPath } from "./paths.mjs";

const POSTS_PAGE = 30;

/** The catalog's rows for some ids: a Map of id to `{ id, name, kind,
 *  elixir_cost, in_catalog }`. */
export async function catalogRows(db, ids) {
  const list = [...new Set(ids.filter((n) => Number.isInteger(n)))];
  if (list.length === 0) return new Map();
  const { rows } = await db.query(
    `select card_id, name, kind, rarity, elixir_cost, in_catalog
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
        rarity: r.rarity ?? null,
        elixir_cost: r.elixir_cost,
        in_catalog: r.in_catalog,
      },
    ]),
  );
}

const POST_COLS = `p.post_id::text as post_id, p.item_id, p.account_id,
       p.player_tag, p.body, p.moment, p.question, p.answered_at, p.deck, p.cards, p.status,
       p.battle_id, ts.share_id, p.revision, p.created_at, p.updated_at,
       pl.name as player_name, ap.passport_id as author_page`;
const POST_AUTHOR_JOIN = `join account a on a.account_id = p.account_id
                     and a.kind = 'person' and a.status = 'approved'`;
const POST_JOIN = `left join timeline_share ts on ts.item_id = p.item_id
                     and ts.created_at >= now() - interval '1 year'
       ${POST_AUTHOR_JOIN}
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
  {
    plain = false,
    visibleOnly = false,
    limit = POSTS_PAGE,
    candidates = null,
  } = {},
) {
  const { rows } = await db.query(
    `${candidates ? `with candidates as materialized (${candidates})` : ""}
     select ${POST_COLS}
       from ${postSource(candidates)}
       ${POST_JOIN}
      where ${seen(plain, visibleOnly)} and ${where}
      order by p.created_at desc, p.post_id desc
      limit ${Number(limit)}`,
    params,
  );
  return rows;
}

const postSource = (candidates) =>
  candidates
    ? `candidates candidate cross join lateral (
         select p.* from account_post p where p.post_id=candidate.post_id limit 1
       ) p`
    : "account_post p";

/** A Home reader's audience condition: the post's player is one the
 *  reader follows now (the feed's own player subjects), its author an
 *  account they follow, or the post is their own. `$2` the player tags. */
const audienceSources = (players = "$2::text[]") => [
  "p.account_id = $1::uuid",
  `p.player_tag = any(${players})`,
  `exists (select 1 from account_follow f where f.account_id = $1::uuid
            and f.followed_account_id = p.account_id)`,
];
const audience = (players) => `(${audienceSources(players).join(" or ")})`;

// A stored Home week can name former clanmates. Only explicit player
// subjects can authorize that audience arm; automatic connections are
// re-resolved from the source for each member read that opts into them.
const subjectTags = (subjects) =>
  subjects
    .filter((s) => s.kind === "player" && s.relationship !== "clanmate")
    .map((s) => s.tag);
const memberPlayers = (players, clanmates) =>
  clanmates
    ? `array(select unnest(${players}) union
             select player_tag from (${clanmatePlayersSql("$1", { names: false })}) current_mates)`
    : players;
// Feed mute is separate from connection truth and named-item access.
// Preserve it even when the linked account is also followed.
const feedMute = (clanmates) =>
  clanmates
    ? ` and (p.account_id=$1::uuid or not exists (
        select 1 from claim muted where muted.account_id=$1::uuid
          and muted.player_tag=p.player_tag and muted.relationship='friend'
          and not muted.notify))`
    : "";

/** Candidate IDs name only this reader's players, authors and clans.
 * Full-window reads use keyed probes. Creation counts bind both time ends
 * in an ordered range so the planner can batch small tables or use the
 * player/time index without walking retained history. Only roster players
 * with candidates pay the full current-peer proof. No candidates are capped
 * before moderation, and UNION deduplicates overlapping audience paths.
 */
const audiencePostIds = ({
  players = "$2::text[]",
  clanmates = false,
  hiddenOwn = false,
  creationCount = false,
  window = "",
  timeColumn = "p.created_at",
} = {}) => {
  const range = window ? ` and ${window}` : "";
  return [
    `select p.post_id from account_post p where p.account_id=$1::uuid
      and (p.status='visible'${hiddenOwn ? " or p.status='hidden'" : ""})${range}`,
    creationCount
      ? `select named.post_id from (
         select p.post_id from account_post p
          where p.player_tag=any(${players}) and p.status='visible'${range}
          order by p.player_tag,p.created_at desc offset 0
       ) named`
      : `select p.post_id from unnest(${players}) followed(player_tag)
     cross join lateral (
       select p.post_id from account_post p
        where p.player_tag=followed.player_tag and p.status='visible'${range}
        order by ${timeColumn} desc offset 0
     ) p`,
    `select p.post_id from account_follow f cross join lateral (
     select p.post_id from account_post p
      where p.account_id = f.followed_account_id and p.status = 'visible'${range}
      order by ${timeColumn} desc offset 0
   ) p where f.account_id = $1::uuid`,
    ...(clanmates
      ? [
          creationCount
            ? `
       select candidate.post_id from (
         with named_clans as materialized (${currentOwnClansSql("$1")}),
         roster_posts as materialized (
           select p.post_id,p.player_tag from account_post p
            where p.player_tag=any(array(select cm.player_tag from named_clans own
              join clan_membership cm on cm.clan_tag=own.clan_tag and cm.left_observed_at is null))
              and p.status='visible'${range}
            order by p.player_tag,p.created_at desc offset 0
         ), posters as materialized (select distinct player_tag from roster_posts),
         permitted as materialized (
           select poster.player_tag from posters poster
           cross join lateral (
             select 1 from (${clanmatePlayersSql("$1", { names: false })}) current_mates
              where current_mates.player_tag=poster.player_tag offset 0
           ) proof
         )
         select rp.post_id from roster_posts rp join permitted using(player_tag)
       ) candidate`
            : `
       select p.post_id from (${clanmatePlayersSql("$1", { names: false })}) current_mates
       cross join lateral (
         select p.post_id from account_post p
          where p.player_tag=current_mates.player_tag and p.status='visible'${range}
          order by ${timeColumn} desc offset 0
       ) p`,
        ]
      : []),
  ].join("\nunion\n");
};

/**
 * The posts in a reader's Home window (`fromMs` to `toMs`), as feed items:
 * their own, and those of the players and accounts they follow. `subjects`
 * are the feed's own (subjectsFor), so a follow with its notice off reads
 * the same as it does for the reader's other items. A post about a battle
 * shows from when its words last changed, as a highlight did. Member web
 * reads opt into current automatic clanmates with `clanmates: true`;
 * explicit friend mutes still win. Named-item access is independent.
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
    questionsOnly = false,
    subjectsOnly = false,
    clanmates = false,
    limit = 200,
  },
) {
  const tags = subjectTags(subjects);
  const players = memberPlayers("$2::text[]", clanmates);
  const timeColumn = createdOnly
    ? "p.created_at"
    : "coalesce(p.updated_at, p.created_at)";
  const window = `${timeColumn} >= $3 and p.created_at ${createdOnly ? "<" : "<="} $4`;
  const rows = await readRows(
    db,
    `${clanmates ? "true" : `${audience(players)} and ${window}`}${feedMute(clanmates)}${subjectsOnly ? ` and p.player_tag = any(${players})` : ""}${plainOnly ? " and p.battle_id is null" : ""}${questionsOnly ? " and p.question" : ""}`,
    [readerId, tags, new Date(fromMs), new Date(toMs)],
    {
      plain,
      visibleOnly,
      limit,
      candidates: clanmates
        ? audiencePostIds({
            clanmates,
            hiddenOwn: !visibleOnly,
            window,
            timeColumn,
          })
        : null,
    },
  );
  return postItems(db, rows, readerId);
}

/** Plain posts for a delivery reader, using the same audience and moderation
 * predicate as the member Timeline. The window is (from, to] at the
 * millisecond precision served in JSON. Read one row beyond the page so
 * the caller can continue at the newest omitted instant; total includes
 * every matching post, without hydrating attachments beyond the page.
 * The member-web `clanmates` opt-in is false for delivery callers.
 */
export async function readVisiblePostPage(
  db,
  readerId,
  {
    subjects,
    fromMs,
    toMs,
    basis = "observed",
    playerTag = null,
    clanmates = false,
    limit = 150,
  },
) {
  const size = Math.max(1, Math.min(200, Math.trunc(limit) || 150));
  const tags = subjectTags(subjects);
  const instant =
    basis === "occurred"
      ? "p.created_at"
      : "coalesce(p.updated_at, p.created_at)";
  const { rows } = await db.query(
    `with candidates as materialized (
       ${audiencePostIds({ clanmates })}
     ), eligible as materialized (
       select p.*, count(*) over()::int as total, ${instant} as page_at
         from candidates candidate
         cross join lateral (
           select p.* from account_post p ${POST_AUTHOR_JOIN}
            where p.post_id = candidate.post_id limit 1
         ) p
        where ${seen(true, true)}${feedMute(clanmates)}
          and p.battle_id is null
          and ${instant} >= $3 and ${instant} < $4
          and ($5::text is null or p.player_tag = $5)
        order by ${instant} desc, p.post_id desc limit ${size + 1}
     )
     select ${POST_COLS}, p.total, p.page_at
       from eligible p ${POST_JOIN}
      order by p.page_at desc, p.post_id desc`,
    [readerId, tags, new Date(fromMs + 1), new Date(toMs + 1), playerTag],
  );
  return {
    items: await postItems(db, rows.slice(0, size), readerId),
    more: Math.max(0, (rows[0]?.total ?? 0) - size),
    more_at: rows[size]?.page_at?.toISOString() ?? null,
  };
}

/** The live posts the Home read could show that were CREATED after its
 * watermark. Same audience/status predicate, without attachment/game reads.
 * Current notify-enabled claims are read in the same statement; account-only
 * follows and own posts do not require a cached game week. Edits never count.
 * PostgreSQL microseconds are compared at the millisecond precision the
 * normalized item and its JSON watermark carry, so a read post stays read.
 * Automatic clanmates are included only for member-web reads that opt in.
 */
export async function countNewPosts(
  db,
  readerId,
  sinceMs,
  {
    plain = false,
    nowMs = Date.now(),
    questionsOnly = false,
    clanmates = false,
  } = {},
) {
  const players = `array(select c.player_tag from claim c
                          where c.account_id = $1::uuid and c.notify)`;
  // Creation order makes this exact: posts at/before the JSON watermark
  // cannot consume any of the newest 200 positions that could count New.
  // Bound every named player/author probe before reading retained history.
  const candidates = audiencePostIds({
    players,
    clanmates,
    hiddenOwn: true,
    creationCount: true,
    window:
      "p.created_at >= ($2::timestamptz + interval '1 millisecond') and p.created_at <= $4::timestamptz",
  });
  const { rows } = await db.query(
    `${candidates ? `with candidates as materialized (${candidates})` : ""}
     select count(*)::int as fresh from (
       select p.created_at from ${postSource(candidates)}
       ${POST_AUTHOR_JOIN}
       where ${seen(plain)} and ${clanmates ? "true" : audience(players)}${feedMute(clanmates)}${questionsOnly ? " and p.question" : ""}
         and coalesce(p.updated_at, p.created_at) >= $3
         and p.created_at <= $4
       order by p.created_at desc, p.post_id desc limit 200
     ) visible where date_trunc('milliseconds', created_at) > $2`,
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
  const tags = subjectTags(subjects);
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
  { subjects = [], plain = false, visibleOnly = false, open = false } = {},
) {
  if (!readerId || !memberPostPath(postId)) return null;
  return postForReader(
    db,
    readerId,
    String(postId),
    subjects,
    { plain, visibleOnly, open },
    "post_id",
  );
}

/** One already-shared post, after the capability gate. No account or
 * follow lookup can substitute for that gate. Moderation and author
 * status are rechecked; normalization is the member reader's own.
 */
export async function readPublishedPost(db, postId, { plain = false } = {}) {
  if (!memberPostPath(postId)) return null;
  const { rows } = await db.query(
    `select ${POST_COLS} from account_post p ${POST_JOIN}
      where p.post_id = $1::bigint and p.status = 'visible'
        ${plain ? "" : "and p.battle_id is not null"}`,
    [String(postId)],
  );
  return (await postItems(db, rows, null))[0] ?? null;
}

/** Whether the reader's own player is in the clan a post's player is in
 *  now: Clan's Feed shows them that post, so they may report it. */
async function inClanWith(db, readerId, playerTag) {
  return (await currentClanmates(db, readerId, { tags: [playerTag] })).has(
    playerTag,
  );
}

/** A player's posts a reader may see (their page and their account's
 *  page): the same audience as Home, newest first; every post about a
 *  battle, which a player's page showed to everyone as a highlight. */
export async function postsBy(
  db,
  readerId,
  {
    subjects,
    playerTag = null,
    accountId = null,
    plain = false,
    clanmates = false,
  },
) {
  const tags = subjectTags(subjects);
  const players = memberPlayers("$2::text[]", clanmates);
  const rows = playerTag
    ? await readRows(
        db,
        `(${audience(players)} or p.battle_id is not null) and p.player_tag = $3`,
        [readerId, tags, playerTag],
        { plain },
      )
    : await readRows(
        db,
        `(${audience(players)} or p.battle_id is not null) and p.account_id = $3::uuid`,
        [readerId, tags, accountId],
        { plain },
      );
  return postItems(db, rows, readerId);
}

/** A clan's Feed: the posts of its members now, in the window, for a
 *  reader's current source membership is checked again here. */
const clanPostWindow = `p.player_tag in (select player_tag from (${currentClanPlayersSql("$1")}) current_members
                       where clan_tag = $2)
        and coalesce(p.updated_at, p.created_at) >= $3 and p.created_at <= $4`;

/** Questions in the same current-clan audience, counted before the cap. */
export async function clanQuestionCounts(
  db,
  readerId,
  { clanTag, fromMs, toMs, plain = false },
) {
  const { rows } = await db.query(
    `select count(*)::int as questions,
            count(*) filter (where p.answered_at is null)::int as unanswered
       from account_post p ${POST_JOIN}
      where ${seen(plain)} and ${clanPostWindow} and p.question`,
    [readerId, clanTag, new Date(fromMs), new Date(toMs)],
  );
  return rows[0];
}

export async function clanPosts(
  db,
  readerId,
  {
    clanTag,
    fromMs,
    toMs,
    plain = false,
    questionsOnly = false,
    unansweredOnly = false,
  },
) {
  const rows = await readRows(
    db,
    `${clanPostWindow}${questionsOnly || unansweredOnly ? " and p.question" : ""}${unansweredOnly ? " and p.answered_at is null" : ""}`,
    [readerId, clanTag, new Date(fromMs), new Date(toMs)],
    { plain, limit: 100 },
  );
  return postItems(db, rows, readerId);
}

/** Visible posts about one named battle, the same member game audience
 * as postsBy. Hidden, reported and blocked posts are never overlaid. */
export async function visibleBattlePosts(db, readerId, battleId) {
  const rows = await readRows(db, "p.battle_id = $2", [readerId, battleId], {
    visibleOnly: true,
  });
  return postItems(db, rows, readerId);
}

/** The player cheer compatibility read's battle posts: the same visible
 * member audience, bounded to its existing occurred window and page cap. */
export async function visiblePlayerBattlePosts(
  db,
  readerId,
  playerTag,
  { fromMs, toMs },
) {
  const rows = await readRows(
    db,
    "p.player_tag = $2 and p.created_at > $3::timestamptz and p.created_at <= $4::timestamptz",
    [readerId, playerTag, new Date(fromMs), new Date(toMs)],
    { visibleOnly: true },
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
      rarity: c?.rarity ?? null,
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
      revision: Math.max(1, Number(r.revision) || 1),
      kind: "post",
      at,
      sort_at: at,
      observed_at: new Date(r.updated_at ?? r.created_at).toISOString(),
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
        moment: readPostMoment(r.moment),
        answered: r.question === true && r.answered_at != null,
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
      group by p.post_id, pl.name, ap.passport_id, ts.share_id
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
    moment: it.post.moment,
    author: it.post.author,
    status: rows[i].status,
    reports: rows[i].reports,
  }));
}
