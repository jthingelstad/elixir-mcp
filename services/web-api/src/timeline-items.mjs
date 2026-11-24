/** Resolve one recorded member item from its source. A locator only
 * narrows the read; identity, current audience and facts come from Elixir.
 * Public sharing uses the same game/people read without a member seat. */
import { blockedSql } from "@elixir-mcp/claims";
import { normalizeTag } from "@elixir-mcp/contracts";
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { ITEM_ID_RE, cheerable } from "@elixir-mcp/tools/activity/cheers";
import { visiblePost } from "@elixir-mcp/posts";
import { SITTINGS } from "@elixir-mcp/ui/session-story";
import { annotateFeed } from "./feed.mjs";
import { timelineItemRef } from "@elixir-mcp/ui/item-link";

const DAY = 86_400_000;
const PAGE_ID = /^[a-z0-9]{12}$/i;

/** Old comments retained only a subject and their own time. Recover a
 * locator from one named subject and the preceding month, never infer an
 * item from its hash or a shared capability. No match leaves history intact. */
export async function recoverMemberItemRef(
  db,
  { accountId, itemId, subjectTag, commentedAt, posts = false },
) {
  if (!accountId || !ITEM_ID_RE.test(String(itemId ?? ""))) return null;
  const subjects = await subjectsFor(db, accountId);
  const post = await visiblePost(db, accountId, itemId, subjects, {
    plain: posts,
    open: true,
  });
  if (post) return timelineItemRef(post);
  let tag;
  try {
    tag = normalizeTag(subjectTag);
  } catch {
    return null;
  }
  const anchor = Date.parse(commentedAt);
  const now = Date.now();
  if (
    !Number.isFinite(anchor) ||
    anchor < now - 366 * DAY ||
    anchor > now + DAY
  )
    return null;
  const built = await buildTimeline(
    db,
    [
      { kind: "player", tag },
      { kind: "clan", tag, scope: "comprehensive" },
    ],
    {
      accountId,
      interactive: true,
      fromMs: anchor - 30 * DAY,
      toMs: Math.min(now, anchor + DAY),
      basis: "occurred",
      accountLines: false,
      lateCounts: false,
      people: { accounts: [], players: true },
      filter: (it) =>
        it.id === itemId &&
        it.kind !== "post" &&
        it.kind !== "battle_highlight",
    },
  );
  const found = built.timeline.find((it) => it.id === itemId);
  if (
    !found ||
    !cheerable(found) ||
    (await blockedSocialItems(db, accountId, [found])).has(itemId)
  )
    return null;
  return timelineItemRef(found);
}

export async function itemPerson(db, pageId, readerId = null) {
  if (!PAGE_ID.test(String(pageId ?? ""))) return null;
  const { rows } = await db.query(
    `select a.account_id from account a
       join account_passport ap on ap.account_id = a.account_id
      where ap.passport_id = $1 and a.kind = 'person' and a.status = 'approved'
        ${readerId ? `and not ${blockedSql("a.account_id", "$2::uuid")}` : ""}`,
    readerId ? [pageId, readerId] : [pageId],
  );
  return rows[0]?.account_id ?? null;
}

/** One exact recorded story before caps. In member mode private Clan
 * facts use the same current verified membership/role checks as the feed.
 * The public mode has no account and can never read those facts. */
