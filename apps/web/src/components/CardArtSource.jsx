import { useCallback, useMemo, useState } from "react";
import { CardArtProvider } from "@elixir-mcp/ui";
import { useCardCatalog } from "../lib/queries.js";

/**
 * Every card tile's art, from the catalog's `art` (2026-10-08, Jamie:
 * "Card art should be in the api response for cards"). A tile draws the
 * form the catalog names, else the base card, else the card's name; it
 * never builds a file name for a form the catalog does not list. While
 * the catalog loads the frames stay empty; if it cannot be read, tiles
 * fall back to the mirror's own names. The catalog is read only once a
 * tile asks for it (`want`), so a page with no card never reads it.
 */
export function cardArtSource(query, want) {
  if (query.isPending) return { status: "loading", art: () => null, want };
  if (query.isError || !Array.isArray(query.data?.cards))
    return { status: "unavailable", art: () => null, want };
  const byId = new Map(query.data.cards.map((c) => [c.id, c.art ?? null]));
  return { status: "ready", art: (id) => byId.get(id) ?? null, want };
}

export function CardArtSource({ children }) {
  const [wanted, setWanted] = useState(false);
  const want = useCallback(() => setWanted(true), []);
  const { isPending, isError, data } = useCardCatalog({ enabled: wanted });
  const value = useMemo(
    () => cardArtSource({ isPending, isError, data }, want),
    [isPending, isError, data, want],
  );
  return <CardArtProvider value={value}>{children}</CardArtProvider>;
}
