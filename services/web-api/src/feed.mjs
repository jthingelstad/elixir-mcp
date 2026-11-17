/**
 * Home's one feed (slice 7, #765): the timeline GET /api/me/timeline builds,
 * with what the page needs to show it and nothing an agent reads. Each item
 * gains:
 *
 *   groups     which of Home's chips it belongs under: "you" (your own
 *              players, and the account's own items), "friends", "clan"
 *              (a clan you follow, or one of its members), and "close"
 *              (a player you marked a close friend, 0281: the reader's
 *              own mark, in the reader's own read). Everyone is every
 *              item, so it is never named.
 *   spark      a sitting's battles in order, for the sparkline: each
 *              battle's outcome and crown margin. Sessions only.
 *   battle_url the battle that proved a moment, as its public page.
 *   scores     a sitting's plain score facts for its line under the title
 *              (design canvas, 2026-11-13): `best_win`, the widest win's
 *              score ("3-0"), and `three_crowns`, how many wins took all
 *              three crowns. From the stored spark's crowns; a week stored
 *              before they were kept has none, and the line says less.
 *   deck       a sitting's deck row: its most played deck's label and
 *              eight cards, each `{id, name, form, elixir_cost}`, kept at
 *              build time. A week stored before it was kept has none.
 *   versus     a highlight's two decks, `{mine, theirs}`, each
 *              `{label, cards}`; theirs null unless one opponent.
 *   proof_mode the mode group of the battle that proved a moment
 *              ("ladder"), for the line under its result.
 *   moment_card
 *              the card a Mastery badge is for, `{id, name}`, so the
 *              moment can show that card's art (2026-11-17). From the
 *              badge's own identifier (masteryCard) and the catalog, in
 *              one read for the page; absent when the catalog has no card
 *              by that name. A card unlocked, maxed or a form names its
 *              card in its own facts (`card_id`, `form`) and needs none.
 *   moment_cards
 *              a day of one player's Mastery badges told as one item
 *              (facts.badges, 2026-11-17): the cards those badges are
 *              for, `[{id, name}]`, highest level first, at most
 *              MOMENT_CARDS_CAP; the catalog's cards only.
 *   avatar_card_id
 *              the profile image of the player the item's avatar draws
 *              (avatarTagOf), when an account verified that player and
 *              chose one (avatars.mjs, 2026-11-14). Absent otherwise.
 *
 * The chips only choose what is shown; the read is the timeline's, so the
 * page's place ("New since your last visit") and its evidence reads stay
 * one. These fields are the website's: MCP's elixir_timeline never carries
 * them, so its contract does not change.
 */
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { masteryCard } from "@elixir-mcp/record/badge-names";
import { verifiedAvatars } from "./avatars.mjs";
import { proofOf } from "@elixir-mcp/tools/activity/bell";
import { modeGroupOf } from "@elixir-mcp/contracts";
import {
  highlightVersus,
  scoresOf,
  sessionDeck,
  sessionSpark,
} from "@elixir-mcp/tools/activity/entries";

/** The facts a moment names its proving battle under (follow.mjs). */
const PROOFS = ["promoted_by", "crossed_by", "best_win"];
/** The battle that proved a moment, or null: one function, shared with
 *  the bell, its mail and its push (packages/tools activity/bell). */
export { proofOf };

/** The mode group of the battle that proved a moment, or null. */
export const proofModeOf = (it) => {
  for (const k of PROOFS) {
    const p = it.facts?.[k];
    if (!p?.battle_id) continue;
    if (p.mode) return p.mode;
    return p.type ? modeGroupOf(p.type, p.event_tag ?? null) : null;
  }
  return null;
};

/** The tags an item is about: its subject and every subject it names. */
const tagsOf = (it) =>
  new Set(
    [it.subject_tag, ...(it.subjects ?? []).map((s) => s.tag)].filter(Boolean),
  );

/** Which chips an item sits under, from the account's own subjects. An
 *  item about nobody the account follows is the account's own (its
 *  administration, a feedback answer), so it is yours. */
export function groupsOf(it, subjects, close = null) {
  const own = new Set();
  const friends = new Set();
  const clans = new Set();
  const all = new Set();
  for (const s of subjects) {
    all.add(s.tag);
    if (s.kind === "clan") clans.add(s.tag);
    else if (s.relationship === "friend") friends.add(s.tag);
    else if (s.relationship === "primary" || s.relationship === "alt")
      own.add(s.tag);
  }
  const tags = tagsOf(it);
  const groups = [];
  const any = (set) => [...tags].some((t) => set.has(t));
  // A people item is about another account unless it names your own
  // player: a followed account's news is Friends, never You, even when
  // you follow none of its players.
  const person = it.section === "people" && !any(own);
  if (!person && (any(own) || ![...tags].some((t) => all.has(t))))
    groups.push("you");
  if (person || any(friends)) groups.push("friends");
  if (any(clans)) groups.push("clan");
  if (close?.size && any(close)) groups.push("close");
  return groups;
}

