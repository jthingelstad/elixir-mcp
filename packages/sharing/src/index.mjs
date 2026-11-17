import { randomBytes } from "node:crypto";
import { ITEM_ID, SHARE_ID, shareUrl } from "./paths.mjs";
export { publicItem, shareableItem } from "./projection.mjs";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
export function mintShareId(bytes = randomBytes(24)) {
  return [...bytes].map((b) => BASE32[b & 31]).join("");
}

/** Called only after the door resolves and authorizes the canonical item.
 * Concurrent tabs and different sharers get one stable link, with no
 * account/referral identity stored. A random-id collision is retried.
 */
export async function ensureShare(db, target) {
  if (!ITEM_ID.test(String(target?.itemId ?? "")))
    throw new Error("invalid shared item");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const {
        rows: [row],
      } = await db.query(
        `insert into timeline_share
           (share_id, item_id, item_kind, source, subject_kind, subject_tag,
            account_page_id, post_id, battle_id, anchor_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (item_id) do update
           set share_id = case when timeline_share.created_at < now() - interval '1 year'
                               then excluded.share_id else timeline_share.share_id end,
               created_at = case when timeline_share.created_at < now() - interval '1 year'
                                 then now() else timeline_share.created_at end
         returning share_id`,
        [
          mintShareId(),
          target.itemId,
          target.kind,
          target.source,
          target.subjectKind ?? null,
          target.subjectTag ?? null,
          target.accountPageId ?? null,
          target.postId ?? null,
          target.battleId ?? null,
          target.anchorAt,
        ],
      );
      return { id: row.share_id, url: shareUrl(row.share_id) };
    } catch (error) {
      if (error.code !== "23505" || attempt === 2) throw error;
    }
  }
}

export async function readShare(db, id) {
  if (!SHARE_ID.test(String(id ?? ""))) return null;
  const { rows } = await db.query(
    `select share_id, item_id, item_kind, source, subject_kind, subject_tag,
            account_page_id, post_id::text, battle_id, anchor_at
       from timeline_share where share_id = $1
         and created_at >= now() - interval '1 year'`,
    [id],
  );
  return rows[0] ?? null;
}
