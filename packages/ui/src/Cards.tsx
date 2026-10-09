import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "./Link.tsx";

/**
 * Cards as the game draws them (design canvas, 2026-10-01): the art the
 * card catalog names (2026-10-08: "Card art should be in the api
 * response for cards"), a ribbon for an Evo or Hero form,
 * and the level under the card. One tile for every surface that shows
 * a card or a deck — the battle page, Ladder, Clan, the console — so a
 * deck reads the same wherever it is. Levels are the in-game 1-16
 * scale the contract serves (`displayLevel`); form is the form PLAYED
 * and is never merged with the base card.
 */

/** The forms a played card can take (contract: form base|evolution|hero). */
export type CardForm = "base" | "evolution" | "hero";

export interface DeckCard {
  id: number;
  name: string;
  form?: CardForm | null;
  level?: number | null;
}

/** The mirror's file suffix per form (contracts cardArtPath). */
const SUFFIX: Record<CardForm, string> = {
  base: "",
  evolution: "_evo",
  hero: "_hero",
};
const FORM_LABEL: Partial<Record<CardForm, string>> = {
  evolution: "Evo",
  hero: "Hero",
};

/** A card's art by form, as the catalog serves it (`art`). */
export type CardArtMap = Partial<Record<CardForm, string>>;

/** Where tiles find art: the app reads the catalog once and provides
 *  it. `loading` draws empty frames; `unavailable` (the catalog could
 *  not be read) falls back to the mirror's own names. `want`, when the
 *  source has it, is called by the first tile that mounts, so a page
 *  with no card never reads the catalog. */
export interface CardArtSource {
  status: "loading" | "ready" | "unavailable";
  art: (id: number) => CardArtMap | null | undefined;
  want?: () => void;
}

const CardArtContext = createContext<CardArtSource | null>(null);

/** Supplies the catalog's art to every tile below it. */
export function CardArtProvider({
  value,
  children,
}: {
  value: CardArtSource;
  children: ReactNode;
}) {
  return (
    <CardArtContext.Provider value={value}>{children}</CardArtContext.Provider>
  );
}

/** The images a tile tries, in order: the played form's art, then the
 *  base card's; past the last, the card's name. Null while the catalog
 *  is still loading. Each is the mirror's one file for that form,
 *  Supercell's own bytes (Jamie, 2026-10-08: "you cannot resize the
 *  images or alter them in anyway"): the tile sizes it with width,
 *  height and CSS, never by asking for a smaller copy. */
export function artCandidates(
  card: Pick<DeckCard, "id" | "form">,
  source: CardArtSource | null,
): string[] | null {
  const form = card.form ?? "base";
  if (source?.status === "loading") return null;
  if (source?.status === "ready") {
    const art = source.art(card.id);
    return [...new Set([art?.[form], art?.base].filter(Boolean) as string[])];
  }
  // No catalog: the mirror's own names, the form then the base card.
  return [...new Set([cardArtSrc(card.id, form), cardArtSrc(card.id, "base")])];
}

/** Tower troops (159xxxxxx) have no mirrored art. */
export const isTowerTroop = (id: number) => id >= 159000000 && id < 160000000;

/** The mirrored art for a card and form: the one file, as Supercell
 *  serves it. */
export function cardArtSrc(id: number, form: CardForm | null = "base"): string {
  return `/assets/cards/${id}${SUFFIX[form ?? "base"]}.png`;
}

/** The label a person reads for a card: "Evo Royal Hogs", "Hero Knight". */
export function cardLabel(card: Pick<DeckCard, "name" | "form">): string {
  const f = card.form ? FORM_LABEL[card.form] : undefined;
  return f ? `${f} ${card.name}` : card.name;
}

/** One card: its art, its form ribbon and its level. `size` is the art's
 *  width in CSS pixels; the art keeps the game's 285:420 frame. With
 *  `to` it is a link (never put one inside another link: pass no `to`
 *  there, or the browser splits the links and the tiles fall apart). */
