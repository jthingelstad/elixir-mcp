# 2026-11-23 — Card art alone on the Timeline; player pages draw like it

Jamie, 2026-11-23: "On the timeline events lets move to JUST showing the
card art. Remove the hero or evo CSS decoration, the card art is
different. Also remove the Elixir cost." And: "when we show a player
earned a badge show the badge at a similar size to the cards", and "on a
players individual profile pages cards are not shown and badges are not
shown. They should use a similar display to the timeline itself."

- **The kit.** `CardArt`, `DeckRow` and `DeckVersus` take `showForm`
  (default true). False draws the art alone, with no Evo or Hero ribbon;
  the tile's accessible name still says the form ("Evo Musketeer").
- **The Timeline's tiles** pass `showForm={false}` and no `showCost`: a
  session's deck, a deck switch, a moment's card (big and one-line), a
  Mastery day's cards, and a post's battle, deck and cards. A post's deck
  keeps its average elixir line. The session page and an opened session's
  games (`SessionPage`, `SessionGames`), Stats, the battle page and the
  composer are not Timeline items and keep the ribbon and costs.
- **Badges.** A badge in a one-line moment is 48px wide, a deck row
  card's width, not the line's 24px mark. A big badge moment was already
  56px, its card's size.
- **Player and account pages.** Their reads (`routes/player.mjs`,
  `account-page.mjs`) run the Timeline's `annotateFeed`, so each item
  carries `moment_card`, `moment_cards`, `badge_art`, `deck`,
  `battle_url` and `avatar_card_id`. `ItemList` draws each day with the
  Timeline's `FeedRows`, and the player's Moments tab is the same list over
  its moments; the old medal tiles and the Moments grid are gone with
  their CSS. A player page's sitting with no page of its own still opens
  its games in place (`FeedRows` gains `canOpen`), and the account page
  leaves out **Open their account** on its own items (`accountLinks`).
