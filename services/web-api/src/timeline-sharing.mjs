/** Authorized creation and capability-only public reading of one item.
 * Client facts are never used. A cache/renderer is not the authority over
 * publication, moderation, account status or the retained record.
 */
import { normalizeTag } from "@elixir-mcp/contracts";
import { storyId, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { SITTINGS } from "@elixir-mcp/ui/session-story";
import { readPublishedPost, readVisiblePost } from "@elixir-mcp/posts";
import {
  ensureShare,
  publicItem,
  readShare,
  shareableItem,
} from "@elixir-mcp/sharing";
import { ITEM_ID, shareUrl } from "@elixir-mcp/sharing/paths";
import { itemPerson as person, readRecordedItem } from "./timeline-items.mjs";
import { readSitting } from "./routes/player.mjs";
import { readPublicBattle } from "./battle-page.mjs";

const DAY = 86400_000;

/** Read by an exact story id before the cap, from one bounded scope. */
async function canonicalItem(
  db,
  target,
  { plain = false, now = Date.now() } = {},
) {
  if (target.source === "battle") {
    const read = await readPublicBattle(db, target.battleId, { around: false });
    if (read.status !== 200) return null;
    return {
      id: storyId("battle", read.battle.id),
      kind: "battle",
      visibility: "public",
      at: read.battle.battle_time,
      ...read,
      subjects: read.sides.flatMap((s) =>
        s.players.map((p) => ({
          kind: "player",
          tag: p.player_tag,
          name: p.name,
        })),
      ),
    };
  }
  if (target.source === "post")
    return readPublishedPost(db, target.postId, { plain });
  const at = Date.parse(target.anchorAt);
  if (!Number.isFinite(at) || at < now - 366 * DAY || at > now + DAY)
    return null;
  if (target.source === "game" && SITTINGS.has(target.kind)) {
    const read = await readSitting(
      db,
      target.subjectTag,
      {
        id: target.itemId,
        at: new Date(at).toISOString(),
        publicOnly: true,
        timezone: "UTC",
      },
      now,
    );
    return read && !read.error && read.shareable ? read.item : null;
  }
  return readRecordedItem(db, target, { now });
}

export async function createItemShare(db, accountId, input, options = {}) {
  if (input?.source !== "battle" && !ITEM_ID.test(String(input?.item_id ?? "")))
    return null;
  let target;
  if (input.source === "battle") {
    const read = await readPublicBattle(db, input.battle_ref, {
      around: false,
    });
    if (read.status !== 200) return null;
    target = {
      itemId: storyId("battle", read.battle.id),
      kind: "battle",
      source: "battle",
      battleId: read.battle.id,
      anchorAt: read.battle.battle_time,
    };
  } else if (input.source === "post") {
    const subjects = await subjectsFor(db, accountId);
    const item = await readVisiblePost(db, accountId, input.post_id, {
      subjects,
      plain: options.plain === true,
      visibleOnly: true,
      open: true,
    });
    if (!item || item.id !== input.item_id) return null;
    target = {
      itemId: item.id,
      kind: "post",
      source: "post",
      postId: item.post.id,
      anchorAt: item.at,
    };
  } else if (input.source === "people") {
    if (!(await person(db, input.account, accountId))) return null;
    target = {
      itemId: input.item_id,
      kind: input.kind,
      source: "people",
      accountPageId: input.account,
      anchorAt: input.at,
    };
  } else if (input.source === "game") {
    if (!["player", "clan"].includes(input.subject?.kind)) return null;
    let tag;
    try {
      tag = normalizeTag(input.subject.tag);
    } catch {
      return null;
    }
    target = {
      itemId: input.item_id,
      kind: input.kind,
      source: "game",
      subjectKind: input.subject.kind,
      subjectTag: tag,
      anchorAt: input.at,
    };
  } else return null;
  const item = await canonicalItem(db, target, options);
  if (!shareableItem(item) || item.id !== target.itemId) return null;
  // Only canonical names/times/kinds persist. The submitted kind or time
  // selected a read; it did not supply a public payload.
  target.kind = item.kind;
  target.anchorAt = SITTINGS.has(item.kind)
    ? item.facts.started_at
    : (item.sort_at ?? item.at);
  return ensureShare(db, target);
}

export async function readSharedItem(db, id, options = {}) {
  const ref = await readShare(db, id);
  if (!ref) return null;
  const item = await canonicalItem(
    db,
    {
      itemId: ref.item_id,
      kind: ref.item_kind,
      source: ref.source,
      subjectKind: ref.subject_kind,
      subjectTag: ref.subject_tag,
      accountPageId: ref.account_page_id,
      postId: ref.post_id,
      anchorAt: ref.anchor_at,
      battleId: ref.battle_id,
    },
    options,
  );
  const projected = item?.id === ref.item_id ? publicItem(item) : null;
  return projected ? { item: projected, url: shareUrl(id) } : null;
}
