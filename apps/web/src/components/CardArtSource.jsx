import { useMemo } from "react";
import { CardArtProvider } from "@elixir-mcp/ui";
import { useCardCatalog } from "../lib/queries.js";

/**
 * Every card tile's art, from the catalog's `art` (2026-10-08, Jamie:
 * "Card art should be in the api response for cards"). A tile draws the
 * form the catalog names, else the base card, else the card's name; it
 * never builds a file name for a form the catalog does not list. While
 * the catalog loads the frames stay empty; if it cannot be read, tiles
 * fall back to the mirror's own names.
 */
export function cardArtSource(query) {
  if (query.isPending) return { status: "loading", art: () => null };
  if (query.isError || !Array.isArray(query.data?.cards))
    return { status: "unavailable", art: () => null };
  const byId = new Map(query.data.cards.map((c) => [c.id, c.art ?? null]));
  return { status: "ready", art: (id) => byId.get(id) ?? null };
}

export function CardArtSource({ children }) {
  const { isPending, isError, data } = useCardCatalog();
  const value = useMemo(
    () => cardArtSource({ isPending, isError, data }),
    [isPending, isError, data],
  );
  return <CardArtProvider value={value}>{children}</CardArtProvider>;
}
