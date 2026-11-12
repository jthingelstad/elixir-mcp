/** A player's highlight of one of their battles, and its share link
 *  (social slice 4, #762; DECISIONS "A battle has its own page",
 *  "Timeline shape", "Everyone signs in; shared posts stay public").
 *
 *  Highlighting is a person's own act: the signed-in person must hold a
 *  verified claim on a player who played the battle (an unverified claim
 *  is anyone's to make, so it never lets anyone post as a player). The
 *  words are stored as typed, up to 500 characters, and escaped at each
 *  output, never here (DECISIONS "A name is escaped at its output, never
 *  in storage"). Sharing gives the post a link, /h/<share id>, that opens
 *  without an account and shows only what the battle page shows plus the
 *  owner's game name and words: never a nickname, an email, an account or
 *  who sent the link. Deleting the highlight deletes its words and makes
 *  the link a 404. */
import { randomBytes } from "node:crypto";
import {
  InvalidTagError,
  POST_ID_PATTERN,
  normalizeTag,
  postUrl,
} from "@elixir-mcp/contracts";
import { resolveBattleRef } from "@elixir-mcp/record/battle-links";
import { readPublicBattle } from "./battle-page.mjs";

/** The most a highlight's words run to, in characters (code points, as
 *  Postgres counts them in 0239's check). */
const WORDS_MAX = 500;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A new share id: 15 base32 characters from 15 random bytes, 5 bits of
 *  each (256 is a multiple of 32, so every character is uniform): 75
 *  random bits, never sequential, naming nothing but the post. */
export function mintShareId(bytes = randomBytes(15)) {
  let out = "";
  for (let i = 0; i < 15; i++) out += BASE32[bytes[i] & 31];
  return out;
}

/** The words as stored: line breaks kept (CRLF made LF), other control
 *  characters dropped (Postgres refuses NUL in text), ends trimmed.
 *  Null when they run past WORDS_MAX; markup is kept as typed. */
export function cleanWords(words) {
  const s = [...String(words ?? "").replace(/\r\n?/g, "\n")]
    .filter((c) => {
      const n = c.codePointAt(0);
      return n === 10 || (n > 31 && n !== 127);
    })
    .join("")
    .trim();
  return [...s].length > WORDS_MAX ? null : s;
}

const fail = (status, error, message) => ({ status, error, message });