/** The players the reader marked close friends (0281), as a set of tags.
 *  The account's own read only: never another member's, never MCP. */
export async function closeTags(db, accountId) {
  const { rows } = await db.query(
    `select player_tag from claim where account_id = $1 and close`,
    [accountId],
  );
  return new Set(rows.map((r) => r.player_tag));
}

/** A sitting's battles as the sparkline draws them: "w", "l" or "d", and
 *  the crown margin's size, 1 to 3 (null when the record lacks a side's
 *  crowns). */
export const sparkOf = (it) => sparkBars(sessionSpark(it));

/** The bars from a sitting's battles ({ outcome, margin }, in order). */
export function sparkBars(spark) {
  if (!Array.isArray(spark) || spark.length === 0) return null;
  return spark.map((b) => ({
    r: b.outcome === "win" ? "w" : b.outcome === "loss" ? "l" : "d",
    m:
      typeof b.margin === "number"
        ? Math.min(3, Math.max(1, Math.abs(b.margin)))
        : null,
  }));
}

/** A sitting's score facts (the widest win, the three-crown wins): the
 *  tools' one function, which the digest reads too (2026-11-16). */
export { scoresOf };

/** Whether a clan arrival offers Follow (design canvas 2026-11-13): a
 *  member who joined a clan you follow, and whom you do not follow, from the
 *  subjects the read already holds. A player followed with notify off is
 *  not among them, and Follow's own write answers for them as everywhere
 *  else. */
export function offersFollow(it, subjects) {
  if (it.kind !== "member_joined") return false;
  const tag = it.facts?.player_tag;
  if (!tag) return false;
  return !subjects.some((s) => s.kind === "player" && s.tag === tag);
}

/** The player an item's avatar draws, as Home's feed picks it: its first
 *  player subject, else the player its facts name; null for a clan's item
 *  or the account's own. */
export function avatarTagOf(it) {
  const player = (it.subjects ?? []).find((s) => s.kind === "player");
  return player?.tag ?? it.facts?.player_tag ?? null;
}

const BADGE_KINDS = new Set(["badge_earned", "legendary_badge_earned"]);

/** The card a Mastery badge item is about, by its shown name; null for any
 *  other item. */
export const masteryCardOf = (it) =>
  BADGE_KINDS.has(it?.kind) ? masteryCard(it.facts?.badge) : null;

/** How many cards a Mastery roll-up shows. */
const MOMENT_CARDS_CAP = 4;

/** The cards a Mastery roll-up's badges are for, by shown name, highest
 *  level first (the facts' order); [] for any other item. */
export const masteryCardsOf = (it) =>
  it?.kind === "badge_earned" && Array.isArray(it.facts?.badges)
    ? it.facts.badges.map((b) => masteryCard(b.badge)).filter(Boolean)
    : [];

/** The catalog's cards by shown name, for the Mastery badges on a page: one
 *  read, and none when the page has no Mastery badge. */
async function cardsByName(db, names) {
  const wanted = [...new Set(names.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { rows } = await db.query(
    `select card_id, name from card
      where kind = 'card' and name = any($1::text[])`,
    [wanted],
  );
  return new Map(rows.map((r) => [r.name, r.card_id]));
}

/** The timeline's items with Home's fields added. */
export async function annotateFeed(db, timeline, subjects, close = null) {
  const items = timeline ?? [];
  const proofs = items.map(proofOf);
  const links = await battleLinks(db, proofs.filter(Boolean));
  const mastery = items.map(masteryCardOf);
  const rolled = items.map(masteryCardsOf);
  const cards = await cardsByName(db, [...mastery, ...rolled.flat()]);
  const faces = items.map(avatarTagOf);
  const avatars = await verifiedAvatars(db, faces);
  return items.map((it, i) => {
    const spark = sparkOf(it);
    const scores = scoresOf(sessionSpark(it));
    const link = proofs[i] ? links.get(proofs[i]) : null;
    const deck = sessionDeck(it);
    const versus = highlightVersus(it);
    const proofMode = proofs[i] ? proofModeOf(it) : null;
    const many = rolled[i]
      .filter((name) => cards.has(name))
      .slice(0, MOMENT_CARDS_CAP)
      .map((name) => ({ id: cards.get(name), name }));
    return {
      ...it,
      groups: groupsOf(it, subjects, close),
      ...(spark ? { spark } : {}),
      ...(scores ? { scores } : {}),
      ...(deck ? { deck } : {}),
      ...(versus ? { versus } : {}),
      ...(link ? { battle_url: link.url } : {}),
      ...(proofMode ? { proof_mode: proofMode } : {}),
      ...(offersFollow(it, subjects) ? { offer_follow: true } : {}),
      ...(mastery[i] && cards.has(mastery[i])
        ? { moment_card: { id: cards.get(mastery[i]), name: mastery[i] } }
        : {}),
      ...(many.length > 1 ? { moment_cards: many } : {}),
      ...(faces[i] && avatars.has(faces[i])
        ? { avatar_card_id: avatars.get(faces[i]) }
        : {}),
    };
  });
}
