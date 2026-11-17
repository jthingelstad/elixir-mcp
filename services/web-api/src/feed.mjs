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
 *   versus     a battle post's two decks, `{mine, theirs}`, each
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
 *   badge_art  the badge's own art (0288, 2026-11-17, the owner: "Yes use
 *              badge art. For sure."), a path on this origin to the
 *              mirror's unaltered copy (contracts' badgeArtPath), for a
 *              single badge moment and a 12-win run that rose a level:
 *              the icon of the level the line tells (0 for a badge with
 *              no tiers), never a neighbouring level's. Absent when no read
 *              profile has carried that level's icon yet, and a Mastery
 *              roll-up keeps its cards. The page falls back to what it
 *              drew before when the mirror has not copied the file yet.
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
import { PEOPLE_KIND_SCHEMAS } from "@elixir-mcp/tools/activity/schemas";
import {
  badgeArtPath,
  modeGroupOf,
  timelineModeOf,
} from "@elixir-mcp/contracts";
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

/**
 * The Timeline's mode filter (Jamie, 2026-11-17: "a player should be able
 * to filter the timeline by these same groups: Trophy Road, Ranked, War,
 * Casual"). Which of the four an item sits under, from the one mode-group
 * vocabulary (contracts' modeGroupOf, folded by timelineModeOf): a session
 * under each mode it was played in, a battle (a highlight's, a post's)
 * under its own, a moment under the mode it is about.
 *
 * An item that is about no mode (a text post, a badge, a card, a clan's
 * roster line, a follow) sits under none, so a mode filter leaves it out
 * and All modes shows it. Every kind is listed here on purpose: a kind
 * not listed is about no mode, and a test (feed-modes.test.mjs) fails on
 * any kind the timeline can build that this table does not name, so a new
 * kind is classified when it lands.
 */
const NO_MODE = () => [];
const groups = (...gs) => [
  ...new Set(gs.filter(Boolean).map((g) => timelineModeOf(g))),
];
/** A battle as an item carries it: its group, or its type and tag. */
const battleGroup = (b) =>
  b
    ? (b.mode_group ?? (b.type ? modeGroupOf(b.type, b.event_tag) : null))
    : null;
/** A sitting: every mode its battles were played in. */
const sittingModes = (it) => groups(...Object.keys(it.facts?.by_mode ?? {}));

export const KIND_MODES = {
  battle_session: sittingModes,
  session_standout: sittingModes,
  battle_highlight: (it) => groups(battleGroup(it.facts?.battle)),
  // A post with a battle attached is that battle's; a post of words, a
  // deck or cards is about no mode.
  post: (it) => groups(battleGroup(it.post?.battle ?? it.facts?.battle)),
  // Arenas and the best trophies are Trophy Road's; leagues are Ranked's.
  arena_changed: () => ["ladder"],
  best_trophies_band: () => ["ladder"],
  ranked_promotion: () => ["ranked"],
  ranked_season_finished: () => ["ranked"],
  // A switch names its mode (13.6.0).
  deck_switched: (it) => groups(it.facts?.mode),
  // A challenge's runs are a challenge's: Casual.
  challenge_best_run: () => ["casual"],
  twelve_win_run: () => ["casual"],
  // The clan's River Race.
  bracket_observed: () => ["war"],
  race_finished: () => ["war"],
  week_resolved: () => ["war"],
  // A player's own war week (13.10.0).
  war_week_played: () => ["war"],
  // About the player, not one mode: wins counted in every mode, a level,
  // a card, a badge, a clan's roster, a quiet spell or a return.
  career_wins_step: NO_MODE,
  collection_level_step: NO_MODE,
  badge_earned: NO_MODE,
  legendary_badge_earned: NO_MODE,
  card_unlocked: NO_MODE,
  card_form_unlocked: NO_MODE,
  card_maxed: NO_MODE,
  // A first win is the card's news, wherever it was won (13.9.0).
  card_first_win: NO_MODE,
  king_tower_leveled: NO_MODE,
  clan_joined: NO_MODE,
  clan_left: NO_MODE,
  member_joined: NO_MODE,
  member_left: NO_MODE,
  member_role_changed: NO_MODE,
  quiet_crossed: NO_MODE,
  returned: NO_MODE,
  account: NO_MODE,
  account_feedback_responded: NO_MODE,
  // What a clan or an app attested (contracts' ATTESTED_FACT_TYPES): a
  // clan's own awards and messages, a departure, a family app's game.
  departure_classified: NO_MODE,
  role_change_made: NO_MODE,
  award_granted: NO_MODE,
  award_standing: NO_MODE,
  member_away: NO_MODE,
  clan_message: NO_MODE,
  personal_record: NO_MODE,
  // People items, an account's own news, are about no mode. Named from
  // their schemas so this file never names a Stamp (the stamps package's
  // boundary test).
  ...Object.fromEntries(
    Object.keys(PEOPLE_KIND_SCHEMAS).map((kind) => [kind, NO_MODE]),
  ),
};

/** The mode filters an item sits under; [] when it is about no mode or
 *  its kind is not one the table names. */
export const modesOf = (it) => (KIND_MODES[it?.kind] ?? NO_MODE)(it);

/** Whether a mode filter shows an item; null is All modes. */
export const inMode = (it, mode) => !mode || modesOf(it).includes(mode);

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

/** The badge and the level whose art an item draws;
 *  null for an item that draws none. A Mastery roll-up (facts.badges)
 *  draws its cards, and a 12-win run that rose no level names none. */
function badgeArtKeyOf(it) {
  const f = it?.facts ?? {};
  if (typeof f.badge !== "string" || !f.badge) return null;
  if (it.kind === "legendary_badge_earned") return { name: f.badge, level: 0 };
  if (it.kind === "badge_earned" && !Array.isArray(f.badges))
    return { name: f.badge, level: Number.isInteger(f.level) ? f.level : 0 };
  if (it.kind === "twelve_win_run" && Number.isInteger(f.level))
    return { name: f.badge, level: f.level };
  return null;
}

/** The badge art held for the badges on a page: one read, and none when
 *  the page has no badge moment. */
async function badgeArtByName(db, keys) {
  const names = [...new Set(keys.filter(Boolean).map((k) => k.name))];
  if (names.length === 0) return new Map();
  const { rows } = await db.query(
    `select name, level, icon_url from badge_art where name = any($1::text[])`,
    [names],
  );
  return new Map(rows.map((r) => [`${r.name}|${r.level}`, r.icon_url]));
}

const badgeArtOf = (key, held) =>
  key ? badgeArtPath(held.get(`${key.name}|${key.level}`)) : null;

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
  const badgeKeys = items.map(badgeArtKeyOf);
  const badgeHeld = await badgeArtByName(db, badgeKeys);
  return items.map((it, i) => {
    const badgeArt = badgeArtOf(badgeKeys[i], badgeHeld);
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
      ...(badgeArt ? { badge_art: badgeArt } : {}),
      ...(faces[i] && avatars.has(faces[i])
        ? { avatar_card_id: avatars.get(faces[i]) }
        : {}),
    };
  });
}