/** One highlight as its owner reads it. */
function own(r) {
  return {
    highlight_id: r.highlight_id,
    player_tag: r.player_tag,
    battle_id: r.battle_id,
    words: r.words,
    share_url: r.share_id ? postUrl(r.share_id) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const OWN_COLUMNS = `highlight_id, player_tag, battle_id, words, share_id,
                     created_at, updated_at`;

/** The battle a reference names, when it names exactly one. */
async function battleOf(db, ref) {
  const ids = await resolveBattleRef(db, ref);
  return ids.length === 1 ? ids[0] : null;
}

/** The account's verified players who played this battle: the players it
 *  may highlight it as. */
async function eligiblePlayers(db, accountId, battleId) {
  const { rows } = await db.query(
    `select bp.player_tag
       from battle_participant bp
       join claim c on c.player_tag = bp.player_tag
      where bp.battle_id = $1 and c.account_id = $2
        and c.status = 'verified'
      order by c.is_primary desc, bp.player_tag`,
    [battleId, accountId],
  );
  return rows.map((r) => r.player_tag);
}

/** What the battle page asks: may this person highlight this battle, as
 *  which players, and the highlights they have posted on it. */
export async function highlightsOn(db, accountId, battleRef) {
  const battleId = await battleOf(db, battleRef);
  if (!battleId) return fail(404, "not_found", "No battle at this address.");
  const players = await eligiblePlayers(db, accountId, battleId);
  const { rows } = await db.query(
    `select ${OWN_COLUMNS} from battle_highlight
      where battle_id = $1 and account_id = $2
      order by created_at`,
    [battleId, accountId],
  );
  return {
    status: 200,
    battle_id: battleId,
    can_highlight_as: players,
    highlights: rows.map(own),
  };
}

/** Post a highlight to the player's timeline. */
export async function createHighlight(
  db,
  accountId,
  { battle, player_tag, words },
) {
  const battleId = await battleOf(db, battle);
  if (!battleId) return fail(404, "not_found", "No battle at this address.");
  const clean = cleanWords(words);
  if (clean === null)
    return fail(400, "too_long", `Up to ${WORDS_MAX} characters.`);
  const players = await eligiblePlayers(db, accountId, battleId);
  let tag = null;
  if (player_tag !== undefined && player_tag !== null && player_tag !== "") {
    try {
      tag = normalizeTag(String(player_tag));
    } catch (error) {
      if (error instanceof InvalidTagError)
        return fail(400, "bad_request", "Not a player tag.");
      throw error;
    }
  } else if (players.length === 1) tag = players[0];
  // The one rule that keeps a post honest: only a verified player of
  // yours who played this battle.
  if (!tag || !players.includes(tag))
    return fail(
      403,
      "not_your_battle",
      "Only a player you have verified, who played this battle, can highlight it.",
    );
  const { rows } = await db.query(
    `insert into battle_highlight (player_tag, battle_id, account_id, words)
     values ($1, $2, $3, $4)
     on conflict (player_tag, battle_id) do nothing
     returning ${OWN_COLUMNS}`,
    [tag, battleId, accountId, clean],
  );
  if (rows.length === 0)
    return fail(
      409,
      "already_highlighted",
      "This battle is already on that player's timeline.",
    );
  return { status: 201, highlight: own(rows[0]) };
}

/** Change a highlight's words. Only the account that posted it. Words
 *  that change count up its revision (0240) and stamp updated_at, so the
 *  timeline serves the same item grown and a cross-posted line is edited
 *  in place; the same words again change nothing. `changed` says which,
 *  for the caller's syndication wake. */
export async function editHighlight(db, accountId, highlightId, { words }) {
  const clean = cleanWords(words);
  if (clean === null)
    return fail(400, "too_long", `Up to ${WORDS_MAX} characters.`);
  // SET reads the row as it was; RETURNING reads it as written, so a
  // changed updated_at (now() is the transaction's instant) says the
  // words changed.
  const { rows } = await db.query(
    `update battle_highlight
        set revision = revision + case when words <> $3 then 1 else 0 end,
            updated_at = case when words <> $3 then now() else updated_at end,
            words = $3
      where highlight_id = $1 and account_id = $2
      returning ${OWN_COLUMNS}, updated_at = now() as changed`,
    [highlightId, accountId, clean],
  );
  if (rows.length === 0) return fail(404, "not_found", "No such highlight.");
  return { status: 200, highlight: own(rows[0]), changed: rows[0].changed };
}

/** Delete a highlight and its words; its link, if shared, is a 404. */
export async function deleteHighlight(db, accountId, highlightId) {
  const { rowCount } = await db.query(
    `delete from battle_highlight where highlight_id = $1 and account_id = $2`,
    [highlightId, accountId],
  );
  if (rowCount === 0) return fail(404, "not_found", "No such highlight.");
  return { status: 200, deleted: true };
}

/** Give a highlight its link, or hand back the one it has: sharing twice
 *  is the same link. A collision on a fresh 75-bit id is a retry. */
export async function shareHighlight(db, accountId, highlightId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { rows } = await db.query(
        `update battle_highlight
            set share_id = coalesce(share_id, $3),
                shared_at = coalesce(shared_at, now())
          where highlight_id = $1 and account_id = $2
          returning ${OWN_COLUMNS}`,
        [highlightId, accountId, mintShareId()],
      );
      if (rows.length === 0)
        return fail(404, "not_found", "No such highlight.");
      return { status: 200, highlight: own(rows[0]) };
    } catch (error) {
      if (error.code !== "23505" || attempt === 2) throw error;
    }
  }
}

/** A shared post, as anyone with its link reads it: the battle exactly as
 *  its public page reads it (readPublicBattle, no account), and the
 *  owner's game name, side and words. Nothing about the account: who
 *  posted it is the player, by the name the game shows. */
export async function readPublicPost(db, shareId, { around = true } = {}) {
  const id = String(shareId ?? "");
  if (!POST_ID_PATTERN.test(id)) return { status: 404 };
  const {
    rows: [h],
  } = await db.query(
    `select h.share_id, h.player_tag, h.battle_id, h.words, h.created_at,
            p.name
       from battle_highlight h
       join player p on p.player_tag = h.player_tag
      where h.share_id = $1`,
    [id],
  );
  if (!h) return { status: 404 };
  const read = await readPublicBattle(db, h.battle_id, { around });
  if (read.status !== 200) return { status: 404 };
  const side = read.sides.findIndex((s) =>
    s.players.some((p) => p.player_tag === h.player_tag),
  );
  const url = postUrl(h.share_id);
  return {
    ...read,
    highlight: {
      share_id: h.share_id,
      url,
      image: `${url}.png`,
      player_tag: h.player_tag,
      name: h.name ?? null,
      side: side < 0 ? null : side === 0 ? "left" : "right",
      outcome: side < 0 ? null : (read.sides[side].outcome ?? null),
      words: h.words,
      created_at: h.created_at,
    },
  };
}