export function CardArt({
  card,
  size = 64,
  to,
  showName = false,
  showLevel = true,
}: {
  card: DeckCard;
  size?: number;
  to?: string | undefined;
  showName?: boolean;
  showLevel?: boolean;
}) {
  // A card Elixir has no art for (Mirror, a card newer than the mirror)
  // is its name in the frame, never a broken image; a form the mirror
  // lacks draws the base card under its ribbon first.
  const source = useContext(CardArtContext);
  const want = source?.want;
  useEffect(() => want?.(), [want]);
  const [failed, setFailed] = useState<string[]>([]);
  const form = card.form ?? "base";
  const label = cardLabel(card);
  const alt = card.level ? `${label}, level ${card.level}` : label;
  const style = { "--card-w": `${size}px` } as CSSProperties;
  const ribbon = FORM_LABEL[form];
  const candidates = isTowerTroop(card.id) ? [] : artCandidates(card, source);
  const src = candidates?.find((u) => !failed.includes(u));
  const body: ReactNode = (
    <>
      <span className="card-art__frame">
        {candidates === null ? null : !src ? (
          <span className="card-art__blank" aria-hidden="true">
            {card.name}
          </span>
        ) : (
          <img
            key={src}
            className="card-art__img"
            src={src}
            alt=""
            width={size}
            height={Math.round((size * 420) / 285)}
            loading="lazy"
            decoding="async"
            onError={() => setFailed((f) => [...f, src])}
          />
        )}
        {ribbon ? (
          <span className={`card-art__form card-art__form--${form}`}>
            {ribbon}
          </span>
        ) : null}
      </span>
      {showLevel && card.level ? (
        <span className="card-art__level">{card.level}</span>
      ) : null}
      {showName ? <span className="card-art__name">{label}</span> : null}
    </>
  );
  if (to)
    return (
      <Link
        to={to}
        className="card-art"
        style={style}
        title={alt}
        aria-label={alt}
      >
        {body}
      </Link>
    );
  return (
    <span
      className="card-art"
      style={style}
      title={alt}
      role="img"
      aria-label={alt}
    >
      {body}
    </span>
  );
}

/** A deck as the game lays it out: two rows of four (`columns` 8 for one
 *  strip). Cards are in the order played. */
export function DeckGrid({
  cards,
  size = 64,
  columns = 4,
  showLevel = true,
  cardTo,
  label,
}: {
  cards: DeckCard[];
  size?: number;
  columns?: 4 | 8;
  showLevel?: boolean;
  cardTo?: ((card: DeckCard) => string | undefined) | undefined;
  label?: string | undefined;
}) {
  return (
    <ul
      className={`deck-grid deck-grid--${columns}`}
      aria-label={label ?? "Deck"}
    >
      {cards.map((c, i) => (
        <li key={`${c.id}-${i}`}>
          <CardArt
            card={c}
            size={size}
            showLevel={showLevel}
            to={cardTo?.(c)}
          />
        </li>
      ))}
    </ul>
  );
}

/** A deck's elixir facts from its cards' costs (the catalog's
 *  elixir_cost): the average over the eight, and the 4-card cycle (the
 *  four cheapest, what it costs to see a card again). Null where a cost
 *  is missing, never a guess. */
export function deckElixir(
  cards: Pick<DeckCard, "id">[],
  costOf: (id: number) => number | null | undefined,
): { average: number | null; cycle4: number | null } {
  const costs = cards.map((c) => costOf(c.id));
  if (cards.length === 0 || costs.some((c) => c == null))
    return { average: null, cycle4: null };
  const known = costs as number[];
  const average = known.reduce((a, c) => a + c, 0) / known.length;
  const cycle4 =
    known.length >= 4
      ? [...known]
          .sort((a, b) => a - b)
          .slice(0, 4)
          .reduce((a, c) => a + c, 0)
      : null;
  return { average: Math.round(average * 10) / 10, cycle4 };
}
