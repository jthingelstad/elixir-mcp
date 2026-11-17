/** A post about a battle (2026-11-17, 0291): what was a highlight is a
 *  post with a battle attached (Jamie: "refactor highlighting a battle to
 *  really just be a post with a battle attached"). posts.mjs writes,
 *  edits, deletes and reads every post; this module holds what only a
 *  post about a battle has: who may write one, the battle page's panel,
 *  its share link and its public page.
 *
 *  Posting about a battle is a person's own act: the signed-in person
 *  must hold a verified claim on a player who played the battle (an
 *  unverified claim is anyone's to make, so it never lets anyone post as
 *  a player). Sharing gives the post a link, /h/<share id>, that opens
 *  without an account and shows only what the battle page shows plus the
 *  author's game name and words: never a nickname, an email, an account
 *  or who sent the link. Deleting the post makes the link a 404. */
import { randomBytes } from "node:crypto";
import { POST_ID_PATTERN, normalizeTag, postUrl } from "@elixir-mcp/contracts";
import { resolveBattleRef } from "@elixir-mcp/record/battle-links";
import { readPublicBattle } from "./battle-page.mjs";
import { verifiedAvatars } from "./avatars.mjs";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A new share id: 15 base32 characters from 15 random bytes, 5 bits of
 *  each (256 is a multiple of 32, so every character is uniform): 75
 *  random bits, never sequential, naming nothing but the post. */
export function mintShareId(bytes = randomBytes(15)) {
  let out = "";
  for (let i = 0; i < 15; i++) out += BASE32[bytes[i] & 31];
  return out;
}

/** The battle a reference names when it names exactly one, and the
 *  account's verified players who played it (primary first): the players
 *  it may post about it as. `{ battle_id, players }` or a 404's error. */
export async function battleFor(db, accountId, ref) {
  const ids = await resolveBattleRef(db, ref);
  if (ids.length !== 1)
    return { error: "not_found", message: "No battle at this address." };
  const { rows } = await db.query(
    `select bp.player_tag
       from battle_participant bp
       join claim c on c.player_tag = bp.player_tag
      where bp.battle_id = $1 and c.account_id = $2
        and c.status = 'verified'
      order by c.is_primary desc, bp.player_tag`,
    [ids[0], accountId],
  );
  return { battle_id: ids[0], players: rows.map((r) => r.player_tag) };
}

/** The player a post is written as: the one asked for when it may be, or
 *  the only one; null when neither. */
export function pickPlayer(players, asked) {
  if (asked == null || asked === "")
    return players.length === 1 ? players[0] : null;
  let tag;
  try {
    tag = normalizeTag(String(asked));
  } catch {
    return null;
  }
  return players.includes(tag) ? tag : null;
}

/** Give a post about a battle its link, or hand back the one it has:
 *  sharing twice is the same link. Its author's only. A collision on a
 *  fresh 75-bit id is a retry. `{ ok, share_url }` or `{ error }`. */
export async function sharePost(db, accountId, postId) {
  if (!/^[1-9][0-9]{0,18}$/.test(String(postId ?? "")))
    return { error: "not_found" };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { rows } = await db.query(
        `update account_post
            set share_id = coalesce(share_id, $3),
                shared_at = coalesce(shared_at, now())
          where post_id = $1::bigint and account_id = $2
            and battle_id is not null and status <> 'removed'
          returning share_id`,
        [String(postId), accountId, mintShareId()],
      );
      if (rows.length === 0) return { error: "not_found" };
      return { ok: true, share_url: postUrl(rows[0].share_id) };
    } catch (error) {
      if (error.code !== "23505" || attempt === 2) throw error;
    }
  }
}

/** A shared post, as anyone with its link reads it: the battle exactly as
 *  its public page reads it (readPublicBattle, no account), and the
 *  author's game name, side and words. Nothing about the account: who
 *  posted it is the player, by the name the game shows. A post hidden or
 *  removed after reports is a 404, as a deleted one is. */
export async function readPublicPost(db, shareId, { around = true } = {}) {
  const id = String(shareId ?? "");
  if (!POST_ID_PATTERN.test(id)) return { status: 404 };
  const {
    rows: [h],
  } = await db.query(
    `select p.share_id, p.player_tag, p.battle_id, p.body, p.created_at,
            pl.name
       from account_post p
       join account a on a.account_id = p.account_id
                     and a.kind = 'person' and a.status = 'approved'
       join player pl on pl.player_tag = p.player_tag
      where p.share_id = $1 and p.status = 'visible'
        and p.battle_id is not null`,
    [id],
  );
  if (!h) return { status: 404 };
  const read = await readPublicBattle(db, h.battle_id, { around });
  if (read.status !== 200) return { status: 404 };
  const side = read.sides.findIndex((s) =>
    s.players.some((p) => p.player_tag === h.player_tag),
  );
  const url = postUrl(h.share_id);
  // The author's profile image, when an account verified them and chose
  // one (avatars.mjs): a shared post shows it to anyone with the link.
  const face = (await verifiedAvatars(db, [h.player_tag])).get(h.player_tag);
  return {
    ...read,
    post: {
      ...(face ? { avatar_card_id: face } : {}),
      share_id: h.share_id,
      url,
      image: `${url}.png`,
      player_tag: h.player_tag,
      name: h.name ?? null,
      side: side < 0 ? null : side === 0 ? "left" : "right",
      outcome: side < 0 ? null : (read.sides[side].outcome ?? null),
      words: h.body,
      created_at: h.created_at,
    },
  };
}
