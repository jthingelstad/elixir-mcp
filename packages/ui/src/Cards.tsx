import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "./Link.tsx";

/**
 * Cards as the game draws them (design canvas, 2026-10-01): the art
 * Elixir mirrors at /assets/cards/, a ribbon for an Evo or Hero form,
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

/** The mirrored widths (infra/scripts/mirror-card-art.mjs). */
const WIDTHS = [128, 192, 285] as const;
const SUFFIX: Record<CardForm, string> = {
  base: "",
  evolution: "_evo",
  hero: "_hero",
};
const FORM_LABEL: Partial<Record<CardForm, string>> = {
  evolution: "Evo",
  hero: "Hero",
};

/** Tower troops (159xxxxxx) have no mirrored art. */
export const isTowerTroop = (id: number) => id >= 159000000 && id < 160000000;

/** The mirrored art for a card at the smallest width that is sharp at
 *  `size` CSS pixels on a 2x screen. */
export function cardArtSrc(
  id: number,
  form: CardForm | null = "base",
  size = 64,
): string {
  const want = size * 2;
  const width = WIDTHS.find((w) => w >= want) ?? WIDTHS[WIDTHS.length - 1];
  return `/assets/cards/${id}${SUFFIX[form ?? "base"]}-${width}.png`;
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
  // is its name in the frame, never a broken image.
  const [missing, setMissing] = useState(false);
  const form = card.form ?? "base";
  const label = cardLabel(card);
  const alt = card.level ? `${label}, level ${card.level}` : label;
  const style = { "--card-w": `${size}px` } as CSSProperties;
  const ribbon = FORM_LABEL[form];
  const body: ReactNode = (
    <>
      <span className="card-art__frame">
        {isTowerTroop(card.id) || missing ? (
          <span className="card-art__blank" aria-hidden="true">
            {card.name}
          </span>
        ) : (
          <img
            className="card-art__img"
            src={cardArtSrc(card.id, form, size)}
            alt=""
            width={size}
            height={Math.round((size * 420) / 285)}
            loading="lazy"
            decoding="async"
            onError={() => setMissing(true)}
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