export async function readRecordedItem(
  db,
  target,
  { accountId = null, now = Date.now() } = {},
) {
  const anchor = Date.parse(target.anchorAt);
  if (
    !Number.isFinite(anchor) ||
    anchor < now - 366 * DAY ||
    anchor > now + DAY
  )
    return null;
  const subjects =
    target.source === "game"
      ? [
          {
            kind: target.subjectKind,
            tag: target.subjectTag,
            scope: "comprehensive",
          },
        ]
      : [];
  const person =
    target.source === "people"
      ? await itemPerson(db, target.accountPageId, accountId)
      : null;
  if (target.source === "people" && !person) return null;
  const built = await buildTimeline(db, subjects, {
    fromMs: anchor - 2 * DAY,
    // A later return cannot erase a clock crossing that was already seen.
    toMs: Math.min(
      now,
      target.kind === "quiet_crossed" ? anchor : anchor + 2 * DAY,
    ),
    timezone: "UTC",
    basis: "occurred",
    accountId,
    interactive: Boolean(accountId),
    clanStories: Boolean(accountId),
    accountLines: false,
    lateCounts: false,
    people: person ? { accounts: [person], players: true } : null,
    filter: (it) =>
      it.id === target.itemId &&
      it.kind !== "post" &&
      it.kind !== "battle_highlight",
  });
  const found = built.timeline.find((it) => it.id === target.itemId);
  if (!found) return null;
  return (await annotateFeed(db, [found], subjects))[0];
}

/** A block does not erase the game record, but it prevents a social
 * action on the verified owner's item, in either direction. */
export async function blockedSocialItems(db, accountId, items) {
  const tagsOf = (it) =>
    it.kind === "post"
      ? []
      : (it.subjects ?? [])
          .filter((s) => s.kind === "player")
          .map((s) => s.tag);
  const pageOf = (it) =>
    it.kind === "post"
      ? it.post?.author?.account_id
      : it.section === "people"
        ? it.facts?.account_id
        : null;
  const tags = [...new Set(items.flatMap(tagsOf))];
  const pages = [...new Set(items.map(pageOf).filter(Boolean))];
  if (!tags.length && !pages.length) return new Set();
  const { rows } = await db.query(
    `select owner.player_tag, null::text as page_id from claim owner
      where owner.player_tag = any($1::text[]) and owner.status = 'verified'
        and (owner.is_primary or owner.relationship in ('primary','alt'))
        and ${blockedSql("owner.account_id", "$2::uuid")}
     union all
     select null::text, ap.passport_id from account_passport ap
      where ap.passport_id = any($3::text[])
        and ${blockedSql("ap.account_id", "$2::uuid")}`,
    [tags, accountId, pages],
  );
  const barredTags = new Set(rows.map((r) => r.player_tag).filter(Boolean));
  const barredPages = new Set(rows.map((r) => r.page_id).filter(Boolean));
  return new Set(
    items
      .filter(
        (it) =>
          tagsOf(it).some((tag) => barredTags.has(tag)) ||
          barredPages.has(pageOf(it)),
      )
      .map((it) => it.id),
  );
}

export async function resolveMemberItem(
  db,
  { accountId, itemId, item, subjects = [], posts = false, now = Date.now() },
) {
  if (
    !ITEM_ID_RE.test(itemId) ||
    !item ||
    Array.isArray(item) ||
    item.item_id !== itemId
  )
    return null;
  if (item.source === "post") {
    const post = await visiblePost(db, accountId, itemId, subjects, {
      plain: posts,
      open: true,
    });
    return post &&
      (item.post_id == null || String(post.post.id) === String(item.post_id))
      ? post
      : null;
  }
  const target = {
    itemId,
    kind: item.kind,
    source: item.source,
    anchorAt: item.at,
  };
  if (item.source === "game") {
    if (!["player", "clan"].includes(item.subject?.kind)) return null;
    try {
      target.subjectTag = normalizeTag(item.subject.tag);
    } catch {
      return null;
    }
    target.subjectKind = item.subject.kind;
  } else if (item.source === "people") {
    target.accountPageId = item.account;
  } else return null;
  const found = await readRecordedItem(db, target, { accountId, now });
  if (
    !found ||
    !cheerable(found) ||
    (found.kind !== target.kind &&
      !(SITTINGS.has(found.kind) && SITTINGS.has(target.kind))) ||
    (await blockedSocialItems(db, accountId, [found])).has(found.id)
  )
    return null;
  return found;
}
