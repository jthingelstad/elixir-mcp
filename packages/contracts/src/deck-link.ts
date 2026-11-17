/**
 * The game's deck link (2026-11-17): what "Copy deck" in Clash Royale
 * puts on the clipboard, read so a post can carry the deck as cards
 * rather than as a link. Pure: no catalog, no network. A caller checks
 * the ids against the card catalog before it believes them.
 *
 * Three spellings are read, each carrying the same `deck` parameter (the
 * eight card ids, `;`-separated) and an optional `tt` (the tower troop):
 *
 * - `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=…&tt=…`
 *   (the web form wrapping the app form; what Elixir's own "Copy deck"
 *   hands back, `deckLink` below);
 * - `https://link.clashroyale.com/deck/en?deck=…&tt=…` (the older web
 *   form);
 * - `clashroyale://copyDeck?deck=…&tt=…` (the app form alone).
 *
 * Percent-encoding (`%3B` for `;`, an encoded inner link) is undone
 * once. Other parameters (`l`, `slots`, `id`) are ignored: Elixir keeps
 * the cards, never the rest. Anything else, another host or a link with
 * no eight-card deck, is not a deck link, and stays the words it was.
 */

/** The game's link host. */
const HOST = "link.clashroyale.com";

/** A language segment in the web forms: `en`, `pt`, `zh-hant`. */
const LANG = "[a-z]{2}(?:[-_][a-z]{2,4})?";

/** One deck link in running text, in any of its spellings. The deck's
 *  own characters are digits and `;` (or `%3B`); the match stops at
 *  whitespace. */
const LINK_IN_TEXT = new RegExp(
  [
    `https?://${HOST.replace(/\./g, "\\.")}/(?:${LANG}/?)?\\?clashroyale(?::|%3A)(?://|%2F%2F)copyDeck(?:\\?|%3F)\\S+`,
    `https?://${HOST.replace(/\./g, "\\.")}/deck/${LANG}/?\\?\\S+`,
    `clashroyale://copyDeck\\?\\S+`,
  ].join("|"),
  "gi",
);

export interface DeckFromLink {
  /** The eight card ids, in the link's order. */
  cards: number[];
  /** The tower troop's id, or null when the link names none. */
  tower_troop: number | null;
}

/** Card ids are positive integers of at most nine digits (26000000,
 *  159000000). */
const ID = /^\d{1,9}$/;

function decodeOnce(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The query string a deck link's cards sit in, or null. */
function deckQuery(link: string): string | null {
  const raw = decodeOnce(link.trim());
  const app = /clashroyale:\/\/copyDeck\?(.*)$/i.exec(raw);
  if (app) {
    // The app form alone, or wrapped by the web form's `/<lang>/?`.
    const head = raw.slice(0, app.index);
    if (head && !new RegExp(`^https?://${HOST.replace(/\./g, "\\.")}/(?:${LANG}/?)?\\?$`, "i").test(head))
      return null;
    return app[1] ?? "";
  }
  const web = new RegExp(
    `^https?://${HOST.replace(/\./g, "\\.")}/deck/${LANG}/?\\?(.*)$`,
    "i",
  ).exec(raw);
  return web ? (web[1] ?? "") : null;
}

/**
 * One deck link read: `{ cards, tower_troop }`, or null when it is not a
 * deck link with eight distinct card ids. The ids are not yet checked
 * against the catalog.
 */
export function parseDeckLink(link: string): DeckFromLink | null {
  if (typeof link !== "string" || link.length > 600) return null;
  const query = deckQuery(link);
  if (query == null) return null;
  const params = new Map<string, string>();
  for (const part of query.split("&")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const key = part.slice(0, at).toLowerCase();
    if (!params.has(key)) params.set(key, part.slice(at + 1));
  }
  const deck = params.get("deck");
  if (!deck) return null;
  const ids = deck.split(";").filter((s) => s !== "");
  if (ids.length !== 8 || !ids.every((s) => ID.test(s))) return null;
  const cards = ids.map(Number);
  if (new Set(cards).size !== 8) return null;
  const tt = params.get("tt");
  if (tt != null && tt !== "" && !ID.test(tt)) return null;
  return { cards, tower_troop: tt ? Number(tt) : null };
}

/**
 * The first deck link in some words: the link as written, where it
 * starts, and the deck it carries; null when there is none. A link the
 * reader does not recognise is not found, and stays in the words.
 */
export function findDeckLink(
  text: string,
): { link: string; index: number; deck: DeckFromLink } | null {
  if (typeof text !== "string") return null;
  for (const m of text.matchAll(LINK_IN_TEXT)) {
    // A link ends before trailing punctuation a sentence put after it.
    const link = m[0].replace(/[),.!?'"\]]+$/, "");
    const deck = parseDeckLink(link);
    if (deck) return { link, index: m.index ?? 0, deck };
  }
  return null;
}

/** The game's link for a deck: what "Copy deck" hands back, the web form
 *  that opens the game's copy prompt. */
export function deckLink(deck: DeckFromLink): string {
  const tt = deck.tower_troop != null ? `&tt=${deck.tower_troop}` : "";
  return `https://${HOST}/en/?clashroyale://copyDeck?deck=${deck.cards.join(";")}${tt}`;
}
