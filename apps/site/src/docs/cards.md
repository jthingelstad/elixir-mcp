---
slug: cards
title: "Cards in the record"
description: "Card catalog facts, forms, recorded inventory and the cards you and your clan have played."
section: record
order: 4
navTitle: "Cards"
icon: layers
lede: "The cards you hold and the cards you played, as recorded."
---

# Cards in the record

Elixir keeps the card catalog, your observed card inventory, the cards on each battle side and exact deck identities. These are facts from the API and your recorded history.

## The places a card lives

| place | what it holds |
| --- | --- |
| Catalog | Id, name, type, rarity, elixir cost, icons, art and available forms. |
| Battle side | Played card, form, slot and level on the in-game 1–16 scale. |
| Deck identity | Exact card/form pairs plus tower troop, identified by `deck_hash`; levels are separate. |
| Player inventory | Last observed level, count, unlocked forms and star level, with observation timestamps. |

**Forms.** Played cards say `form: "base" | "evolution" | "hero"`. Inventory and catalog list sets as `forms_unlocked` and `forms_available`. The API encodes these as `evolutionLevel`: 1 Evolution, 2 Hero, 3 both. See [Deck identity and forms](/docs/battles#deck-identity-and-forms).

**Levels.** Recorded tools serve the in-game 1–16 scale. Raw API payloads use rarity-relative levels; `cards_catalog` carries `maxLevelRarityScale` for joining to them. Level differences describe the games that happened, as explained in [Methodology](/docs/methodology#card-levels-described-not-adjusted-for).

## One card in one call

`cards_card` takes an exact card name or `card_id` and a required subject: `segment: "mine"` for your clan, `{player_tag}` for one player, or `{clan_tag}` for a clan's current members. It serves catalog facts and `card.first_played {base, evolution, hero}`: the earliest play of each form in that selected recorded history. A form never observed stays null.

`first_seen_in_catalog` is when Elixir stored the catalog row, not the card's release date. The API does not provide release dates, descriptions or combat statistics.

For a clan, `members.played` lists current members who played the card in the requested window, with battle counts, wins/losses, levels and forms. A duel contributes each recorded round. `members.held` lists observed inventory with `observed_at` and `since`; missing inventory is unknown. Membership is current at the time of the call, including members' earlier games. The window defaults to the current season; `season`, `from`/`to` and `mode` can narrow the played list. `first_played` spans the whole selected history. Compact verbosity drops the member lists.

Card history reads use the selected players' recorded games before looking up card details. Repeated decks still contribute every played game and duel round; they share one earliest-play lookup for each card form.

## Which tool for which card question

| question | tool |
| --- | --- |
| What is this card, and which forms exist? | `cards_catalog` |
| When did this player first play it? Who in this clan played or holds it? | `cards_card` |
| Which cards did I play, or face, in my games? | `battles_cards` with `perspective` |
| My battles with or against a card | `battles_query` with `with_card`, `with_cards` or `against_card` |
| My observed card levels and forms | `players_collection` |
| Which decks did I play? | `battles_decks` |
| What is this deck called? | `cards_archetype` |

## Card art

Card responses carry each card's art by form: `art: {base, evolution, hero}` on `cards_catalog` when `ids` or `query` name the cards, on `card.art` in `cards_card`, and on the public catalog at `/api/public/cards`. A form is there when the API's own `iconUrls` lists it, so the art is the game's. Each address is an image on Elixir's own origin: an exact copy of the file the API's icon URL serves, byte for byte, never resized, re-encoded or otherwise altered, so there is one image per card and form (285 by 420 pixels as Supercell publishes them). Show it at any size with HTML or CSS (`width` and `height` on the image); there are no smaller copies. Elixir copies the images from the API's addresses, so a page showing them never sends its reader to Supercell's servers. `iconUrls` stays as the API serves it.

Draw a played card's form art, else the base card's art, else its name. The API lists a new card or form about two weeks before Supercell publishes its image (on 2026-10-08, Hero Electro Wizard and Evo Electro Giant), so a missing form is expected then: Elixir tries again on every update and copies the image once it answers. Until then that address does not answer, and the base card stands in. Tower troops carry no art yet. The unnarrowed `cards_catalog` leaves `art` out to stay under the result cap.

## Tower troops

A tower troop is the ninth card in a deck identity. The API reports none on river race battles; that absence stays unknown. Two otherwise identical decks with different tower troops have different hashes. `players_collection` lists observed tower troops as `support_cards`; `cards_card` can describe a tower troop and its earliest selected-history play. `cards_catalog` lists them under `tower_troops`, apart from `cards`.

## A card's own page

Every deck card has a public page at `/cards/<card id>` with its name, art, rarity, cost and forms; tower troops have none. A battle's page and Ladder's decks link each card there. These pages serve catalog facts only.

Earliest play uses the recorded deck identity for each game or duel round; it does not infer a release date or compare your play with the game as a whole.

Card history counts your own boat attacks and excludes boat defenses, where
someone else attacked your boat. Earliest play keeps the recorded form; duel
member counts use each played round.
