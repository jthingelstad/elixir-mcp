# 2026-11-26 — Every deck shows just the cards

Jamie, 2026-11-26: "Displays of decks inside of sessions still have 'evo'
and 'hero' labels as well as elixir scores. These need to be updated to
be the same 'just the cards' as other displays." And: "Individual battle
pages should remove the elixir score overlay from the cards."

This carries the 2026-11-23 Timeline change
(`2026-11-23-timeline-card-art-alone.md`) to the places it left out.

- **Session page** (`SessionPage`, and an opened session's games in
  `SessionGames`, both the run's deck and the other side's): `DeckRow`
  with `showForm={false}` and no cost drop.
- **Battle page** (`Battle.jsx` `DeckPanel`, so both sides and each duel
  round): `DeckGrid` with `showForm={false}`. The battle page never drew an
  elixir cost on a card, so nothing else goes: each card keeps its level
  pill (Jamie, 2026-11-26: "Don't remove card levels"), and the panel's
  facts (average elixir, the four cheapest cards, average card level) and
  the Side by side table are unchanged.
- **Also brought in line:** Home's week panel's most played deck
  (`Today.jsx`), and the composer's preview of a pasted deck and of picked
  cards (`Post.jsx`), so a post looks the same before and after it is
  posted.
- **The kit.** `DeckGrid` gains `showForm`, passed to `CardArt`.
  `showCost` is gone from `DeckRow` and `DeckVersus` (no caller was left),
  with the `.card-elixir`, `.kit-deckrow__cost` and `.kit-deckrow__said`
  rules and the `--elixir-drop`, `--elixir-drop-deck` and `--t-card-cost`
  tokens.
- **Kept on purpose:** Stats (its decks and cards keep the ribbon; it is
  the season read back, elixir included), a post's deck line with its
  average elixir, the card pages, the verify challenge's deck, mail and
  the share picture.
